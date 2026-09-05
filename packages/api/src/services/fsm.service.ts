import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { randomUUID } from 'crypto';
import {
  TableFSMState,
  SignalSource,
  isValidTransition,
  getNextState,
  STATE_COLORS,
  STATE_EMOJIS,
  TableStateChangedEvent,
  OccupancyCompletedEvent
} from '@mesaya/shared';

export interface TransitionParams {
  tableId: string;
  toState: TableFSMState;
  source: SignalSource;
  trigger: string;
  staffUserId?: string | null;
  metadata?: Record<string, unknown>;
  isOverride?: boolean;
  expectedCurrentState?: TableFSMState;
}

export interface TransitionResult {
  success: boolean;
  tableId: string;
  tableLabel: string;
  restaurantId: string;
  previousState: TableFSMState;
  newState: TableFSMState;
  source: SignalSource;
  stateEventId: string;
  stateChangedAt: string;
  occupancyMinutes: number | null;
}

export class FSMService {
  /**
   * Attempts an atomic state transition on a given table.
   * Employs optimistic concurrency locking and full audit logging.
   */
  async attemptTransition(params: TransitionParams): Promise<TransitionResult> {
    const { tableId, toState, source, trigger, staffUserId, metadata, isOverride, expectedCurrentState } = params;

    // 1. Fetch current table state
    const table = await prisma.table.findUnique({
      where: { id: tableId },
      include: {
        floorZone: true,
        restaurant: true,
        sessions: {
          where: { closedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: {
            calls: {
              where: { status: { in: ['PENDING', 'IN_PROGRESS'] } },
              orderBy: { createdAt: 'desc' },
              take: 1
            }
          }
        }
      }
    });

    if (!table) {
      const error: any = new Error(`Mesa con ID ${tableId} no encontrada`);
      error.statusCode = 404;
      error.code = 'TABLE_NOT_FOUND';
      throw error;
    }

    const fromState = (table.currentState as TableFSMState) || TableFSMState.AVAILABLE;

    // Pre-condition check: if expectedCurrentState was explicitly provided, it must match current state
    if (expectedCurrentState && fromState !== expectedCurrentState) {
      const error: any = new Error(
        `Conflicto de concurrencia: se esperaba el estado ${expectedCurrentState} pero la mesa se encuentra en ${fromState}`
      );
      error.statusCode = 409;
      error.code = 'STATE_CONFLICT';
      error.details = {
        tableId,
        currentState: fromState,
        expectedState: expectedCurrentState,
        attemptedToState: toState
      };
      throw error;
    }

    // 2. Validate transition
    const allowed = isValidTransition(fromState, toState, isOverride ?? false);
    if (!allowed) {
      const error: any = new Error(
        `Transición no permitida: no se puede pasar de ${fromState} a ${toState}`
      );
      error.statusCode = 422;
      error.code = 'INVALID_TRANSITION';
      error.details = { fromState, toState, allowed: false };
      throw error;
    }

    // 3. Optimistic atomic update using table's current state
    const now = new Date();
    const conditionState = expectedCurrentState ?? fromState;
    const updateResult = await prisma.table.updateMany({
      where: {
        id: tableId,
        currentState: conditionState
      },
      data: {
        currentState: toState,
        stateChangedAt: now
      }
    });

    if (updateResult.count === 0) {
      // Concurrency conflict: another staff or automated process updated the state simultaneously
      const freshTable = await prisma.table.findUnique({ where: { id: tableId } });
      const error: any = new Error(
        `Conflicto de concurrencia: la mesa ${table.label} cambió a ${freshTable?.currentState} simultáneamente`
      );
      error.statusCode = 409;
      error.code = 'STATE_CONFLICT';
      error.details = {
        tableId,
        currentState: freshTable?.currentState,
        expectedState: conditionState,
        attemptedToState: toState
      };
      throw error;
    }

    // 4. Record immutable audit event
    const stateEvent = await prisma.tableStateEvent.create({
      data: {
        tableId,
        fromState,
        toState,
        trigger,
        source,
        staffUserId: staffUserId ?? null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        createdAt: now
      }
    });

    // 5. Manage OccupancySession lifecycle
    await this.handleOccupancySessionLifecycle(table, fromState, toState, now);

    // Auto-resolve any pending or in-progress calls when table is cleared or reset
    if (toState === TableFSMState.TO_CLEAN || toState === TableFSMState.AVAILABLE) {
      const openSessions = await prisma.tableSession.findMany({
        where: { tableId: table.id },
        select: { id: true }
      });

      if (openSessions.length > 0) {
        const sessionIds = openSessions.map((s) => s.id);
        const pendingCalls = await prisma.callRequest.findMany({
          where: {
            tableSessionId: { in: sessionIds },
            status: { in: ['PENDING', 'IN_PROGRESS'] }
          }
        });
        if (pendingCalls.length > 0) {
          await prisma.callRequest.updateMany({
            where: { id: { in: pendingCalls.map((c) => c.id) } },
            data: { status: 'RESOLVED', resolvedAt: now }
          });
          for (const c of pendingCalls) {
            eventBus.broadcastCall(
              {
                id: c.id,
                restaurantId: table.restaurantId,
                tableId: table.id,
                tableLabel: table.label,
                sector: table.sector as any,
                type: c.type as any,
                paymentMethod: c.paymentMethod as any,
                note: c.note,
                origin: c.origin as any,
                status: 'RESOLVED' as any,
                createdAt: c.createdAt.toISOString(),
                resolvedAt: now.toISOString()
              },
              'call.updated'
            );
          }
        }
      }
    }

    // Revoke all active guest sessions when table transitions to TO_CLEAN or AVAILABLE (idempotent)
    if (toState === TableFSMState.TO_CLEAN || toState === TableFSMState.AVAILABLE) {
      await prisma.tableSession.updateMany({
        where: { tableId: table.id, closedAt: null },
        data: { closedAt: now }
      });
    }

    // 6. Calculate occupancy minutes from start of dining session
    let occupancyMinutes: number | null = null;
    if (toState !== TableFSMState.AVAILABLE && toState !== TableFSMState.RESERVED) {
      const activeOccSession = await prisma.occupancySession.findFirst({
        where: { tableId: table.id, cleanedAt: null },
        select: { seatedAt: true }
      });
      const startTime = activeOccSession ? activeOccSession.seatedAt.getTime() : now.getTime();
      occupancyMinutes = Math.max(0, Math.floor((now.getTime() - startTime) / 60000));
    }

    const activeSession = table.sessions[0];
    const activeCall = activeSession?.calls[0];

    // 7. Resolve staff name for broadcast
    let staffName: string | null = null;
    if (staffUserId) {
      const staff = await prisma.staffUser.findUnique({ where: { id: staffUserId } });
      if (staff) staffName = staff.name;
    }

    // 8. Broadcast real-time SSE event to all connected salon tablets (<50ms)
    const stateColor = STATE_COLORS[toState]?.hex ?? '#22c55e';
    const stateEmoji = STATE_EMOJIS[toState] ?? '🟢';

    const sseEvent: TableStateChangedEvent = {
      tableId: table.id,
      tableLabel: table.label,
      restaurantId: table.restaurantId,
      floorZoneId: table.floorZoneId,
      zoneName: table.floorZone?.name ?? null,
      previousState: fromState,
      newState: toState,
      stateColor,
      stateEmoji,
      trigger,
      source,
      staffUserId: staffUserId ?? null,
      staffName,
      occupancyMinutes,
      activeCall: activeCall
        ? {
            id: activeCall.id,
            type: activeCall.type,
            paymentMethod: activeCall.paymentMethod
          }
        : null,
      timestamp: now.toISOString()
    };

    eventBus.broadcastTableState(sseEvent);

    return {
      success: true,
      tableId: table.id,
      tableLabel: table.label,
      restaurantId: table.restaurantId,
      previousState: fromState,
      newState: toState,
      source,
      stateEventId: stateEvent.id,
      stateChangedAt: now.toISOString(),
      occupancyMinutes
    };
  }

  /**
   * Helper to execute 1-Tap actions from the central salon tablet
   */
  async handleTapAction(
    tableId: string,
    action: 'next' | 'skip_to' | 'revert',
    targetState?: TableFSMState,
    staffUserId?: string,
    note?: string,
    expectedCurrentState?: TableFSMState
  ): Promise<TransitionResult> {
    const table = await prisma.table.findUnique({ where: { id: tableId } });
    if (!table) {
      const error: any = new Error(`Mesa con ID ${tableId} no encontrada`);
      error.statusCode = 404;
      error.code = 'TABLE_NOT_FOUND';
      throw error;
    }

    const current = (table.currentState as TableFSMState) || TableFSMState.AVAILABLE;

    if (expectedCurrentState && current !== expectedCurrentState) {
      const error: any = new Error(
        `Conflicto de concurrencia: se esperaba el estado ${expectedCurrentState} pero la mesa se encuentra en ${current}`
      );
      error.statusCode = 409;
      error.code = 'STATE_CONFLICT';
      error.details = {
        tableId,
        currentState: current,
        expectedState: expectedCurrentState
      };
      throw error;
    }

    let next: TableFSMState;

    if (action === 'skip_to') {
      if (!targetState) {
        const error: any = new Error("targetState requerido para acción 'skip_to'");
        error.statusCode = 400;
        error.code = 'MISSING_TARGET_STATE';
        throw error;
      }
      next = targetState;
    } else if (action === 'next') {
      next = getNextState(current);
    } else {
      // Revert to previous logged state
      const lastEvent = await prisma.tableStateEvent.findFirst({
        where: { tableId },
        orderBy: { createdAt: 'desc' }
      });
      next = (lastEvent?.fromState as TableFSMState) || TableFSMState.AVAILABLE;
    }

    return this.attemptTransition({
      tableId,
      toState: next,
      source: SignalSource.STAFF_TERMINAL_TAP,
      trigger: note || `1-Tap Tablet: ${action} (${current} -> ${next})`,
      staffUserId,
      expectedCurrentState: expectedCurrentState ?? current
    });
  }

  /**
   * Manages OccupancySession creation, phase timestamps, and final turn-time calculation
   */
  private async handleOccupancySessionLifecycle(
    table: { id: string; label: string; restaurantId: string; shiftId?: string | null },
    fromState: TableFSMState,
    toState: TableFSMState,
    timestamp: Date
  ): Promise<void> {
    try {
      // 1. Starting a new occupancy cycle (AVAILABLE -> OCCUPIED_NO_ORDER or RESERVED -> OCCUPIED_NO_ORDER)
      if (toState === TableFSMState.OCCUPIED_NO_ORDER) {
        const existingOpen = await prisma.occupancySession.findFirst({
          where: { tableId: table.id, cleanedAt: null }
        });

        if (!existingOpen) {
          await prisma.occupancySession.create({
            data: {
              tableId: table.id,
              restaurantId: table.restaurantId,
              seatedAt: timestamp
            }
          });
        }

        // Ensure fresh TableSession for diners if an active shift is open
        const activeShift = await prisma.shift.findFirst({
          where: { restaurantId: table.restaurantId, closedAt: null }
        });
        if (activeShift) {
          const activeTableSession = await prisma.tableSession.findFirst({
            where: {
              tableId: table.id,
              shiftId: activeShift.id,
              closedAt: null,
              expiresAt: { gt: timestamp }
            }
          });
          if (!activeTableSession) {
            const expiresAt = new Date(timestamp.getTime() + 4 * 60 * 60 * 1000);
            await prisma.tableSession.create({
              data: {
                tableId: table.id,
                shiftId: activeShift.id,
                token: randomUUID(),
                expiresAt,
                createdAt: timestamp
              }
            });
          }
        }
      }

      // 2. Mid-cycle timestamp updates
      const openSession = await prisma.occupancySession.findFirst({
        where: { tableId: table.id, cleanedAt: null },
        orderBy: { seatedAt: 'desc' }
      });

      if (openSession) {
        const updates: Record<string, any> = {};

        if (toState === TableFSMState.ORDER_IN_KITCHEN && !openSession.orderedAt) {
          updates.orderedAt = timestamp;
        } else if (toState === TableFSMState.EATING && !openSession.servedAt) {
          updates.servedAt = timestamp;
        } else if (toState === TableFSMState.BILL_REQUESTED && !openSession.billAt) {
          updates.billAt = timestamp;
        } else if (toState === TableFSMState.PAID && !openSession.paidAt) {
          updates.paidAt = timestamp;
        } else if (toState === TableFSMState.TO_CLEAN && !openSession.vacatedAt) {
          updates.vacatedAt = timestamp;
        }

        // 3. Completing the cycle (Table cleaned and released to AVAILABLE)
        if (toState === TableFSMState.AVAILABLE) {
          updates.cleanedAt = timestamp;
          const seatedTime = openSession.seatedAt.getTime();
          const cleanedTime = timestamp.getTime();

          const totalMinutes = Math.max(1, Math.round((cleanedTime - seatedTime) / 60000));
          updates.durationMinutes = totalMinutes;
          updates.turnTimeMinutes = totalMinutes;

          if (openSession.orderedAt) {
            updates.timeToOrderMinutes = Math.max(
              0,
              Math.round((openSession.orderedAt.getTime() - seatedTime) / 60000)
            );
          }

          if (openSession.servedAt && openSession.orderedAt) {
            updates.timeToServeMinutes = Math.max(
              0,
              Math.round((openSession.servedAt.getTime() - openSession.orderedAt.getTime()) / 60000)
            );
          }

          if (openSession.vacatedAt && openSession.paidAt) {
            updates.dwellAfterPayMinutes = Math.max(
              0,
              Math.round((openSession.vacatedAt.getTime() - openSession.paidAt.getTime()) / 60000)
            );
          }

          // Broadcast occupancy completed event for analytics
          const updatedSession = await prisma.occupancySession.update({
            where: { id: openSession.id },
            data: updates
          });

          const completedEvent: OccupancyCompletedEvent = {
            tableId: table.id,
            tableLabel: table.label,
            restaurantId: table.restaurantId,
            session: {
              id: updatedSession.id,
              partySize: updatedSession.partySize,
              seatedAt: updatedSession.seatedAt.toISOString(),
              orderedAt: updatedSession.orderedAt?.toISOString() ?? null,
              servedAt: updatedSession.servedAt?.toISOString() ?? null,
              billAt: updatedSession.billAt?.toISOString() ?? null,
              paidAt: updatedSession.paidAt?.toISOString() ?? null,
              vacatedAt: updatedSession.vacatedAt?.toISOString() ?? null,
              cleanedAt: updatedSession.cleanedAt ? updatedSession.cleanedAt.toISOString() : timestamp.toISOString(),
              totalRevenue: updatedSession.totalRevenue,
              durationMinutes: updatedSession.durationMinutes,
              turnTimeMinutes: updatedSession.turnTimeMinutes,
              phases: {
                timeToOrderMinutes: updatedSession.timeToOrderMinutes,
                timeToServeMinutes: updatedSession.timeToServeMinutes,
                dwellAfterPayMinutes: updatedSession.dwellAfterPayMinutes
              }
            },
            timestamp: timestamp.toISOString()
          };

          eventBus.broadcastOccupancyCompleted(completedEvent);
          return;
        }

        if (Object.keys(updates).length > 0) {
          await prisma.occupancySession.update({
            where: { id: openSession.id },
            data: updates
          });
        }
      }
    } catch (err) {
      console.error('Error actualizando OccupancySession en FSM:', err);
    }
  }
}

export const fsmService = new FSMService();

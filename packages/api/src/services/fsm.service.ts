import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { SessionService } from './session.service';
import {
  TableFSMState,
  SignalSource,
  isValidTransition,
  isProhibitedJump,
  getNextState,
  STATE_COLORS,
  STATE_EMOJIS,
  TableStateChangedEvent,
  OccupancyCompletedEvent
} from '@mesaya/shared';

export interface TransitionParams {
  tableId: string;
  toState: TableFSMState;
  /** Optional caller snapshot used to turn a stale intent into a clean 409. */
  fromState?: TableFSMState;
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
  // Serialize transitions per table inside one API process. The updateMany
  // CAS remains authoritative for cross-process races; this queue prevents a
  // burst of local taps from piling up on SQLite locks and makes each stale
  // intent return the documented 409 conflict instead of a driver timeout.
  private readonly transitionInFlight = new Map<string, Promise<TransitionResult>>();

  /**
   * Attempts an atomic state transition on a given table.
   * Employs optimistic concurrency locking and full audit logging.
   */
  async attemptTransition(params: TransitionParams): Promise<TransitionResult> {
    const previous = this.transitionInFlight.get(params.tableId) ?? Promise.resolve(undefined);
    const operation = previous.catch(() => undefined).then(() => this.attemptTransitionInternal(params));
    const tracked = operation.finally(() => {
      if (this.transitionInFlight.get(params.tableId) === tracked) {
        this.transitionInFlight.delete(params.tableId);
      }
    });
    this.transitionInFlight.set(params.tableId, tracked);
    return tracked;
  }

  private async attemptTransitionInternal(params: TransitionParams): Promise<TransitionResult> {
    const { tableId, toState, source, trigger, staffUserId, metadata, isOverride } = params;
    const expectedCurrentState = params.expectedCurrentState ?? params.fromState;

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

    // 2. Contrato operativo Gate A: saltos que reabren ocupación o saltan
    // limpieza, prohibidos incluso con override. Sólo `Mesa lista` hace
    // TO_CLEAN -> AVAILABLE.
    if (isProhibitedJump(fromState, toState)) {
      const error: any = new Error(
        `Transición prohibida por contrato operativo: no se puede pasar de ${fromState} a ${toState} sin completar limpieza/rotación explícita`
      );
      error.statusCode = 422;
      error.code = 'INVALID_TRANSITION';
      error.details = { fromState, toState, allowed: false, jumpProhibited: true };
      throw error;
    }

    // 2b. El override administrativo YA NO es un bypass universal: sólo
    // documenta (auditoría) una transición que ya es válida por matriz y que
    // además supera los guardas de cuenta/pendientes (H2). Un salto fuera de
    // matriz con override se rechaza igual que sin override.
    const allowed = isValidTransition(fromState, toState, false);
    if (!allowed) {
      const error: any = new Error(
        `Transición no permitida: no se puede pasar de ${fromState} a ${toState}`
      );
      error.statusCode = 422;
      error.code = 'INVALID_TRANSITION';
      error.details = { fromState, toState, allowed: false, overrideRejected: Boolean(isOverride) };
      throw error;
    }

    // 2c. H2: TO_CLEAN/AVAILABLE nunca cierran silenciosamente. Antes de mutar,
    // validar saldo, borrador, validación pendiente y llamados; si hay algo
    // pendiente se rechaza con 409 accionable y la sesión queda intacta.
    if (toState === TableFSMState.TO_CLEAN || toState === TableFSMState.AVAILABLE) {
      if (fromState === TableFSMState.TO_CLEAN && toState === TableFSMState.AVAILABLE) {
        // `Mesa lista` explícita: valida que no quede ocupación con pendientes.
        await this.assertTableClearableForFsm(tableId);
      } else if (toState === TableFSMState.TO_CLEAN) {
        await this.assertTableClearableForFsm(tableId);
      } else {
        // AVAILABLE directo desde otro estado sólo es válido vía matriz en
        // casos puntuales (no-show/cancel); igual exige mesa sin pendientes.
        await this.assertTableClearableForFsm(tableId);
      }
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

    // 4. Record immutable audit event (el override queda auditado, nunca bypass)
    const auditMetadata = {
      ...(metadata ?? {}),
      ...(isOverride ? { administrativeOverride: true, overrideSource: source } : {})
    };
    const stateEvent = await prisma.tableStateEvent.create({
      data: {
        tableId,
        fromState,
        toState,
        trigger,
        source,
        staffUserId: staffUserId ?? null,
        metadata: Object.keys(auditMetadata).length > 0 ? JSON.stringify(auditMetadata) : null,
        createdAt: now
      }
    });

    // 5. Manage OccupancySession lifecycle
    await this.handleOccupancySessionLifecycle(table, fromState, toState, now);

    // H2: sin auto-resolve silencioso de llamados por FSM. Los pendientes ya
    // bloquearon arriba con 409 accionable; sólo una acción explícita del
    // personal puede resolverlos. Revocar sesiones aquí sólo alcanza a
    // ocupaciones ya validadas sin pendientes (idempotente).

    // Revoke all active guest sessions when table transitions to TO_CLEAN or AVAILABLE (idempotent)
    // E02: revocar implica closedAt + activeKey null para que la restricción única
    // `activeKey = tableId` vuelva a proteger una sola ocupación operativa.
    if (toState === TableFSMState.TO_CLEAN || toState === TableFSMState.AVAILABLE) {
      await prisma.tableSession.updateMany({
        where: { tableId: table.id, closedAt: null },
        data: { closedAt: now, activeKey: null }
      });
    }

    // E11: the physical `Mesa lista` action also prepares the next QR
    // occupation. The QR endpoint remains read-only; it will only resolve
    // this fresh session. If the shift is closed, leave the table AVAILABLE
    // without inventing a session—the next open shift can create one safely.
    if (fromState === TableFSMState.TO_CLEAN && toState === TableFSMState.AVAILABLE) {
      await SessionService.getOrCreateOperationalSession(
        table.id,
        table.restaurantId,
        now,
        { createShiftIfMissing: false }
      );
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
   * Converge una mesa a un estado operativo sin saltar la matriz de la FSM.
   *
   * Los flujos QR y algunas ocupaciones legadas pueden tener pedidos/cuenta
   * válidos mientras `Table.currentState` todavía figura como AVAILABLE. Los
   * consumidores no deberían repetir a mano AVAILABLE -> OCCUPIED -> ...:
   * este helper calcula el siguiente paso permitido, lo aplica con CAS y
   * vuelve a leer ante una carrera. Si el estado ya representa una mesa
   * ocupada para el objetivo (por ejemplo, una llamada de mozo durante
   * EATING), no fuerza una regresión visual.
   */
  async ensureOperationalState(params: {
    tableId: string;
    toState: TableFSMState;
    source: SignalSource;
    trigger: string;
    staffUserId?: string | null;
    metadata?: Record<string, unknown>;
    maxAttempts?: number;
  }): Promise<TableFSMState> {
    const maxAttempts = Math.max(1, params.maxAttempts ?? 4);

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const table = await prisma.table.findUnique({
        where: { id: params.tableId },
        select: { currentState: true }
      });

      if (!table) {
        const error: any = new Error(`Mesa con ID ${params.tableId} no encontrada`);
        error.statusCode = 404;
        error.code = 'TABLE_NOT_FOUND';
        throw error;
      }

      const current = (table.currentState as TableFSMState) || TableFSMState.AVAILABLE;
      if (current === params.toState || FSMService.isOperationallySufficient(current, params.toState)) {
        return current;
      }

      const next = FSMService.getOperationalStep(current, params.toState);
      if (!next) {
        const error: any = new Error(
          `La mesa no puede converger de ${current} a ${params.toState} sin una acción explícita`
        );
        error.statusCode = 409;
        error.code = params.toState === TableFSMState.PAID || current === TableFSMState.PAID
          ? 'TABLE_NOT_ORDERABLE'
          : 'INVALID_TABLE_STATE_FLOW';
        error.details = { tableId: params.tableId, currentState: current, targetState: params.toState };
        throw error;
      }

      try {
        await this.attemptTransition({
          tableId: params.tableId,
          toState: next,
          source: params.source,
          trigger: `${params.trigger} (${current} -> ${next})`,
          staffUserId: params.staffUserId,
          metadata: params.metadata,
          expectedCurrentState: current
        });
      } catch (error: any) {
        if (error?.code === 'STATE_CONFLICT' && attempt < maxAttempts - 1) continue;
        throw error;
      }
    }

    const error: any = new Error('La mesa cambió mientras se actualizaba; releé el estado y reintentá');
    error.statusCode = 409;
    error.code = 'STATE_CONFLICT';
    throw error;
  }

  /**
   * Variante tx-aware (E06): un solo paso canónico de la FSM usando el
   * cliente transaccional `tx` en vez del prisma global. Replica la
   * validación de matriz/CAS de attemptTransition + TableStateEvent +
   * timestamps de OccupancySession. Lanza 422/409 si la transición no es
   * posible, para que la tx que la contiene revierta.
   */
  static async transitionTx(
    tx: any,
    params: TransitionParams & { restaurantId?: string }
  ): Promise<{ fromState: TableFSMState; toState: TableFSMState; stateEventId: string }> {
    const { tableId, toState, source, trigger, staffUserId, metadata, expectedCurrentState } = params;
    const table = await tx.table.findUnique({ where: { id: tableId } });
    if (!table) {
      const error: any = new Error(`Mesa con ID ${tableId} no encontrada`);
      error.statusCode = 404; error.code = 'TABLE_NOT_FOUND'; throw error;
    }
    if (params.restaurantId && (table as any).restaurantId !== params.restaurantId) {
      const error: any = new Error('La mesa pertenece a otro restaurante');
      error.statusCode = 403; error.code = 'STAFF_TENANT_MISMATCH';
      error.details = { tableId }; throw error;
    }
    const fromState = ((table as any).currentState as TableFSMState) || TableFSMState.AVAILABLE;
    if (expectedCurrentState && fromState !== expectedCurrentState) {
      const error: any = new Error(
        `Conflicto de concurrencia: se esperaba el estado ${expectedCurrentState} pero la mesa se encuentra en ${fromState}`
      );
      error.statusCode = 409; error.code = 'STATE_CONFLICT';
      error.details = { tableId, currentState: fromState, expectedState: expectedCurrentState, attemptedToState: toState };
      throw error;
    }
    if (isProhibitedJump(fromState, toState)) {
      const error: any = new Error(
        `Transición prohibida por contrato operativo: no se puede pasar de ${fromState} a ${toState} sin completar limpieza/rotación explícita`
      );
      error.statusCode = 422; error.code = 'INVALID_TRANSITION';
      error.details = { fromState, toState, allowed: false, jumpProhibited: true }; throw error;
    }
    if (!isValidTransition(fromState, toState, false)) {
      const error: any = new Error(`Transición no permitida: no se puede pasar de ${fromState} a ${toState}`);
      error.statusCode = 422; error.code = 'INVALID_TRANSITION';
      error.details = { fromState, toState, allowed: false }; throw error;
    }
    const now = new Date();
    const conditionState = expectedCurrentState ?? fromState;
    const updateResult = await tx.table.updateMany({
      where: { id: tableId, currentState: conditionState },
      data: { currentState: toState, stateChangedAt: now }
    });
    if (updateResult.count === 0) {
      const fresh = await tx.table.findUnique({ where: { id: tableId } });
      const error: any = new Error(`Conflicto de concurrencia: la mesa cambió a ${fresh?.currentState} simultáneamente`);
      error.statusCode = 409; error.code = 'STATE_CONFLICT';
      error.details = { tableId, currentState: fresh?.currentState, expectedState: conditionState, attemptedToState: toState };
      throw error;
    }
    const stateEvent = await tx.tableStateEvent.create({
      data: {
        tableId, fromState, toState, trigger, source,
        staffUserId: staffUserId ?? null,
        metadata: metadata && Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
        createdAt: now
      }
    });
    // Timestamps de ocupación sobre la misma tx (sin broadcast aquí).
    const openSession = await tx.occupancySession.findFirst({
      where: { tableId, cleanedAt: null }, orderBy: { seatedAt: 'desc' }
    });
    if (toState === TableFSMState.OCCUPIED_NO_ORDER && !openSession) {
      if (fromState !== TableFSMState.TO_CLEAN && fromState !== TableFSMState.PAID) {
        await tx.occupancySession.create({
          data: { tableId, restaurantId: (table as any).restaurantId, seatedAt: now }
        });
      }
    } else if (openSession) {
      const updates: Record<string, any> = {};
      if (toState === TableFSMState.ORDER_IN_KITCHEN && !(openSession as any).orderedAt) updates.orderedAt = now;
      else if (toState === TableFSMState.EATING && !(openSession as any).servedAt) updates.servedAt = now;
      else if (toState === TableFSMState.BILL_REQUESTED && !(openSession as any).billAt) updates.billAt = now;
      else if (toState === TableFSMState.PAID && !(openSession as any).paidAt) updates.paidAt = now;
      else if (toState === TableFSMState.TO_CLEAN && !(openSession as any).vacatedAt) updates.vacatedAt = now;
      if (Object.keys(updates).length > 0) {
        await tx.occupancySession.update({ where: { id: (openSession as any).id }, data: updates });
      }
    }
    return { fromState, toState, stateEventId: stateEvent.id };
  }

  /**
   * Convergencia tx-aware: avanza por pasos canónicos (getOperationalStep)
   * hasta `toState` o un estado operacionalmente suficiente, todo sobre `tx`.
   * Si no hay camino canónico, lanza 409/422 y la tx revierte.
   */
  static async ensureOperationalStateTx(
    tx: any,
    params: { tableId: string; toState: TableFSMState; source: SignalSource; trigger: string; staffUserId?: string | null; metadata?: Record<string, unknown>; restaurantId?: string; maxAttempts?: number }
  ): Promise<TableFSMState> {
    const maxAttempts = Math.max(1, params.maxAttempts ?? 4);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const table = await tx.table.findUnique({ where: { id: params.tableId } });
      if (!table) {
        const error: any = new Error(`Mesa con ID ${params.tableId} no encontrada`);
        error.statusCode = 404; error.code = 'TABLE_NOT_FOUND'; throw error;
      }
      const current = ((table as any).currentState as TableFSMState) || TableFSMState.AVAILABLE;
      if (current === params.toState || FSMService.isOperationallySufficient(current, params.toState)) return current;
      const next = FSMService.getOperationalStep(current, params.toState);
      if (!next) {
        const error: any = new Error(`La mesa no puede converger de ${current} a ${params.toState} sin una acción explícita`);
        error.statusCode = 409; error.code = 'INVALID_TABLE_STATE_FLOW';
        error.details = { tableId: params.tableId, currentState: current, targetState: params.toState };
        throw error;
      }
      await FSMService.transitionTx(tx, {
        tableId: params.tableId, toState: next, source: params.source,
        trigger: `${params.trigger} (${current} -> ${next})`,
        staffUserId: params.staffUserId, metadata: params.metadata,
        expectedCurrentState: current, restaurantId: params.restaurantId
      });
    }
    const error: any = new Error('La mesa cambió mientras se actualizaba; releé el estado y reintentá');
    error.statusCode = 409; error.code = 'STATE_CONFLICT'; throw error;
  }

  private static isOperationallySufficient(current: TableFSMState, target: TableFSMState): boolean {
    if (target === TableFSMState.OCCUPIED_NO_ORDER) {
      return [
        TableFSMState.ORDER_IN_KITCHEN,
        TableFSMState.EATING,
        TableFSMState.BILL_REQUESTED
      ].includes(current);
    }
    return false;
  }

  private static getOperationalStep(current: TableFSMState, target: TableFSMState): TableFSMState | null {
    const vacantStates = [
      TableFSMState.AVAILABLE,
      TableFSMState.RESERVED,
      TableFSMState.TO_CLEAN
    ];

    if (target === TableFSMState.OCCUPIED_NO_ORDER) {
      return vacantStates.includes(current) ? TableFSMState.OCCUPIED_NO_ORDER : null;
    }

    if (target === TableFSMState.ORDER_IN_KITCHEN) {
      if (vacantStates.includes(current)) return TableFSMState.OCCUPIED_NO_ORDER;
      if ([TableFSMState.OCCUPIED_NO_ORDER, TableFSMState.EATING].includes(current)) {
        return TableFSMState.ORDER_IN_KITCHEN;
      }
      // La matriz canónica no permite BILL_REQUESTED -> ORDER_IN_KITCHEN:
      // primero se retoma la ocupación y recién después entra la nueva tanda.
      if (current === TableFSMState.BILL_REQUESTED) return TableFSMState.EATING;
      return null;
    }

    if (target === TableFSMState.EATING) {
      if (vacantStates.includes(current)) return TableFSMState.OCCUPIED_NO_ORDER;
      if ([TableFSMState.OCCUPIED_NO_ORDER, TableFSMState.ORDER_IN_KITCHEN, TableFSMState.BILL_REQUESTED].includes(current)) {
        return TableFSMState.EATING;
      }
      return null;
    }

    if (target === TableFSMState.BILL_REQUESTED) {
      if (vacantStates.includes(current)) return TableFSMState.OCCUPIED_NO_ORDER;
      if ([TableFSMState.OCCUPIED_NO_ORDER, TableFSMState.ORDER_IN_KITCHEN, TableFSMState.EATING].includes(current)) {
        return TableFSMState.BILL_REQUESTED;
      }
      return null;
    }

    if (target === TableFSMState.PAID) {
      if (vacantStates.includes(current)) return TableFSMState.OCCUPIED_NO_ORDER;
      if ([TableFSMState.OCCUPIED_NO_ORDER, TableFSMState.ORDER_IN_KITCHEN].includes(current)) {
        return TableFSMState.EATING;
      }
      if ([TableFSMState.EATING, TableFSMState.BILL_REQUESTED].includes(current)) {
        return TableFSMState.PAID;
      }
      return null;
    }

    if (target === TableFSMState.TO_CLEAN) {
      return [
        TableFSMState.PAID,
        TableFSMState.OCCUPIED_NO_ORDER,
        TableFSMState.ORDER_IN_KITCHEN,
        TableFSMState.EATING,
        TableFSMState.BILL_REQUESTED
      ].includes(current)
        ? TableFSMState.TO_CLEAN
        : null;
    }

    if (target === TableFSMState.AVAILABLE && current === TableFSMState.TO_CLEAN) {
      return TableFSMState.AVAILABLE;
    }

    return null;
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
   * H2: guarda de cierre para TO_CLEAN/AVAILABLE por FSM. Valida saldo,
   * borrador, validación pendiente y llamados ANTES de cerrar sesiones; si hay
   * algo pendiente rechaza con 409 accionable y deja todo intacto (sin cierre
   * silencioso por FSM). Se ejecuta antes de mutar el estado.
   */
  private async assertTableClearableForFsm(tableId: string): Promise<void> {
    const openSessions = await prisma.tableSession.findMany({
      where: { tableId, closedAt: null },
      select: { id: true }
    });
    if (openSessions.length === 0) return;
    const { OrderService } = await import('./order.service');
    for (const open of openSessions) {
      const account = await OrderService.getSessionAccount(open.id);
      if (account.saldoMinor > 0) {
        const error: any = new Error(
          `No se puede liberar la mesa con consumos pendientes ($${(account.saldoMinor / 100).toFixed(2)}). Cobrá y cerrá por la caja antes de pasar a limpieza.`
        );
        error.statusCode = 409;
        error.code = 'TABLE_HAS_UNPAID_BALANCE';
        error.details = { tableId, tableSessionId: open.id, saldoMinor: account.saldoMinor };
        throw error;
      }
      if (account.draft) {
        const error: any = new Error(
          'La mesa tiene un carrito sin enviar; descartalo o envialo explícitamente antes de liberar.'
        );
        error.statusCode = 409;
        error.code = 'DRAFT_UNRESOLVED';
        error.details = { tableId, tableSessionId: open.id };
        throw error;
      }
      if (account.pendingValidation.length > 0) {
        const error: any = new Error(
          'La mesa tiene tandas esperando confirmación; aceptalas o rechazalas explícitamente antes de liberar.'
        );
        error.statusCode = 409;
        error.code = 'PENDING_VALIDATION_UNRESOLVED';
        error.details = { tableId, tableSessionId: open.id, count: account.pendingValidation.length };
        throw error;
      }
      const pendingCalls = await prisma.callRequest.count({
        where: { tableSessionId: open.id, status: { in: ['PENDING', 'IN_PROGRESS'] } }
      });
      if (pendingCalls > 0) {
        const error: any = new Error(
          `La mesa tiene ${pendingCalls} llamado(s) pendiente(s); resolvelos o cancelalos explícitamente antes de liberar.`
        );
        error.statusCode = 409;
        error.code = 'PENDING_CALLS';
        error.details = { tableId, tableSessionId: open.id, count: pendingCalls };
        throw error;
      }
    }
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
      // Gate A: jamás crear/reabrir sesión desde TO_CLEAN/PAID ni tras cobro/cierre.
      // Sólo AVAILABLE/RESERVED inician ocupación; cualquier otro origen que pida
      // OCCUPIED_NO_ORDER es una reapertura indebida (la matriz ya la bloquea, esto
      // es defensa en profundidad para transiciones automáticas).
      if (toState === TableFSMState.OCCUPIED_NO_ORDER) {
        if (fromState === TableFSMState.TO_CLEAN || fromState === TableFSMState.PAID) {
          console.warn(
            `FSM lifecycle: reapertura bloqueada ${fromState} -> ${toState} en mesa ${table.id}; requiere Mesa lista`
          );
          return;
        }
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

        // La ocupación manual/por FSM también debe tener un QR operativo para
        // que la vista del cliente pueda entrar a la misma cuenta. En el camino
        // caliente (por ejemplo, una ráfaga de 1-Tap) la sesión vigente ya viene
        // en el snapshot de la mesa y se evita abrir otra transacción SQLite.
        const currentSession = (table as any).sessions?.[0];
        const hasUsableSession = currentSession
          && new Date(currentSession.expiresAt).getTime() > timestamp.getTime()
          && currentSession.activeKey === table.id;
        if (!hasUsableSession) {
          await SessionService.getOrCreateOperationalSession(
            table.id,
            table.restaurantId,
            timestamp,
            { createShiftIfMissing: false }
          );
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

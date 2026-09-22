import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { FSMService } from './fsm.service';
import { TableFSMState, SignalSource } from '@mesaya/shared';
import {
  ServiceTaskClaimDTO,
  ServiceTaskActResultDTO,
  ServiceTaskKind,
  ServiceTaskIntention,
  CallStatus,
  OrderStatus
} from '@mesaya/shared';

const ACTIVE_CALL_STATUSES = [CallStatus.PENDING, CallStatus.IN_PROGRESS] as const;

const TASK_KINDS: readonly ServiceTaskKind[] = [
  'CALL',
  'ORDER_VALIDATION',
  'ORDER_PREPARATION',
  'ORDER_DELIVERY',
  'ACCOUNT_COLLECTION',
  'TABLE_CLEANUP'
];

function taskError(statusCode: number, code: string, message: string, details?: unknown): any {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function assertTaskInput(taskType: string, targetId: string) {
  if (!TASK_KINDS.includes(taskType as ServiceTaskKind) || typeof targetId !== 'string' || !targetId.trim()) {
    throw taskError(400, 'INVALID_SERVICE_TASK', 'Tipo e identificador de tarea inválidos');
  }
  if (targetId.length > 200 || /[\u0000-\u001f\u007f]/.test(targetId)) {
    throw taskError(400, 'INVALID_SERVICE_TASK', 'Identificador de tarea inválido');
  }
}

function taskKeyFor(taskType: ServiceTaskKind, targetId: string) {
  return `${taskType}:${targetId}`;
}

type StaffContext = {
  staffUserId: string;
  staffRestaurantId: string;
  staffRole: string;
  terminalId?: string | null;
};

export class ServiceTaskService {
  static taskKey(taskType: ServiceTaskKind, targetId: string) {
    assertTaskInput(taskType, targetId);
    return taskKeyFor(taskType, targetId.trim());
  }

  /**
   * Reclama una tarea lógica con una clave única activa. La fila histórica no
   * se elimina: al liberar/resolver se anula activeKey y una toma posterior
   * genera una nueva fila auditable.
   */
  static async claimTask(taskType: ServiceTaskKind, targetId: string, staff: StaffContext): Promise<ServiceTaskClaimDTO> {
    assertTaskInput(taskType, targetId);
    const cleanTargetId = targetId.trim();
    const taskKey = taskKeyFor(taskType, cleanTargetId);

    if (!staff.staffUserId || !staff.staffRestaurantId) {
      throw taskError(401, 'UNAUTHORIZED', 'Identidad de personal incompleta');
    }

    try {
      return await prisma.$transaction(async (tx) => {
        const target = await this.findClaimableTarget(tx, taskType, cleanTargetId, staff.staffRestaurantId);
        if (!target) {
          throw taskError(
            409,
            'TASK_NO_LONGER_AVAILABLE',
            'La tarea cambió de estado o ya no está disponible; actualizá Servicio antes de actuar.'
          );
        }

        const current = await tx.serviceTaskClaim.findFirst({
          where: { activeKey: taskKey, status: 'ACTIVE' }
        });
        if (current) {
          if (current.staffUserId === staff.staffUserId) {
            return this.formatClaim(current);
          }
          throw taskError(
            409,
            'TASK_ALREADY_CLAIMED',
            'Otro operador ya se ocupó de esta tarea; la tarjeta conservará su responsable.',
            {
              taskKey,
              staffUserId: current.staffUserId,
              terminalId: current.terminalId,
              claimedAt: current.claimedAt.toISOString()
            }
          );
        }

        const created = await tx.serviceTaskClaim.create({
          data: {
            taskKey,
            activeKey: taskKey,
            taskType,
            targetId: cleanTargetId,
            restaurantId: staff.staffRestaurantId,
            staffUserId: staff.staffUserId,
            terminalId: staff.terminalId || null,
            status: 'ACTIVE'
          }
        });

        if (taskType === 'CALL') {
          await tx.callRequest.updateMany({
            where: { id: cleanTargetId, status: CallStatus.PENDING },
            data: { status: CallStatus.IN_PROGRESS, acknowledgedAt: new Date() }
          });
        }

        return this.formatClaim(created);
      });
    } catch (err: any) {
      // Two terminals can pass the read at the same time; the unique activeKey
      // is the definitive arbitration, not the browser's local state.
      if (err?.code === 'P2002') {
        const current = await prisma.serviceTaskClaim.findFirst({
          where: { activeKey: taskKey, status: 'ACTIVE' }
        });
        if (current?.staffUserId === staff.staffUserId) return this.formatClaim(current);
        throw taskError(
          409,
          'TASK_ALREADY_CLAIMED',
          'Otro operador ya se ocupó de esta tarea; la tarjeta conservará su responsable.'
        );
      }
      throw err;
    }
  }

  static async releaseTask(taskType: ServiceTaskKind, targetId: string, staff: StaffContext) {
    assertTaskInput(taskType, targetId);
    const taskKey = taskKeyFor(taskType, targetId.trim());
    const current = await prisma.serviceTaskClaim.findFirst({
      where: { activeKey: taskKey, status: 'ACTIVE', restaurantId: staff.staffRestaurantId }
    });
    if (!current) return { success: true, status: 'ALREADY_RELEASED', taskKey };
    if (current.staffUserId !== staff.staffUserId && staff.staffRole !== 'MANAGER') {
      throw taskError(403, 'TASK_RELEASE_FORBIDDEN', 'Solo quien tomó la tarea o un encargado puede reasignarla.');
    }
    const released = await prisma.serviceTaskClaim.updateMany({
      where: { id: current.id, activeKey: taskKey, status: 'ACTIVE' },
      data: { activeKey: null, status: 'RELEASED', releasedAt: new Date() }
    });
    if (taskType === 'CALL' && released.count > 0) {
      await prisma.callRequest.updateMany({
        where: { id: targetId.trim(), status: CallStatus.IN_PROGRESS },
        data: { status: CallStatus.PENDING, acknowledgedAt: null }
      });
    }
    return { success: true, status: released.count === 1 ? 'RELEASED' : 'ALREADY_RELEASED', taskKey };
  }

  static async resolveTask(taskType: ServiceTaskKind, targetId: string, staff: StaffContext) {
    assertTaskInput(taskType, targetId);
    const taskKey = taskKeyFor(taskType, targetId.trim());
    const current = await prisma.serviceTaskClaim.findFirst({
      where: { activeKey: taskKey, status: 'ACTIVE', restaurantId: staff.staffRestaurantId }
    });
    if (!current) return { success: true, status: 'NO_ACTIVE_CLAIM', taskKey };
    if (current.staffUserId !== staff.staffUserId && staff.staffRole !== 'MANAGER') {
      throw taskError(403, 'TASK_RESOLVE_FORBIDDEN', 'La tarea está asignada a otro operador.');
    }
    const resolved = await prisma.serviceTaskClaim.updateMany({
      where: { id: current.id, activeKey: taskKey, status: 'ACTIVE' },
      data: { activeKey: null, status: 'RESOLVED', resolvedAt: new Date() }
    });
    return { success: true, status: resolved.count === 1 ? 'RESOLVED' : 'NO_ACTIVE_CLAIM', taskKey };
  }

  static async resolveByTarget(taskType: ServiceTaskKind, targetId: string, staff: StaffContext) {
    return this.resolveTask(taskType, targetId, staff);
  }

  /**
   * E06 — comando de intención atómica: claim (si no hay) + mutación de
   * dominio + resolve de la claim dentro de UNA única transacción sobre `tx`.
   * Nunca llama a servicios que usan el prisma global fuera de la tx; si la
   * mutación falla, la tx revierte y no queda claim activa nueva. Los eventos
   * se publican después del commit.
   */
  static async actTask(
    taskType: ServiceTaskKind,
    targetId: string,
    staff: StaffContext,
    input?: { action?: string; reason?: string }
  ): Promise<ServiceTaskActResultDTO> {
    assertTaskInput(taskType, targetId);
    const cleanTargetId = targetId.trim();
    const taskKey = taskKeyFor(taskType, cleanTargetId);
    const action = ((input?.action || 'COMPLETE') as string).toUpperCase() as ServiceTaskIntention;
    if (action !== 'COMPLETE' && action !== 'REJECT' && action !== 'UNDO') {
      throw taskError(400, 'INVALID_SERVICE_ACTION', 'Acción inválida: COMPLETE, REJECT o UNDO');
    }
    if (action === 'UNDO' && taskType !== 'ORDER_DELIVERY') {
      throw taskError(422, 'SERVICE_ACTION_NOT_SUPPORTED', 'UNDO solo admite ORDER_DELIVERY');
    }
    if (!staff.staffUserId || !staff.staffRestaurantId) {
      throw taskError(401, 'UNAUTHORIZED', 'Identidad de personal incompleta');
    }
    if (action === 'REJECT') {
      if (taskType !== 'ORDER_VALIDATION') {
        throw taskError(422, 'SERVICE_ACTION_NOT_SUPPORTED', 'Solo ORDER_VALIDATION admite REJECT');
      }
      const reason = String(input?.reason || '').trim().slice(0, 240);
      if (!reason) throw taskError(400, 'REJECTION_REASON_REQUIRED', 'El rechazo necesita un motivo explícito');
    }

    let result: ServiceTaskActResultDTO;
    try {
      result = await prisma.$transaction(async (tx) => {
        // E09 — UNDO de entrega: corrección dentro de ventana corta, misma tx.
        if (action === 'UNDO') {
          return this.undoDeliveryTx(tx, taskKey, cleanTargetId, staff);
        }
        // 1. Arbitraje de claim con activeKey único dentro de la tx.
        const existing = await tx.serviceTaskClaim.findFirst({
          where: { activeKey: taskKey, status: 'ACTIVE' }
        });
        if (existing) {
          if (existing.restaurantId !== staff.staffRestaurantId) {
            throw taskError(403, 'STAFF_TENANT_MISMATCH', 'La tarea pertenece a otro restaurante');
          }
          if (existing.staffUserId !== staff.staffUserId) {
            throw taskError(409, 'TASK_ALREADY_CLAIMED', 'Otro operador ya se ocupó de esta tarea; actualizá Servicio.', {
              taskKey, staffUserId: existing.staffUserId, terminalId: existing.terminalId,
              claimedAt: existing.claimedAt.toISOString()
            });
          }
        } else {
          await tx.serviceTaskClaim.create({
            data: {
              taskKey, activeKey: taskKey, taskType, targetId: cleanTargetId,
              restaurantId: staff.staffRestaurantId, staffUserId: staff.staffUserId,
              terminalId: staff.terminalId || null, status: 'ACTIVE'
            }
          });
        }

        // 2. Mutación de dominio sobre `tx` con writes condicionales (updateMany).
        const now = new Date();
        let status = '';
        let replay = false;

        if (taskType === 'CALL') {
          if (action !== 'COMPLETE') throw taskError(422, 'SERVICE_ACTION_NOT_SUPPORTED', 'CALL solo admite COMPLETE');
          const call = await tx.callRequest.findFirst({
            where: { id: cleanTargetId, tableSession: { table: { restaurantId: staff.staffRestaurantId } } },
            select: { id: true, status: true }
          });
          if (!call) throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'El llamado cambió de estado o ya no está disponible; actualizá Servicio.');
          if (call.status === CallStatus.RESOLVED) { status = CallStatus.RESOLVED; replay = true; }
          else if (call.status === CallStatus.PENDING || call.status === CallStatus.IN_PROGRESS) {
            const changed = await tx.callRequest.updateMany({
              where: { id: cleanTargetId, status: { in: [CallStatus.PENDING, CallStatus.IN_PROGRESS] } },
              data: { status: CallStatus.RESOLVED, activeKey: null, acknowledgedAt: now, resolvedAt: now }
            });
            if (changed.count === 0) {
              const latest = await tx.callRequest.findFirst({ where: { id: cleanTargetId }, select: { status: true } });
              if (latest?.status === CallStatus.RESOLVED) { status = CallStatus.RESOLVED; replay = true; }
              else throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'El llamado cambió durante la acción; actualizá Servicio.');
            } else status = CallStatus.RESOLVED;
          } else throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'El llamado ya no está accionable; actualizá Servicio.');
        } else {
          const order = await tx.order.findFirst({
            where: { id: cleanTargetId, tableSession: { table: { restaurantId: staff.staffRestaurantId } } },
            select: { id: true, status: true, tableSession: { select: { tableId: true } } }
          });
          if (!order) throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'La comanda cambió de estado o ya no está disponible; actualizá Servicio.');
          if (action === 'REJECT') {
            const reason = String(input?.reason || '').trim().slice(0, 240);
            if (order.status === OrderStatus.CANCELLED) { status = OrderStatus.CANCELLED; replay = true; }
            else if (order.status !== OrderStatus.PENDING_VALIDATION) {
              throw taskError(409, 'ORDER_REVIEW_CONFLICT', 'La comanda ya no está pendiente de revisión; actualizá Servicio.');
            } else {
              // Sin cobro: solo CANCELLED + motivo auditado.
              const changed = await tx.order.updateMany({
                where: { id: cleanTargetId, status: OrderStatus.PENDING_VALIDATION },
                data: { status: OrderStatus.CANCELLED, draftKey: null, cancellationReason: reason, cancelledBy: staff.staffUserId, cancelledAt: now }
              });
              if (changed.count === 0) {
                const latest = await tx.order.findFirst({ where: { id: cleanTargetId }, select: { status: true } });
                if (latest?.status === OrderStatus.CANCELLED) { status = OrderStatus.CANCELLED; replay = true; }
                else throw taskError(409, 'ORDER_REVIEW_CONFLICT', 'La comanda cambió mientras se rechazaba; actualizá Servicio.');
              } else status = OrderStatus.CANCELLED;
            }
          } else if (taskType === 'ORDER_VALIDATION') {
            if (order.status === OrderStatus.IN_KITCHEN) { status = OrderStatus.IN_KITCHEN; replay = true; }
            else if (order.status !== OrderStatus.PENDING_VALIDATION) {
              throw taskError(409, 'ORDER_REVIEW_CONFLICT', 'La comanda ya no está pendiente de validación; actualizá Servicio.');
            } else {
              const bad = await tx.orderItem.findFirst({
                where: { orderId: cleanTargetId, menuItem: { isAvailable: false } }, select: { id: true }
              });
              if (bad) throw taskError(422, 'ITEM_NOT_AVAILABLE', 'Hay platos sin stock vigente; resolvé la excepción o rechazá la comanda.');
              // FSM canónica en la misma tx: mesa -> ORDER_IN_KITCHEN + TableStateEvent + orderedAt.
              await FSMService.ensureOperationalStateTx(tx, {
                tableId: (order as any).tableSession.tableId,
                toState: TableFSMState.ORDER_IN_KITCHEN,
                source: SignalSource.STAFF_TERMINAL_TAP,
                trigger: `E06 ORDER_VALIDATION ${cleanTargetId}`,
                staffUserId: staff.staffUserId,
                restaurantId: staff.staffRestaurantId
              });
              const changed = await tx.order.updateMany({
                where: { id: cleanTargetId, status: OrderStatus.PENDING_VALIDATION },
                data: { status: OrderStatus.IN_KITCHEN, draftKey: null, reviewReasonCode: null, reviewReasonDetail: null }
              });
              if (changed.count === 0) {
                const latest = await tx.order.findFirst({ where: { id: cleanTargetId }, select: { status: true } });
                if (latest?.status === OrderStatus.IN_KITCHEN) { status = OrderStatus.IN_KITCHEN; replay = true; }
                else throw taskError(409, 'ORDER_REVIEW_CONFLICT', 'La comanda cambió mientras se validaba; actualizá Servicio.');
              } else status = OrderStatus.IN_KITCHEN;
            }
          } else if (taskType === 'ORDER_PREPARATION') {
            if (order.status === OrderStatus.READY_TO_SERVE || order.status === OrderStatus.SERVED) { status = order.status; replay = true; }
            else if (order.status !== OrderStatus.IN_KITCHEN) {
              throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'La comanda ya no está en cocina; actualizá Servicio.');
            } else {
              const changed = await tx.order.updateMany({
                where: { id: cleanTargetId, status: OrderStatus.IN_KITCHEN },
                data: { status: OrderStatus.READY_TO_SERVE, draftKey: null }
              });
              if (changed.count === 0) {
                const latest = await tx.order.findFirst({ where: { id: cleanTargetId }, select: { status: true } });
                if (latest?.status === OrderStatus.READY_TO_SERVE || latest?.status === OrderStatus.SERVED) { status = latest.status; replay = true; }
                else throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'La comanda cambió durante la acción; actualizá Servicio.');
              } else status = OrderStatus.READY_TO_SERVE;
            }
          } else if (taskType === 'ORDER_DELIVERY') {
            if (order.status === OrderStatus.SERVED) { status = OrderStatus.SERVED; replay = true; }
            else if (order.status !== OrderStatus.READY_TO_SERVE) {
              throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'La comanda ya no está lista para entregar; actualizá Servicio.');
            } else {
              // FSM canónica en la misma tx: mesa -> EATING + TableStateEvent + servedAt.
              await FSMService.ensureOperationalStateTx(tx, {
                tableId: (order as any).tableSession.tableId,
                toState: TableFSMState.EATING,
                source: SignalSource.STAFF_TERMINAL_TAP,
                trigger: `E06 ORDER_DELIVERY ${cleanTargetId}`,
                staffUserId: staff.staffUserId,
                restaurantId: staff.staffRestaurantId
              });
              const changed = await tx.order.updateMany({
                where: { id: cleanTargetId, status: OrderStatus.READY_TO_SERVE },
                data: { status: OrderStatus.SERVED, draftKey: null }
              });
              if (changed.count === 0) {
                const latest = await tx.order.findFirst({ where: { id: cleanTargetId }, select: { status: true } });
                if (latest?.status === OrderStatus.SERVED) { status = OrderStatus.SERVED; replay = true; }
                else throw taskError(409, 'TASK_NO_LONGER_AVAILABLE', 'La comanda cambió durante la entrega; actualizá Servicio.');
              } else status = OrderStatus.SERVED;
            }
          } else {
            if (taskType === 'TABLE_CLEANUP') throw taskError(422, 'SERVICE_ACTION_NOT_SUPPORTED', 'TABLE_CLEANUP se confirma con Mesa lista (tap a AVAILABLE con TO_CLEAN esperado), no por act');
            throw taskError(422, 'SERVICE_ACTION_NOT_SUPPORTED', 'ACCOUNT_COLLECTION se cobra por el comando de cuenta, no por act');
          }
        }

        // 3. Resolver la claim en la misma tx.
        await tx.serviceTaskClaim.updateMany({
          where: { activeKey: taskKey, status: 'ACTIVE', restaurantId: staff.staffRestaurantId },
          data: { activeKey: null, status: 'RESOLVED', resolvedAt: new Date() }
        });
        return { success: true, taskKey, taskType, targetId: cleanTargetId, action, status, idempotentReplay: replay || undefined };
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const current = await prisma.serviceTaskClaim.findFirst({ where: { activeKey: taskKey, status: 'ACTIVE' } });
        if (current?.staffUserId === staff.staffUserId) {
          // El otro intento ganó y es del mismo operador: reintentar una vez es replay seguro.
          return this.actTask(taskType, cleanTargetId, staff, input);
        }
        throw taskError(409, 'TASK_ALREADY_CLAIMED', 'Otro operador tomó esta tarea durante el intento; actualizá Servicio.');
      }
      throw err;
    }

    // 4. Eventos después del commit.
    try {
      if (taskType === 'CALL') eventBus.broadcast(staff.staffRestaurantId, 'call.resolved', { callId: cleanTargetId, status: result.status });
      else if (result.action === 'REJECT') {
        eventBus.broadcast(staff.staffRestaurantId, 'order.rejected', { orderId: cleanTargetId, reason: String(input?.reason || '').trim().slice(0, 240) });
        eventBus.broadcast(staff.staffRestaurantId, 'order.status_changed', { orderId: cleanTargetId, newStatus: result.status });
      } else if (result.action === 'UNDO') {
        eventBus.broadcast(staff.staffRestaurantId, 'order.status_changed', { orderId: cleanTargetId, newStatus: result.status, undone: true });
      } else {
        const ev = taskType === 'ORDER_VALIDATION' ? 'order.validated' : 'order.status_changed';
        eventBus.broadcast(staff.staffRestaurantId, ev, { orderId: cleanTargetId, newStatus: result.status });
      }
    } catch { /* eventos best-effort */ }
    return result;
  }

  static readonly DELIVERY_UNDO_WINDOW_MS = 30_000;

  /**
   * E09 — deshace una entrega SERVED dentro de 30s: valida claim previa
   * RESOLVED del mismo operador dentro de la ventana, orden en SERVED y mesa
   * en EATING; en una sola tx registra la corrección (claim RESOLVED),
   * revierte orden a READY_TO_SERVE y mesa a ORDER_IN_KITCHEN vía FSM
   * tx-aware (TableStateEvent). Nunca toca otra tanda (updateMany por id).
   */
  private static async undoDeliveryTx(tx: any, taskKey: string, orderId: string, staff: StaffContext): Promise<ServiceTaskActResultDTO> {
    const now = new Date();
    const order = await tx.order.findFirst({
      where: { id: orderId, tableSession: { table: { restaurantId: staff.staffRestaurantId } } },
      select: { id: true, status: true, updatedAt: true, tableSession: { select: { tableId: true } } }
    });
    if (!order) {
      throw taskError(409, 'DELIVERY_UNDO_UNAVAILABLE', 'La entrega ya no se puede deshacer; actualizá Servicio para ver el estado actual.');
    }
    if (order.status !== OrderStatus.SERVED) {
      throw taskError(409, 'DELIVERY_UNDO_UNAVAILABLE', 'La entrega ya no se puede deshacer porque la tanda cambió de estado; actualizá Servicio.');
    }
    const windowStart = new Date(now.getTime() - this.DELIVERY_UNDO_WINDOW_MS);
    const prior = await tx.serviceTaskClaim.findFirst({
      where: {
        taskKey, taskType: 'ORDER_DELIVERY', targetId: orderId,
        restaurantId: staff.staffRestaurantId, staffUserId: staff.staffUserId, status: 'RESOLVED'
      },
      orderBy: [{ resolvedAt: 'desc' }, { claimedAt: 'desc' }]
    });
    if (!prior || !prior.resolvedAt) {
      throw taskError(409, 'DELIVERY_UNDO_UNAVAILABLE', 'No hay una entrega tuya reciente para deshacer; actualizá Servicio.');
    }
    if (new Date(prior.resolvedAt).getTime() < windowStart.getTime()) {
      throw taskError(409, 'DELIVERY_UNDO_EXPIRED', 'Pasaron más de 30 segundos desde la entrega; ya no se puede deshacer. Corregí la tanda desde Cocina/Cuenta.');
    }
    // Otra mutación posterior a la entrega (pago, cancelación externa, etc.).
    if (new Date((order as any).updatedAt).getTime() > new Date(prior.resolvedAt).getTime() + 1000) {
      const fresh = await tx.order.findFirst({ where: { id: orderId }, select: { status: true } });
      if (fresh?.status !== OrderStatus.SERVED) {
        throw taskError(409, 'DELIVERY_UNDO_UNAVAILABLE', 'La tanda cambió después de la entrega; actualizá Servicio.');
      }
    }
    const table = await tx.table.findUnique({ where: { id: (order as any).tableSession.tableId }, select: { id: true, currentState: true } });
    if (!table || (table as any).currentState !== TableFSMState.EATING) {
      throw taskError(409, 'DELIVERY_UNDO_UNAVAILABLE', 'La mesa ya avanzó a otro estado físico; no se puede deshacer la entrega. Actualizá Servicio.');
    }
    // Corrección auditada: claim de corrección resuelta (hito ServiceTaskClaim).
    await tx.serviceTaskClaim.create({
      data: {
        taskKey: `${taskKey}:UNDO:${now.getTime()}`, activeKey: null, taskType: 'ORDER_DELIVERY',
        targetId: orderId, restaurantId: staff.staffRestaurantId, staffUserId: staff.staffUserId,
        terminalId: staff.terminalId || null, status: 'RESOLVED', resolvedAt: now
      }
    });
    await FSMService.transitionTx(tx, {
      tableId: (order as any).tableSession.tableId, toState: TableFSMState.ORDER_IN_KITCHEN,
      source: SignalSource.STAFF_TERMINAL_TAP, trigger: `E09 DELIVERY_UNDO ${orderId}`,
      staffUserId: staff.staffUserId, restaurantId: staff.staffRestaurantId,
      expectedCurrentState: TableFSMState.EATING
    });
    const changed = await tx.order.updateMany({
      where: { id: orderId, status: OrderStatus.SERVED },
      data: { status: OrderStatus.READY_TO_SERVE, draftKey: null }
    });
    if (changed.count === 0) {
      throw taskError(409, 'DELIVERY_UNDO_UNAVAILABLE', 'La tanda cambió durante la corrección; actualizá Servicio.');
    }
    return { success: true, taskKey, taskType: 'ORDER_DELIVERY', targetId: orderId, action: 'UNDO', status: OrderStatus.READY_TO_SERVE };
  }

  static async getActiveClaims(restaurantId: string) {
    const claims = await prisma.serviceTaskClaim.findMany({
      where: { restaurantId, status: 'ACTIVE', activeKey: { not: null } },
      orderBy: [{ claimedAt: 'asc' }, { id: 'asc' }]
    });
    // Una acción operativa puede haber confirmado el hecho (por ejemplo,
    // READY_TO_SERVE -> SERVED) y perder la petición posterior que resolvía
    // la claim. No dejar esa fila fantasma en el resumen de Servicio: el
    // estado canónico del llamado/pedido/cuenta decide si la toma sigue viva.
    const validClaims = await Promise.all(
      claims.map(async (claim) => {
        const target = await this.findClaimableTarget(
          prisma,
          claim.taskType as ServiceTaskKind,
          claim.targetId,
          restaurantId
        );
        return target ? claim : null;
      })
    );
    const staleClaims = claims.filter((_, index) => !validClaims[index]);
    if (staleClaims.length > 0) {
      await prisma.serviceTaskClaim.updateMany({
        where: {
          id: { in: staleClaims.map((claim) => claim.id) },
          restaurantId,
          status: 'ACTIVE',
          activeKey: { not: null }
        },
        data: { activeKey: null, status: 'RELEASED', releasedAt: new Date() }
      });
    }
    const currentClaims = validClaims.filter(Boolean) as typeof claims;
    const staffIds = [...new Set(currentClaims.map((claim) => claim.staffUserId))];
    const staffUsers = staffIds.length
      ? await prisma.staffUser.findMany({ where: { id: { in: staffIds }, restaurantId }, select: { id: true, name: true } })
      : [];
    const staffById = new Map(staffUsers.map((user) => [user.id, user.name]));
    return currentClaims.map((claim) => this.formatClaim(claim, staffById.get(claim.staffUserId) || null));
  }

  private static formatClaim(claim: any, staffName?: string | null): ServiceTaskClaimDTO {
    return {
      id: claim.id,
      taskKey: claim.taskKey,
      taskType: claim.taskType as ServiceTaskKind,
      targetId: claim.targetId,
      staffUserId: claim.staffUserId,
      staffName: staffName ?? null,
      terminalId: claim.terminalId ?? null,
      claimedAt: claim.claimedAt.toISOString(),
      status: claim.status
    };
  }

  private static async findClaimableTarget(tx: any, taskType: ServiceTaskKind, targetId: string, restaurantId: string) {
    if (taskType === 'CALL') {
      return tx.callRequest.findFirst({
        where: {
          id: targetId,
          status: { in: ACTIVE_CALL_STATUSES as any },
          tableSession: { table: { restaurantId } }
        },
        select: { id: true }
      });
    }

    if (taskType === 'ACCOUNT_COLLECTION') {
      const session = await tx.tableSession.findFirst({
        where: {
          id: targetId,
          closedAt: null,
          table: { restaurantId },
          orders: { some: { status: { not: OrderStatus.CANCELLED } } }
        },
        select: { id: true }
      });
      if (!session) return null;
      const { OrderService } = await import('./order.service');
      const account = await OrderService.getSessionAccountTx(tx, targetId);
      return account.saldoMinor > 0 ? session : null;
    }

    const statusByKind: Record<string, string> = {
      ORDER_VALIDATION: OrderStatus.PENDING_VALIDATION,
      ORDER_PREPARATION: OrderStatus.IN_KITCHEN,
      ORDER_DELIVERY: OrderStatus.READY_TO_SERVE
    };
    return tx.order.findFirst({
      where: {
        id: targetId,
        status: statusByKind[taskType],
        tableSession: { table: { restaurantId, } }
      },
      select: { id: true }
    });
  }
}

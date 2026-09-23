import {
  CALL_TYPE_LABELS,
  CallStatus,
  CallType,
  PaymentMethod,
  OrderStatus,
  ServiceParticipantDTO,
  ServiceReviewReasonDTO,
  ServiceTaskItemDTO,
  ServiceAccountDTO,
  ServiceTaskDTO,
  ServiceWorkspaceDTO
} from '@mesaya/shared';
import { CallService } from './call.service';
import { formatOrderReviewReason, OrderService } from './order.service';
import { ServiceTaskService } from './service-task.service';
import { floorPlanService } from './floorplan.service';
import { prisma } from '../lib/prisma';

function workspaceError(statusCode: number, code: string, message: string): any {
  const error: any = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

const CALL_PRIORITY: Record<string, number> = {
  BILL: 100,
  WAITER: 88,
  SUPPLIES: 82,
  CUSTOM: 76
};

const ORDER_PRIORITY: Record<string, number> = {
  READY_TO_SERVE: 94,
  PENDING_VALIDATION: 86,
  IN_KITCHEN: 35
};

function ageSeconds(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 1000));
}

function priorityFor(base: number, age: number) {
  // The age contribution is capped: old work stays visible but a new burst
  // cannot continuously starve it or reshuffle it every second.
  return base + Math.min(20, Math.floor(age / 300));
}

function toMinor(amount: number) {
  return Math.round(Number(amount || 0) * 100);
}

function normalizeNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  return note ? note : null;
}

function isDeclaredRestrictionNote(note: string) {
  const normalized = note.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /alerg|anafil|intoleran|celiac|tacc|gluten/i.test(normalized);
}

function participantForOrder(source: unknown, guestName: unknown): ServiceParticipantDTO {
  if (source === 'STAFF_TERMINAL') return { kind: 'STAFF', label: 'Personal' };
  if (source === 'WAITLIST') return { kind: 'WAITLIST', label: 'Fila de espera' };
  if (source === 'GUEST_QR' || (typeof guestName === 'string' && guestName.trim())) {
    const name = typeof guestName === 'string' ? guestName.trim().slice(0, 40) : '';
    return { kind: 'GUEST', label: name || 'Comensal' };
  }
  return { kind: 'UNKNOWN', label: 'Sin identificar' };
}

function buildOrderContext(order: any): {
  totalMinor: number;
  items: ServiceTaskItemDTO[];
  participants: ServiceParticipantDTO[];
  notes: string[];
  allergenNotes: string[];
  reviewReason: ServiceReviewReasonDTO | null;
} {
  const totalMinor = order.totalAmountMinor ?? toMinor(order.totalAmount);
  const items: ServiceTaskItemDTO[] = (order.items || []).map((item: any) => {
    const unitPriceMinor = item.unitPriceMinor ?? toMinor(item.unitPrice);
    return {
      itemId: item.id,
      name: item.name || '',
      quantity: item.quantity,
      notes: normalizeNote(item.notes),
      unitPriceMinor,
      lineTotalMinor: unitPriceMinor * item.quantity,
      participant: participantForOrder(order.source, item.guestName)
    };
  });
  const notes = [...new Set(items.flatMap((item) => item.notes ? [item.notes] : []))];
  const allergenNotes = notes.filter(isDeclaredRestrictionNote);
  const participants = [...new Map(
    items.map((item) => [`${item.participant.kind}:${item.participant.label}`, item.participant])
  ).values()];
  const persistedReviewReason = formatOrderReviewReason(order.reviewReasonCode, order.reviewReasonDetail);
  const reviewReason = persistedReviewReason || (order.status === OrderStatus.PENDING_VALIDATION
    ? {
        code: 'WAITER_VALIDATION_REQUIRED' as const,
        label: 'Revisión manual requerida',
        detail: allergenNotes.length > 0
          ? 'La restricción declarada queda visible como contexto operativo; no agrega una confirmación adicional.'
          : 'La configuración actual del local mantiene la comanda pendiente hasta que un mozo la confirme.'
      }
    : null);

  if (reviewReason && reviewReason.code === 'WAITER_VALIDATION_REQUIRED' && allergenNotes.length > 0 && !reviewReason.detail?.includes('no agrega una confirmación adicional')) {
    reviewReason.detail = `${reviewReason.detail || ''} La restricción declarada queda visible como contexto operativo; no agrega una confirmación adicional.`.trim();
  }

  return { totalMinor, items, participants, notes, allergenNotes, reviewReason };
}

function orderSummary(items: ServiceTaskItemDTO[], totalMinor: number) {
  if (items.length === 0) return `Comanda sin detalle · ${formatMinor(totalMinor)}`;
  const visible = items.slice(0, 3).map((item) => `${item.quantity}× ${item.name}`).join(' · ');
  const extra = items.length > 3 ? ` · +${items.length - 3} más` : '';
  return `${visible}${extra} · ${formatMinor(totalMinor)}`;
}

function tableInfo(tableById: Map<string, any>, tableId: string, fallbackLabel?: string) {
  const table = tableById.get(tableId);
  return {
    tableId,
    tableLabel: table?.label || fallbackLabel || 'Mesa sin identificar',
    sector: table?.sector || 'SALON_PRINCIPAL'
  };
}

export class ServiceWorkspaceService {
  static async getSnapshot(restaurantIdOrSlug: string, staffRestaurantId?: string, isTerminalOnly: boolean = false): Promise<ServiceWorkspaceDTO> {
    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] },
      select: {
        id: true,
        moduleConfig: {
          select: { allowWaitersToCollectCash: true, allowSplitBill: true }
        }
      }
    });
    if (!restaurant) throw workspaceError(404, 'RESTAURANT_NOT_FOUND', 'Restaurante no encontrado');
    if (staffRestaurantId && restaurant.id !== staffRestaurantId) {
      throw workspaceError(404, 'NOT_FOUND', 'Recurso no encontrado');
    }

    // A single HTTP snapshot is the polling boundary for Servicio. The sources
    // remain canonical; this composition does not create shadow entities.
    const [calls, kitchenOrders, accounts, floorPlan, claims] = await Promise.all([
      CallService.getActiveCalls(restaurant.id),
      OrderService.getKitchenOrders(restaurant.id, restaurant.id),
      OrderService.getCashAccounts(restaurant.id, restaurant.id),
      floorPlanService.getFloorPlan(restaurant.id),
      ServiceTaskService.getActiveClaims(restaurant.id)
    ]);

    // A BILL can already be resolved when the synthetic collection task is
    // shown. Keep the latest request for the current occupation so Servicio
    // still tells the mozo what the guest asked for, without joining history
    // by table id alone.
    const currentSessionIds = accounts.map((account) => account.tableSessionId);
    const latestBillCalls = currentSessionIds.length === 0
      ? []
      : await prisma.callRequest.findMany({
          where: {
            tableSessionId: { in: currentSessionIds },
            type: CallType.BILL
          },
          select: { id: true, tableSessionId: true, paymentMethod: true, tipMinor: true, createdAt: true },
          orderBy: { createdAt: 'desc' }
        });
    const requestedPaymentBySession = new Map<string, PaymentMethod>();
    const requestedTipBySession = new Map<string, number>();
    for (const call of latestBillCalls) {
      if (!requestedPaymentBySession.has(call.tableSessionId)) {
        requestedPaymentBySession.set(call.tableSessionId, call.paymentMethod as PaymentMethod);
        requestedTipBySession.set(call.tableSessionId, call.tipMinor || 0);
      }
    }

    // Resolver mozo que atendió/reclamó el llamado BILL o la sesión
    const billCallIds = latestBillCalls.map((c) => c.id);
    const relatedClaims = await prisma.serviceTaskClaim.findMany({
      where: {
        restaurantId: restaurant.id,
        OR: [
          { taskType: 'CALL', targetId: { in: billCallIds } },
          { taskType: 'ACCOUNT_COLLECTION', targetId: { in: currentSessionIds } }
        ]
      },
      orderBy: { claimedAt: 'desc' }
    });

    const staffUserIds = Array.from(new Set(relatedClaims.map((c) => c.staffUserId).filter(Boolean)));
    const staffUsers = staffUserIds.length === 0
      ? []
      : await prisma.staffUser.findMany({
          where: { id: { in: staffUserIds } },
          select: { id: true, name: true }
        });
    const staffNameById = new Map(staffUsers.map((s) => [s.id, s.name]));

    const responsibleBySession = new Map<string, { id: string; name: string }>();
    for (const call of latestBillCalls) {
      if (!responsibleBySession.has(call.tableSessionId)) {
        const claim = relatedClaims.find((c) => c.taskType === 'CALL' && c.targetId === call.id);
        if (claim) {
          responsibleBySession.set(call.tableSessionId, {
            id: claim.staffUserId,
            name: staffNameById.get(claim.staffUserId) || 'Personal del salón'
          });
        }
      }
    }
    for (const sId of currentSessionIds) {
      if (!responsibleBySession.has(sId)) {
        const claim = relatedClaims.find((c) => c.taskType === 'ACCOUNT_COLLECTION' && c.targetId === sId);
        if (claim) {
          responsibleBySession.set(sId, {
            id: claim.staffUserId,
            name: staffNameById.get(claim.staffUserId) || 'Personal del salón'
          });
        }
      }
    }

    const now = Date.now();
    const tableById = new Map(floorPlan.tables.map((table) => [table.id, table]));
    const claimByKey = new Map(claims.map((claim) => [claim.taskKey, claim]));
    const accountByTableId = new Map<string, ServiceAccountDTO>();

    for (const rawAccount of accounts) {
      const table = tableById.get(rawAccount.tableId);
      const resp = responsibleBySession.get(rawAccount.tableSessionId);
      const account: ServiceAccountDTO = {
        tableSessionId: rawAccount.tableSessionId,
        tableId: rawAccount.tableId,
        tableLabel: table?.label || 'Mesa sin identificar',
        sector: table?.sector || 'SALON_PRINCIPAL',
        currentState: table?.currentState || 'UNKNOWN',
        requestedPaymentMethod: requestedPaymentBySession.get(rawAccount.tableSessionId),
        requestedTipMinor: requestedTipBySession.get(rawAccount.tableSessionId),
        responsibleStaffUserId: resp?.id || null,
        responsibleStaffName: resp?.name || null,
        account: {
          version: rawAccount.version,
          consumoMinor: rawAccount.consumoMinor,
          paidMinor: rawAccount.paidMinor,
          tipMinor: rawAccount.tipMinor,
          saldoMinor: rawAccount.saldoMinor,
          pendingValidation: rawAccount.pendingValidation,
          draft: rawAccount.draft,
          tandas: rawAccount.tandas
        }
      };
      // El plano y las tareas representan la sesión más reciente de la mesa.
      // Versiones anteriores podían dejar una sesión QR vencida abierta; como
      // getCashAccounts viene ordenado más reciente primero, no permitir que
      // una cuenta histórica reemplace el contexto operativo actual.
      if (!accountByTableId.has(account.tableId)) {
        accountByTableId.set(account.tableId, account);
      }
    }

    const tasks: ServiceTaskDTO[] = [];
    const accountFor = (tableId: string) => accountByTableId.get(tableId);

    for (const call of calls) {
      const age = ageSeconds(call.createdAt, now);
      const location = tableInfo(tableById, call.tableId, call.tableLabel);
      const account = accountFor(call.tableId);
      const title = call.type === CallType.BILL
        ? 'Cobrar cuenta'
        : (CALL_TYPE_LABELS[call.type] || 'Atender solicitud');
      const summary = call.note?.trim() || (call.type === CallType.BILL
        ? (isTerminalOnly ? 'Solicita cuenta' : `Saldo pendiente ${formatMinor(account?.account.saldoMinor || 0)}`)
        : 'La mesa solicitó atención');
      tasks.push({
        id: `call:${call.id}`,
        taskKey: ServiceTaskService.taskKey('CALL', call.id),
        kind: 'CALL',
        source: 'CALL_REQUEST',
        targetId: call.id,
        ...location,
        title,
        summary,
        status: call.status,
        priority: priorityFor(CALL_PRIORITY[call.type] || 76, age),
        createdAt: call.createdAt,
        ageSeconds: age,
        action: 'CLAIM',
        claim: claimByKey.get(ServiceTaskService.taskKey('CALL', call.id)) || null,
        payload: {
          callType: call.type,
          callStatus: call.status,
          ...(call.type === CallType.BILL ? {
            paymentMethod: call.paymentMethod,
            requestedTipMinor: call.tipMinor || 0
          } : {}),
          balanceMinor: (call.type === CallType.BILL && !isTerminalOnly) ? account?.account.saldoMinor || 0 : undefined
        }
      });
    }

    for (const order of kitchenOrders) {
      const age = ageSeconds(order.createdAt, now);
      const location = tableInfo(tableById, order.tableId, order.tableLabel);
      const context = buildOrderContext(order);
      const kind = order.status === OrderStatus.PENDING_VALIDATION
        ? 'ORDER_VALIDATION'
        : order.status === OrderStatus.READY_TO_SERVE
          ? 'ORDER_DELIVERY'
          : 'ORDER_PREPARATION';
      const action = kind === 'ORDER_VALIDATION'
        ? 'VALIDATE_ORDER'
        : kind === 'ORDER_DELIVERY'
          ? 'SERVE_ORDER'
          : 'MARK_READY';
      const taskKey = ServiceTaskService.taskKey(kind, order.id);
      const itemCount = order.items.reduce((total, item) => total + item.quantity, 0);
      tasks.push({
        id: `order:${order.id}`,
        taskKey,
        kind,
        source: 'ORDER',
        targetId: order.id,
        ...location,
        title: kind === 'ORDER_VALIDATION'
          ? 'Validar comanda'
          : kind === 'ORDER_DELIVERY'
            ? 'Entregar a mesa'
            : 'En preparación',
        summary: orderSummary(context.items, context.totalMinor),
        status: order.status,
        priority: priorityFor(ORDER_PRIORITY[order.status] || 35, age),
        createdAt: order.createdAt,
        ageSeconds: age,
        action,
        claim: claimByKey.get(taskKey) || null,
        payload: {
          orderStatus: order.status,
          itemCount,
          totalMinor: context.totalMinor,
          items: context.items,
          participants: context.participants,
          notes: context.notes,
          allergenNotes: context.allergenNotes,
          ...(context.reviewReason ? { reviewReason: context.reviewReason } : {})
        }
      });
    }

    // E10: una tarjeta sintética ACCOUNT_COLLECTION por cuenta con saldo cobrable.
    // No duplica un BILL activo: si ya hay llamado BILL para la mesa, el llamado
    // conserva el cobro (tiene claim/acción propios) y no se emite la sintética.
    const activeBillTableIds = new Set(
      calls.filter((call) => call.type === CallType.BILL).map((call) => call.tableId)
    );
    for (const account of accountByTableId.values()) {
      if (account.account.saldoMinor <= 0) continue;
      if (activeBillTableIds.has(account.tableId)) continue;
      const taskKey = ServiceTaskService.taskKey('ACCOUNT_COLLECTION', account.tableSessionId);
      const table = tableById.get(account.tableId);
      const changedAt = (table as any)?.stateChangedAt || (table as any)?.updatedAt || new Date(now).toISOString();
      const createdAt = typeof changedAt === 'string' ? changedAt : new Date(changedAt).toISOString();
      const age = ageSeconds(createdAt, now);
      tasks.push({
        id: `account:${account.tableSessionId}`,
        taskKey,
        kind: 'ACCOUNT_COLLECTION',
        source: 'TABLE_SESSION',
        targetId: account.tableSessionId,
        tableId: account.tableId,
        tableLabel: account.tableLabel,
        sector: account.sector,
        title: 'Cobrar cuenta',
        summary: `Saldo pendiente ${formatMinor(account.account.saldoMinor)}`,
        status: 'PENDING_COLLECTION',
        priority: priorityFor(90, age),
        createdAt,
        ageSeconds: age,
        action: 'COLLECT_ACCOUNT',
        claim: claimByKey.get(taskKey) || null,
        payload: {
          balanceMinor: account.account.saldoMinor,
          totalMinor: account.account.consumoMinor,
          ...(account.requestedPaymentMethod ? {
            paymentMethod: account.requestedPaymentMethod,
            requestedTipMinor: account.requestedTipMinor || 0
          } : {})
        }
      });
    }

    // E11: TO_CLEAN como trabajo de la cola (TABLE_CLEANUP), sin claims falsos.
    for (const table of floorPlan.tables) {
      if ((table as any).currentState !== 'TO_CLEAN') continue;
      const taskKey = ServiceTaskService.taskKey('TABLE_CLEANUP', (table as any).id);
      const changedAt = (table as any).stateChangedAt || (table as any).updatedAt || new Date(now).toISOString();
      const createdAt = typeof changedAt === 'string' ? changedAt : new Date(changedAt).toISOString();
      const age = ageSeconds(createdAt, now);
      tasks.push({
        id: `cleanup:${(table as any).id}`,
        taskKey,
        kind: 'TABLE_CLEANUP',
        source: 'TABLE_SESSION',
        targetId: (table as any).id,
        tableId: (table as any).id,
        tableLabel: (table as any).label || 'Mesa sin identificar',
        sector: (table as any).sector || 'SALON_PRINCIPAL',
        title: 'Mesa lista (limpieza)',
        summary: `${(table as any).label || 'Mesa'} · pagada · falta limpiar`,
        status: 'TO_CLEAN',
        priority: priorityFor(96, age),
        createdAt,
        ageSeconds: age,
        action: 'MARK_CLEAN',
        claim: claimByKey.get(taskKey) || null,
        payload: {}
      });
    }

    tasks.sort((a, b) => b.priority - a.priority || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id.localeCompare(b.id));

    const pendingCalls = calls.filter((call) => call.status === CallStatus.PENDING || call.status === CallStatus.IN_PROGRESS).length;
    const ordersToValidate = kitchenOrders.filter((order) => order.status === OrderStatus.PENDING_VALIDATION).length;
    const ordersInPreparation = kitchenOrders.filter((order) => order.status === OrderStatus.IN_KITCHEN).length;
    const ordersToDeliver = kitchenOrders.filter((order) => order.status === OrderStatus.READY_TO_SERVE).length;
    const accountsToCollect = [...accountByTableId.values()].filter((account) => account.account.saldoMinor > 0).length;

    return {
      restaurantId: restaurant.id,
      generatedAt: new Date(now).toISOString(),
      staleAfterSeconds: 12,
      floorPlan,
      tasks,
      accounts: isTerminalOnly ? [] : [...accountByTableId.values()].sort((a, b) => a.tableLabel.localeCompare(b.tableLabel, 'es', { numeric: true })),
      allowWaitersToCollectCash: Boolean(restaurant.moduleConfig?.allowWaitersToCollectCash),
      allowSplitBill: Boolean(restaurant.moduleConfig?.allowSplitBill),
      summary: {
        totalTasks: tasks.length,
        pendingCalls,
        ordersToValidate,
        ordersInPreparation,
        ordersToDeliver,
        accountsToCollect,
        activeClaims: claims.length
      }
    };
  }
}

function formatMinor(amountMinor: number) {
  return `$${(Math.max(0, amountMinor) / 100).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

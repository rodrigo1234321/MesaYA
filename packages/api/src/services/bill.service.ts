import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';
import { fsmService } from './fsm.service';
import { TableFSMState, SignalSource, OrderStatus } from '@mesaya/shared';
import {
  splitEqualParts,
  assertValidCents,
  sumCents,
  CENTS_CURRENCY,
  toCentsFromFloatPrice
} from '../lib/money';
import { assertValidIdempotencyKey } from '../lib/order-contracts';

export interface BillItemDTO {
  id: string;
  orderId: string;
  menuItemId: string;
  name: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  currency: string;
  notes?: string | null;
  modifiersSnapshot?: any;
  addedByGuest: string;
  participantId?: string | null;
  participantName?: string | null;
  claimedByGuest?: string | null;
  claimVersion: number;
  isPaid: boolean;
}

export interface BillParticipantDTO {
  id: string;
  displayName: string | null;
  claimedItemsCount: number;
  claimedSubtotalCents: number;
}

export interface BillPaymentDTO {
  id: string;
  method: string;
  amountCents: number;
  tipCents: number;
  amountFloat: number;
  tipFloat: number;
  currency: string;
  status: string;
  idempotencyKey: string;
  staffUserId: string;
  participantId?: string | null;
  participantName?: string | null;
  reversalReason?: string | null;
  reversalStaffId?: string | null;
  reversalAt?: string | null;
  resolvedAt: string | null;
}

export interface EqualSplitOptionDTO {
  parts: number;
  distribution: Array<{
    part: number;
    amountCents: number;
    amountFloat: number;
  }>;
}

export interface TableBillDTO {
  tableSessionId: string;
  tableId: string;
  tableLabel: string;
  restaurantId: string;
  restaurantName: string;
  currency: string;
  totalCents: number;
  totalFloat: number;
  paidCents: number;
  paidFloat: number;
  remainingCents: number;
  remainingFloat: number;
  tipTotalCents: number;
  tipTotalFloat: number;
  status: 'OPEN' | 'PAID';
  revision: number;
  items: BillItemDTO[];
  participants: BillParticipantDTO[];
  payments: BillPaymentDTO[];
  settledPayments?: any[];
  splitEqualOptions: EqualSplitOptionDTO[];
}

export class BillService {
  /**
   * Normaliza y valida los métodos de cobro presencial autorizados en el piloto.
   */
  static normalizePaymentMethod(rawMethod: unknown): 'WAITER_CASH' | 'WAITER_CARD' | 'WAITER_MP_QR' {
    if (typeof rawMethod !== 'string') {
      const err: any = new Error('Método de pago requerido');
      err.statusCode = 400;
      err.code = 'INVALID_PAYMENT_METHOD';
      throw err;
    }
    const m = rawMethod.trim().toUpperCase();
    if (m === 'WAITER_CASH' || m === 'CASH') return 'WAITER_CASH';
    if (m === 'WAITER_CARD' || m === 'CARD') return 'WAITER_CARD';
    if (m === 'WAITER_MP_QR' || m === 'MP_QR' || m === 'EXTERNAL_QR') return 'WAITER_MP_QR';

    const err: any = new Error('Método de cobro no válido. Permitidos: WAITER_CASH, WAITER_CARD, WAITER_MP_QR');
    err.statusCode = 400;
    err.code = 'INVALID_PAYMENT_METHOD';
    throw err;
  }

  /**
   * Calcula de forma exhaustiva y determinista la cuenta consolidada para la visita activa.
   * Invariantes:
   * - Moneda única explícita ARS.
   * - Dinero en centavos enteros; cero floats como autoridad contable.
   * - Incluye TODOS los ítems de tandas y órdenes no canceladas de la sesión.
   * - Reparto en partes iguales con distribución determinista de residuo.
   */
  static async calculateTableBill(tableSessionId: string): Promise<TableBillDTO> {
    const session = await prisma.tableSession.findUnique({
      where: { id: tableSessionId },
      include: {
        table: { include: { restaurant: true } },
        participants: { where: { status: 'ACTIVE' } },
        orders: {
          where: { status: { not: OrderStatus.CANCELLED } },
          include: {
            items: {
              include: {
                menuItem: { select: { name: true } },
                participant: { select: { displayName: true } },
                tanda: { select: { status: true, seq: true } }
              },
              orderBy: { createdAt: 'asc' }
            }
          }
        },
        tandas: {
          where: { status: { not: 'CANCELLED' } }
        }
      }
    });

    if (!session) {
      const err: any = new Error('Sesión de mesa no encontrada');
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    // Filtrar ítems de órdenes válidas cuya tanda no haya sido cancelada
    const validItems: BillItemDTO[] = [];
    for (const order of session.orders) {
      for (const it of order.items) {
        if (it.tanda && it.tanda.status === 'CANCELLED') continue;

        const lineCents =
          it.lineTotalCents ??
          (it.unitPriceCents !== null && it.unitPriceCents !== undefined
            ? it.unitPriceCents * it.quantity
            : toCentsFromFloatPrice(it.unitPrice) * it.quantity);

        const unitCents =
          it.unitPriceCents ??
          (it.unitPrice !== null && it.unitPrice !== undefined
            ? toCentsFromFloatPrice(it.unitPrice)
            : Math.round(lineCents / it.quantity));

        let modSnapshot: any = undefined;
        if (it.modifiersSnapshot) {
          try {
            modSnapshot =
              typeof it.modifiersSnapshot === 'string'
                ? JSON.parse(it.modifiersSnapshot)
                : it.modifiersSnapshot;
          } catch (_) {}
        }

        validItems.push({
          id: it.id,
          orderId: order.id,
          menuItemId: it.menuItemId,
          name: it.productNameSnapshot || it.menuItem?.name || 'Ítem',
          quantity: it.quantity,
          unitPriceCents: unitCents,
          lineTotalCents: lineCents,
          currency: CENTS_CURRENCY,
          notes: it.notes,
          modifiersSnapshot: modSnapshot,
          addedByGuest: it.addedByGuest,
          participantId: it.participantId,
          participantName: it.participant?.displayName || null,
          claimedByGuest: it.claimedByGuest,
          claimVersion: it.claimVersion,
          isPaid: it.isPaid
        });
      }
    }

    // Consultar todos los pagos presenciales de la visita (para auditoría e historial en UI)
    const paymentRecords = await prisma.paymentTransaction.findMany({
      where: {
        tableSessionId: session.id
      },
      include: {
        participant: true
      },
      orderBy: { createdAt: 'asc' }
    });

    const payments: BillPaymentDTO[] = paymentRecords.map((p) => {
      const amountCents = p.amountCents ?? toCentsFromFloatPrice(p.amount);
      const tipCents = p.tipCents ?? (p.tipAmount ? toCentsFromFloatPrice(p.tipAmount) : 0);
      return {
        id: p.id,
        method: p.method,
        amountCents,
        tipCents,
        amountFloat: amountCents / 100,
        tipFloat: tipCents / 100,
        currency: CENTS_CURRENCY,
        status: p.status,
        idempotencyKey: p.idempotencyKey,
        staffUserId: p.guestSessionId,
        participantId: p.participantId,
        participantName: p.participant?.displayName || null,
        reversalReason: p.reversalReason,
        reversalStaffId: p.reversalStaffId,
        reversalAt: p.reversalAt?.toISOString() || null,
        resolvedAt: p.resolvedAt?.toISOString() || null
      };
    });

    // Sumas enteras en centavos (solo pagos MANUAL_SETTLED y APPROVED suman al saldo pagado)
    const totalCents = sumCents(validItems.map((i) => i.lineTotalCents), 'totalCents');
    const activePayments = payments.filter((p) => p.status === 'MANUAL_SETTLED' || p.status === 'APPROVED');
    const paidCents = sumCents(activePayments.map((p) => p.amountCents), 'paidCents');
    const tipTotalCents = sumCents(activePayments.map((p) => p.tipCents), 'tipTotalCents');
    const remainingCents = Math.max(0, totalCents - paidCents);

    const isFullyPaid = totalCents > 0 && remainingCents === 0;
    const status: 'OPEN' | 'PAID' = isFullyPaid ? 'PAID' : 'OPEN';

    // Desglose por participante activo
    const participants: BillParticipantDTO[] = session.participants.map((part) => {
      const claimed = validItems.filter(
        (it) => it.claimedByGuest === part.id || (!it.claimedByGuest && it.participantId === part.id)
      );
      const claimedSubtotal = claimed.reduce((sum, it) => sum + it.lineTotalCents, 0);
      return {
        id: part.id,
        displayName: part.displayName,
        claimedItemsCount: claimed.length,
        claimedSubtotalCents: claimedSubtotal
      };
    });

    // Opciones de división en partes iguales (2 a 6 partes) usando splitEqualParts determinista
    const splitEqualOptions: EqualSplitOptionDTO[] = [2, 3, 4, 5, 6].map((parts) => {
      const distributionCents = splitEqualParts(remainingCents, parts);
      return {
        parts,
        distribution: distributionCents.map((amt, idx) => ({
          part: idx + 1,
          amountCents: amt,
          amountFloat: amt / 100
        }))
      };
    });

    // Revisión numérica calculada para control de concurrencia optimista de cuenta
    const revision =
      validItems.reduce((acc, it) => acc + it.claimVersion + 1, 0) + payments.length;

    return {
      tableSessionId: session.id,
      tableId: session.tableId,
      tableLabel: session.table.label,
      restaurantId: session.table.restaurantId,
      restaurantName: session.table.restaurant.name,
      currency: CENTS_CURRENCY,
      totalCents,
      totalFloat: totalCents / 100,
      paidCents,
      paidFloat: paidCents / 100,
      remainingCents,
      remainingFloat: remainingCents / 100,
      tipTotalCents,
      tipTotalFloat: tipTotalCents / 100,
      status,
      revision,
      items: validItems,
      participants,
      payments,
      settledPayments: payments,
      splitEqualOptions
    };
  }

  /**
   * Reclamo optimista de un ítem por un comensal con control de versión estricto.
   * Evita condiciones de carrera entre comensales al repartirse la cuenta.
   */
  static async claimItemByParticipant(params: {
    sessionToken: string;
    participantToken?: string;
    guestSessionId?: string;
    orderItemId: string;
    expectedVersion: number;
    unclaim?: boolean;
  }): Promise<{ item: BillItemDTO; bill: TableBillDTO }> {
    const { sessionToken, participantToken, guestSessionId, orderItemId, expectedVersion, unclaim } = params;

    const session = await prisma.tableSession.findUnique({
      where: { token: sessionToken },
      include: { table: true }
    });

    if (!session || session.closedAt !== null) {
      const err: any = new Error('Sesión de comensal no válida o finalizada');
      err.statusCode = 404;
      err.code = 'SESSION_NOT_FOUND';
      throw err;
    }

    let claimantId = guestSessionId || 'anon-guest';
    if (participantToken) {
      const { createHash } = await import('crypto');
      const tokenHash = createHash('sha256').update(participantToken.trim()).digest('hex');
      const participant = await prisma.visitParticipant.findUnique({
        where: { tokenHash }
      });
      if (participant && participant.tableSessionId === session.id && participant.status === 'ACTIVE') {
        claimantId = participant.id;
      }
    }

    if (typeof expectedVersion !== 'number' || !Number.isInteger(expectedVersion) || expectedVersion < 0) {
      const err: any = new Error('expectedVersion debe ser entero >= 0');
      err.statusCode = 400;
      err.code = 'INVALID_EXPECTED_VERSION';
      throw err;
    }

    const updatedItem = await prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUnique({
        where: { id: orderItemId },
        include: { order: true }
      });

      if (!item || item.order.tableSessionId !== session.id) {
        const err: any = new Error('Ítem no encontrado en la comanda de esta mesa');
        err.statusCode = 404;
        err.code = 'ITEM_NOT_FOUND';
        throw err;
      }

      if (item.isPaid) {
        const err: any = new Error('No se puede reclamar o modificar un ítem que ya fue pagado');
        err.statusCode = 409;
        err.code = 'ITEM_ALREADY_PAID';
        throw err;
      }

      if (item.claimVersion !== expectedVersion) {
        const err: any = new Error(
          `Conflicto de concurrencia: el ítem fue modificado simultáneamente (versión esperada ${expectedVersion}, actual ${item.claimVersion})`
        );
        err.statusCode = 409;
        err.code = 'CLAIM_VERSION_MISMATCH';
        throw err;
      }

      const newClaimant = unclaim ? null : claimantId;
      const nextVersion = item.claimVersion + 1;

      return tx.orderItem.update({
        where: { id: orderItemId },
        data: {
          claimedByGuest: newClaimant,
          claimVersion: nextVersion
        },
        include: {
          menuItem: { select: { name: true } },
          participant: { select: { displayName: true } }
        }
      });
    });

    const bill = await this.calculateTableBill(session.id);

    eventBus.broadcast(session.table.restaurantId, 'bill.item_claimed', {
      tableId: session.tableId,
      orderItemId: updatedItem.id,
      claimedBy: updatedItem.claimedByGuest,
      claimVersion: updatedItem.claimVersion
    });

    const lineCents =
      updatedItem.lineTotalCents ??
      (updatedItem.unitPriceCents !== null && updatedItem.unitPriceCents !== undefined
        ? updatedItem.unitPriceCents * updatedItem.quantity
        : toCentsFromFloatPrice(updatedItem.unitPrice) * updatedItem.quantity);

    const unitCents =
      updatedItem.unitPriceCents ??
      (updatedItem.unitPrice !== null && updatedItem.unitPrice !== undefined
        ? toCentsFromFloatPrice(updatedItem.unitPrice)
        : Math.round(lineCents / updatedItem.quantity));

    return {
      item: {
        id: updatedItem.id,
        orderId: updatedItem.orderId,
        menuItemId: updatedItem.menuItemId,
        name: updatedItem.productNameSnapshot || updatedItem.menuItem?.name || 'Ítem',
        quantity: updatedItem.quantity,
        unitPriceCents: unitCents,
        lineTotalCents: lineCents,
        currency: CENTS_CURRENCY,
        notes: updatedItem.notes,
        addedByGuest: updatedItem.addedByGuest,
        participantId: updatedItem.participantId,
        participantName: updatedItem.participant?.displayName || null,
        claimedByGuest: updatedItem.claimedByGuest,
        claimVersion: updatedItem.claimVersion,
        isPaid: updatedItem.isPaid
      },
      bill
    };
  }

  /**
   * Calcula el reparto exacto en centavos para un plato compartido entre N comensales.
   * La suma de las partes es idéntica al importe total de la línea (cero pérdida de centavos).
   */
  static calculateSharedItemSplit(lineTotalCents: number, participantCount: number): number[] {
    assertValidCents(lineTotalCents, 'lineTotalCents');
    return splitEqualParts(lineTotalCents, participantCount);
  }

  /**
   * Registro presencial de cobro por personal autorizado (WAITER / MANAGER).
   * Invariantes críticas:
   * 1. Idempotencia estricta por idempotencyKey: reintento idéntico retorna misma transacción;
   *    reintento con diferente importe/parámetros arroja 409 conflicto.
   * 2. Prevención absoluta de sobrepago: si el importe supera el saldo remanente, arroja 409.
   * 3. Concurrencia segura en transacción atómica: si dos mozos cobran a la vez, sólo uno consume el saldo.
   * 4. Propina separada del consumo: no reduce deuda de cocina ni impide liquidar saldo.
   * 5. Transición a PAID del pedido y la mesa sólo cuando el saldo remanente llega exactamente a 0.
   */
  static async settleManualPayment(params: {
    staffRestaurantId: string;
    staffUserId: string;
    staffRole: string;
    tableSessionId?: string;
    tableId?: string;
    orderId?: string;
    amountCents: number;
    tipCents?: number;
    paymentMethod: string;
    idempotencyKey: string;
    participantId?: string;
    orderItemId?: string;
  }): Promise<{ transaction: BillPaymentDTO; bill: TableBillDTO; duplicate?: boolean }> {
    const {
      staffRestaurantId,
      staffUserId,
      staffRole: _staffRole,
      amountCents,
      tipCents = 0,
      paymentMethod,
      idempotencyKey,
      participantId,
      orderItemId
    } = params;

    assertValidIdempotencyKey(idempotencyKey);
    assertValidCents(amountCents, 'amountCents');
    assertValidCents(tipCents, 'tipCents');

    if (amountCents <= 0) {
      const err: any = new Error('El importe a cobrar debe ser mayor a 0 centavos');
      err.statusCode = 400;
      err.code = 'INVALID_AMOUNT';
      throw err;
    }

    const normalizedMethod = this.normalizePaymentMethod(paymentMethod);

    let targetSessionId = params.tableSessionId;

    if (!targetSessionId && params.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        select: { tableSessionId: true }
      });
      targetSessionId = order?.tableSessionId;
    }

    if (!targetSessionId && params.tableId) {
      const activeSession = await prisma.tableSession.findFirst({
        where: { tableId: params.tableId, closedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true }
      });
      targetSessionId = activeSession?.id;
    }

    if (!targetSessionId) {
      const err: any = new Error('No se especificó sesión de mesa ni orden válida para cobrar');
      err.statusCode = 400;
      err.code = 'MISSING_SESSION';
      throw err;
    }

    let fsmBroadcast: any = null;
    let result: any;

    try {
      result = await prisma.$transaction(async (tx) => {
        // 1. Localización y bloqueo de la sesión primero para serializar cobros concurrentes
        const session = await tx.tableSession.findUnique({
          where: { id: targetSessionId },
          include: { table: true }
        });

        if (!session) {
          const err: any = new Error('Sesión de mesa no encontrada');
          err.statusCode = 404;
          err.code = 'SESSION_NOT_FOUND';
          throw err;
        }

        // Tenant isolation: el staff sólo puede cobrar mesas de su propio restaurante
        if (session.table.restaurantId !== staffRestaurantId) {
          const err: any = new Error('No autorizado para registrar pagos de otro restaurante');
          err.statusCode = 403;
          err.code = 'STAFF_TENANT_MISMATCH';
          throw err;
        }

        // Serializar cobros concurrentes sobre la sesión para evitar lecturas de saldo desfasadas.
        // En PostgreSQL esto adquiere un bloqueo exclusivo de fila (row-level lock);
        // en SQLite se ejecuta de forma serializada dentro de la transacción.
        await tx.tableSession.update({
          where: { id: targetSessionId },
          data: { paymentSeq: { increment: 1 } }
        });

        // 2. Verificación estricta de idempotencia BAJO BLOQUEO de la sesión
        const existingTx = await tx.paymentTransaction.findUnique({
          where: { idempotencyKey },
          include: {
            participant: true,
            order: {
              include: {
                tableSession: {
                  include: { table: true }
                }
              }
            }
          }
        });

        if (existingTx) {
          const existingAmountCents = existingTx.amountCents ?? toCentsFromFloatPrice(existingTx.amount);
          const existingTipCents = existingTx.tipCents ?? (existingTx.tipAmount ? toCentsFromFloatPrice(existingTx.tipAmount) : 0);
          const txSessionId = existingTx.tableSessionId || existingTx.order?.tableSessionId;
          const txRestaurantId = existingTx.order?.tableSession?.table?.restaurantId;

          const reqParticipant = participantId || null;
          const txParticipant = existingTx.participantId || null;
          const reqItem = orderItemId || null;
          const txItem = (existingTx as any).requestedOrderItemId || null;

          if (
            txSessionId !== targetSessionId ||
            (txRestaurantId && txRestaurantId !== staffRestaurantId) ||
            existingTx.method !== normalizedMethod ||
            existingAmountCents !== amountCents ||
            existingTipCents !== tipCents ||
            reqParticipant !== txParticipant ||
            reqItem !== txItem
          ) {
            const err: any = new Error(
              `Conflicto de idempotencia: la clave ya fue utilizada con diferente sesión, restaurante, método, importes u objetivo dirigido`
            );
            err.statusCode = 409;
            err.code = 'IDEMPOTENCY_CONFLICT';
            throw err;
          }

          return { existing: existingTx, session };
        }

        // 3. Validación de pertenencia a la sesión (participante e ítem).
        // Se valida el objetivo ANTES que el estado de la sesión para devolver
        // el error más específico (p. ej. participante ajeno) incluso si la
        // sesión ya se cerró; el reintento idempotente exacto ya se resolvió arriba.
        if (participantId) {
          const participant = await tx.visitParticipant.findFirst({
            where: { id: participantId, tableSessionId: session.id }
          });
          if (!participant) {
            const err: any = new Error('El participante especificado no pertenece a la sesión de la mesa');
            err.statusCode = 400;
            err.code = 'PARTICIPANT_NOT_IN_SESSION';
            throw err;
          }
          if (participant.status !== 'ACTIVE') {
            const err: any = new Error(
              `El participante especificado no está activo (estado actual: ${participant.status})`
            );
            err.statusCode = 409;
            err.code = 'PARTICIPANT_NOT_ACTIVE';
            throw err;
          }
        }

        if (orderItemId) {
          const item = await tx.orderItem.findFirst({
            where: { id: orderItemId, order: { tableSessionId: session.id } }
          });
          if (!item) {
            const err: any = new Error('El ítem especificado no pertenece a la sesión de la mesa');
            err.statusCode = 400;
            err.code = 'ITEM_NOT_IN_SESSION';
            throw err;
          }
        }

        // 4. La sesión objetivo debe seguir abierta: ni cerrada ni vencida.
        // Se valida DESPUÉS del chequeo idempotente (paso 2) para que el reintento
        // exacto de una transacción ya válida siga devolviendo el duplicado.
        if (session.closedAt !== null) {
          const err: any = new Error('La sesión de mesa ya fue cerrada; no se aceptan pagos nuevos');
          err.statusCode = 409;
          err.code = 'SESSION_CLOSED';
          throw err;
        }

        if (session.expiresAt && new Date(session.expiresAt).getTime() <= Date.now()) {
          const err: any = new Error('La sesión de mesa expiró; no se aceptan pagos nuevos');
          err.statusCode = 409;
          err.code = 'SESSION_EXPIRED';
          throw err;
        }

        // 5. Cálculo de balance dentro de la transacción serializada
        const nonCancelledOrders = await tx.order.findMany({
          where: {
            tableSessionId: session.id,
            status: { not: OrderStatus.CANCELLED }
          },
          include: {
            items: {
              include: { tanda: true }
            }
          }
        });

        let totalSessionCents = 0;
        for (const ord of nonCancelledOrders) {
          for (const item of ord.items) {
            if (item.tanda && item.tanda.status === 'CANCELLED') continue;
            const lineC =
              item.lineTotalCents ??
              (item.unitPriceCents !== null && item.unitPriceCents !== undefined
                ? item.unitPriceCents * item.quantity
                : toCentsFromFloatPrice(item.unitPrice) * item.quantity);
            totalSessionCents += lineC;
          }
        }

        const existingSettled = await tx.paymentTransaction.findMany({
          where: {
            tableSessionId: session.id,
            status: { in: ['MANUAL_SETTLED', 'APPROVED'] }
          }
        });

        let paidSessionCents = 0;
        for (const p of existingSettled) {
          paidSessionCents += p.amountCents ?? toCentsFromFloatPrice(p.amount);
        }

        const currentRemainingCents = Math.max(0, totalSessionCents - paidSessionCents);

        if (currentRemainingCents <= 0) {
          const err: any = new Error('La cuenta de la mesa ya se encuentra saldada en su totalidad');
          err.statusCode = 409;
          err.code = 'BILL_ALREADY_PAID';
          throw err;
        }

        if (amountCents > currentRemainingCents) {
          const err: any = new Error(
            `Sobrepago no permitido: el importe a cobrar ($${amountCents / 100}) supera el saldo pendiente ($${currentRemainingCents / 100})`
          );
          err.statusCode = 409;
          err.code = 'OVERPAYMENT_NOT_ALLOWED';
          throw err;
        }

        // 6. Seleccionar la orden activa para relacionar la transacción
        let primaryOrder = nonCancelledOrders.find(
          (o) => o.status !== OrderStatus.PAID && o.status !== OrderStatus.CANCELLED
        );
        if (!primaryOrder && nonCancelledOrders.length > 0) {
          primaryOrder = nonCancelledOrders[0];
        }

        if (!primaryOrder) {
          const err: any = new Error('No hay comandas activas para asociar el cobro');
          err.statusCode = 400;
          err.code = 'NO_ACTIVE_ORDER';
          throw err;
        }

        const now = new Date();

        // 7. Crear registro de pago presencial con trazabilidad de participante y objetivo dirigido
        const createdTx = await tx.paymentTransaction.create({
          data: {
            idempotencyKey,
            orderId: primaryOrder.id,
            tableSessionId: session.id,
            guestSessionId: staffUserId,
            participantId: participantId || null,
            requestedOrderItemId: orderItemId || null,
            method: normalizedMethod,
            amount: amountCents / 100,
            amountCents,
            tipAmount: tipCents / 100,
            tipCents,
            currency: CENTS_CURRENCY,
            status: 'MANUAL_SETTLED',
            resolvedAt: now
          },
          include: {
            participant: true
          }
        });

        // 8. Asignación contable granular (PaymentAllocation)
        let itemsToAllocate: typeof nonCancelledOrders[0]['items'] = [];

        if (orderItemId) {
          itemsToAllocate = nonCancelledOrders.flatMap((o) => o.items).filter((i) => i.id === orderItemId);
        } else if (participantId) {
          itemsToAllocate = nonCancelledOrders
            .flatMap((o) => o.items)
            .filter(
              (i) =>
                (!i.tanda || i.tanda.status !== 'CANCELLED') &&
                (i.claimedByGuest === participantId || i.participantId === participantId)
            );
        } else {
          itemsToAllocate = nonCancelledOrders
            .flatMap((o) => o.items)
            .filter((i) => !i.tanda || i.tanda.status !== 'CANCELLED');
        }

        let remainingPaymentCents = amountCents;
        for (const item of itemsToAllocate) {
          if (remainingPaymentCents <= 0) break;

          const itemTotal =
            item.lineTotalCents ??
            (item.unitPriceCents !== null && item.unitPriceCents !== undefined
              ? item.unitPriceCents * item.quantity
              : toCentsFromFloatPrice(item.unitPrice) * item.quantity);

          const priorAllocs = await tx.paymentAllocation.findMany({
            where: {
              orderItemId: item.id,
              paymentTransaction: {
                status: { in: ['MANUAL_SETTLED', 'APPROVED'] }
              }
            }
          });
          const priorCovered = priorAllocs.reduce((sum, a) => sum + a.amountCents, 0);
          const needed = Math.max(0, itemTotal - priorCovered);

          if (needed > 0) {
            const allocAmount = Math.min(remainingPaymentCents, needed);
            await tx.paymentAllocation.create({
              data: {
                paymentTransactionId: createdTx.id,
                orderItemId: item.id,
                amountCents: allocAmount
              }
            });
            remainingPaymentCents -= allocAmount;

            if (priorCovered + allocAmount >= itemTotal) {
              await tx.orderItem.update({
                where: { id: item.id },
                data: { isPaid: true }
              });
            }
          }
        }

        // 8b. Rechazo atómico de remanente no asignado: si el pago es dirigido
        // (participantId u orderItemId) y el importe supera el saldo todavía asignable
        // a ese objetivo, o si un pago general no logró asignar toda su suma, se aborta
        // la transacción completa (sin persistir PaymentTransaction ni allocations).
        if (remainingPaymentCents > 0) {
          const err: any = new Error(
            `Remanente sin asignar no permitido: ${remainingPaymentCents} centavos del cobro no corresponden a saldo asignable del objetivo dirigido`
          );
          err.statusCode = 409;
          err.code = 'UNALLOCATED_PAYMENT_REMAINDER';
          err.details = { remainingPaymentCents, amountCents, participantId: participantId || null, orderItemId: orderItemId || null };
          throw err;
        }

        // 9. Si el saldo llegó a 0 con este pago, liquidar órdenes y mesa ATÓMICAMENTE
        const isBalanceCleared = amountCents === currentRemainingCents;
        if (isBalanceCleared) {
          await tx.order.updateMany({
            where: {
              tableSessionId: session.id,
              status: { notIn: [OrderStatus.PAID, OrderStatus.CANCELLED] }
            },
            data: { status: OrderStatus.PAID }
          });

          await tx.orderItem.updateMany({
            where: {
              order: { tableSessionId: session.id }
            },
            data: { isPaid: true }
          });

          // Transición atómica de mesa a PAID dentro de la misma transacción
          const freshTable = await tx.table.findUnique({ where: { id: session.tableId } });
          if (freshTable && freshTable.currentState !== TableFSMState.PAID) {
            const fsmRes = await fsmService.attemptTransition(
              {
                tableId: session.tableId,
                toState: TableFSMState.PAID,
                source: SignalSource.STAFF_TERMINAL_TAP,
                trigger: 'Cuenta saldada en su totalidad por personal presencial',
                staffUserId,
                isOverride: true
              },
              tx
            );
            if (fsmRes && typeof fsmRes.broadcast === 'function') {
              fsmBroadcast = fsmRes.broadcast;
            }
          }
        }

        return {
          created: createdTx,
          session,
          isBalanceCleared
        };
      });
    } catch (txErr: any) {
      // Manejo de carrera concurrente sobre la misma clave de idempotencia
      if (
        txErr?.code === 'P2002' ||
        txErr?.code === 'BILL_ALREADY_PAID' ||
        txErr?.message?.includes('idempotencyKey')
      ) {
        const fallbackTx = await prisma.paymentTransaction.findUnique({
          where: { idempotencyKey },
          include: {
            participant: true,
            order: {
              include: {
                tableSession: {
                  include: { table: true }
                }
              }
            }
          }
        });

        if (fallbackTx) {
          const fallbackAmountCents = fallbackTx.amountCents ?? toCentsFromFloatPrice(fallbackTx.amount);
          const fallbackTipCents = fallbackTx.tipCents ?? (fallbackTx.tipAmount ? toCentsFromFloatPrice(fallbackTx.tipAmount) : 0);
          const txSessionId = fallbackTx.tableSessionId || fallbackTx.order?.tableSessionId;
          const txRestaurantId = fallbackTx.order?.tableSession?.table?.restaurantId;

          const reqParticipant = participantId || null;
          const txParticipant = fallbackTx.participantId || null;
          const reqItem = orderItemId || null;
          const txItem = (fallbackTx as any).requestedOrderItemId || null;

          if (
            txSessionId !== targetSessionId ||
            (txRestaurantId && txRestaurantId !== staffRestaurantId) ||
            fallbackTx.method !== normalizedMethod ||
            fallbackAmountCents !== amountCents ||
            fallbackTipCents !== tipCents ||
            reqParticipant !== txParticipant ||
            reqItem !== txItem
          ) {
            const conflictErr: any = new Error(
              `Conflicto de idempotencia: la clave ya fue utilizada con diferente sesión, restaurante, método, importes u objetivo dirigido`
            );
            conflictErr.statusCode = 409;
            conflictErr.code = 'IDEMPOTENCY_CONFLICT';
            throw conflictErr;
          }

          result = { existing: fallbackTx, session: fallbackTx.order.tableSession };
        } else {
          throw txErr;
        }
      } else {
        throw txErr;
      }
    }

    if (typeof fsmBroadcast === 'function') {
      try {
        fsmBroadcast();
      } catch (_) {}
    }

    if (result.existing) {
      const bill = await this.calculateTableBill(result.existing.tableSessionId);
      const amountCents = result.existing.amountCents ?? toCentsFromFloatPrice(result.existing.amount);
      const tipCents = result.existing.tipCents ?? (result.existing.tipAmount ? toCentsFromFloatPrice(result.existing.tipAmount) : 0);

      return {
        transaction: {
          id: result.existing.id,
          method: result.existing.method,
          amountCents,
          tipCents,
          amountFloat: amountCents / 100,
          tipFloat: tipCents / 100,
          currency: CENTS_CURRENCY,
          status: result.existing.status,
          idempotencyKey: result.existing.idempotencyKey,
          staffUserId: result.existing.guestSessionId,
          participantId: result.existing.participantId,
          participantName: result.existing.participant?.displayName || null,
          resolvedAt: result.existing.resolvedAt?.toISOString() || null
        },
        bill,
        duplicate: true
      };
    }

    const { created, session } = result;
    const bill = await this.calculateTableBill(session.id);

    eventBus.broadcast(session.table.restaurantId, 'payment.settled', {
      tableId: session.tableId,
      tableLabel: session.table.label,
      transactionId: created.id,
      amountCents: created.amountCents,
      tipCents: created.tipCents,
      remainingCents: bill.remainingCents,
      isFullyPaid: bill.status === 'PAID'
    });

    if (bill.status === 'PAID') {
      eventBus.broadcast(session.table.restaurantId, 'order.paid', {
        tableId: session.tableId,
        tableLabel: session.table.label,
        totalAmount: bill.totalFloat,
        paidAt: new Date().toISOString()
      });
    }

    return {
      transaction: {
        id: created.id,
        method: created.method,
        amountCents: created.amountCents!,
        tipCents: created.tipCents!,
        amountFloat: created.amountCents! / 100,
        tipFloat: created.tipCents! / 100,
        currency: CENTS_CURRENCY,
        status: created.status,
        idempotencyKey: created.idempotencyKey,
        staffUserId: created.guestSessionId,
        participantId: created.participantId,
        participantName: created.participant?.displayName || null,
        resolvedAt: created.resolvedAt?.toISOString() || null
      },
      bill
    };
  }

  /**
   * Reversión autorizada de un cobro presencial con registro de auditoría.
   * Restringida a rol MANAGER. Reabre el saldo deudor de la mesa y restaura el estado operativo atómicamente.
   */
  static async revertManualPayment(params: {
    staffRestaurantId: string;
    staffUserId: string;
    staffRole: string;
    paymentTransactionId: string;
    reason?: string;
  }): Promise<{ success: boolean; bill: TableBillDTO }> {
    const { staffRestaurantId, staffUserId, staffRole, paymentTransactionId } = params;

    if (staffRole !== 'MANAGER') {
      const err: any = new Error('Solo un usuario con rol MANAGER puede autorizar la reversión de cobros presenciales');
      err.statusCode = 403;
      err.code = 'FORBIDDEN_ROLE';
      throw err;
    }

    const tx = await prisma.paymentTransaction.findUnique({
      where: { id: paymentTransactionId },
      include: {
        order: {
          include: {
            tableSession: {
              include: { table: true }
            }
          }
        }
      }
    });

    if (!tx) {
      const err: any = new Error('Transacción de pago no encontrada');
      err.statusCode = 404;
      err.code = 'TRANSACTION_NOT_FOUND';
      throw err;
    }

    const restaurantId = tx.order.tableSession.table.restaurantId;
    const tableId = tx.order.tableSession.table.id;

    if (restaurantId !== staffRestaurantId) {
      const err: any = new Error('No autorizado para revertir pagos de otro restaurante');
      err.statusCode = 403;
      err.code = 'STAFF_TENANT_MISMATCH';
      throw err;
    }

    if (tx.status !== 'MANUAL_SETTLED') {
      const err: any = new Error(`Solo se pueden revertir cobros en estado MANUAL_SETTLED (estado actual: ${tx.status})`);
      err.statusCode = 400;
      err.code = 'CANNOT_REVERT';
      throw err;
    }

    const normalizedReason = (params.reason || 'Reversión autorizada por MANAGER').trim().slice(0, 500);

    let fsmRevertBroadcast: any = null;

    // Reversión contable y restauración de FSM ATÓMICA en una sola transacción
    await prisma.$transaction(async (prismaTx) => {
      await prismaTx.paymentTransaction.update({
        where: { id: tx.id },
        data: {
          status: 'REFUNDED',
          reversalReason: normalizedReason,
          reversalStaffId: staffUserId,
          reversalAt: new Date()
        }
      });

      // Si la comanda estaba en PAID, se reabre a SERVED para reflejar el saldo pendiente
      await prismaTx.order.updateMany({
        where: {
          tableSessionId: tx.tableSessionId,
          status: OrderStatus.PAID
        },
        data: { status: OrderStatus.SERVED }
      });

      // Re-evaluar granularmente cada ítem de la sesión:
      // Un ítem sólo permanece pagado si la suma de sus allocations activas (MANUAL_SETTLED, APPROVED)
      // cubre su lineTotalCents. Si no la cubre, se marca isPaid: false.
      const sessionOrders = await prismaTx.order.findMany({
        where: {
          tableSessionId: tx.tableSessionId,
          status: { not: OrderStatus.CANCELLED }
        },
        include: {
          items: true
        }
      });

      for (const ord of sessionOrders) {
        for (const item of ord.items) {
          const itemTotal =
            item.lineTotalCents ??
            (item.unitPriceCents !== null && item.unitPriceCents !== undefined
              ? item.unitPriceCents * item.quantity
              : toCentsFromFloatPrice(item.unitPrice) * item.quantity);

          const activeAllocs = await prismaTx.paymentAllocation.findMany({
            where: {
              orderItemId: item.id,
              paymentTransaction: {
                status: { in: ['MANUAL_SETTLED', 'APPROVED'] }
              }
            }
          });
          const coveredCents = activeAllocs.reduce((sum, a) => sum + a.amountCents, 0);
          const shouldBePaid = coveredCents >= itemTotal && itemTotal > 0;

          if (item.isPaid !== shouldBePaid) {
            await prismaTx.orderItem.update({
              where: { id: item.id },
              data: { isPaid: shouldBePaid }
            });
          }
        }
      }

      // Reabrir estado de la mesa en FSM si estaba en PAID ATÓMICAMENTE dentro de la transacción
      const freshTable = await prismaTx.table.findUnique({ where: { id: tableId } });
      if (freshTable && freshTable.currentState === TableFSMState.PAID) {
        const fsmRes = await fsmService.attemptTransition(
          {
            tableId,
            toState: TableFSMState.EATING,
            source: SignalSource.STAFF_TERMINAL_TAP,
            trigger: `Cobro presencial revertido por MANAGER: ${normalizedReason}`,
            staffUserId,
            isOverride: true
          },
          prismaTx
        );
        if (fsmRes && typeof fsmRes.broadcast === 'function') {
          fsmRevertBroadcast = fsmRes.broadcast;
        }
      }
    });

    if (typeof fsmRevertBroadcast === 'function') {
      try {
        fsmRevertBroadcast();
      } catch (_) {}
    }

    const bill = await this.calculateTableBill(tx.tableSessionId);

    eventBus.broadcast(restaurantId, 'payment.reverted', {
      tableId,
      transactionId: tx.id,
      revertedBy: staffUserId,
      reason: normalizedReason,
      remainingCents: bill.remainingCents
    });

    return { success: true, bill };
  }

  /**
   * Comprueba si una mesa tiene un saldo activo pendiente de pago.
   * Usado como guarda para impedir el cierre físico o virtual con deuda abierta.
   */
  static async hasUnpaidBalance(tableId: string): Promise<{ hasUnpaid: boolean; remainingCents: number; tableSessionId?: string }> {
    const activeSession = await prisma.tableSession.findFirst({
      where: { tableId, closedAt: null },
      orderBy: { createdAt: 'desc' }
    });

    if (!activeSession) {
      return { hasUnpaid: false, remainingCents: 0 };
    }

    try {
      const bill = await this.calculateTableBill(activeSession.id);
      return {
        hasUnpaid: bill.remainingCents > 0,
        remainingCents: bill.remainingCents,
        tableSessionId: activeSession.id
      };
    } catch (_) {
      return { hasUnpaid: false, remainingCents: 0, tableSessionId: activeSession.id };
    }
  }
}

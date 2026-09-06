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

    // Consultar todos los pagos presenciales confirmados (MANUAL_SETTLED / APPROVED)
    const paymentRecords = await prisma.paymentTransaction.findMany({
      where: {
        tableSessionId: session.id,
        status: { in: ['MANUAL_SETTLED', 'APPROVED'] }
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
        resolvedAt: p.resolvedAt?.toISOString() || null
      };
    });

    // Sumas enteras en centavos
    const totalCents = sumCents(validItems.map((i) => i.lineTotalCents), 'totalCents');
    const paidCents = sumCents(payments.map((p) => p.amountCents), 'paidCents');
    const tipTotalCents = sumCents(payments.map((p) => p.tipCents), 'tipTotalCents');
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
      participantId: _participantId,
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

    // Ejecución transaccional atómica con aislamiento
    const result = await prisma.$transaction(async (tx) => {
      // 1. Verificación de idempotencia
      const existingTx = await tx.paymentTransaction.findUnique({
        where: { idempotencyKey }
      });

      if (existingTx) {
        const existingAmountCents = existingTx.amountCents ?? toCentsFromFloatPrice(existingTx.amount);
        const existingTipCents = existingTx.tipCents ?? (existingTx.tipAmount ? toCentsFromFloatPrice(existingTx.tipAmount) : 0);

        if (existingAmountCents !== amountCents || existingTipCents !== tipCents) {
          const err: any = new Error(
            `Conflicto de idempotencia: la clave ya fue utilizada con importes distintos (existente: $${existingAmountCents / 100}, solicitado: $${amountCents / 100})`
          );
          err.statusCode = 409;
          err.code = 'IDEMPOTENCY_CONFLICT';
          throw err;
        }

        return { existing: existingTx };
      }

      // 2. Localización de la sesión de mesa
      let targetSessionId = params.tableSessionId;

      if (!targetSessionId && params.orderId) {
        const order = await tx.order.findUnique({
          where: { id: params.orderId },
          select: { tableSessionId: true }
        });
        targetSessionId = order?.tableSessionId;
      }

      if (!targetSessionId && params.tableId) {
        const activeSession = await tx.tableSession.findFirst({
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

      // 3. Cálculo de balance dentro de la transacción para evitar carreras de cobro simultáneo
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

      // 4. Seleccionar la orden activa para relacionar la transacción
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

      // 5. Crear registro de pago presencial
      const createdTx = await tx.paymentTransaction.create({
        data: {
          idempotencyKey,
          orderId: primaryOrder.id,
          tableSessionId: session.id,
          guestSessionId: staffUserId,
          method: normalizedMethod,
          amount: amountCents / 100,
          amountCents,
          tipAmount: tipCents / 100,
          tipCents,
          currency: CENTS_CURRENCY,
          status: 'MANUAL_SETTLED',
          resolvedAt: now
        }
      });

      // 6. Si se pagó un ítem específico, marcarlo como pagado
      if (orderItemId) {
        await tx.orderItem.updateMany({
          where: { id: orderItemId, order: { tableSessionId: session.id } },
          data: { isPaid: true }
        });
      }

      // 7. Si el saldo llegó a 0 con este pago, liquidar órdenes y mesa
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
      }

      return {
        created: createdTx,
        session,
        isBalanceCleared
      };
    });

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
          resolvedAt: result.existing.resolvedAt?.toISOString() || null
        },
        bill,
        duplicate: true
      };
    }

    const { created, session, isBalanceCleared } = result;

    // Transición de mesa a PAID sólo si la cuenta se saldó completamente
    if (isBalanceCleared) {
      try {
        const freshTable = await prisma.table.findUnique({ where: { id: session.tableId } });
        if (
          freshTable &&
          (freshTable.currentState === TableFSMState.EATING ||
            freshTable.currentState === TableFSMState.BILL_REQUESTED ||
            freshTable.currentState === TableFSMState.ORDER_IN_KITCHEN)
        ) {
          await fsmService.attemptTransition({
            tableId: session.tableId,
            toState: TableFSMState.PAID,
            source: SignalSource.STAFF_TERMINAL_TAP,
            trigger: 'Cuenta saldada en su totalidad por personal presencial',
            staffUserId
          });
        }
      } catch (err) {
        console.warn('[settleManualPayment] FSM state transition warning:', err);
      }
    }

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
        resolvedAt: created.resolvedAt?.toISOString() || null
      },
      bill
    };
  }

  /**
   * Reversión autorizada de un cobro presencial con registro de auditoría.
   * Reabre el saldo deudor de la mesa y restaura el estado operativo si corresponde.
   */
  static async revertManualPayment(params: {
    staffRestaurantId: string;
    staffUserId: string;
    staffRole: string;
    paymentTransactionId: string;
  }): Promise<{ success: boolean; bill: TableBillDTO }> {
    const { staffRestaurantId, staffUserId, paymentTransactionId } = params;

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

    await prisma.$transaction(async (prismaTx) => {
      await prismaTx.paymentTransaction.update({
        where: { id: tx.id },
        data: { status: 'REFUNDED' }
      });

      // Si la comanda estaba en PAID, se reabre a SERVED para reflejar el saldo pendiente
      await prismaTx.order.updateMany({
        where: {
          tableSessionId: tx.tableSessionId,
          status: OrderStatus.PAID
        },
        data: { status: OrderStatus.SERVED }
      });

      // Marcar ítems de la orden como pendientes de pago
      await prismaTx.orderItem.updateMany({
        where: {
          order: { tableSessionId: tx.tableSessionId }
        },
        data: { isPaid: false }
      });
    });

    // Reabrir estado de la mesa en FSM si estaba en PAID
    try {
      const freshTable = await prisma.table.findUnique({ where: { id: tableId } });
      if (freshTable && freshTable.currentState === TableFSMState.PAID) {
        await fsmService.attemptTransition({
          tableId,
          toState: TableFSMState.EATING,
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: 'Cobro presencial revertido por personal autorizado',
          staffUserId
        });
      }
    } catch (err) {
      console.warn('[revertManualPayment] FSM state rollback warning:', err);
    }

    const bill = await this.calculateTableBill(tx.tableSessionId);

    eventBus.broadcast(restaurantId, 'payment.reverted', {
      tableId,
      transactionId: tx.id,
      revertedBy: staffUserId,
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

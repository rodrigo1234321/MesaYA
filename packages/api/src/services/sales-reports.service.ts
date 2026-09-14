import { prisma } from '../lib/prisma';
import {
  SalesSummaryDTO,
  SalesOperationDTO,
  PaymentMethodBreakdownDTO,
  WAITER_PAYMENT_METHOD_LABELS,
  WaiterPaymentMethod,
  OrderStatus,
  CANONICAL_CONSUMO_STATUSES,
  isOrderComputable
} from '@mesaya/shared';

export interface SalesReportQueryOptions {
  period?: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
  dateFrom?: string;
  dateTo?: string;
  paymentMethod?: string;
  responsibleStaffUserId?: string;
  hasFiscalDocument?: boolean;
}

export class SalesReportsService {
  /**
   * Determina los límites UTC [start, end) a partir del período solicitado
   * y la zona horaria IANA del restaurante (default Argentina).
   */
  static resolveDateRange(
    timezone: string,
    options: SalesReportQueryOptions
  ): { dateFrom: Date; dateTo: Date; periodLabel: string } {
    const period = options.period || (options.dateFrom && options.dateTo ? 'CUSTOM' : 'TODAY');

    if (period === 'CUSTOM' && options.dateFrom && options.dateTo) {
      return {
        dateFrom: new Date(options.dateFrom),
        dateTo: new Date(options.dateTo),
        periodLabel: 'Rango personalizado'
      };
    }

    // Usar Intl.DateTimeFormat para descomponer la fecha actual en la zona horaria del restaurante
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false,
      hourCycle: 'h23'
    });

    const parts = formatter.formatToParts(now);
    const getPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || '0', 10);

    const year = getPart('year');
    const month = getPart('month'); // 1..12
    const day = getPart('day');     // 1..31

    // Helper para construir Date en UTC dado una fecha/hora local
    const getUtcDateForLocal = (y: number, m: number, d: number, hour = 0, min = 0, sec = 0): Date => {
      // Formato ISO string estimado y ajuste de offset exacto
      const utcDate = new Date(Date.UTC(y, m - 1, d, hour, min, sec));
      const invParts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false,
        hourCycle: 'h23'
      }).formatToParts(utcDate);

      const invPart = (t: string) => parseInt(invParts.find((p) => p.type === t)?.value || '0', 10);
      const diffMs =
        Date.UTC(invPart('year'), invPart('month') - 1, invPart('day'), invPart('hour'), invPart('minute'), invPart('second')) -
        utcDate.getTime();

      return new Date(utcDate.getTime() - diffMs);
    };

    if (period === 'YESTERDAY') {
      const yesterdayDate = new Date(Date.UTC(year, month - 1, day - 1));
      const yY = yesterdayDate.getUTCFullYear();
      const yM = yesterdayDate.getUTCMonth() + 1;
      const yD = yesterdayDate.getUTCDate();
      return {
        dateFrom: getUtcDateForLocal(yY, yM, yD, 0, 0, 0),
        dateTo: getUtcDateForLocal(yY, yM, yD + 1, 0, 0, 0),
        periodLabel: 'Ayer'
      };
    }

    if (period === 'THIS_MONTH') {
      const nextMonthFirst = month === 12 ? getUtcDateForLocal(year + 1, 1, 1, 0, 0, 0) : getUtcDateForLocal(year, month + 1, 1, 0, 0, 0);
      return {
        dateFrom: getUtcDateForLocal(year, month, 1, 0, 0, 0),
        dateTo: nextMonthFirst,
        periodLabel: 'Este mes'
      };
    }

    if (period === 'LAST_MONTH') {
      const lmYear = month === 1 ? year - 1 : year;
      const lmMonth = month === 1 ? 12 : month - 1;
      return {
        dateFrom: getUtcDateForLocal(lmYear, lmMonth, 1, 0, 0, 0),
        dateTo: getUtcDateForLocal(year, month, 1, 0, 0, 0),
        periodLabel: 'Mes anterior'
      };
    }

    // Default: TODAY
    return {
      dateFrom: getUtcDateForLocal(year, month, day, 0, 0, 0),
      dateTo: getUtcDateForLocal(year, month, day + 1, 0, 0, 0),
      periodLabel: 'Hoy'
    };
  }

  /**
   * Resumen ejecutivo y financiero por restaurante y rango.
   * Reglas del plan:
   * - Consumo confirmado: tandas aceptadas con precios originales creadas en el período.
   * - Cobros de consumo: settlements confirmados en el período (menos ajustes).
   * - Propinas cobradas: tipMinor confirmados en el período (menos ajustes).
   * - Total recibido: cobros consumo + propinas cobradas.
   * - Pendiente al corte: saldo acumulado no saldado de sesiones activas/abiertas.
   */
  static async getSalesSummary(
    restaurantId: string,
    options: SalesReportQueryOptions = {}
  ): Promise<SalesSummaryDTO> {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, timezone: true }
    });

    if (!restaurant) {
      const err: any = new Error('Restaurante no encontrado');
      err.statusCode = 404;
      err.code = 'RESTAURANT_NOT_FOUND';
      throw err;
    }

    const timezone = restaurant.timezone || 'America/Argentina/Buenos_Aires';
    const { dateFrom, dateTo, periodLabel } = this.resolveDateRange(timezone, options);

    // El filtro documental se resuelve por sesión, no por importe ni por fecha
    // del comprobante: una asociación parcial sigue siendo la misma ocupación.
    let fiscalSessionCondition: { in: string[] } | { notIn: string[] } | undefined;
    if (options.hasFiscalDocument !== undefined) {
      const coveredRows = await prisma.fiscalDocumentCoverage.findMany({
        where: { fiscalDocument: { restaurantId } },
        select: { tableSessionId: true }
      });
      const coveredSessionIds = [...new Set(coveredRows.map((row) => row.tableSessionId))];
      if (options.hasFiscalDocument) {
        fiscalSessionCondition = { in: coveredSessionIds };
      } else if (coveredSessionIds.length > 0) {
        fiscalSessionCondition = { notIn: coveredSessionIds };
      }
    }

    // 1. Cobros registrados en el período (AccountSettlement)
    const settlements = await prisma.accountSettlement.findMany({
      where: {
        restaurantId,
        createdAt: { gte: dateFrom, lt: dateTo },
        ...(fiscalSessionCondition ? { tableSessionId: fiscalSessionCondition } : {}),
        ...(options.paymentMethod ? { method: options.paymentMethod } : {}),
        ...(options.responsibleStaffUserId ? { responsibleStaffUserId: options.responsibleStaffUserId } : {})
      },
      include: {
        adjustments: true
      }
    });

    // 2. Transacciones legadas aprobadas (PaymentTransaction)
    const legacyPayments = await prisma.paymentTransaction.findMany({
      where: {
        order: {
          tableSession: {
            table: { restaurantId },
            ...(fiscalSessionCondition ? { id: fiscalSessionCondition } : {})
          }
        },
        createdAt: { gte: dateFrom, lt: dateTo },
        status: { in: ['APPROVED', 'MANUAL_SETTLED'] },
        ...(options.paymentMethod ? { method: options.paymentMethod } : {})
      }
    });

    // 3. Consumo confirmado en el período (Orders en estados aceptados)
    const acceptedStatuses = [
      OrderStatus.CONFIRMED,
      OrderStatus.IN_KITCHEN,
      OrderStatus.READY_TO_SERVE,
      OrderStatus.SERVED,
      OrderStatus.PAID
    ];

    const confirmedOrders = await prisma.order.findMany({
      where: {
        tableSession: {
          table: { restaurantId },
          ...(fiscalSessionCondition ? { id: fiscalSessionCondition } : {})
        },
        createdAt: { gte: dateFrom, lt: dateTo },
        status: { in: acceptedStatuses }
      },
      select: {
        totalAmountMinor: true,
        totalAmount: true
      }
    });

    let consumoConfirmadoMinor = 0;
    for (const ord of confirmedOrders) {
      consumoConfirmadoMinor += ord.totalAmountMinor ?? Math.round(Number(ord.totalAmount || 0) * 100);
    }

    // 4. Calcular desglose por método y acumulados de cobro
    let consumoCobradoMinor = 0;
    let propinasCobradasMinor = 0;
    const sessionIdsInPeriod = new Set<string>();

    const breakdownMap = new Map<
      string,
      {
        paymentsCount: number;
        consumoMinor: number;
        tipMinor: number;
        refundMinor: number;
        totalMinor: number;
      }
    >();

    const ensureMethodSlot = (method: string) => {
      if (!breakdownMap.has(method)) {
        breakdownMap.set(method, {
          paymentsCount: 0,
          consumoMinor: 0,
          tipMinor: 0,
          refundMinor: 0,
          totalMinor: 0
        });
      }
      return breakdownMap.get(method)!;
    };

    for (const s of settlements) {
      sessionIdsInPeriod.add(s.tableSessionId);
      const slot = ensureMethodSlot(s.method);
      slot.paymentsCount += 1;

      // Ajustes/devoluciones asociados a este settlement
      const refundConsumption = s.adjustments.reduce((sum, a) => sum + a.amountMinor, 0);
      const refundTip = s.adjustments.reduce((sum, a) => sum + a.tipMinor, 0);
      const effectiveConsumption = Math.max(0, s.amountMinor - refundConsumption);
      const effectiveTip = Math.max(0, s.tipMinor - refundTip);

      slot.consumoMinor += effectiveConsumption;
      slot.tipMinor += effectiveTip;
      slot.refundMinor += refundConsumption + refundTip;
      slot.totalMinor += effectiveConsumption + effectiveTip;

      consumoCobradoMinor += effectiveConsumption;
      propinasCobradasMinor += effectiveTip;
    }

    for (const lp of legacyPayments) {
      sessionIdsInPeriod.add(lp.tableSessionId);
      const slot = ensureMethodSlot(lp.method);
      slot.paymentsCount += 1;
      const amt = lp.amountMinor ?? Math.round(Number(lp.amount || 0) * 100);
      const tip = lp.tipAmountMinor ?? Math.round(Number(lp.tipAmount || 0) * 100);

      slot.consumoMinor += amt;
      slot.tipMinor += tip;
      slot.totalMinor += amt + tip;

      consumoCobradoMinor += amt;
      propinasCobradasMinor += tip;
    }

    const totalRecibidoMinor = consumoCobradoMinor + propinasCobradasMinor;

    // 5. Pendiente al corte: saldo de ocupaciones que seguían abiertas al fin
    // del período. No usar el estado actual ni sumar órdenes posteriores al corte.
    const openSessions = await prisma.tableSession.findMany({
      where: {
        ...(fiscalSessionCondition ? { id: fiscalSessionCondition } : {}),
        table: { restaurantId },
        createdAt: { lt: dateTo },
        OR: [{ closedAt: null }, { closedAt: { gt: dateTo } }]
      },
      include: {
        orders: {
          where: { status: { in: acceptedStatuses }, createdAt: { lt: dateTo } },
          select: {
            id: true,
            status: true,
            totalAmountMinor: true,
            totalAmount: true,
            payments: {
              where: {
                createdAt: { lt: dateTo },
                status: { in: ['APPROVED', 'MANUAL_SETTLED'] }
              },
              select: { amountMinor: true, amount: true }
            }
          }
        },
        settlements: {
          where: { createdAt: { lt: dateTo } },
          select: {
            amountMinor: true,
            adjustments: {
              where: { createdAt: { lt: dateTo } },
              select: { amountMinor: true }
            }
          }
        }
      }
    });

    let pendienteAlCorteMinor = 0;
    for (const sess of openSessions) {
      const computableOrders = sess.orders.filter((o) => isOrderComputable(o.status));
      const sessConsumo = computableOrders.reduce(
        (sum, o) => sum + (o.totalAmountMinor ?? Math.round(Number(o.totalAmount || 0) * 100)),
        0
      );
      const sessSettlementsPaid = sess.settlements.reduce(
        (sum, s) => sum + Math.max(0, s.amountMinor - s.adjustments.reduce((adjusted, a) => adjusted + a.amountMinor, 0)),
        0
      );
      const sessDigitalPaid = computableOrders.reduce(
        (sum, o) => sum + o.payments.reduce(
          (pSum, p) => pSum + (p.amountMinor ?? Math.round(Number(p.amount || 0) * 100)),
          0
        ),
        0
      );
      const sessPaid = sessSettlementsPaid + sessDigitalPaid;
      pendienteAlCorteMinor += Math.max(0, sessConsumo - sessPaid);
    }

    const allMethods: WaiterPaymentMethod[] = [
      'WAITER_CASH',
      'WAITER_CARD_DEBIT',
      'WAITER_CARD_CREDIT',
      'WAITER_MP_QR',
      'WAITER_TRANSFER',
      'WAITER_CARD'
    ];

    const byMethod: PaymentMethodBreakdownDTO[] = [];
    // Primero agregar los métodos estándar en orden definido
    for (const m of allMethods) {
      const slot = breakdownMap.get(m) || {
        paymentsCount: 0,
        consumoMinor: 0,
        tipMinor: 0,
        refundMinor: 0,
        totalMinor: 0
      };
      byMethod.push({
        method: m,
        label: WAITER_PAYMENT_METHOD_LABELS[m] || m,
        ...slot
      });
      breakdownMap.delete(m);
    }

    // Agregar cualquier otro método remanente (ej. digitales legacy)
    for (const [m, slot] of breakdownMap.entries()) {
      byMethod.push({
        method: m,
        label: m,
        ...slot
      });
    }

    return {
      restaurantId,
      timezone,
      period: periodLabel,
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      currency: 'ARS',
      unit: 'ARS_MINOR',
      consumoConfirmadoMinor,
      consumoCobradoMinor,
      propinasCobradasMinor,
      totalRecibidoMinor,
      pendienteAlCorteMinor,
      uniqueSessionsCount: sessionIdsInPeriod.size,
      paymentsCount: settlements.length + legacyPayments.length,
      byMethod,
      generatedAt: new Date().toISOString()
    };
  }

  /**
   * Detalle de operaciones con drill-down a tandas e ítems.
   */
  static async getSalesOperations(
    restaurantId: string,
    options: SalesReportQueryOptions = {}
  ): Promise<SalesOperationDTO[]> {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { timezone: true }
    });
    if (!restaurant) {
      const err: any = new Error('Restaurante no encontrado');
      err.statusCode = 404;
      err.code = 'RESTAURANT_NOT_FOUND';
      throw err;
    }

    const timezone = restaurant.timezone || 'America/Argentina/Buenos_Aires';
    const { dateFrom, dateTo } = this.resolveDateRange(timezone, options);

    // Buscar sesiones que hayan tenido tandas creadas o cobros en el rango
    const sessions = await prisma.tableSession.findMany({
      where: {
        table: { restaurantId },
        OR: [
          { createdAt: { gte: dateFrom, lt: dateTo } },
          { settlements: { some: { createdAt: { gte: dateFrom, lt: dateTo } } } },
          { orders: { some: { payments: { some: { createdAt: { gte: dateFrom, lt: dateTo }, status: { in: ['APPROVED', 'MANUAL_SETTLED'] } } } } } }
        ]
      },
      include: {
        table: true,
        orders: {
          include: {
            items: {
              include: { menuItem: true }
            },
            payments: true
          },
          orderBy: { createdAt: 'asc' }
        },
        settlements: {
          include: {
            adjustments: true
          },
          orderBy: { createdAt: 'asc' }
        },
        receipts: {
          orderBy: { createdAt: 'asc' }
        },
        coveredFiscalDocs: {
          include: {
            fiscalDocument: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const staffUsers = await prisma.staffUser.findMany({
      where: { restaurantId },
      select: { id: true, name: true }
    });
    const staffNameById = new Map(staffUsers.map((u) => [u.id, u.name]));

    const operations: SalesOperationDTO[] = [];

    for (const sess of sessions) {
      // Filtrar tandas computables en la cuenta
      const validOrders = sess.orders.filter((o) => isOrderComputable(o.status));
      let consumoTotalMinor = 0;
      const tandas = validOrders.map((ord) => {
        const orderTotalMinor = ord.totalAmountMinor ?? Math.round(Number(ord.totalAmount || 0) * 100);
        consumoTotalMinor += orderTotalMinor;
        return {
          orderId: ord.id,
          status: ord.status,
          totalMinor: orderTotalMinor,
          items: ord.items.map((item) => ({
            name: item.menuItem?.name || 'Ítem sin nombre',
            quantity: item.quantity,
            unitPriceMinor: Math.round(Number(item.unitPrice || 0) * 100),
            lineTotalMinor: Math.round(Number(item.unitPrice || 0) * item.quantity * 100)
          }))
        };
      });

      let cobradoTotalMinor = 0;
      let propinaTotalMinor = 0;
      const settlements = sess.settlements.map((s) => {
        const refundAmt = s.adjustments.reduce((sum, a) => sum + a.amountMinor, 0);
        const refundTip = s.adjustments.reduce((sum, a) => sum + a.tipMinor, 0);
        const netAmt = Math.max(0, s.amountMinor - refundAmt);
        const netTip = Math.max(0, s.tipMinor - refundTip);

        cobradoTotalMinor += netAmt;
        propinaTotalMinor += netTip;

        const staffId = s.responsibleStaffUserId || s.createdBy;
        return {
          settlementId: s.id,
          method: s.method,
          methodLabel: (WAITER_PAYMENT_METHOD_LABELS as any)[s.method] || s.method,
          amountMinor: netAmt,
          tipMinor: netTip,
          totalMinor: netAmt + netTip,
          responsibleStaffUserId: staffId,
          responsibleStaffName: staffNameById.get(staffId) || 'Personal del salón',
          adjustments: s.adjustments.map((a: any) => ({
            id: a.id,
            settlementId: a.settlementId,
            restaurantId: a.restaurantId,
            amountMinor: a.amountMinor,
            tipMinor: a.tipMinor,
            totalAdjustedMinor: a.amountMinor + a.tipMinor,
            reason: a.reason,
            adjustedBy: a.adjustedBy,
            createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt
          })),
          createdAt: s.createdAt.toISOString()
        };
      });

      // Sumar pagos digitales legados aprobados sobre las comandas de la sesión
      for (const ord of sess.orders) {
        for (const p of ord.payments || []) {
          if (p.status === 'APPROVED' || p.status === 'MANUAL_SETTLED') {
            const pAmt = p.amountMinor ?? Math.round(Number(p.amount || 0) * 100);
            const pTip = p.tipAmountMinor ?? Math.round(Number(p.tipAmount || 0) * 100);
            cobradoTotalMinor += pAmt;
            propinaTotalMinor += pTip;
          }
        }
      }

      const saldoMinor = Math.max(0, consumoTotalMinor - cobradoTotalMinor);
      const status = sess.closedAt ? 'CLOSED' : saldoMinor === 0 && consumoTotalMinor > 0 ? 'SETTLED' : 'OPEN';

      // Filtros opcionales
      if (options.paymentMethod && !settlements.some((st) => st.method === options.paymentMethod)) {
        continue;
      }
      if (options.responsibleStaffUserId && !settlements.some((st) => st.responsibleStaffUserId === options.responsibleStaffUserId)) {
        continue;
      }
      if (options.hasFiscalDocument !== undefined) {
        const hasDoc = sess.coveredFiscalDocs.length > 0;
        if (options.hasFiscalDocument !== hasDoc) continue;
      }

      operations.push({
        tableSessionId: sess.id,
        tableLabel: sess.table.label,
        sector: sess.table.sector,
        sessionStartedAt: sess.createdAt.toISOString(),
        sessionClosedAt: sess.closedAt ? sess.closedAt.toISOString() : null,
        consumoTotalMinor,
        cobradoTotalMinor,
        propinaTotalMinor,
        saldoMinor,
        status,
        tandas,
        settlements,
        receipts: sess.receipts.map((r) => ({
          receiptId: r.id,
          receiptNumber: r.receiptNumber,
          receiptType: r.receiptType,
          createdAt: r.createdAt.toISOString()
        })),
        fiscalDocuments: sess.coveredFiscalDocs.map((c) => ({
          fiscalDocumentId: c.fiscalDocumentId,
          docType: c.fiscalDocument.docType,
          docNumber: `${c.fiscalDocument.pointOfSale.toString().padStart(4, '0')}-${c.fiscalDocument.docNumber}`,
          totalMinor: c.coveredMinor
        }))
      });
    }

    return operations;
  }

  /**
   * Registra una devolución o ajuste parcial/total sobre un cobro (AccountSettlement).
   * No modifica ni elimina el settlement original (inmutable / append-only).
   */
  static async createPaymentAdjustment(
    restaurantId: string,
    settlementId: string,
    data: {
      amountMinor: number;
      tipMinor?: number;
      reason: string;
      adjustedBy: string;
    }
  ) {
    const rawAmountMinor: unknown = data.amountMinor;
    const rawTipMinor: unknown = data.tipMinor;
    const amountMinor = rawAmountMinor === undefined ? 0 : typeof rawAmountMinor === 'number' ? rawAmountMinor : NaN;
    const tipMinor = rawTipMinor === undefined ? 0 : typeof rawTipMinor === 'number' ? rawTipMinor : NaN;
    const reason = String(data.reason || '').trim();

    if (
      !Number.isFinite(amountMinor) ||
      !Number.isFinite(tipMinor) ||
      !Number.isSafeInteger(amountMinor) ||
      !Number.isSafeInteger(tipMinor) ||
      !Number.isSafeInteger(amountMinor + tipMinor) ||
      amountMinor < 0 ||
      tipMinor < 0 ||
      amountMinor + tipMinor <= 0
    ) {
      const error: any = new Error('El ajuste requiere importes enteros no negativos y una suma mayor a cero.');
      error.statusCode = 400;
      error.code = 'INVALID_ADJUSTMENT_AMOUNTS';
      throw error;
    }

    if (!reason) {
      const error: any = new Error('El ajuste requiere un motivo explícito.');
      error.statusCode = 400;
      error.code = 'REASON_REQUIRED';
      throw error;
    }

    const settlement = await prisma.accountSettlement.findUnique({
      where: { id: settlementId },
      include: { adjustments: true }
    });

    if (!settlement || settlement.restaurantId !== restaurantId) {
      const error: any = new Error('Cobro / settlement no encontrado para este restaurante.');
      error.statusCode = 404;
      error.code = 'SETTLEMENT_NOT_FOUND';
      throw error;
    }

    const priorRefundAmount = settlement.adjustments.reduce((sum, a) => sum + a.amountMinor, 0);
    const priorRefundTip = settlement.adjustments.reduce((sum, a) => sum + a.tipMinor, 0);

    if (priorRefundAmount + amountMinor > settlement.amountMinor) {
      const maxRefundable = settlement.amountMinor - priorRefundAmount;
      const error: any = new Error(
        `El ajuste de consumo ($${(amountMinor / 100).toFixed(2)}) supera el monto disponible ($${(maxRefundable / 100).toFixed(2)}).`
      );
      error.statusCode = 422;
      error.code = 'ADJUSTMENT_EXCEEDS_SETTLEMENT';
      throw error;
    }

    if (priorRefundTip + tipMinor > settlement.tipMinor) {
      const maxRefundableTip = settlement.tipMinor - priorRefundTip;
      const error: any = new Error(
        `El ajuste de propina ($${(tipMinor / 100).toFixed(2)}) supera la propina disponible ($${(maxRefundableTip / 100).toFixed(2)}).`
      );
      error.statusCode = 422;
      error.code = 'ADJUSTMENT_EXCEEDS_TIP';
      throw error;
    }

    const created = await prisma.paymentAdjustment.create({
      data: {
        settlementId,
        restaurantId,
        amountMinor,
        tipMinor,
        reason,
        adjustedBy: data.adjustedBy
      }
    });

    return {
      id: created.id,
      settlementId: created.settlementId,
      restaurantId: created.restaurantId,
      amountMinor: created.amountMinor,
      tipMinor: created.tipMinor,
      totalAdjustedMinor: created.amountMinor + created.tipMinor,
      reason: created.reason,
      adjustedBy: created.adjustedBy,
      createdAt: created.createdAt.toISOString()
    };
  }
}

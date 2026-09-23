import { prisma } from '../lib/prisma';
import { RewardsService } from './rewards.service';
import {
  SalesSummaryDTO,
  SalesOperationDTO,
  PaymentMethodBreakdownDTO,
  WAITER_PAYMENT_METHOD_LABELS,
  WaiterPaymentMethod,
  OrderStatus,
  isOrderComputable
} from '@mesaya/shared';

export interface SalesReportQueryOptions {
  period?: 'TODAY' | 'YESTERDAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';
  dateFrom?: string;
  dateTo?: string;
  /** E16: turno explícito; su ventana [openedAt, closedAt ?? ahora) prevalece sobre period/fechas. */
  shiftId?: string;
  paymentMethod?: string;
  responsibleStaffUserId?: string;
  hasFiscalDocument?: boolean;
}

/**
 * Política contable E16 (conciliación por movimientos — ver
 * docs/plan-remediacion-servicio-gemini/evidencia/E16/DIAGNOSTICO.md):
 *
 * - `consumo` (ventas devengadas): tandas en estados computables por su
 *   `createdAt` original. Nunca se mueve una orden a la fecha de pago.
 * - `cobrado neto` / `propina` neta: cobros (`AccountSettlement` o
 *   `PaymentTransaction` legacy aprobado) por su propio `createdAt`, menos
 *   ajustes/devoluciones.
 * - `devolución`: cada `PaymentAdjustment` computa en el período de SU PROPIO
 *   `createdAt` (fecha del ajuste), con el método del cobro original. Una
 *   devolución posterior NO reescribe el resumen del día del cobro.
 * - `saldo` / `pendiente al corte`: consumo computable acumulado menos cobros
 *   netos acumulados al instante `hasta` (exclusivo), sólo de sesiones
 *   abiertas en ese instante (closedAt null o > hasta).
 * - Todo rango es [desde,hasta) en la zona IANA del local. Turno explícito
 *   (shiftId) cuando exista, incluyendo turnos que cruzan medianoche.
 * - Filtros: método y responsable aplican a movimientos de cobro de salón;
 *   pagos legacy no tienen responsable atribuido —el filtro por responsable
 *   los excluye del período (pero el saldo vivo siempre los descuenta)— y el
 *   filtro por método sí les aplica; comprobante fiscal filtra por sesión.
 * - Ante rango inválido o turno ajeno se propaga 400/404 seguro, nunca un
 *   falso cero.
 */
export interface ResolvedReportRange {
  dateFrom: Date;
  dateTo: Date;
  periodLabel: string;
  shiftId: string | null;
  shiftLabel: string | null;
  shiftOpenedAt: string | null;
  shiftClosedAt: string | null;
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
   * E16: resuelve el rango efectivo del reporte. Con shiftId, la ventana es
   * [openedAt, closedAt ?? ahora) del turno (verificado del mismo restaurante);
   * sin shiftId, el período calendario habitual. Valida fechas CUSTOM.
   */
  static async resolveReportRange(
    restaurantId: string,
    timezone: string,
    options: SalesReportQueryOptions
  ): Promise<ResolvedReportRange> {
    if (options.shiftId) {
      const shift = await prisma.shift.findUnique({ where: { id: options.shiftId } });
      if (!shift || shift.restaurantId !== restaurantId) {
        const err: any = new Error('Turno no encontrado para este restaurante.');
        err.statusCode = 404;
        err.code = 'SHIFT_NOT_FOUND';
        throw err;
      }
      const dateFrom = new Date(shift.openedAt);
      const dateTo = shift.closedAt ? new Date(shift.closedAt) : new Date();
      if (!(dateTo.getTime() > dateFrom.getTime())) {
        const err: any = new Error('El turno aún no acumula un rango válido [desde,hasta).');
        err.statusCode = 400;
        err.code = 'INVALID_SHIFT_RANGE';
        throw err;
      }
      const fmt = (d: Date) =>
        d.toLocaleString('es-AR', {
          timeZone: timezone,
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      return {
        dateFrom,
        dateTo,
        periodLabel: `Turno ${fmt(dateFrom)}–${fmt(dateTo)}`,
        shiftId: shift.id,
        shiftLabel: `Turno ${fmt(dateFrom)}–${fmt(dateTo)}`,
        shiftOpenedAt: dateFrom.toISOString(),
        shiftClosedAt: shift.closedAt ? new Date(shift.closedAt).toISOString() : null
      };
    }

    const { dateFrom, dateTo, periodLabel } = this.resolveDateRange(timezone, options);
    if (!Number.isFinite(dateFrom.getTime()) || !Number.isFinite(dateTo.getTime()) || dateTo.getTime() <= dateFrom.getTime()) {
      const err: any = new Error('Rango de fechas inválido: se requiere [desde,hasta) con hasta posterior a desde.');
      err.statusCode = 400;
      err.code = 'INVALID_DATE_RANGE';
      throw err;
    }
    return {
      dateFrom,
      dateTo,
      periodLabel,
      shiftId: null,
      shiftLabel: null,
      shiftOpenedAt: null,
      shiftClosedAt: null
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
    const { dateFrom, dateTo, periodLabel, shiftId, shiftLabel, shiftOpenedAt, shiftClosedAt } =
      await this.resolveReportRange(restaurantId, timezone, options);

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

    // 1. Cobros registrados en el período (AccountSettlement). Los ajustes se
    // traen con su fecha propia: sólo los creados dentro de [desde,hasta)
    // reducen el neto del período (E16: la devolución posterior no reescribe
    // el día del cobro).
    const settlements = await prisma.accountSettlement.findMany({
      where: {
        restaurantId,
        // Un ajuste es un movimiento del período aunque el cobro original
        // pertenezca a un período anterior. Traer ambos casos evita perder
        // devoluciones hechas sobre cobros históricos.
        OR: [
          { createdAt: { gte: dateFrom, lt: dateTo } },
          { adjustments: { some: { createdAt: { gte: dateFrom, lt: dateTo } } } }
        ],
        ...(fiscalSessionCondition ? { tableSessionId: fiscalSessionCondition } : {}),
        ...(options.paymentMethod ? { method: options.paymentMethod } : {}),
        ...(options.responsibleStaffUserId ? { responsibleStaffUserId: options.responsibleStaffUserId } : {})
      },
      include: {
        adjustments: true
      }
    });

    // 2. Transacciones legadas aprobadas (PaymentTransaction). No tienen
    // responsable atribuido: el filtro por responsable las excluye del
    // período (política E16 documentada); el filtro por método sí aplica.
    const legacyPayments = options.responsibleStaffUserId
      ? []
      : await prisma.paymentTransaction.findMany({
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
    let devolucionesMinor = 0;
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
      const settlementInRange = s.createdAt >= dateFrom && s.createdAt < dateTo;
      sessionIdsInPeriod.add(s.tableSessionId);
      const inRangeAdjustments = s.adjustments.filter(
        (a) => a.createdAt >= dateFrom && a.createdAt < dateTo
      );
      const slot = ensureMethodSlot(s.method);
      if (settlementInRange) slot.paymentsCount += 1;

      // E16: sólo los ajustes creados dentro del período reducen su neto; un
      // ajuste posterior computa en su propia fecha, con el método original.
      const refundConsumption = inRangeAdjustments.reduce((sum, a) => sum + a.amountMinor, 0);
      const refundTip = inRangeAdjustments.reduce((sum, a) => sum + a.tipMinor, 0);
      // Si sólo la devolución cae en el rango, el movimiento es negativo:
      // no se vuelve a contar el cobro original como si fuera de este período.
      const effectiveConsumption = settlementInRange
        ? Math.max(0, s.amountMinor - refundConsumption)
        : -refundConsumption;
      const effectiveTip = settlementInRange
        ? Math.max(0, s.tipMinor - refundTip)
        : -refundTip;

      slot.consumoMinor += effectiveConsumption;
      slot.tipMinor += effectiveTip;
      slot.refundMinor += refundConsumption + refundTip;
      slot.totalMinor += effectiveConsumption + effectiveTip;

      consumoCobradoMinor += effectiveConsumption;
      propinasCobradasMinor += effectiveTip;
      devolucionesMinor += refundConsumption + refundTip;
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
      devolucionesMinor,
      totalRecibidoMinor,
      pendienteAlCorteMinor,
      shiftId,
      shiftLabel,
      shiftOpenedAt,
      shiftClosedAt,
      uniqueSessionsCount: sessionIdsInPeriod.size,
      paymentsCount: settlements.filter((s) => s.createdAt >= dateFrom && s.createdAt < dateTo).length + legacyPayments.length,
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
    const { dateFrom, dateTo } = await this.resolveReportRange(restaurantId, timezone, options);

    // E16: sesiones con algún MOVIMIENTO en [desde,hasta): tanda creada,
    // cobro, pago legacy o devolución/ajuste posterior. Los importes de cada
    // operación son del período (igual semántica que el resumen); el saldo y
    // el estado son de la cuenta completa para no ocultar deuda.
    const sessions = await prisma.tableSession.findMany({
      where: {
        table: { restaurantId },
        OR: [
          { orders: { some: { createdAt: { gte: dateFrom, lt: dateTo } } } },
          { settlements: { some: { createdAt: { gte: dateFrom, lt: dateTo } } } },
          { settlements: { some: { adjustments: { some: { createdAt: { gte: dateFrom, lt: dateTo } } } } } },
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
      const orderTotal = (ord: any) =>
        ord.totalAmountMinor ?? Math.round(Number(ord.totalAmount || 0) * 100);
      const inRange = (d: Date | string) => {
        const t = d instanceof Date ? d.getTime() : new Date(d).getTime();
        return t >= dateFrom.getTime() && t < dateTo.getTime();
      };

      // Consumo de vida de la cuenta (para saldo) y del período (para conciliar
      // con el resumen). La fecha original de cada tanda se preserva siempre.
      const validOrders = sess.orders.filter((o) => isOrderComputable(o.status));
      const lifetimeConsumoMinor = validOrders.reduce((sum, o) => sum + orderTotal(o), 0);
      const periodOrders = validOrders.filter((o) => inRange(o.createdAt));
      let consumoTotalMinor = 0;
      const tandas = periodOrders.map((ord) => {
        const orderTotalMinor = orderTotal(ord);
        consumoTotalMinor += orderTotalMinor;
        return {
          orderId: ord.id,
          status: ord.status,
          totalMinor: orderTotalMinor,
          createdAt: ord.createdAt instanceof Date ? ord.createdAt.toISOString() : String(ord.createdAt),
          items: ord.items.map((item) => ({
            name: item.menuItem?.name || 'Ítem sin nombre',
            quantity: item.quantity,
            unitPriceMinor: Math.round(Number(item.unitPrice || 0) * 100),
            lineTotalMinor: Math.round(Number(item.unitPrice || 0) * item.quantity * 100)
          }))
        };
      });

      // Cobros del período con la misma semántica que el resumen: settlement
      // por su createdAt, ajustes sólo si caen dentro del período, filtros de
      // método/responsable idénticos a getSalesSummary.
      let cobradoTotalMinor = 0;
      let propinaTotalMinor = 0;
      let devolucionTotalMinor = 0;
      const settlements: any[] = [];
      // Saldo de vida: neto acumulado de todos los cobros menos todos los ajustes.
      let lifetimePaidMinor = 0;

      for (const s of sess.settlements) {
        const allRefundAmt = s.adjustments.reduce((sum, a) => sum + a.amountMinor, 0);
        lifetimePaidMinor += Math.max(0, s.amountMinor - allRefundAmt);

        const settlementInRange = inRange(s.createdAt);
        const periodAdjustments = s.adjustments.filter((a: any) => inRange(a.createdAt));
        if (!settlementInRange && periodAdjustments.length === 0) continue;
        if (options.paymentMethod && s.method !== options.paymentMethod) continue;
        const staffId = s.responsibleStaffUserId || s.createdBy;
        if (options.responsibleStaffUserId && staffId !== options.responsibleStaffUserId) continue;

        const refundAmt = periodAdjustments.reduce((sum: number, a: any) => sum + a.amountMinor, 0);
        const refundTip = periodAdjustments.reduce((sum: number, a: any) => sum + a.tipMinor, 0);
        const netAmt = settlementInRange ? Math.max(0, s.amountMinor - refundAmt) : -refundAmt;
        const netTip = settlementInRange ? Math.max(0, s.tipMinor - refundTip) : -refundTip;

        cobradoTotalMinor += netAmt;
        propinaTotalMinor += netTip;
        devolucionTotalMinor += refundAmt + refundTip;

        settlements.push({
          settlementId: s.id,
          method: s.method,
          methodLabel: (WAITER_PAYMENT_METHOD_LABELS as any)[s.method] || s.method,
          amountMinor: netAmt,
          tipMinor: netTip,
          totalMinor: netAmt + netTip,
          responsibleStaffUserId: staffId,
          responsibleStaffName: staffNameById.get(staffId) || 'Personal del salón',
          adjustments: periodAdjustments.map((a: any) => ({
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
        });
      }

      // Pagos digitales legados aprobados (misma semántica que el resumen:
      // sin responsable atribuido — el filtro por responsable los excluye del
      // período pero el saldo vivo siempre los considera cobro real).
      let legacyInPeriod = false;
      for (const ord of sess.orders) {
        for (const p of ord.payments || []) {
          if (p.status !== 'APPROVED' && p.status !== 'MANUAL_SETTLED') continue;
          const pAmt = p.amountMinor ?? Math.round(Number(p.amount || 0) * 100);
          const pTip = p.tipAmountMinor ?? Math.round(Number(p.tipAmount || 0) * 100);
          lifetimePaidMinor += pAmt;
          if (options.responsibleStaffUserId) continue;
          if (!inRange(p.createdAt)) continue;
          if (options.paymentMethod && p.method !== options.paymentMethod) continue;
          cobradoTotalMinor += pAmt;
          propinaTotalMinor += pTip;
          legacyInPeriod = true;
        }
      }

      const saldoMinor = Math.max(0, lifetimeConsumoMinor - lifetimePaidMinor);
      const status = sess.closedAt ? 'CLOSED' : saldoMinor === 0 && lifetimeConsumoMinor > 0 ? 'SETTLED' : 'OPEN';

      // Filtros opcionales de inclusión (igual que antes, ahora sobre
      // movimientos del período)
      if (options.paymentMethod && !settlements.length && !legacyInPeriod) {
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
        devolucionTotalMinor,
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

    let rewards: any = null;
    let rewardsWarning: string | null = null;
    try {
      rewards = await RewardsService.reverseSettlementAdjustment({
        restaurantId,
        settlementId,
        adjustmentId: created.id,
        amountMinor,
        reason: `Devolución de consumo: ${reason}`,
        approvedBy: data.adjustedBy
      });
    } catch (err: any) {
      // La devolución financiera ya quedó append-only y confirmada. No se
      // revierte por una condición de Rewards; se deja una acción explícita
      // para reconciliar el ledger sin ocultar la incidencia al manager.
      rewardsWarning = 'Devolución registrada; la reversión de puntos Rewards quedó pendiente de revisión.';
      console.warn('Rewards reversal pending after payment adjustment:', err?.code || err?.message || 'unknown');
    }

    return {
      id: created.id,
      settlementId: created.settlementId,
      restaurantId: created.restaurantId,
      amountMinor: created.amountMinor,
      tipMinor: created.tipMinor,
      totalAdjustedMinor: created.amountMinor + created.tipMinor,
      reason: created.reason,
      adjustedBy: created.adjustedBy,
      createdAt: created.createdAt.toISOString(),
      rewards,
      ...(rewardsWarning ? { rewardsWarning } : {})
    };
  }
}

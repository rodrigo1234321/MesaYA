import { prisma } from '../lib/prisma';
import {
  RTMSAnalyticsSummaryDTO,
  PhaseMetricsDTO,
  HeatmapHourCellDTO,
  TablePerformanceDTO,
  TableShape,
  AnalyticsMetricDTO,
  AnalyticsQualityDTO
} from '@mesaya/shared';

export class RTMSAnalyticsService {
  /**
   * Helper to resolve restaurant by ID or slug
   */
  private static async resolveRestaurant(idOrSlug: string) {
    const restaurant = await prisma.restaurant.findFirst({
      where: {
        OR: [{ id: idOrSlug }, { slug: idOrSlug }]
      },
      include: {
        tables: {
          include: {
            floorZone: true
          }
        }
      }
    });

    if (!restaurant) {
      const err: any = new Error(`Restaurante '${idOrSlug}' no encontrado`);
      err.statusCode = 404;
      throw err;
    }

    return restaurant;
  }

  private static async resolvePeriod(
    restaurantId: string,
    from: Date,
    to: Date,
    timezone: string
  ): Promise<{ operatingHours: number; quality: AnalyticsQualityDTO }> {
    const shifts = await prisma.shift.findMany({
      where: {
        restaurantId,
        openedAt: { lt: to },
        OR: [{ closedAt: null }, { closedAt: { gt: from } }]
      },
      select: { openedAt: true, closedAt: true }
    });

    let operatingMs = 0;
    for (const shift of shifts) {
      const start = Math.max(shift.openedAt.getTime(), from.getTime());
      const end = Math.min((shift.closedAt || to).getTime(), to.getTime());
      if (end > start) operatingMs += end - start;
    }

    const warnings: string[] = [];
    if (shifts.length === 0) warnings.push('No hay turnos operativos medidos en el período.');
    return {
      operatingHours: operatingMs / (1000 * 60 * 60),
      quality: {
        timezone,
        period: { from: from.toISOString(), to: to.toISOString() },
        measuredRecords: shifts.length,
        warnings
      }
    };
  }

  private static metric(
    value: number,
    unit: string,
    from: Date,
    to: Date,
    timezone: string,
    sampleSize: number,
    source: string
  ): AnalyticsMetricDTO {
    return {
      value,
      unit,
      period: { from: from.toISOString(), to: to.toISOString(), timezone },
      sampleSize,
      source,
      quality: sampleSize > 0 ? 'MEASURED' : 'NO_DATA'
    };
  }

  private static async getMeasuredPayments(
    restaurantId: string,
    from: Date,
    to: Date
  ) {
    return prisma.paymentTransaction.findMany({
      where: {
        status: { in: ['APPROVED', 'MANUAL_SETTLED'] },
        createdAt: { gte: from, lte: to },
        order: { tableSession: { table: { restaurantId } } }
      },
      select: {
        amount: true,
        createdAt: true,
        order: { select: { tableSession: { select: { tableId: true } } } }
      }
    });
  }

  /**
   * 1. Resumen Global de Rendimiento & RevPASH
   */
  static async getAnalyticsSummary(
    idOrSlug: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<RTMSAnalyticsSummaryDTO> {
    const restaurant = await this.resolveRestaurant(idOrSlug);

    const now = new Date();
    const to = toDate || now;
    const from = fromDate || new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000); // 7 días atrás por defecto
    const { operatingHours, quality: periodQuality } = await this.resolvePeriod(
      restaurant.id,
      from,
      to,
      restaurant.timezone
    );

    // Sumar capacidad total de asientos
    const totalSeats = restaurant.tables.reduce((acc, t) => acc + (t.capacity || 4), 0);
    const totalSeatHours = totalSeats * operatingHours;

    // Consultar sesiones de permanencia en el rango
    const sessions = await prisma.occupancySession.findMany({
      where: {
        restaurantId: restaurant.id,
        seatedAt: { gte: from, lte: to }
      }
    });

    const totalSessions = sessions.length;
    const payments = await this.getMeasuredPayments(restaurant.id, from, to);
    const totalRevenue = payments.reduce((sum, payment) => sum + payment.amount, 0);
    let turnTimeSum = 0;
    let turnTimeCount = 0;
    let durationSum = 0;
    let durationCount = 0;
    let occupiedSeatMinutesSum = 0;

    for (const s of sessions) {
      if (s.turnTimeMinutes !== null && s.turnTimeMinutes > 0) {
        turnTimeSum += s.turnTimeMinutes;
        turnTimeCount++;
      }

      if (s.durationMinutes !== null && s.durationMinutes > 0) {
        durationSum += s.durationMinutes;
        durationCount++;
        occupiedSeatMinutesSum += s.durationMinutes * (s.partySize || 2);
      }
    }

    const averageTurnTimeMinutes = turnTimeCount > 0 ? Math.round(turnTimeSum / turnTimeCount) : 0;
    const averageDurationMinutes = durationCount > 0 ? Math.round(durationSum / durationCount) : 0;

    // RevPASH = Total Revenue / Total Available Seat Hours
    const revPASH = totalSeatHours > 0 ? Math.round((totalRevenue / totalSeatHours) * 100) / 100 : 0;

    // Tasa de ocupación de asientos en %
    const totalAvailableSeatMinutes = totalSeatHours * 60;
    const occupancyRatePercentage = Math.min(
      100,
      totalAvailableSeatMinutes > 0
        ? Math.round((occupiedSeatMinutesSum / totalAvailableSeatMinutes) * 100)
        : 0
    );

    const turnsPerTableAverage =
      restaurant.tables.length > 0
        ? Math.round((totalSessions / restaurant.tables.length) * 10) / 10
        : 0;

    const qualityWarnings = [...periodQuality.warnings];
    if (payments.length === 0) qualityWarnings.push('No hay pagos conciliados en el período; revenue queda en cero.');
    if (turnTimeCount === 0) qualityWarnings.push('No hay turnos cerrados con duración medida.');
    const quality: AnalyticsQualityDTO = {
      ...periodQuality,
      measuredRecords: periodQuality.measuredRecords + sessions.length + payments.length,
      warnings: qualityWarnings
    };

    return {
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        operatingHours
      },
      totalSessions,
      totalRevenue,
      totalSeats,
      totalSeatHours,
      revPASH,
      averageTurnTimeMinutes,
      averageDurationMinutes,
      occupancyRatePercentage,
      turnsPerTableAverage,
      quality,
      metrics: {
        totalRevenue: this.metric(totalRevenue, 'ARS', from, to, restaurant.timezone, payments.length, 'payment_transactions.amount'),
        revPASH: this.metric(revPASH, 'ARS_per_seat_hour', from, to, restaurant.timezone, payments.length, 'payment_transactions.amount / shifts'),
        occupancyRatePercentage: this.metric(occupancyRatePercentage, 'percent', from, to, restaurant.timezone, durationCount, 'occupancy_sessions.durationMinutes'),
        averageTurnTimeMinutes: this.metric(averageTurnTimeMinutes, 'minutes', from, to, restaurant.timezone, turnTimeCount, 'occupancy_sessions.turnTimeMinutes'),
        averageDurationMinutes: this.metric(averageDurationMinutes, 'minutes', from, to, restaurant.timezone, durationCount, 'occupancy_sessions.durationMinutes')
      }
    };
  }

  /**
   * 2. Desglose de Fases de la Experiencia Gastronómica (Embudo de Dwell Time)
   */
  static async getPhaseMetrics(
    idOrSlug: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<PhaseMetricsDTO> {
    const restaurant = await this.resolveRestaurant(idOrSlug);
    const to = toDate || new Date();
    const from = fromDate || new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    const sessions = await prisma.occupancySession.findMany({
      where: {
        restaurantId: restaurant.id,
        seatedAt: { gte: from, lte: to }
      }
    });

    let toOrderSum = 0, toOrderCount = 0;
    let prepSum = 0, prepCount = 0;
    let dwellSum = 0, dwellCount = 0;
    let vacateSum = 0, vacateCount = 0;
    let cleanSum = 0, cleanCount = 0;

    for (const s of sessions) {
      const seated = s.seatedAt.getTime();
      const ordered = s.orderedAt?.getTime();
      const served = s.servedAt?.getTime();
      const bill = s.billAt?.getTime() || s.paidAt?.getTime();
      const vacated = s.vacatedAt?.getTime();
      const cleaned = s.cleanedAt?.getTime();

      // Fase 1: Seated -> Ordered
      if (ordered && ordered >= seated) {
        toOrderSum += (ordered - seated) / (1000 * 60);
        toOrderCount++;
      }

      // Fase 2: Ordered -> Served (Cocina)
      if (ordered && served && served >= ordered) {
        prepSum += (served - ordered) / (1000 * 60);
        prepCount++;
      }

      // Fase 3: Served -> Bill (Comiendo)
      if (served && bill && bill >= served) {
        dwellSum += (bill - served) / (1000 * 60);
        dwellCount++;
      }

      // Fase 4: Bill -> Vacated (Sobremesa post cuenta)
      if (bill && vacated && vacated >= bill) {
        vacateSum += (vacated - bill) / (1000 * 60);
        vacateCount++;
      }

      // Fase 5: Vacated -> Cleaned (Tiempo de limpieza / rotación)
      if (vacated && cleaned && cleaned >= vacated) {
        cleanSum += (cleaned - vacated) / (1000 * 60);
        cleanCount++;
      }
    }

    const phase = (sum: number, count: number) => count > 0 ? Math.max(0, Math.round(sum / count)) : 0;
    const warnings: string[] = [];
    if (toOrderCount === 0) warnings.push('Sin fase medida: sentado a pedido.');
    if (prepCount === 0) warnings.push('Sin fase medida: pedido a servido.');
    if (dwellCount === 0) warnings.push('Sin fase medida: servido a cuenta.');
    if (vacateCount === 0) warnings.push('Sin fase medida: pago a desocupación.');
    if (cleanCount === 0) warnings.push('Sin fase medida: desocupación a limpieza.');
    return {
      timeToOrderAvgMinutes: phase(toOrderSum, toOrderCount),
      kitchenPrepAvgMinutes: phase(prepSum, prepCount),
      eatingDwellAvgMinutes: phase(dwellSum, dwellCount),
      paymentToVacateAvgMinutes: phase(vacateSum, vacateCount),
      cleaningTurnaroundAvgMinutes: phase(cleanSum, cleanCount),
      quality: {
        timezone: restaurant.timezone,
        period: { from: from.toISOString(), to: to.toISOString() },
        measuredRecords: sessions.length,
        warnings
      },
      metrics: {
        timeToOrderAvgMinutes: this.metric(phase(toOrderSum, toOrderCount), 'minutes', from, to, restaurant.timezone, toOrderCount, 'occupancy_sessions.seatedAt/orderedAt'),
        kitchenPrepAvgMinutes: this.metric(phase(prepSum, prepCount), 'minutes', from, to, restaurant.timezone, prepCount, 'occupancy_sessions.orderedAt/servedAt'),
        eatingDwellAvgMinutes: this.metric(phase(dwellSum, dwellCount), 'minutes', from, to, restaurant.timezone, dwellCount, 'occupancy_sessions.servedAt/billAt'),
        paymentToVacateAvgMinutes: this.metric(phase(vacateSum, vacateCount), 'minutes', from, to, restaurant.timezone, vacateCount, 'occupancy_sessions.paidAt/vacatedAt'),
        cleaningTurnaroundAvgMinutes: this.metric(phase(cleanSum, cleanCount), 'minutes', from, to, restaurant.timezone, cleanCount, 'occupancy_sessions.vacatedAt/cleanedAt')
      }
    };
  }

  /**
   * 3. Mapa de Calor de Ocupación por Día de la Semana y Hora
   */
  static async getOccupancyHeatmap(
    idOrSlug: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<HeatmapHourCellDTO[]> {
    const restaurant = await this.resolveRestaurant(idOrSlug);
    const to = toDate || new Date();
    const from = fromDate || new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 días para mapa representativo

    const sessions = await prisma.occupancySession.findMany({
      where: {
        restaurantId: restaurant.id,
        seatedAt: { gte: from, lte: to }
      }
    });

    const dayLabels = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const totalCapacity = restaurant.tables.reduce((acc, t) => acc + (t.capacity || 0), 0);
    const payments = await this.getMeasuredPayments(restaurant.id, from, to);

    // Inicializar matriz 7 días x 24 horas
    const grid: Record<string, { sessions: number; revenue: number; diners: number }> = {};
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        grid[`${d}-${h}`] = { sessions: 0, revenue: 0, diners: 0 };
      }
    }

    for (const s of sessions) {
      const d = s.seatedAt.getDay();
      const h = s.seatedAt.getHours();
      const key = `${d}-${h}`;
      if (grid[key]) {
        grid[key].sessions++;
        grid[key].diners += s.partySize || 2;
      }
    }
    for (const payment of payments) {
      const d = payment.createdAt.getDay();
      const h = payment.createdAt.getHours();
      const key = `${d}-${h}`;
      if (grid[key]) grid[key].revenue += payment.amount;
    }

    const cells: HeatmapHourCellDTO[] = [];
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        const item = grid[`${d}-${h}`];
        // Ocupación calculada sobre la capacidad del turno
        const occupancyPercentage =
          totalCapacity > 0 ? Math.min(100, Math.round((item.diners / totalCapacity) * 100)) : 0;

        cells.push({
          dayOfWeek: d,
          dayLabel: dayLabels[d],
          hour: h,
          occupancyPercentage,
          sessionsCount: item.sessions,
          revenue: item.revenue,
          metrics: {
            occupancyPercentage: this.metric(occupancyPercentage, 'percent', from, to, restaurant.timezone, item.sessions, 'occupancy_sessions.partySize'),
            revenue: this.metric(item.revenue, 'ARS', from, to, restaurant.timezone, payments.filter((payment) => payment.createdAt.getDay() === d && payment.createdAt.getHours() === h).length, 'payment_transactions.amount')
          }
        });
      }
    }

    return cells;
  }

  /**
   * 4. Rendimiento Comparativo Mesa por Mesa
   */
  static async getTablePerformance(
    idOrSlug: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<TablePerformanceDTO[]> {
    const restaurant = await this.resolveRestaurant(idOrSlug);
    const to = toDate || new Date();
    const from = fromDate || new Date(to.getTime() - 7 * 24 * 60 * 60 * 1000);

    const sessions = await prisma.occupancySession.findMany({
      where: {
        restaurantId: restaurant.id,
        seatedAt: { gte: from, lte: to }
      }
    });

    const { operatingHours, quality: periodQuality } = await this.resolvePeriod(
      restaurant.id,
      from,
      to,
      restaurant.timezone
    );
    const payments = await this.getMeasuredPayments(restaurant.id, from, to);

    const performanceList: TablePerformanceDTO[] = restaurant.tables.map((table) => {
      const tableSessions = sessions.filter((s) => s.tableId === table.id);
      const totalTurns = tableSessions.length;
      const tablePayments = payments.filter((payment) => payment.order.tableSession.tableId === table.id);
      const revenue = tablePayments.reduce((sum, payment) => sum + payment.amount, 0);
      let durationMinutesSum = 0;

      for (const s of tableSessions) {
        if (s.turnTimeMinutes) {
          durationMinutesSum += s.turnTimeMinutes;
        } else if (s.durationMinutes) {
          durationMinutesSum += s.durationMinutes;
        }
      }

      const avgTurn = totalTurns > 0 ? Math.round(durationMinutesSum / totalTurns) : 0;
      const seatHours = (table.capacity || 0) * operatingHours;
      const revPASH = seatHours > 0 ? Math.round((revenue / seatHours) * 100) / 100 : 0;

      const totalOccupiedMinutes = durationMinutesSum;
      const totalAvailableMinutes = seatHours * 60;
      const utilizationPercentage =
        totalAvailableMinutes > 0
          ? Math.min(100, Math.round((totalOccupiedMinutes / totalAvailableMinutes) * 100))
          : 0;

      return {
        tableId: table.id,
        label: table.label,
        shape: (table.shape as TableShape) || 'RECT',
        capacity: table.capacity || 4,
        zoneName: table.floorZone?.name || null,
        totalTurns,
        totalRevenue: revenue,
        averageTurnTimeMinutes: avgTurn,
        revPASH,
        utilizationPercentage,
        quality: {
          ...periodQuality,
          measuredRecords: tableSessions.length + tablePayments.length,
          warnings: [
            ...periodQuality.warnings,
            ...(tablePayments.length === 0 ? ['No hay pagos conciliados para esta mesa en el período.'] : []),
            ...(durationMinutesSum === 0 ? ['No hay duración medida para esta mesa en el período.'] : [])
          ]
        },
        metrics: {
          totalRevenue: this.metric(revenue, 'ARS', from, to, restaurant.timezone, tablePayments.length, 'payment_transactions.amount'),
          averageTurnTimeMinutes: this.metric(avgTurn, 'minutes', from, to, restaurant.timezone, tableSessions.filter((s) => Boolean(s.turnTimeMinutes || s.durationMinutes)).length, 'occupancy_sessions.turnTimeMinutes/durationMinutes'),
          revPASH: this.metric(revPASH, 'ARS_per_seat_hour', from, to, restaurant.timezone, tablePayments.length, 'payment_transactions.amount / shifts'),
          utilizationPercentage: this.metric(utilizationPercentage, 'percent', from, to, restaurant.timezone, tableSessions.filter((s) => Boolean(s.durationMinutes)).length, 'occupancy_sessions.durationMinutes')
        }
      };
    });

    // Ordenar de mayor a menor facturación
    return performanceList.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }
}

import { prisma } from '../lib/prisma';
import {
  RTMSAnalyticsSummaryDTO,
  PhaseMetricsDTO,
  HeatmapHourCellDTO,
  TablePerformanceDTO,
  TableShape
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

    // Calcular horas operativas del período
    const diffHours = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60)));
    // Estimación de horas de servicio reales (aprox. 8h por día de servicio)
    const daysInPeriod = Math.max(1, Math.round(diffHours / 24));
    const operatingHours = Math.min(diffHours, daysInPeriod * 8);

    // Sumar capacidad total de asientos
    const totalSeats = restaurant.tables.reduce((acc, t) => acc + (t.capacity || 4), 0);
    const totalSeatHours = Math.max(1, totalSeats * operatingHours);

    // Consultar sesiones de permanencia en el rango
    const sessions = await prisma.occupancySession.findMany({
      where: {
        restaurantId: restaurant.id,
        seatedAt: { gte: from, lte: to }
      }
    });

    const totalSessions = sessions.length;
    let totalRevenue = 0;
    let turnTimeSum = 0;
    let turnTimeCount = 0;
    let durationSum = 0;
    let durationCount = 0;
    let occupiedSeatMinutesSum = 0;

    for (const s of sessions) {
      // Si la sesión no tiene revenue registrado, estimamos $9.500 ARS por comensal
      const estimatedRev = (s.partySize || 2) * 9500;
      const rev = s.totalRevenue !== null && s.totalRevenue > 0 ? s.totalRevenue : estimatedRev;
      totalRevenue += rev;

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

    const averageTurnTimeMinutes =
      turnTimeCount > 0 ? Math.round(turnTimeSum / turnTimeCount) : 65;
    const averageDurationMinutes =
      durationCount > 0 ? Math.round(durationSum / durationCount) : 55;

    // RevPASH = Total Revenue / Total Available Seat Hours
    const revPASH = Math.round((totalRevenue / totalSeatHours) * 100) / 100;

    // Tasa de ocupación de asientos en %
    const totalAvailableSeatMinutes = totalSeatHours * 60;
    const occupancyRatePercentage = Math.min(
      100,
      Math.round((occupiedSeatMinutesSum / totalAvailableSeatMinutes) * 100)
    );

    const turnsPerTableAverage =
      restaurant.tables.length > 0
        ? Math.round((totalSessions / restaurant.tables.length) * 10) / 10
        : 0;

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
      turnsPerTableAverage
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

    return {
      timeToOrderAvgMinutes: toOrderCount > 0 ? Math.max(1, Math.round(toOrderSum / toOrderCount)) : 8,
      kitchenPrepAvgMinutes: prepCount > 0 ? Math.max(1, Math.round(prepSum / prepCount)) : 22,
      eatingDwellAvgMinutes: dwellCount > 0 ? Math.max(1, Math.round(dwellSum / dwellCount)) : 38,
      paymentToVacateAvgMinutes: vacateCount > 0 ? Math.max(1, Math.round(vacateSum / vacateCount)) : 12,
      cleaningTurnaroundAvgMinutes: cleanCount > 0 ? Math.max(1, Math.round(cleanSum / cleanCount)) : 6
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
    const totalCapacity = restaurant.tables.reduce((acc, t) => acc + (t.capacity || 4), 0);

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
        grid[key].revenue += s.totalRevenue || (s.partySize || 2) * 9500;
      }
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
          revenue: item.revenue
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

    const diffHours = Math.max(1, Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60)));
    const daysInPeriod = Math.max(1, Math.round(diffHours / 24));
    const operatingHours = Math.min(diffHours, daysInPeriod * 8);

    const performanceList: TablePerformanceDTO[] = restaurant.tables.map((table) => {
      const tableSessions = sessions.filter((s) => s.tableId === table.id);
      const totalTurns = tableSessions.length;
      let revenue = 0;
      let durationMinutesSum = 0;

      for (const s of tableSessions) {
        revenue += s.totalRevenue || (s.partySize || 2) * 9500;
        if (s.turnTimeMinutes) {
          durationMinutesSum += s.turnTimeMinutes;
        } else if (s.durationMinutes) {
          durationMinutesSum += s.durationMinutes;
        }
      }

      const avgTurn = totalTurns > 0 ? Math.round(durationMinutesSum / totalTurns) : 0;
      const seatHours = (table.capacity || 4) * operatingHours;
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
        utilizationPercentage
      };
    });

    // Ordenar de mayor a menor facturación
    return performanceList.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }
}

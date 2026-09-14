import { prisma } from '../lib/prisma';
import { MetricsDTO, CallType, PaymentMethod, AnalyticsMetricDTO } from '@mesaya/shared';

export class MetricsService {
  static async getMetrics(restaurantId: string): Promise<MetricsDTO> {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { timezone: true }
    });

    const timezone = restaurant?.timezone || 'America/Argentina/Buenos_Aires';
    const now = new Date();

    // Calcular inicio del día en la zona horaria del restaurante (P1-03)
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    const getPart = (t: string) => parseInt(parts.find((p) => p.type === t)?.value || '0', 10);
    const year = getPart('year');
    const month = getPart('month');
    const day = getPart('day');

    const utcEstimated = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const invParts = formatter.formatToParts(utcEstimated);
    const invPart = (t: string) => parseInt(invParts.find((p) => p.type === t)?.value || '0', 10);
    const diffMs = Date.UTC(invPart('year'), invPart('month') - 1, invPart('day'), invPart('hour'), invPart('minute'), invPart('second')) - utcEstimated.getTime();
    const today = new Date(utcEstimated.getTime() - diffMs);

    const currentShift = await prisma.shift.findFirst({
      where: { restaurantId, closedAt: null },
      orderBy: { openedAt: 'desc' }
    });

    const shiftStart = currentShift?.openedAt ? currentShift.openedAt : today;

    const calls = await prisma.callRequest.findMany({
      where: {
        tableSession: {
          table: { restaurantId }
        },
        createdAt: { gte: shiftStart }
      }
    });

    const resolvedCalls = calls.filter(c => c.status === 'RESOLVED');
    const responseTimes: number[] = [];

    for (const call of resolvedCalls) {
      const attentionDate = call.acknowledgedAt ?? call.resolvedAt;
      if (attentionDate) {
        const diffMs = new Date(attentionDate).getTime() - new Date(call.createdAt).getTime();
        responseTimes.push(Math.max(0, Math.floor(diffMs / 1000)));
      }
    }

    const avgResponseTimeSeconds = responseTimes.length > 0
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length)
      : 0;

    const pendingCallsCount = calls.filter(c => c.status === 'PENDING' || c.status === 'IN_PROGRESS').length;

    const callsByType: Record<CallType, number> = {
      [CallType.BILL]: 0,
      [CallType.WAITER]: 0,
      [CallType.SUPPLIES]: 0,
      [CallType.CUSTOM]: 0
    };

    const callsByPaymentMethod: Record<PaymentMethod, number> = {
      [PaymentMethod.CASH]: 0,
      [PaymentMethod.MERCADO_PAGO]: 0,
      [PaymentMethod.CARD]: 0,
      [PaymentMethod.CARD_DEBIT]: 0,
      [PaymentMethod.CARD_CREDIT]: 0,
      [PaymentMethod.NOT_APPLICABLE]: 0
    };

    for (const call of calls) {
      if (callsByType[call.type as CallType] !== undefined) {
        callsByType[call.type as CallType]++;
      }
      if (callsByPaymentMethod[call.paymentMethod as PaymentMethod] !== undefined) {
        callsByPaymentMethod[call.paymentMethod as PaymentMethod]++;
      }
    }

    const feedbacks = await prisma.feedback.findMany({
      where: {
        tableSession: {
          table: { restaurantId }
        },
        createdAt: { gte: shiftStart, lte: now }
      }
    });

    const npsAverage = feedbacks.length > 0
      ? Number((feedbacks.reduce((acc, f) => acc + f.rating, 0) / feedbacks.length).toFixed(1))
      : 0;

    const period = { from: shiftStart.toISOString(), to: now.toISOString() };
    const warnings: string[] = [];
    if (responseTimes.length === 0) warnings.push('No hay llamados resueltos con tiempo de atención medido.');
    if (feedbacks.length === 0) warnings.push('No hay valoraciones en el período seleccionado.');
    const quality = {
      timezone,
      period,
      measuredRecords: calls.length + feedbacks.length,
      warnings
    };
    const metric = (value: number, unit: string, sampleSize: number, source: string): AnalyticsMetricDTO => ({
      value,
      unit,
      period: { ...period, timezone },
      sampleSize,
      source,
      quality: sampleSize > 0 ? 'MEASURED' : 'NO_DATA'
    });

    return {
      avgResponseTimeSeconds,
      totalCallsToday: calls.length,
      pendingCallsCount,
      callsByType,
      callsByPaymentMethod,
      npsAverage,
      ratingAverage: npsAverage,
      avgResponseSampleSize: responseTimes.length,
      npsSampleSize: feedbacks.length,
      ratingSampleSize: feedbacks.length,
      quality,
      metrics: {
        avgResponseTimeSeconds: metric(avgResponseTimeSeconds, 'seconds', responseTimes.length, 'call_requests.acknowledgedAt'),
        totalCalls: metric(calls.length, 'count', calls.length, 'call_requests.createdAt'),
        npsAverage: metric(npsAverage, 'rating_1_to_5', feedbacks.length, 'feedback.rating')
      }
    };
  }
}

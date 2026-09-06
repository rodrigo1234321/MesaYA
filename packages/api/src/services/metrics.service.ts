import { prisma } from '../lib/prisma';
import { MetricsDTO, CallType, PaymentMethod } from '@mesaya/shared';

export class MetricsService {
  static async getMetrics(restaurantId: string): Promise<MetricsDTO> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
        }
      }
    });

    const npsAverage = feedbacks.length > 0
      ? Number((feedbacks.reduce((acc, f) => acc + f.rating, 0) / feedbacks.length).toFixed(1))
      : 5.0;

    return {
      avgResponseTimeSeconds,
      totalCallsToday: calls.length,
      pendingCallsCount,
      callsByType,
      callsByPaymentMethod,
      npsAverage
    };
  }
}

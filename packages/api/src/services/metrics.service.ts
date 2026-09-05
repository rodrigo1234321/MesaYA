import { prisma } from '../lib/prisma';
import { MetricsDTO, CallType, PaymentMethod } from '@mesaya/shared';

export class MetricsService {
  static async getMetrics(restaurantId: string): Promise<MetricsDTO> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const calls = await prisma.callRequest.findMany({
      where: {
        tableSession: {
          table: { restaurantId }
        },
        createdAt: { gte: today }
      }
    });

    const resolvedCalls = calls.filter(c => c.status === 'RESOLVED' && c.acknowledgedAt);
    let totalResponseSeconds = 0;
    for (const call of resolvedCalls) {
      if (call.acknowledgedAt) {
        const diffMs = new Date(call.acknowledgedAt).getTime() - new Date(call.createdAt).getTime();
        totalResponseSeconds += Math.max(0, Math.floor(diffMs / 1000));
      }
    }

    const avgResponseTimeSeconds = resolvedCalls.length > 0
      ? Math.round(totalResponseSeconds / resolvedCalls.length)
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

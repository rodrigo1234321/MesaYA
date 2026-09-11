import { describe, expect, it, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { RTMSAnalyticsService } from '../src/services/rtms-analytics.service';

describe('analytics: calidad de datos y ausencia de estimaciones implícitas', () => {
  it('marca NO_DATA y no inventa revenue ni tiempos en un período vacío', async () => {
    const restaurant = await prisma.restaurant.findFirst({ orderBy: { createdAt: 'asc' } });
    expect(restaurant).toBeTruthy();

    const from = new Date('2001-01-01T00:00:00.000Z');
    const to = new Date('2001-01-02T00:00:00.000Z');
    const summary = await RTMSAnalyticsService.getAnalyticsSummary(restaurant!.id, from, to);
    const phases = await RTMSAnalyticsService.getPhaseMetrics(restaurant!.id, from, to);

    expect(summary.totalRevenue).toBe(0);
    expect(summary.period.operatingHours).toBe(0);
    expect(summary.metrics?.totalRevenue.quality).toBe('NO_DATA');
    expect(summary.metrics?.totalRevenue.sampleSize).toBe(0);
    expect(summary.quality?.warnings.some((warning) => warning.includes('revenue'))).toBe(true);
    expect(phases.timeToOrderAvgMinutes).toBe(0);
    expect(phases.metrics?.timeToOrderAvgMinutes.quality).toBe('NO_DATA');
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

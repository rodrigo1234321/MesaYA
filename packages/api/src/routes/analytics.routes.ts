import { FastifyInstance } from 'fastify';
import { RTMSAnalyticsService } from '../services/rtms-analytics.service';
import { requireRestaurantAccess, verifyManagerRole } from '../middlewares/auth.middleware';
import { sendSanitizedError } from '../lib/errorHandler';

export async function rtmsAnalyticsRoutes(fastify: FastifyInstance) {
  // 1. Resumen Global de RevPASH y Ocupación
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: { from?: string; to?: string };
  }>('/analytics/:restaurantId/summary', { preHandler: [verifyManagerRole, requireRestaurantAccess((request) => (request.params as { restaurantId: string }).restaurantId)] }, async (req, reply) => {
    try {
      const from = req.query.from ? new Date(req.query.from) : undefined;
      const to = req.query.to ? new Date(req.query.to) : undefined;
      const summary = await RTMSAnalyticsService.getAnalyticsSummary(
        req.params.restaurantId,
        from,
        to
      );
      return reply.send(summary);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  // 2. Embudo de Fases Gastronómicas (Dwell Times)
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: { from?: string; to?: string };
  }>('/analytics/:restaurantId/phases', { preHandler: [verifyManagerRole, requireRestaurantAccess((request) => (request.params as { restaurantId: string }).restaurantId)] }, async (req, reply) => {
    try {
      const from = req.query.from ? new Date(req.query.from) : undefined;
      const to = req.query.to ? new Date(req.query.to) : undefined;
      const phases = await RTMSAnalyticsService.getPhaseMetrics(
        req.params.restaurantId,
        from,
        to
      );
      return reply.send(phases);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  // 3. Mapa de Calor Horario (7x24)
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: { from?: string; to?: string };
  }>('/analytics/:restaurantId/heatmap', { preHandler: [verifyManagerRole, requireRestaurantAccess((request) => (request.params as { restaurantId: string }).restaurantId)] }, async (req, reply) => {
    try {
      const from = req.query.from ? new Date(req.query.from) : undefined;
      const to = req.query.to ? new Date(req.query.to) : undefined;
      const heatmap = await RTMSAnalyticsService.getOccupancyHeatmap(
        req.params.restaurantId,
        from,
        to
      );
      return reply.send(heatmap);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  // 4. Rendimiento por Mesa
  fastify.get<{
    Params: { restaurantId: string };
    Querystring: { from?: string; to?: string };
  }>('/analytics/:restaurantId/table-performance', { preHandler: [verifyManagerRole, requireRestaurantAccess((request) => (request.params as { restaurantId: string }).restaurantId)] }, async (req, reply) => {
    try {
      const from = req.query.from ? new Date(req.query.from) : undefined;
      const to = req.query.to ? new Date(req.query.to) : undefined;
      const tables = await RTMSAnalyticsService.getTablePerformance(
        req.params.restaurantId,
        from,
        to
      );
      return reply.send(tables);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });
}

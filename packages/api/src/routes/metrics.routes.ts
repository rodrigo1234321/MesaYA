import { FastifyInstance } from 'fastify';
import { MetricsService } from '../services/metrics.service';
import { verifyManagerRole } from '../middlewares/auth.middleware';

export async function metricsRoutes(fastify: FastifyInstance) {
  fastify.get('/metrics', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { restaurantId: requestedRestaurantId } = request.query as { restaurantId?: string };
      const restaurantId = request.staffUser!.restaurantId;
      if (requestedRestaurantId && requestedRestaurantId !== restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }
      const metrics = await MetricsService.getMetrics(restaurantId);
      return reply.send(metrics);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message });
    }
  });
}

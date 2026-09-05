import { FastifyInstance } from 'fastify';
import { SessionService } from '../services/session.service';

export async function sessionRoutes(fastify: FastifyInstance) {
  fastify.get('/sessions/:token', async (request, reply) => {
    const { token } = request.params as { token: string };

    const sessionData = await SessionService.validateToken(token);
    if (!sessionData) {
      return reply.status(404).send({
        error: 'Sesión o mesa no encontrada',
        valid: false
      });
    }

    if (!sessionData.valid && !sessionData.table) {
      return reply.status(404).send(sessionData);
    }

    return reply.send(sessionData);
  });

  fastify.get('/sessions/:slug/:tableLabel', async (request, reply) => {
    try {
      const { slug, tableLabel } = request.params as { slug: string; tableLabel: string };
      const sessionData = await SessionService.getOrCreateActiveSessionBySlugAndTable(
        decodeURIComponent(slug),
        decodeURIComponent(tableLabel)
      );
      return reply.send(sessionData);
    } catch (err: any) {
      return reply.status(err.statusCode || 404).send({
        error: err.message || 'Restaurante o mesa no encontrados',
        valid: false
      });
    }
  });

  fastify.get('/sessions/table/:label', async (request, reply) => {
    const isExplicitTest =
      process.env.NODE_ENV === 'test' && process.env.ALLOW_LEGACY_DEMO_ROUTES === 'true';

    if (!isExplicitTest) {
      return reply.status(403).send({
        error: 'FORBIDDEN_LEGACY_ROUTE',
        message:
          'Endpoint legacy deshabilitado. La resolución canónica de QR requiere restaurante y mesa (/r/:slug/mesa/:label).',
        valid: false
      });
    }

    try {
      const { label } = request.params as { label: string };
      const decoded = decodeURIComponent(label);
      const sessionData = await SessionService.getOrCreateActiveDemoSession(decoded);
      return reply.send(sessionData);
    } catch (err: any) {
      return reply.status(err.statusCode || 404).send({
        error: err.message || 'Mesa no encontrada',
        valid: false
      });
    }
  });
}

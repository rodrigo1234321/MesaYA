import { FastifyInstance } from 'fastify';
import { SessionService } from '../services/session.service';
import { sendSanitizedError } from '../lib/errorHandler';

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

    // E02: token viejo (cerrado/expirado/TO_CLEAN) → 410 para que ningún cliente
    // reutilice una ocupación anterior. Vigente → 200. M2: se preservan code y
    // details coherentes (SESSION_CLOSED/SESSION_EXPIRED/SHIFT_CLOSED).
    if (!sessionData.valid && ((sessionData as any).isClosed || (sessionData as any).isExpired)) {
      return reply.status(410).send(sessionData);
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
      return sendSanitizedError(reply, err, { valid: false });
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
      return sendSanitizedError(reply, err, { valid: false });
    }
  });
}

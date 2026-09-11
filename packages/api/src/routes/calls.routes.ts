import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { CallService } from '../services/call.service';
import { CreateCallDTO, CallStatus, CallType, PaymentMethod, CallOrigin } from '@mesaya/shared';
import { verifyStaffToken } from '../middlewares/auth.middleware';

export async function callRoutes(fastify: FastifyInstance) {
  // Client creates a call (Public, authenticated by sessionToken)
  fastify.post('/calls', async (request, reply) => {
    try {
      const body = request.body as CreateCallDTO;
      if (!body || typeof body !== 'object') {
        return reply.status(400).send({ error: 'Cuerpo de petición requerido' });
      }

      if (!body.sessionToken || typeof body.sessionToken !== 'string') {
        return reply.status(400).send({ error: 'Faltan parámetros requeridos (sessionToken, type)' });
      }

      if (body.sessionToken.length > 100) {
        return reply.status(400).send({ error: 'sessionToken inválido' });
      }

      if (!body.type || !Object.values(CallType).includes(body.type)) {
        return reply.status(400).send({ error: 'Faltan parámetros requeridos (sessionToken, type)' });
      }

      if (body.paymentMethod && !Object.values(PaymentMethod).includes(body.paymentMethod)) {
        return reply.status(400).send({ error: 'Método de pago inválido' });
      }

      if (body.tipMinor !== undefined && (!Number.isInteger(body.tipMinor) || body.tipMinor < 0 || body.tipMinor > 2147483647)) {
        return reply.status(400).send({ error: 'La propina debe ser un importe entero válido en centavos' });
      }

      if (body.origin && !Object.values(CallOrigin).includes(body.origin)) {
        return reply.status(400).send({ error: 'Origen de llamado inválido' });
      }

      if (body.note && (typeof body.note !== 'string' || body.note.length > 500)) {
        return reply.status(400).send({ error: 'La nota no puede superar los 500 caracteres' });
      }

      const createdCall = await CallService.createCall(body);
      return reply.status(201).send(createdCall);
    } catch (err: any) {
      const status = err.statusCode || 500;
      if (status === 429 && err.retryAfterSeconds) {
        reply.header('Retry-After', String(Math.max(1, Math.ceil(err.retryAfterSeconds))));
      }
      return reply.status(status).send({ error: err.message, code: err.code });
    }
  });

  // Waiter updates call status (IN_PROGRESS, RESOLVED, etc.) - REQUIRES STAFF JWT
  fastify.patch('/calls/:id', { onRequest: [verifyStaffToken] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { status?: CallStatus };

      if (!body?.status || !Object.values(CallStatus).includes(body.status)) {
        return reply.status(400).send({ error: 'Estado inválido' });
      }

      // Ensure caller is staff from the same restaurant (if call exists)
      const call = await prisma.callRequest.findUnique({
        where: { id },
        include: { tableSession: { include: { table: true } } }
      });

      if (!call) {
        return reply.status(404).send({ error: 'Llamado no encontrado' });
      }

      if (request.staffUser && call.tableSession.table.restaurantId !== request.staffUser.restaurantId) {
        return reply.status(403).send({ error: 'No tienes autorización para modificar llamados de otro restaurante' });
      }

      // Actor derived strictly from JWT, ignore any actor in body
      const staffUserId = request.staffUser?.sub;
      const updated = await CallService.updateCallStatus(id, body.status, request.staffUser?.restaurantId, staffUserId);
      return reply.send(updated);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message, code: err.code });
    }
  });

  // Client cancels call ("Ya fui atendido")
  fastify.post('/calls/:id/cancel', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const body = request.body as { sessionToken?: string };

      if (!body?.sessionToken || typeof body.sessionToken !== 'string') {
        return reply.status(400).send({ error: 'sessionToken requerido' });
      }

      const result = await CallService.cancelCallByClient(id, body.sessionToken);
      return reply.send(result);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message, code: err.code });
    }
  });

  // Fetch active calls list for staff - REQUIRES STAFF JWT & TENANT ISOLATION
  fastify.get('/calls', { onRequest: [verifyStaffToken] }, async (request, reply) => {
    try {
      const { restaurantId } = request.query as { restaurantId?: string };
      if (!restaurantId) {
        return reply.status(400).send({ error: 'restaurantId requerido' });
      }

      const rest = await prisma.restaurant.findFirst({
        where: { OR: [{ id: restaurantId }, { slug: restaurantId }] }
      });
      if (!rest) return reply.status(404).send({ error: 'Restaurante no encontrado' });

      if (request.staffUser && request.staffUser.restaurantId !== rest.id) {
        return reply.status(403).send({ error: 'No tienes autorización para acceder a los llamados de otro restaurante' });
      }

      const activeCalls = await CallService.getActiveCalls(rest.id);
      return reply.send(activeCalls);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message, code: err.code });
    }
  });
}

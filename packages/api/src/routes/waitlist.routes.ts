import { FastifyPluginAsync } from 'fastify';
import { WaitlistService } from '../services/waitlist.service';
import { verifyStaffToken } from '../middlewares/auth.middleware';
import { JoinWaitlistDTO } from '@mesaya/shared';
import { AbuseControlService, AbusePolicies } from '../services/abuse-control.service';
import { prisma } from '../lib/prisma';

export const waitlistRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /v1/waitlist/join
   * Registro de comensal en la fila virtual desde la vereda/móvil.
   * SEGURIDAD: Límite compartido por IP + tenant (3 registros / 10m).
   * Retorna ticket individual sin exponer listados ni teléfonos.
   */
  fastify.post<{ Body: JoinWaitlistDTO }>(
    '/waitlist/join',
    async (request, reply) => {
      const body = request.body || ({} as any);
      const ip = request.ip || '127.0.0.1';
      const slug = typeof body.restaurantSlug === 'string' ? body.restaurantSlug.trim().toLowerCase() : '';
      const guestName = typeof body.guestName === 'string' ? body.guestName.trim() : '';
      const phoneDigits = typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
      const validShapeForLimit = Boolean(
        slug && guestName.length >= 2 && guestName.length <= 50 &&
        Number.isInteger(body.partySize) && body.partySize >= 1 && body.partySize <= 20 &&
        phoneDigits.length >= 8 && phoneDigits.length <= 15 && body.consent !== false &&
        !(Array.isArray(body.preOrderData) && body.preOrderData.length > 0)
      );

      // No se penalizan payloads evidentemente inválidos: esos siguen su
      // validación normal y no consumen el bucket de la operación real.
      if (validShapeForLimit) {
        const tenant = await prisma.restaurant.findFirst({
          where: { OR: [{ id: slug }, { slug }] },
          select: { id: true }
        });
        const decision = await AbuseControlService.consume(
          `waitlist:tenant:${tenant?.id || slug}:ip:${ip}`,
          AbusePolicies.WAITLIST_BY_IP_TENANT
        );
        if (!decision.allowed) {
          reply.header('Retry-After', String(decision.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiadas solicitudes para este restaurante desde esta red. Por favor aguardá unos minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
      }

      try {
        const entry = await WaitlistService.joinWaitlist(body);
        return reply.status(201).send(entry);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * GET /v1/staff/restaurants/:id/waitlist
   * Consulta de fila de espera para el panel del staff.
   */
  fastify.get<{ Params: { id: string } }>(
    '/staff/restaurants/:id/waitlist',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      try {
        const queue = await WaitlistService.getQueue(id, staffRestaurantId);
        return reply.send({ queue });
      } catch (err: any) {
        const status = err.statusCode || 500;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * PATCH /v1/staff/waitlist/:id/call
   * Mozo llama al comensal (aviso de mesa lista).
   */
  fastify.patch<{ Params: { id: string } }>(
    '/staff/waitlist/:id/call',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      try {
        const entry = await WaitlistService.callGuest(id, staffRestaurantId);
        return reply.send(entry);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * PATCH /v1/staff/waitlist/:id/seat
   * Mozo sienta al grupo en mesa del salón.
   */
  fastify.patch<{
    Params: { id: string };
    Body: { tableId?: string };
  }>(
    '/staff/waitlist/:id/seat',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      const staffUserId = request.staffUser?.sub;
      const { tableId } = (request.body as any) || {};

      if (!tableId || typeof tableId !== 'string' || !tableId.trim()) {
        return reply.status(400).send({
          error: 'tableId es requerido para sentar a un comensal',
          code: 'TABLE_ID_REQUIRED'
        });
      }

      try {
        const entry = await WaitlistService.seatGuest(id, {
          staffRestaurantId,
          staffUserId,
          tableId: tableId.trim()
        });
        return reply.send(entry);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );
};

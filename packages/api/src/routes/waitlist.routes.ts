import { FastifyPluginAsync } from 'fastify';
import { WaitlistService } from '../services/waitlist.service';
import { verifyStaffToken } from '../middlewares/auth.middleware';
import { JoinWaitlistDTO } from '@mesaya/shared';
import { AbuseControlService, AbusePolicies } from '../services/abuse-control.service';
import { prisma } from '../lib/prisma';
import { isRestaurantInConfiguredInstance } from '../lib/environment';
import { sendSanitizedError } from '../lib/errorHandler';

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
        if (tenant && isRestaurantInConfiguredInstance(tenant.id)) {
          // Clave combinada por teléfono y red para no penalizar a otros clientes en el mismo Wi-Fi del salón
          const decision = await AbuseControlService.consume(
            `waitlist:tenant:${tenant.id}:phone:${phoneDigits.slice(-8)}:ip:${ip}`,
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
      }

      try {
        const entry = await WaitlistService.joinWaitlist(body);
        return reply.status(201).send(entry);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/waitlist/:id/status?phone=...
   * Consulta pública del propio ticket. El teléfono normalizado evita que un
   * id enumerado revele nombre, tamaño o estado a terceros.
   */
  fastify.get<{ Params: { id: string }; Querystring: { phone?: string } }>(
    '/waitlist/:id/status',
    async (request, reply) => {
      try {
        const entry = await WaitlistService.getPublicStatus(request.params.id, request.query.phone || '');
        return reply.send(entry);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/waitlist/:id/cancel
   * Cancelación segura pública del ticket desde el dispositivo del comensal.
   * Requiere el teléfono normalizado para validación privada (no enumeración).
   */
  fastify.post<{
    Params: { id: string };
    Body: { phone?: string; reason?: string };
    Querystring: { phone?: string };
  }>(
    '/waitlist/:id/cancel',
    async (request, reply) => {
      const { id } = request.params;
      const phone = request.body?.phone || request.query?.phone || '';
      const reason = request.body?.reason;
      try {
        const entry = await WaitlistService.cancelPublicTicket(id, phone, reason);
        return reply.send(entry);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * PATCH /v1/staff/waitlist/:id/seat
   * Mozo sienta al grupo en mesa del salón.
   */
  fastify.patch<{
    Params: { id: string };
    Body: { tableId?: string; skipPreOrder?: boolean; skipReason?: string };
  }>(
    '/staff/waitlist/:id/seat',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      const staffUserId = request.staffUser?.sub;
      const staffRole = request.staffUser?.role;
      const { tableId, skipPreOrder, skipReason } = (request.body as any) || {};

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
          staffRole,
          tableId: tableId.trim(),
          skipPreOrder: Boolean(skipPreOrder),
          skipReason: typeof skipReason === 'string' ? skipReason : undefined
        });
        return reply.send(entry);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * PATCH /v1/staff/waitlist/:id/cancel
   * Mozo o encargado cancela un turno de espera del salón.
   */
  fastify.patch<{
    Params: { id: string };
    Body: { reason?: string };
  }>(
    '/staff/waitlist/:id/cancel',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      const reason = request.body?.reason;
      try {
        const entry = await WaitlistService.cancelByStaff(id, staffRestaurantId, reason);
        return reply.send(entry);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * PATCH /v1/staff/waitlist/:id/no-show
   * Mozo o encargado marca el turno como no-show tras aviso sin comparecencia.
   */
  fastify.patch<{
    Params: { id: string };
    Body: { reason?: string };
  }>(
    '/staff/waitlist/:id/no-show',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      const reason = request.body?.reason;
      try {
        const entry = await WaitlistService.markNoShow(id, staffRestaurantId, reason);
        return reply.send(entry);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );
};

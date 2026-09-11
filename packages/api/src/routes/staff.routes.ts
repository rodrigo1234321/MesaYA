import { FastifyInstance } from 'fastify';
import { StaffService } from '../services/staff.service';
import { StaffLoginDTO } from '@mesaya/shared';
import { getEnvironmentConfig, STAFF_JWT_EXPIRES_IN } from '../lib/environment';
import { verifyManagerRole } from '../middlewares/auth.middleware';
import { prisma } from '../lib/prisma';
import { AbuseControlService, AbusePolicies } from '../services/abuse-control.service';

export async function staffRoutes(fastify: FastifyInstance) {
  fastify.post('/staff/login', async (request, reply) => {
    try {
      const body = request.body as StaffLoginDTO & { terminalId?: string };
      if (
        !body ||
        typeof body.restaurantSlug !== 'string' ||
        typeof body.pin !== 'string' ||
        !body.restaurantSlug.trim() ||
        !body.pin.trim() ||
        body.pin.length > 32 ||
        body.restaurantSlug.length > 100 ||
        (body.terminalId !== undefined && (typeof body.terminalId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.terminalId)))
      ) {
        return reply.status(400).send({ error: 'restaurantSlug y pin son requeridos y deben ser válidos' });
      }

      const cleanSlug = body.restaurantSlug.trim();
      const restaurant = await prisma.restaurant.findFirst({
        where: { OR: [{ id: cleanSlug }, { slug: cleanSlug }] },
        select: { id: true, slug: true }
      });

      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }
      const environment = getEnvironmentConfig();
      if (environment.instanceMode === 'SINGLE_RESTAURANT' && restaurant.id !== environment.instanceRestaurantId) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }

      const loginDecision = await AbuseControlService.consume(
        `login:tenant:${restaurant.id}:ip:${request.ip || 'unknown'}`,
        AbusePolicies.LOGIN_BY_IP_TENANT
      );
      if (!loginDecision.allowed) {
        reply.header('Retry-After', String(loginDecision.retryAfterSeconds));
        return reply.status(429).send({
          error: 'Demasiados intentos de acceso. Por favor aguardá unos minutos.',
          code: 'RATE_LIMIT_EXCEEDED'
        });
      }

      const { staffUser } = await StaffService.login({
        restaurantSlug: restaurant.slug,
        pin: body.pin.trim()
      });
      const token = fastify.jwt.sign({
        sub: staffUser.id,
        role: staffUser.role,
        restaurantId: staffUser.restaurantId,
        assignedSector: staffUser.assignedSector,
        terminalId: body.terminalId
      }, { expiresIn: STAFF_JWT_EXPIRES_IN });

      return reply.send({
        token,
        staffUser
      });
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message });
    }
  });

  fastify.get('/staff', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { restaurantId: requestedRestaurantId } = request.query as { restaurantId?: string };
      const restaurantId = request.staffUser!.restaurantId;
      if (requestedRestaurantId && requestedRestaurantId !== restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }
      const staffList = await StaffService.listStaff(restaurantId);
      return reply.send(staffList);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message });
    }
  });

  fastify.post('/staff', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { restaurantId: requestedRestaurantId, name, pin, role, assignedSector } = request.body as any;
      const restaurantId = request.staffUser!.restaurantId;
      if (requestedRestaurantId && requestedRestaurantId !== restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }
      const newStaff = await StaffService.createStaff(restaurantId, name, pin, role, assignedSector);
      return reply.status(201).send(newStaff);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message });
    }
  });
}

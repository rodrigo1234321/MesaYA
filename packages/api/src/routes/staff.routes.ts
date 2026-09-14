import { FastifyInstance } from 'fastify';
import { StaffService } from '../services/staff.service';
import { StaffLoginDTO } from '@mesaya/shared';
import { getEnvironmentConfig, STAFF_JWT_EXPIRES_IN } from '../lib/environment';
import { verifyManagerRole } from '../middlewares/auth.middleware';
import { prisma } from '../lib/prisma';
import { AbuseControlService, AbusePolicies } from '../services/abuse-control.service';
import { sendSanitizedError } from '../lib/errorHandler';

export async function staffRoutes(fastify: FastifyInstance) {
  fastify.post('/staff/login', async (request, reply) => {
    try {
      const body = request.body as StaffLoginDTO & { terminalId?: string; isTemporary?: boolean };
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

      // Control de abuso: protección dual anti-fuerza bruta y anti-bloqueo Wi-Fi.
      // 1. Si presenta terminalId, se valida su bucket específico (5 intentos / 5 min).
      // 2. Además, para evitar rotación maliciosa de terminalId desde una misma IP,
      //    se evalúa el bucket IP del salón con un límite agregado prudente (25 intentos / 5 min).
      // 3. Si no presenta terminalId, el bucket de la IP aplica el límite estricto (5 intentos / 5 min).
      const ipKey = `login:tenant:${restaurant.id}:ip:${request.ip || 'unknown'}`;
      if (body.terminalId?.trim()) {
        const termKey = `login:tenant:${restaurant.id}:term:${body.terminalId.trim()}`;
        const termDecision = await AbuseControlService.consume(termKey, AbusePolicies.LOGIN_BY_IP_TENANT);
        if (!termDecision.allowed) {
          reply.header('Retry-After', String(termDecision.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiados intentos de acceso desde este terminal. Por favor aguardá unos minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
        const ipDecision = await AbuseControlService.consume(ipKey, { limit: 25, windowSeconds: 5 * 60 });
        if (!ipDecision.allowed) {
          reply.header('Retry-After', String(ipDecision.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiados intentos de acceso desde esta red. Por favor aguardá unos minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
      } else {
        const ipDecision = await AbuseControlService.consume(ipKey, AbusePolicies.LOGIN_BY_IP_TENANT);
        if (!ipDecision.allowed) {
          reply.header('Retry-After', String(ipDecision.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiados intentos de acceso. Por favor aguardá unos minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
      }

      const { staffUser } = await StaffService.login({
        restaurantSlug: restaurant.slug,
        pin: body.pin.trim()
      });
      const isTemporary = Boolean(body.isTemporary);
      const expiresIn = isTemporary ? '300s' : STAFF_JWT_EXPIRES_IN;
      const token = fastify.jwt.sign({
        sub: staffUser.id,
        role: staffUser.role,
        restaurantId: staffUser.restaurantId,
        assignedSector: staffUser.assignedSector,
        terminalId: body.terminalId,
        temp: isTemporary
      }, { expiresIn });

      return reply.send({
        token,
        staffUser,
        isTemporary,
        expiresInSeconds: isTemporary ? 300 : 43200
      });
    } catch (err: any) {
      return sendSanitizedError(reply, err);
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
      return sendSanitizedError(reply, err);
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
      return sendSanitizedError(reply, err);
    }
  });
}

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
      const body = request.body as StaffLoginDTO & {
        terminalId?: string;
        isTemporary?: boolean;
        purpose?: string;
        tableId?: string;
        sessionId?: string;
      };
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

      // Control de abuso: separación entre volumen de requests y presupuesto de fallos de PIN
      const ip = request.ip || 'unknown';
      const termId = body.terminalId?.trim();
      const ipReqKey = `login_req:tenant:${restaurant.id}:ip:${ip}`;
      const ipFailKey = `login_failures:tenant:${restaurant.id}:ip:${ip}`;

      // 1. Límite volumétrico anti-saturación DoS de solicitudes HTTP
      if (termId) {
        const termReqKey = `login_req:tenant:${restaurant.id}:term:${termId}`;
        const termReqDecision = await AbuseControlService.consume(termReqKey, AbusePolicies.LOGIN_REQUEST_BURST_TERM);
        if (!termReqDecision.allowed) {
          reply.header('Retry-After', String(termReqDecision.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiadas solicitudes desde este terminal. Por favor aguardá unos segundos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
        const ipReqDecision = await AbuseControlService.consume(ipReqKey, AbusePolicies.LOGIN_REQUEST_BURST_IP);
        if (!ipReqDecision.allowed) {
          reply.header('Retry-After', String(ipReqDecision.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiadas solicitudes desde esta red. Por favor aguardá unos segundos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }

        // 2. Comprobar si el terminal o la IP ya están en lockout por fallos de PIN previos
        const termFailKey = `login_failures:tenant:${restaurant.id}:term:${termId}`;
        const termFailCheck = await AbuseControlService.check(termFailKey, AbusePolicies.LOGIN_FAILURES_PER_TERMINAL);
        if (!termFailCheck.allowed) {
          reply.header('Retry-After', String(termFailCheck.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiados intentos de acceso desde este terminal. Por favor aguardá unos minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }

        const ipAggFailKey = `login_failures:tenant:${restaurant.id}:ip_agg:${ip}`;
        const ipAggCheck = await AbuseControlService.check(ipAggFailKey, AbusePolicies.LOGIN_FAILURES_IP_AGGREGATE);
        if (!ipAggCheck.allowed) {
          reply.header('Retry-After', String(ipAggCheck.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiados intentos fallidos acumulados en esta red. Por favor aguardá unos minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
      } else {
        const ipReqDecision = await AbuseControlService.consume(ipReqKey, AbusePolicies.LOGIN_REQUEST_BURST_IP);
        if (!ipReqDecision.allowed) {
          reply.header('Retry-After', String(ipReqDecision.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiadas solicitudes. Por favor aguardá unos segundos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
        const ipFailCheck = await AbuseControlService.check(ipFailKey, AbusePolicies.LOGIN_FAILURES_PER_IP);
        if (!ipFailCheck.allowed) {
          reply.header('Retry-After', String(ipFailCheck.retryAfterSeconds));
          return reply.status(429).send({
            error: 'Demasiados intentos de acceso. Por favor aguardá unos minutos.',
            code: 'RATE_LIMIT_EXCEEDED'
          });
        }
      }

      // 3. Ejecutar la autenticación
      let loginResult;
      try {
        loginResult = await StaffService.login({
          restaurantSlug: restaurant.slug,
          pin: body.pin.trim()
        });
      } catch (err: any) {
        // Contabilizar fallo atómico de credenciales sólo ante credenciales inválidas (401)
        if (err?.statusCode === 401 || err?.message?.includes('PIN') || err?.message?.includes('inválido')) {
          if (termId) {
            const termFailKey = `login_failures:tenant:${restaurant.id}:term:${termId}`;
            const ipAggFailKey = `login_failures:tenant:${restaurant.id}:ip_agg:${ip}`;
            await AbuseControlService.consume(termFailKey, AbusePolicies.LOGIN_FAILURES_PER_TERMINAL);
            await AbuseControlService.consume(ipAggFailKey, AbusePolicies.LOGIN_FAILURES_IP_AGGREGATE);
          } else {
            await AbuseControlService.consume(ipFailKey, AbusePolicies.LOGIN_FAILURES_PER_IP);
          }
        }
        throw err;
      }

      // 4. Si el login fue exitoso, limpiar fallos acumulados en este terminal
      if (termId) {
        const termFailKey = `login_failures:tenant:${restaurant.id}:term:${termId}`;
        await AbuseControlService.reset(termFailKey).catch(() => undefined);
      }

      const { staffUser } = loginResult;
      const isTemporary = Boolean(body.isTemporary);
      const expiresIn = isTemporary ? '300s' : STAFF_JWT_EXPIRES_IN;
      const token = fastify.jwt.sign({
        sub: staffUser.id,
        role: staffUser.role,
        restaurantId: staffUser.restaurantId,
        assignedSector: staffUser.assignedSector,
        terminalId: body.terminalId,
        temp: isTemporary,
        purpose: body.purpose,
        tableId: body.tableId,
        sessionId: body.sessionId
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

  /** Provisiona una credencial de hardware para un puesto de salón o estación de cocina */
  fastify.post('/staff/terminal/provision', async (request, reply) => {
    try {
      const body = request.body as {
        restaurantSlug?: string;
        pin?: string;
        terminalId?: string;
        mode?: string;
      };
      if (
        !body ||
        typeof body.restaurantSlug !== 'string' ||
        typeof body.pin !== 'string' ||
        typeof body.terminalId !== 'string' ||
        !body.restaurantSlug.trim() ||
        !body.pin.trim() ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(body.terminalId.trim())
      ) {
        return reply.status(400).send({ error: 'restaurantSlug, pin y terminalId válido son requeridos' });
      }

      const cleanSlug = body.restaurantSlug.trim();
      const restaurant = await prisma.restaurant.findFirst({
        where: { OR: [{ id: cleanSlug }, { slug: cleanSlug }] },
        select: { id: true, slug: true }
      });
      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }

      // Validar identidad del personal que autoriza la tablet
      const { staffUser } = await StaffService.login({
        restaurantSlug: restaurant.slug,
        pin: body.pin.trim()
      });

      const cleanTerminalId = body.terminalId.trim();
      const terminalToken = fastify.jwt.sign({
        sub: `term:${cleanTerminalId}`,
        role: 'TERMINAL',
        restaurantId: restaurant.id,
        terminalId: cleanTerminalId,
        mode: body.mode || 'SALON',
        isTerminalOnly: true,
        provisionedByStaffId: staffUser.id
      }, { expiresIn: '7d' });

      return reply.status(200).send({
        terminalToken,
        terminalId: cleanTerminalId,
        restaurantId: restaurant.id,
        mode: body.mode || 'SALON',
        role: 'TERMINAL',
        isTerminalOnly: true
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

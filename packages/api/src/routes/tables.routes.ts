import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { Sector, TableFSMState } from '@mesaya/shared';
import { verifyStaffToken, verifyManagerRole } from '../middlewares/auth.middleware';

export async function tableRoutes(fastify: FastifyInstance) {
  fastify.get('/restaurants/:id/tables', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: {
        OR: [{ id }, { slug: id }]
      }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }

    const tables = await prisma.table.findMany({
      where: { restaurantId: restaurant.id },
      include: {
        sessions: {
          where: { closedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      },
      orderBy: { label: 'asc' }
    });

    const formatted = tables.map(t => ({
      id: t.id,
      label: t.label,
      sector: t.sector as Sector,
      isOutdoor: t.isOutdoor,
      capacity: t.capacity,
      currentState: t.currentState as TableFSMState,
      activeToken: null,
      expiresAt: t.sessions[0]?.expiresAt || null
    }));

    return reply.send(formatted);
  });

  fastify.post('/restaurants/:id/tables', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { label, sector, isOutdoor } = request.body as {
        label: string;
        sector?: string;
        isOutdoor?: boolean;
      };

      if (!label) {
        return reply.status(400).send({ error: 'label requerido' });
      }

      const restaurant = await prisma.restaurant.findFirst({
        where: {
          OR: [{ id }, { slug: id }]
        }
      });

      if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      const table = await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          label,
          sector: sector || 'SALON_PRINCIPAL',
          isOutdoor: Boolean(isOutdoor)
        }
      });

      return reply.status(201).send(table);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message });
    }
  });

  fastify.post('/tables/:id/close-session', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { force } = (request.body as any) || {};

      const table = await prisma.table.findUnique({ where: { id } });
      if (!table || table.restaurantId !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      if (force && request.staffUser!.role !== 'MANAGER') {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          code: 'FORBIDDEN_FORCE_CLOSE',
          message: 'Se requieren permisos de encargado para forzar el cierre de una mesa.'
        });
      }

      const { SessionService } = await import('../services/session.service');
      const result = await SessionService.closeTableSession(id, { force: Boolean(force) });
      return reply.send(result);
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message, code: err.code });
    }
  });

  fastify.post('/tables/:id/new-session', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const table = await prisma.table.findUnique({ where: { id } });
      if (!table || table.restaurantId !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      const { SessionService } = await import('../services/session.service');
      const token = await SessionService.createNewSessionForTable(id);
      return reply.send({ success: true, token });
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message });
    }
  });

  fastify.delete('/tables/:id', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const table = await prisma.table.findUnique({ where: { id } });
      if (!table || table.restaurantId !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      await prisma.table.delete({ where: { id } });
      return reply.send({ success: true });
    } catch (err: any) {
      const code = err.statusCode || 500;
      return reply.status(code).send({ error: err.message });
    }
  });
}

import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { ShiftService } from '../services/shift.service';
import { verifyStaffToken, verifyManagerRole } from '../middlewares/auth.middleware';
import { sendSanitizedError } from '../lib/errorHandler';

export async function shiftRoutes(fastify: FastifyInstance) {
  fastify.post('/shifts/open', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { restaurantId } = request.body as { restaurantId: string };
      if (!restaurantId) {
        return reply.status(400).send({ error: 'restaurantId requerido' });
      }

      const rest = await prisma.restaurant.findFirst({
        where: { OR: [{ id: restaurantId }, { slug: restaurantId }] }
      });
      if (!rest || rest.id !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      const result = await ShiftService.openShift(rest.id);
      return reply.status(201).send({
        shift: result.shift,
        sessionsCount: result.sessionsCount
      });
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  fastify.post('/shifts/:id/close', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const { restaurantId } = request.body as { restaurantId: string };

      if (!restaurantId) {
        return reply.status(400).send({ error: 'restaurantId requerido' });
      }

      const rest = await prisma.restaurant.findFirst({
        where: { OR: [{ id: restaurantId }, { slug: restaurantId }] }
      });
      if (!rest || rest.id !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      const shift = await prisma.shift.findFirst({
        where: { id, restaurantId: rest.id }
      });
      if (!shift) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      const updated = await ShiftService.closeShift(id, rest.id);
      return reply.send(updated);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  fastify.get('/shifts/current', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    try {
      const { restaurantId } = request.query as { restaurantId: string };
      if (!restaurantId) {
        return reply.status(400).send({ error: 'restaurantId requerido' });
      }

      const rest = await prisma.restaurant.findFirst({
        where: { OR: [{ id: restaurantId }, { slug: restaurantId }] }
      });
      if (!rest || rest.id !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      const shift = await ShiftService.getCurrentShift(rest.id);
      return reply.send(shift || { active: false });
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });
}

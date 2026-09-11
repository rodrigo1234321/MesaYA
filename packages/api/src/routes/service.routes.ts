import { FastifyInstance } from 'fastify';
import { verifyStaffToken } from '../middlewares/auth.middleware';
import { ServiceTaskKind } from '@mesaya/shared';
import { ServiceTaskService } from '../services/service-task.service';
import { ServiceWorkspaceService } from '../services/service-workspace.service';

function staffContext(request: any) {
  return {
    staffUserId: request.staffUser?.sub || '',
    staffRestaurantId: request.staffUser?.restaurantId || '',
    staffRole: request.staffUser?.role || '',
    terminalId: request.staffUser?.terminalId || null
  };
}

export async function serviceRoutes(fastify: FastifyInstance) {
  /** Single polling boundary for the shared terminal: calls, kitchen, accounts and map. */
  fastify.get('/staff/restaurants/:id/service-workspace', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const snapshot = await ServiceWorkspaceService.getSnapshot(id, request.staffUser?.restaurantId);
      return reply.send(snapshot);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message, code: err.code });
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/claim', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      const claim = await ServiceTaskService.claimTask(taskType, targetId, staffContext(request));
      return reply.status(201).send(claim);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message, code: err.code, details: err.details });
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/release', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      return reply.send(await ServiceTaskService.releaseTask(taskType, targetId, staffContext(request)));
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message, code: err.code, details: err.details });
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/resolve', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      return reply.send(await ServiceTaskService.resolveTask(taskType, targetId, staffContext(request)));
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message, code: err.code, details: err.details });
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/act', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      const result = await ServiceTaskService.actTask(taskType, targetId, staffContext(request), (request.body as any) || {});
      return reply.send(result);
    } catch (err: any) {
      return reply.status(err.statusCode || 500).send({ error: err.message, code: err.code, details: err.details });
    }
  });
}

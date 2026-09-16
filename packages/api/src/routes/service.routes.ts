import { FastifyInstance } from 'fastify';
import { verifyStaffToken } from '../middlewares/auth.middleware';
import { ServiceTaskKind } from '@mesaya/shared';
import { ServiceTaskService } from '../services/service-task.service';
import { ServiceWorkspaceService } from '../services/service-workspace.service';
import { sendSanitizedError } from '../lib/errorHandler';
import { prisma } from '../lib/prisma';

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
      const isTerminalOnly = Boolean(request.staffUser?.isTerminalOnly || request.staffUser?.role === 'TERMINAL');
      const snapshot = await ServiceWorkspaceService.getSnapshot(id, request.staffUser?.restaurantId, isTerminalOnly);
      return reply.send(snapshot);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/claim', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      const claim = await ServiceTaskService.claimTask(taskType, targetId, staffContext(request));
      return reply.status(201).send(claim);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/release', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      return reply.send(await ServiceTaskService.releaseTask(taskType, targetId, staffContext(request)));
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/resolve', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      return reply.send(await ServiceTaskService.resolveTask(taskType, targetId, staffContext(request)));
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  fastify.post('/staff/service/tasks/:taskType/:targetId/act', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { taskType, targetId } = request.params as { taskType: ServiceTaskKind; targetId: string };
    try {
      const result = await ServiceTaskService.actTask(taskType, targetId, staffContext(request), (request.body as any) || {});
      return reply.send(result);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });

  /**
   * POST /v1/staff/restaurants/:id/service-tasks/act (E14 — segundo puesto).
   * Alias con alcance de restaurante para que el puesto de salón/cocina actúe
   * con la clave de tarea visible en el workspace (`task:ORDER_DELIVERY:<orderId>`)
   * y el verbo de UI (`SERVE_ORDER`). Delega en el comando atómico canónico
   * ORDER_DELIVERY/COMPLETE: READY_TO_SERVE -> SERVED + mesa -> EATING, con
   * aislamiento de tenant, idempotencia y arbitraje ya definidos en el servicio.
   * Listo no equivale a entregado: sólo SERVE_ORDER explícito sirve la comanda.
   */
  fastify.post('/staff/restaurants/:id/service-tasks/act', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const restaurant = await prisma.restaurant.findFirst({
        where: { OR: [{ id }, { slug: id }] },
        select: { id: true }
      });
      if (!restaurant) {
        const notFound: any = new Error('Restaurante no encontrado');
        notFound.statusCode = 404;
        notFound.code = 'RESTAURANT_NOT_FOUND';
        throw notFound;
      }
      if (restaurant.id !== request.staffUser?.restaurantId) {
        const forbidden: any = new Error('No autorizado para operar tareas de otro restaurante');
        forbidden.statusCode = 403;
        forbidden.code = 'STAFF_TENANT_MISMATCH';
        throw forbidden;
      }

      const body = (request.body as any) || {};
      const rawKey = String(body.taskKey || '');
      const cleanKey = rawKey.startsWith('task:') ? rawKey.slice('task:'.length) : rawKey;
      const separator = cleanKey.indexOf(':');
      const kind = separator === -1 ? '' : cleanKey.slice(0, separator);
      const targetId = separator === -1 ? '' : cleanKey.slice(separator + 1);
      if (kind !== 'ORDER_DELIVERY' || !targetId.trim()) {
        const invalid: any = new Error('Tarea inválida: se esperaba task:ORDER_DELIVERY:<orderId>');
        invalid.statusCode = 400;
        invalid.code = 'INVALID_SERVICE_TASK';
        throw invalid;
      }
      const action = String(body.action || '').toUpperCase();
      if (action !== 'SERVE_ORDER' && action !== 'COMPLETE') {
        const unsupported: any = new Error('Acción no soportada en este puesto: SERVE_ORDER');
        unsupported.statusCode = 422;
        unsupported.code = 'SERVICE_ACTION_NOT_SUPPORTED';
        throw unsupported;
      }

      const result = await ServiceTaskService.actTask('ORDER_DELIVERY', targetId.trim(), staffContext(request), { action: 'COMPLETE' });
      return reply.send(result);
    } catch (err: any) {
      return sendSanitizedError(reply, err);
    }
  });
}

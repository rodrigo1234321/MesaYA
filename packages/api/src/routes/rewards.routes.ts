import { FastifyPluginAsync } from 'fastify';
import { requireRestaurantAccess, verifyManagerRole } from '../middlewares/auth.middleware';
import { RewardsService } from '../services/rewards.service';
import { sendSanitizedError } from '../lib/errorHandler';

function bodyObject(body: unknown): Record<string, any> {
  return body && typeof body === 'object' ? body as Record<string, any> : {};
}

export const rewardsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { id: string }; Querystring: { phone?: string } }>(
    '/staff/restaurants/:id/rewards/customer',
    { preHandler: [requireRestaurantAccess((request) => (request.params as { id: string }).id)] },
    async (request, reply) => {
      try {
        const phone = request.query.phone || '';
        return reply.send(await RewardsService.getBalance(request.params.id, phone, true));
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/staff/restaurants/:id/rewards/items',
    { preHandler: [requireRestaurantAccess((request) => (request.params as { id: string }).id)] },
    async (request, reply) => {
      try {
        const items = await RewardsService.listRewardItems(request.params.id);
        return reply.send({ items });
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: Record<string, any> }>(
    '/staff/restaurants/:id/rewards/accrual',
    { preHandler: [requireRestaurantAccess((request) => (request.params as { id: string }).id)] },
    async (request, reply) => {
      const body = bodyObject(request.body);
      try {
        if (!Number.isInteger(body.points) || body.points <= 0) {
          return reply.status(400).send({ error: 'points debe ser un entero positivo', code: 'INVALID_POINTS_DELTA' });
        }
        const result = await RewardsService.accrue({
          restaurantId: request.params.id,
          phone: body.phone,
          points: body.points,
          reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Ajuste autorizado por personal',
          referenceType: typeof body.referenceType === 'string' ? body.referenceType.trim() : undefined,
          referenceId: typeof body.referenceId === 'string' ? body.referenceId.trim() : undefined,
          idempotencyKey: body.idempotencyKey
        });
        return reply.status(result.idempotentReplay ? 200 : 201).send(result);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: Record<string, any> }>(
    '/staff/restaurants/:id/rewards/redeem',
    { preHandler: [requireRestaurantAccess((request) => (request.params as { id: string }).id)] },
    async (request, reply) => {
      const body = bodyObject(request.body);
      try {
        const result = await RewardsService.redeem({
          restaurantId: request.params.id,
          phone: body.phone,
          rewardItemId: body.rewardItemId,
          approvedBy: request.staffUser!.sub,
          idempotencyKey: body.idempotencyKey
        });
        return reply.status(result.idempotentReplay ? 200 : 201).send(result);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string; redemptionId: string }; Body: Record<string, any> }>(
    '/staff/restaurants/:id/rewards/redemptions/:redemptionId/cancel',
    { preHandler: [verifyManagerRole] },
    async (request, reply) => {
      if (request.staffUser?.restaurantId !== request.params.id) {
        return reply.status(404).send({ error: 'NOT_FOUND', code: 'NOT_FOUND' });
      }
      const body = bodyObject(request.body);
      try {
        const result = await RewardsService.cancelRedemption({
          restaurantId: request.params.id,
          redemptionId: request.params.redemptionId,
          approvedBy: request.staffUser!.sub,
          reason: typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'Canje cancelado por encargado'
        });
        return reply.send(result);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  fastify.post<{ Params: { id: string }; Body: Record<string, any> }>(
    '/admin/restaurants/:id/rewards/items',
    { preHandler: [verifyManagerRole] },
    async (request, reply) => {
      if (request.staffUser?.restaurantId !== request.params.id) {
        return reply.status(404).send({ error: 'NOT_FOUND', code: 'NOT_FOUND' });
      }
      const body = bodyObject(request.body);
      try {
        const item = await RewardsService.createRewardItem({
          restaurantId: request.params.id,
          name: body.name,
          description: body.description,
          pointsCost: body.pointsCost
        });
        return reply.status(201).send(item);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );
};

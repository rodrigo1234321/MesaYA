import { FastifyPluginAsync } from 'fastify';
import { OrderService } from '../services/order.service';
import { prisma } from '../lib/prisma';
import { verifyStaffToken } from '../middlewares/auth.middleware';
import { AddOrderItemDTO, ClaimItemDTO, SplitMode, OrderStatus } from '@mesaya/shared';

export const orderRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/orders/session/:token
   * Obtiene la orden activa de una sesión de mesa tras validar la sesión activa.
   */
  fastify.get<{ Params: { token: string } }>(
    '/orders/session/:token',
    async (request, reply) => {
      try {
        const { token } = request.params;
        const result = await OrderService.getActiveOrderForGuest(token);
        return reply.send(result);
      } catch (err: any) {
        const status = err.statusCode || 500;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * GET /v1/orders/active
   * Snapshot de comanda activa del comensal a través del header x-session-token o query param.
   */
  fastify.get(
    '/orders/active',
    async (request, reply) => {
      const sessionToken =
        (request.headers['x-session-token'] as string) ||
        (request.query as any)?.sessionToken ||
        (request.query as any)?.token;

      if (!sessionToken) {
        return reply.status(401).send({ error: 'Token de sesión requerido', code: 'SESSION_TOKEN_REQUIRED' });
      }

      try {
        const result = await OrderService.getActiveOrderForGuest(sessionToken);
        return reply.send(result);
      } catch (err: any) {
        const status = err.statusCode || 500;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * POST /v1/orders/items
   * Agrega un ítem al carrito colaborativo de la mesa.
   */
  fastify.post<{ Body: AddOrderItemDTO }>(
    '/orders/items',
    async (request, reply) => {
      const body = request.body;
      try {
        const order = await OrderService.addItem(body);
        return reply.status(201).send(order);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * DELETE /v1/orders/items/:id
   * Elimina un ítem del carrito colaborativo (solo si la comanda está en DRAFT).
   */
  fastify.delete<{ Params: { id: string }; Headers: { 'x-session-token'?: string } }>(
    '/orders/items/:id',
    async (request, reply) => {
      const { id } = request.params;
      const sessionToken =
        request.headers['x-session-token'] ||
        (request.query as any)?.sessionToken ||
        (request.body as any)?.sessionToken;

      if (!sessionToken) {
        return reply.status(401).send({ error: 'Falta token de sesión', code: 'SESSION_TOKEN_REQUIRED' });
      }

      try {
        const order = await OrderService.removeItem(sessionToken, id);
        return reply.send(order);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * POST /v1/orders/submit
   * Envía la comanda a validación del mozo / cocina.
   * Idempotente: reintentos devuelven la orden activa sin duplicar líneas.
   */
  fastify.post<{ Body: { sessionToken: string } }>(
    '/orders/submit',
    async (request, reply) => {
      const { sessionToken } = request.body || {};
      if (!sessionToken) {
        return reply.status(400).send({ error: 'sessionToken requerido', code: 'SESSION_TOKEN_REQUIRED' });
      }
      try {
        const order = await OrderService.submitOrder(sessionToken);
        return reply.send(order);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * POST /v1/staff/orders/:id/validate
   * Mozo valida la comanda en salón (Doble control).
   */
  fastify.post<{ Params: { id: string } }>(
    '/staff/orders/:id/validate',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      const staffName = request.staffUser?.role === 'MANAGER' ? 'Encargado' : 'Mozo';
      try {
        const order = await OrderService.validateOrder(id, staffName, staffRestaurantId);
        return reply.send(order);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * GET /v1/staff/restaurants/:id/kitchen-orders
   * Consulta centralizada de todas las comandas activas para la pantalla de cocina (KDS).
   * Unifica pedidos realizados por comensales (QR) y pedidos cargados por los mozos en salón.
   */
  fastify.get<{ Params: { id: string } }>(
    '/staff/restaurants/:id/kitchen-orders',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      try {
        const orders = await OrderService.getKitchenOrders(id, staffRestaurantId);
        return reply.send({ orders });
      } catch (err: any) {
        const status = err.statusCode || 500;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * POST /v1/staff/tables/:tableId/orders/items
   * Mozo carga directamente platos a una mesa desde su celular o tablet del salón.
   */
  fastify.post<{
    Params: { tableId: string };
    Body: { menuItemId: string; quantity: number; notes?: string };
  }>(
    '/staff/tables/:tableId/orders/items',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { tableId } = request.params;
      const { menuItemId, quantity, notes } = request.body || ({} as any);

      if (!menuItemId || quantity === undefined) {
        return reply.status(400).send({ error: 'menuItemId y quantity son requeridos' });
      }

      try {
        const staffUserId = request.staffUser?.sub;
        const staffRestaurantId = request.staffUser?.restaurantId;
        const staffName = request.staffUser?.role === 'MANAGER' ? 'Encargado' : 'Mozo';

        const order = await OrderService.addItemByStaff({
          tableId,
          menuItemId,
          quantity,
          notes,
          staffUserId,
          staffName,
          staffRestaurantId
        });

        return reply.status(201).send(order);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * PATCH /v1/staff/orders/:id/status
   * Cocina o mozo actualiza el estado de la comanda (IN_KITCHEN -> READY_TO_SERVE -> SERVED).
   */
  fastify.patch<{
    Params: { id: string };
    Body: { status: OrderStatus; paymentMethod?: string; tipAmount?: number };
  }>(
    '/staff/orders/:id/status',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const { status, paymentMethod, tipAmount } = request.body || ({} as any);

      if (!status) {
        return reply.status(400).send({ error: 'status es requerido', code: 'STATUS_REQUIRED' });
      }

      try {
        const staffRestaurantId = request.staffUser?.restaurantId;
        const staffRole = request.staffUser?.role;
        const staffUserId = request.staffUser?.sub;

        const order = await OrderService.updateOrderStatusByStaff(id, status, {
          staffRestaurantId,
          staffRole,
          staffUserId,
          paymentMethod,
          tipAmount
        });
        return reply.send(order);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * POST /v1/staff/orders/:id/pay
   * Confirmación manual presencial de cobro por manager/encargado (WAITER_CASH / WAITER_CARD).
   */
  fastify.post<{
    Params: { id: string };
    Body: { paymentMethod?: string; tipAmount?: number };
  }>(
    '/staff/orders/:id/pay',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const { paymentMethod, tipAmount } = request.body || {};

      try {
        const staffRestaurantId = request.staffUser?.restaurantId;
        const staffRole = request.staffUser?.role;
        const staffUserId = request.staffUser?.sub;

        if (!staffRestaurantId || !staffRole || !staffUserId) {
          return reply.status(401).send({ error: 'Token de staff inválido', code: 'UNAUTHORIZED' });
        }

        const result = await OrderService.registerManualPayment({
          orderId: id,
          staffRestaurantId,
          staffRole,
          staffUserId,
          paymentMethod,
          tipAmount
        });
        return reply.send(result);
      } catch (err: any) {
        const status = err.statusCode || 400;
        return reply.status(status).send({ error: err.message, code: err.code });
      }
    }
  );

  /**
   * POST /v1/orders/items/claim
   * Bloqueado en piloto presencial: división de cuenta no disponible.
   */
  fastify.post<{ Body: ClaimItemDTO }>(
    '/orders/items/claim',
    async (_request, reply) => {
      return reply.status(503).send({
        error: 'Pagos digitales y división de cuenta no disponibles en el piloto presencial',
        code: 'DIGITAL_PAYMENTS_UNAVAILABLE'
      });
    }
  );

  /**
   * POST /v1/orders/:id/split-session
   * Bloqueado en piloto presencial: división de cuenta no disponible.
   */
  fastify.post<{ Params: { id: string }; Body: { mode: SplitMode; totalParts?: number } }>(
    '/orders/:id/split-session',
    async (_request, reply) => {
      return reply.status(503).send({
        error: 'Pagos digitales y división de cuenta no disponibles en el piloto presencial',
        code: 'DIGITAL_PAYMENTS_UNAVAILABLE'
      });
    }
  );

  /**
   * POST /v1/orders/split-session/:id/pay-part
   * Bloqueado en piloto presencial: pagos digitales no disponibles.
   */
  fastify.post<{ Params: { id: string }; Body: { guestSessionId: string; paymentMethod?: string } }>(
    '/orders/split-session/:id/pay-part',
    async (_request, reply) => {
      return reply.status(503).send({
        error: 'Pagos digitales y división de cuenta no disponibles en el piloto presencial',
        code: 'DIGITAL_PAYMENTS_UNAVAILABLE'
      });
    }
  );
};


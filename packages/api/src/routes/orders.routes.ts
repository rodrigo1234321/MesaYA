import { FastifyPluginAsync } from 'fastify';
import { OrderService } from '../services/order.service';
import { prisma } from '../lib/prisma';
import { verifyStaffToken, verifyManagerRole, verifySettlementAuthorization } from '../middlewares/auth.middleware';
import { AddOrderItemDTO, ClaimItemDTO, SplitMode, OrderStatus } from '@mesaya/shared';
import { sendSanitizedError } from '../lib/errorHandler';

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
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/orders/submit
   * Envía la comanda a validación del mozo / cocina.
   * Body: { sessionToken (requerido), idempotencyKey? (opcional, 1..200 chars) }.
   * Sin clave: comportamiento legado (reintento devuelve la orden activa).
   * Con clave (B06): una clave aceptada = una tanda; reintentos (doble clic,
   * timeout con respuesta perdida) devuelven la tanda original aunque ya haya un
   * borrador nuevo. Códigos: 200 OK | 400 EMPTY_ORDER/INVALID_SUBMIT_KEY |
   * 403 ORDERING_DISABLED | 404 SESSION_NOT_FOUND | 409 SUBMIT_KEY_REUSED,
   * ORDER_FINAL_STATE, SUBMIT_CONFLICT, DRAFT_CONFLICT | 410 SESSION_CLOSED,
   * SESSION_EXPIRED. Stock cambiado o cantidad fuera de umbral quedan como
   * PENDING_VALIDATION con reviewReason; agregar un plato ya no disponible sigue
   * devolviendo 422 ITEM_NOT_AVAILABLE. Respuesta: OrderDTO.
   */
  fastify.post<{ Body: { sessionToken: string; idempotencyKey?: string } }>(
    '/orders/submit',
    async (request, reply) => {
      const { sessionToken, idempotencyKey } = request.body || {};
      if (!sessionToken) {
        return reply.status(400).send({ error: 'sessionToken requerido', code: 'SESSION_TOKEN_REQUIRED' });
      }
      try {
        const order = await OrderService.submitOrder(sessionToken, { idempotencyKey });
        return reply.send(order);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/staff/orders/:id/reject
   * Rechazo explícito de una comanda pendiente de revisión (E05).
   * Body: { reason: string }. Repetir el mismo rechazo devuelve la comanda
   * cancelada sin crear otro efecto.
   */
  fastify.post<{ Params: { id: string }; Body: { reason?: string } }>(
    '/staff/orders/:id/reject',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const staffRestaurantId = request.staffUser?.restaurantId;
      const staffUserId = request.staffUser?.sub;
      try {
        const order = await OrderService.rejectOrder(id, request.body?.reason || '', {
          staffRestaurantId,
          staffUserId
        });
        return reply.send(order);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * GET /v1/staff/restaurants/:id/cash-orders
   * Snapshot para la caja presencial de la pantalla compartida.
   * `orders`: filas legadas por comanda (compatibilidad, DEPRECADO E01 como camino de
   * cobro; ver 04-CONTRATO-CANONICO-E01). `accounts`: cuenta agregada por sesión B03,
   * vía canónica (contrato 04-CONTRATO-CUENTA-B01 + E01); S08 elegirá la vista.
   */
  fastify.get<{ Params: { id: string } }>(
    '/staff/restaurants/:id/cash-orders',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const orders = await OrderService.getCashOrders(id, request.staffUser?.restaurantId);
        const accounts = await OrderService.getCashAccounts(id, request.staffUser?.restaurantId);
        return reply.send({ orders, accounts });
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/staff/sessions/:sessionId/settle
   * Camino NUEVO B04: liquidación presencial por CUENTA de TableSession
   * (contrato 04-CONTRATO-CUENTA-B01 C4). No reemplaza la vía legada por comanda;
   * consumidores futuros: caja contextual S08. Requiere MANAGER + idempotencyKey +
   * expectedAccountVersion. Nunca marca órdenes como PAID ni libera la mesa.
   */
  fastify.post<{
    Params: { sessionId: string };
    Body: {
      idempotencyKey: string;
      expectedAccountVersion: string;
      method: string;
      amountMinor?: number;
      tipMinor?: number;
      responsibleStaffUserId?: string;
      allocations?: Array<{ orderId: string; amountMinor: number }>;
    };
  }>(
    '/staff/sessions/:sessionId/settle',
    { preHandler: [verifySettlementAuthorization] },
    async (request, reply) => {
      const { sessionId } = request.params;
      const body = request.body || ({} as any);
      try {
        const result = await OrderService.settleSessionAccount({
          tableSessionId: sessionId,
          staffUserId: request.staffUser?.sub || '',
          staffRestaurantId: request.staffUser?.restaurantId || '',
          staffRole: request.staffUser?.role || '',
          method: body.method,
          idempotencyKey: body.idempotencyKey,
          expectedAccountVersion: body.expectedAccountVersion,
          responsibleStaffUserId: body.responsibleStaffUserId,
          amountMinor: body.amountMinor,
          tipMinor: body.tipMinor,
          allocations: body.allocations
        });
        return reply.status(result.idempotentReplay ? 200 : 201).send(result);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/staff/sessions/:sessionId/settle-and-close
   * Camino E03: comando atómico Cobrar y cerrar (contrato 04-CONTRATO-CANONICO-E01).
   * Revalida versión, registra el pago TOTAL idempotente, cierra la sesión, revoca el
   * token y pasa a TO_CLEAN con tarea de limpieza. Requiere MANAGER + idempotencyKey +
   * expectedAccountVersion. Para pagar y continuar en mesa usar /settle (sin cierre).
   */
  fastify.post<{
    Params: { sessionId: string };
    Body: {
      idempotencyKey: string;
      expectedAccountVersion: string;
      method: string;
      amountMinor?: number;
      tipMinor?: number;
      responsibleStaffUserId?: string;
      allocations?: Array<{ orderId: string; amountMinor: number }>;
    };
  }>(
    '/staff/sessions/:sessionId/settle-and-close',
    { preHandler: [verifySettlementAuthorization] },
    async (request, reply) => {
      const { sessionId } = request.params;
      const body = request.body || ({} as any);
      try {
        const result = await OrderService.settleAndCloseSessionAccount({
          tableSessionId: sessionId,
          staffUserId: request.staffUser?.sub || '',
          staffRestaurantId: request.staffUser?.restaurantId || '',
          staffRole: request.staffUser?.role || '',
          method: body.method,
          idempotencyKey: body.idempotencyKey,
          expectedAccountVersion: body.expectedAccountVersion,
          responsibleStaffUserId: body.responsibleStaffUserId,
          amountMinor: body.amountMinor,
          tipMinor: body.tipMinor,
          allocations: body.allocations
        });
        return reply.status(result.idempotentReplay ? 200 : 201).send(result);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
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
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/staff/tables/:tableId/orders
   * Pedido presencial completo: varias líneas, una tanda nueva, mismo KDS y
   * misma cuenta acumulada que los pedidos QR. La escritura es atómica.
   */
  fastify.post<{
    Params: { tableId: string };
    Body: { lines: Array<{ menuItemId: string; quantity: number; notes?: string }> };
  }>(
    '/staff/tables/:tableId/orders',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { tableId } = request.params;
      const lines = request.body?.lines;
      if (!Array.isArray(lines) || lines.length === 0) {
        return reply.status(400).send({ error: 'lines debe contener al menos un ítem', code: 'INVALID_MANUAL_ORDER' });
      }

      try {
        const order = await OrderService.addManualOrderByStaff({
          tableId,
          lines,
          staffUserId: request.staffUser?.sub,
          staffName: request.staffUser?.name,
          staffRestaurantId: request.staffUser?.restaurantId
        });
        return reply.status(201).send(order);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * PATCH /v1/staff/orders/:id/status
   * Cocina o mozo actualiza el estado de la comanda (IN_KITCHEN -> READY_TO_SERVE -> SERVED).
   */
  fastify.patch<{
    Params: { id: string };
    Body: { status: OrderStatus; paymentMethod?: string; tipAmount?: number; reason?: string };
  }>(
    '/staff/orders/:id/status',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      const { id } = request.params;
      const { status, paymentMethod, tipAmount, reason } = request.body || ({} as any);

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
          tipAmount,
          reason
        });
        return reply.send(order);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/staff/orders/:id/pay — DEPRECADO (E01).
   * Cobro legado por comanda. Conservado sólo por compatibilidad histórica; el camino
   * normal es la cuenta por sesión (`POST /v1/staff/sessions/:sessionId/settle` y
   * `settle-and-close`, contrato 04-CONTRATO-CANONICO-E01). No usar en flujos nuevos.
   */
  fastify.post<{
    Params: { id: string };
    Body: { paymentMethod?: string; tipAmount?: number; idempotencyKey?: string; customerPhone?: string };
  }>(
    '/staff/orders/:id/pay',
    { preHandler: [verifyStaffToken] },
    async (request, reply) => {
      // E01: deprecado sin fecha Sunset comprometida. No se anuncia Sunset
      // porque no hay una fecha de retiro aprobada; eliminarlo requiere
      // decisión explícita posterior, no una fecha inventada.
      reply.header('Deprecation', 'true');
      request.log.warn(
        { route: '/v1/staff/orders/:id/pay', deprecated: true, canonical: '/v1/staff/sessions/:sessionId/settle' },
        'E01: cobro por comanda deprecado; usar cuenta por sesión'
      );
      const { id } = request.params;
      const { paymentMethod, tipAmount, idempotencyKey, customerPhone } = request.body || {};

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
          tipAmount,
          idempotencyKey,
          customerPhone
        });
        return reply.send(result);
      } catch (err: any) {
        return sendSanitizedError(reply, err);
      }
    }
  );

  /**
   * POST /v1/orders/items/claim
   * No disponible en la release base: la división de cuenta requiere una pasarela digital.
   */
  fastify.post<{ Body: ClaimItemDTO }>(
    '/orders/items/claim',
    async (_request, reply) => {
      return reply.status(503).send({
        error: 'Pagos digitales y división de cuenta no disponibles en esta release; el cobro es presencial',
        code: 'DIGITAL_PAYMENTS_UNAVAILABLE'
      });
    }
  );

  /**
   * POST /v1/orders/:id/split-session
   * No disponible en la release base: la división de cuenta requiere una pasarela digital.
   */
  fastify.post<{ Params: { id: string }; Body: { mode: SplitMode; totalParts?: number } }>(
    '/orders/:id/split-session',
    async (_request, reply) => {
      return reply.status(503).send({
        error: 'Pagos digitales y división de cuenta no disponibles en esta release; el cobro es presencial',
        code: 'DIGITAL_PAYMENTS_UNAVAILABLE'
      });
    }
  );

  /**
   * POST /v1/orders/split-session/:id/pay-part
   * No disponible en la release base: pagos digitales autónomos no están configurados.
   */
  fastify.post<{ Params: { id: string }; Body: { guestSessionId: string; paymentMethod?: string } }>(
    '/orders/split-session/:id/pay-part',
    async (_request, reply) => {
      return reply.status(503).send({
        error: 'Pagos digitales y división de cuenta no disponibles en esta release; el cobro es presencial',
        code: 'DIGITAL_PAYMENTS_UNAVAILABLE'
      });
    }
  );
};

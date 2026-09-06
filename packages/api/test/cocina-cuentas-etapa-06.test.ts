import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

describe('COCINA-CUENTAS Etapa 06 — Admin Modos, KDS Operativo, Sincronización de Tandas y Gestión de Agotados', () => {
  let app: FastifyInstance;

  // Tenant A: Pizzería Bella Napoli
  let restA: any;
  let shiftA: any;
  let tableA1: any;
  let sessionA1: any;
  let catA: any;
  let itemMuzzarella: any;
  let itemFugazzeta: any;
  let staffWaiterA: any;
  let tokenWaiterA: string;
  let staffManagerA: any;
  let tokenManagerA: string;

  // Tenant B: Burger Joint Beta (aislamiento)
  let restB: any;
  let shiftB: any;
  let tableB1: any;
  let sessionB1: any;
  let catB: any;
  let itemBacon: any;
  let staffWaiterB: any;
  let tokenWaiterB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    // 1. Setup Tenant A
    restA = await prisma.restaurant.create({
      data: {
        name: 'Pizzería Bella Napoli',
        slug: `test-napoli-${timestamp}`,
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
      }
    });

    shiftA = await prisma.shift.create({
      data: { restaurantId: restA.id, activeKey: restA.id }
    });

    tableA1 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa A1',
        currentState: TableFSMState.OCCUPIED_NO_ORDER
      }
    });

    sessionA1 = await prisma.tableSession.create({
      data: {
        tableId: tableA1.id,
        shiftId: shiftA.id,
        token: `session-napoli-${timestamp}`,
        activeKey: tableA1.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });

    catA = await prisma.menuCategory.create({
      data: { restaurantId: restA.id, name: 'Pizzas al Horno', orderIndex: 0 }
    });

    itemMuzzarella = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Pizza Muzzarella',
        price: 8500,
        priceCents: 850000,
        isAvailable: true
      }
    });

    itemFugazzeta = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Pizza Fugazzeta Rellena',
        price: 11000,
        priceCents: 1100000,
        isAvailable: true
      }
    });

    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Mario A',
        pinHash: await bcrypt.hash('1234', 10),
        role: 'WAITER'
      }
    });

    staffManagerA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Encargado Luigi A',
        pinHash: await bcrypt.hash('5678', 10),
        role: 'MANAGER'
      }
    });

    const loginWaiterA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '1234' }
    });
    tokenWaiterA = loginWaiterA.json().token;

    const loginManagerA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '5678' }
    });
    tokenManagerA = loginManagerA.json().token;

    // 2. Setup Tenant B
    restB = await prisma.restaurant.create({
      data: {
        name: 'Burger Joint Beta',
        slug: `test-burger-${timestamp}`,
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false
          }
        }
      }
    });

    shiftB = await prisma.shift.create({
      data: { restaurantId: restB.id, activeKey: restB.id }
    });

    tableB1 = await prisma.table.create({
      data: {
        restaurantId: restB.id,
        label: 'Mesa B1',
        currentState: TableFSMState.OCCUPIED_NO_ORDER
      }
    });

    sessionB1 = await prisma.tableSession.create({
      data: {
        tableId: tableB1.id,
        shiftId: shiftB.id,
        token: `session-burger-${timestamp}`,
        activeKey: tableB1.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });

    catB = await prisma.menuCategory.create({
      data: { restaurantId: restB.id, name: 'Hamburguesas', orderIndex: 0 }
    });

    itemBacon = await prisma.menuItem.create({
      data: {
        categoryId: catB.id,
        name: 'Bacon Double Burger',
        price: 9000,
        priceCents: 900000,
        isAvailable: true
      }
    });

    staffWaiterB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo Beta',
        pinHash: await bcrypt.hash('9999', 10),
        role: 'WAITER'
      }
    });

    const loginWaiterB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '9999' }
    });
    tokenWaiterB = loginWaiterB.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. KDS centralizado y visualización de órdenes CONFIRMED', () => {
    it('Muestra comandas en estado CONFIRMED en el listado de cocina (KDS)', async () => {
      // Creamos participante y tanda en Tenant A (requireWaiterValidation: true -> status CONFIRMED)
      const joinRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionA1.token, displayName: 'Comensal Gourmet' }
      });
      expect(joinRes.statusCode).toBe(201);
      const participantToken = joinRes.json().participantToken;

      const tandaRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionA1.token,
          participantToken,
          idempotencyKey: `kds-test-${Date.now()}`,
          notes: 'Mesa con niño celiaco: sin tacc por favor',
          items: [{ menuItemId: itemMuzzarella.id, quantity: 2, notes: 'Sin tacc / celíaco' }]
        }
      });
      expect(tandaRes.statusCode).toBe(201);
      expect(tandaRes.json().status).toBe('CONFIRMED');

      // Consultar KDS
      const kdsRes = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(kdsRes.statusCode).toBe(200);
      const orders = kdsRes.json().orders;
      expect(Array.isArray(orders)).toBe(true);

      const found = orders.find((o: any) => o.tableId === tableA1.id);
      expect(found).toBeDefined();
      expect(found.status).toBe(OrderStatus.CONFIRMED);
      expect(found.items.length).toBeGreaterThanOrEqual(1);

      const item = found.items.find((i: any) => i.name === 'Pizza Muzzarella');
      expect(item).toBeDefined();
      expect(item.quantity).toBe(2);
      expect(item.participantName).toBe('Comensal Gourmet');
      expect(item.notes).toContain('celíaco');
    });

    it('Rechaza consulta de KDS a staff de otro tenant con 403 STAFF_TENANT_MISMATCH', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
    });

    it('Rechaza consulta de KDS anónima sin token con 401', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('2. Sincronización de ciclo de vida FSM entre Order y OrderTanda', () => {
    let orderToValidate: any;

    beforeAll(async () => {
      orderToValidate = await prisma.order.findFirst({
        where: { tableSessionId: sessionA1.id, status: OrderStatus.CONFIRMED }
      });
      expect(orderToValidate).toBeTruthy();
    });

    it('Validar orden por staff (validateOrder) transiciona orden y tandas a IN_KITCHEN', async () => {
      const valRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderToValidate.id}/validate`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(valRes.statusCode).toBe(200);
      expect(valRes.json().status).toBe(OrderStatus.IN_KITCHEN);

      // Verificar que las tandas de la sesión ahora están en IN_KITCHEN
      const tandas = await prisma.orderTanda.findMany({
        where: { tableSessionId: sessionA1.id }
      });
      expect(tandas.length).toBeGreaterThanOrEqual(1);
      for (const t of tandas) {
        expect(t.status).toBe('IN_KITCHEN');
      }
    });

    it('Avanzar orden a READY_TO_SERVE y luego SERVED transiciona tandas a SERVED', async () => {
      // 1. IN_KITCHEN -> READY_TO_SERVE
      const readyRes = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderToValidate.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.READY_TO_SERVE }
      });
      expect(readyRes.statusCode).toBe(200);
      expect(readyRes.json().status).toBe(OrderStatus.READY_TO_SERVE);

      // 2. READY_TO_SERVE -> SERVED
      const servedRes = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderToValidate.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.SERVED }
      });
      expect(servedRes.statusCode).toBe(200);
      expect(servedRes.json().status).toBe(OrderStatus.SERVED);

      // Verificar que las tandas pasaron a SERVED
      const tandas = await prisma.orderTanda.findMany({
        where: { tableSessionId: sessionA1.id }
      });
      for (const t of tandas) {
        expect(t.status).toBe('SERVED');
      }
    });

    it('Cancelar / rechazar comanda transiciona orden y tandas activas a CANCELLED', async () => {
      // Creamos una nueva tanda para probar cancelación
      const joinRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionB1.token, displayName: 'Comensal Cancelar' }
      });
      const participantToken = joinRes.json().participantToken;

      const tandaRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionB1.token,
          participantToken,
          idempotencyKey: `cancel-test-${Date.now()}`,
          items: [{ menuItemId: itemBacon.id, quantity: 1 }]
        }
      });
      expect(tandaRes.statusCode).toBe(201);

      const orderB = await prisma.order.findFirst({
        where: { tableSessionId: sessionB1.id, status: OrderStatus.IN_KITCHEN }
      });
      expect(orderB).toBeTruthy();

      const cancelRes = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderB!.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { status: OrderStatus.CANCELLED }
      });
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().status).toBe(OrderStatus.CANCELLED);

      const tandasB = await prisma.orderTanda.findMany({
        where: { tableSessionId: sessionB1.id }
      });
      for (const t of tandasB) {
        expect(t.status).toBe('CANCELLED');
      }
    });
  });

  describe('3. Gestión de Platos Agotados (Stock 86) por Personal', () => {
    it('Permite al staff marcar un plato como agotado (isAvailable: false)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/restaurants/${restA.id}/menu/items/${itemFugazzeta.id}/availability`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { isAvailable: false }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().isAvailable).toBe(false);
      expect(res.json().id).toBe(itemFugazzeta.id);

      const updated = await prisma.menuItem.findUnique({ where: { id: itemFugazzeta.id } });
      expect(updated?.isAvailable).toBe(false);
    });

    it('Rechaza el pedido de un comensal para un plato agotado con 409 ITEM_UNAVAILABLE', async () => {
      const joinRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionA1.token, displayName: 'Comensal Deseo' }
      });
      const participantToken = joinRes.json().participantToken;

      const orderAttempt = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionA1.token,
          participantToken,
          idempotencyKey: `fugazzeta-attempt-${Date.now()}`,
          items: [{ menuItemId: itemFugazzeta.id, quantity: 1 }]
        }
      });
      expect(orderAttempt.statusCode).toBe(409);
      expect(orderAttempt.json().code).toBe('ITEM_UNAVAILABLE');
    });

    it('Permite al staff reactivar el plato disponible nuevamente (isAvailable: true)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/restaurants/${restA.id}/menu/items/${itemFugazzeta.id}/availability`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { isAvailable: true }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().isAvailable).toBe(true);

      const updated = await prisma.menuItem.findUnique({ where: { id: itemFugazzeta.id } });
      expect(updated?.isAvailable).toBe(true);
    });

    it('Rechaza modificación de disponibilidad por staff de otro tenant con 403 STAFF_TENANT_MISMATCH', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/restaurants/${restA.id}/menu/items/${itemFugazzeta.id}/availability`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { isAvailable: false }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
    });

    it('Rechaza actualización con 404 si el ítem pertenece a otro restaurante', async () => {
      // Intentar actualizar itemBacon (de Rest B) con el ID de Rest A en la URL
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/restaurants/${restA.id}/menu/items/${itemBacon.id}/availability`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { isAvailable: false }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('ITEM_NOT_FOUND');
    });

    it('Rechaza payload inválido con 400 INVALID_PAYLOAD', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/restaurants/${restA.id}/menu/items/${itemFugazzeta.id}/availability`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { isAvailable: 'not-a-boolean' }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_PAYLOAD');
    });

    it('Rechaza actualización anónima con 401', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/restaurants/${restA.id}/menu/items/${itemFugazzeta.id}/availability`,
        payload: { isAvailable: true }
      });
      expect(res.statusCode).toBe(401);
    });
  });
});

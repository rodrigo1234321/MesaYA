import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderService } from '../src/services/order.service';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

/**
 * C05 — historial de tandas separado del borrador.
 * La fuente de verdad es la sesión: la respuesta pública conserva cada envío,
 * incluidos los pendientes y cancelados, pero no expone el DRAFT como historia.
 */
describe('C05 — historial público por ronda y estados de envío', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let shift: any;
  let category: any;

  async function createSession(label: string) {
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `C05 ${label} ${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    return { table, session };
  }

  async function createItem(name: string, price: number) {
    return prisma.menuItem.create({
      data: { categoryId: category.id, name, price, isAvailable: true }
    });
  }

  async function createOrder(sessionId: string, itemId: string, status: OrderStatus, price: number, ageMs: number) {
    return prisma.order.create({
      data: {
        tableSessionId: sessionId,
        status,
        totalAmount: price,
        createdAt: new Date(Date.now() - ageMs),
        items: {
          create: [{
            menuItemId: itemId,
            quantity: 1,
            unitPrice: price,
            addedByGuest: 'c05-fixture'
          }]
        }
      }
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    restaurant = await prisma.restaurant.create({
      data: {
        name: 'C05 history',
        slug: `c05-history-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'C05 carta', orderIndex: 0 }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('conserva tres rondas y excluye el nuevo borrador del historial', async () => {
    const { session } = await createSession('tres rondas');
    const firstItem = await createItem('Primera ronda', 1000);
    const pendingItem = await createItem('Pendiente', 2000);
    const rejectedItem = await createItem('Rechazado', 3000);
    await createOrder(session.id, firstItem.id, OrderStatus.IN_KITCHEN, 1000, 3000);
    await createOrder(session.id, pendingItem.id, OrderStatus.PENDING_VALIDATION, 2000, 2000);
    await createOrder(session.id, rejectedItem.id, OrderStatus.CANCELLED, 3000, 1000);
    const draft = await createOrder(session.id, firstItem.id, OrderStatus.DRAFT, 1000, 0);

    const history = await OrderService.getSessionOrderHistory(session.id);
    expect(history).toHaveLength(3);
    expect(history.map((round) => round.status)).toEqual([
      OrderStatus.IN_KITCHEN,
      OrderStatus.PENDING_VALIDATION,
      OrderStatus.CANCELLED
    ]);
    expect(history.map((round) => round.orderId)).not.toContain(draft.id);
    expect(history[1].items[0]).toMatchObject({ name: 'Pendiente', quantity: 1, lineTotalMinor: 200000 });

    const response = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.order.id).toBe(draft.id);
    expect(body.order.status).toBe(OrderStatus.DRAFT);
    expect(body.history.map((round: any) => round.status)).toEqual(history.map((round) => round.status));
    expect(body.history[0].items[0]).not.toHaveProperty('addedByGuest');
    expect(body.account.consumoMinor).toBe(100000);
    expect(body.account.pendingValidation).toHaveLength(1);
  });

  it('distingue validación requerida de envío directo y se actualiza al reabrir', async () => {
    const required = await createSession('validación');
    const requiredItem = await createItem('Valida al mozo', 1200);
    await OrderService.addItem({
      sessionToken: required.session.token,
      guestSessionId: 'c05-required',
      menuItemId: requiredItem.id,
      quantity: 1
    });
    const pending = await OrderService.submitOrder(required.session.token, { idempotencyKey: `c05-pending-${randomUUID()}` });
    let reopened = await app.inject({ method: 'GET', url: `/v1/orders/session/${required.session.token}` });
    expect(reopened.json().history.find((round: any) => round.orderId === pending.id).status).toBe(OrderStatus.PENDING_VALIDATION);

    await OrderService.validateOrder(pending.id, 'Mozo', restaurant.id);
    reopened = await app.inject({ method: 'GET', url: `/v1/orders/session/${required.session.token}` });
    expect(reopened.json().history.find((round: any) => round.orderId === pending.id).status).toBe(OrderStatus.IN_KITCHEN);

    const directRestaurant = await prisma.restaurant.create({
      data: {
        name: 'C05 direct',
        slug: `c05-direct-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#0ea5e9',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: false } }
      }
    });
    const directShift = await prisma.shift.create({ data: { restaurantId: directRestaurant.id, openedAt: new Date() } });
    const directTable = await prisma.table.create({
      data: {
        restaurantId: directRestaurant.id,
        label: `C05 direct ${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    const directSession = await prisma.tableSession.create({
      data: {
        tableId: directTable.id,
        shiftId: directShift.id,
        token: randomUUID(),
        activeKey: directTable.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    const directCategory = await prisma.menuCategory.create({
      data: { restaurantId: directRestaurant.id, name: 'C05 directo', orderIndex: 0 }
    });
    const directItem = await prisma.menuItem.create({
      data: { categoryId: directCategory.id, name: 'Directo cocina', price: 900, isAvailable: true }
    });
    await OrderService.addItem({
      sessionToken: directSession.token,
      guestSessionId: 'c05-direct',
      menuItemId: directItem.id,
      quantity: 1
    });
    const directOrder = await OrderService.submitOrder(directSession.token, { idempotencyKey: `c05-direct-${randomUUID()}` });
    expect(directOrder.status).toBe(OrderStatus.IN_KITCHEN);
    const directReopen = await app.inject({ method: 'GET', url: `/v1/orders/session/${directSession.token}` });
    expect(directReopen.json().history[0].status).toBe(OrderStatus.IN_KITCHEN);
  });

  it('muestra rechazo de una ronda sin ocultar la ronda aceptada restante', async () => {
    const { session } = await createSession('rechazo parcial');
    const acceptedItem = await createItem('Queda aceptado', 1500);
    const rejectedItem = await createItem('Se rechaza', 1800);
    const accepted = await createOrder(session.id, acceptedItem.id, OrderStatus.IN_KITCHEN, 1500, 2000);
    const rejected = await createOrder(session.id, rejectedItem.id, OrderStatus.IN_KITCHEN, 1800, 1000);

    await OrderService.updateOrderStatusByStaff(rejected.id, OrderStatus.CANCELLED, {
      staffRestaurantId: restaurant.id,
      staffRole: 'MANAGER',
      staffUserId: 'c05-manager',
      reason: 'Ingrediente agotado; ofrecer alternativa'
    });

    const response = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.history.map((round: any) => round.status)).toEqual([
      OrderStatus.IN_KITCHEN,
      OrderStatus.CANCELLED
    ]);
    expect(body.history.find((round: any) => round.orderId === rejected.id).items[0].name).toBe('Se rechaza');
    expect(body.history.find((round: any) => round.orderId === rejected.id).cancellationReason).toBe('Ingrediente agotado; ofrecer alternativa');
    expect(body.account.tandas.map((round: any) => round.orderId)).toEqual([accepted.id]);
    expect(body.account.consumoMinor).toBe(150000);
  });
});

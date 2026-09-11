import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

describe('E13 — carrito colaborativo con identidad legible', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let shift: any;
  let menuItem: any;
  let waiterToken: string;

  async function createSession(label: string) {
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `${label}-${randomUUID().slice(0, 6)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    return prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'E13 Colaborativo',
        slug: `e13-collaboration-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#4f46e5',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false,
            reviewQuantityThreshold: 6,
            enableUpsell: false
          }
        }
      }
    });
    shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'E13 bebidas' } });
    menuItem = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Gin E13', price: 1200, isAvailable: true }
    });

    const waiter = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo E13',
        pinHash: await bcrypt.hash('6113', 10),
        role: 'WAITER'
      }
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '6113', terminalId: 'e13-terminal' }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().staffUser.id).toBe(waiter.id);
    waiterToken = login.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('guarda el nombre separado de la nota y no expone el identificador técnico', async () => {
    const session = await createSession('E13 nombre');
    const added = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken: session.token,
        guestSessionId: 'guest-e13-technical-id',
        menuItemId: menuItem.id,
        quantity: 1,
        guestName: '  Ana  ',
        notes: 'Sin cebolla'
      }
    });

    expect(added.statusCode).toBe(201);
    const addedBody = added.json();
    expect(addedBody.items[0]).toEqual(expect.objectContaining({ guestName: 'Ana', notes: 'Sin cebolla' }));
    expect(addedBody.items[0]).not.toHaveProperty('addedByGuest');
    expect(addedBody).not.toHaveProperty('createdByStaffUserId');

    const stored = await prisma.orderItem.findFirstOrThrow({ where: { order: { tableSessionId: session.id } } });
    expect(stored.guestName).toBe('Ana');
    expect(stored.notes).toBe('Sin cebolla');
    expect(stored.addedByGuest).toBe('guest-e13-technical-id');

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/orders/submit',
      payload: { sessionToken: session.token, idempotencyKey: `e13-${randomUUID()}` }
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe(OrderStatus.IN_KITCHEN);

    const guestView = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(guestView.statusCode).toBe(200);
    expect(guestView.json().order.items[0]).toEqual(expect.objectContaining({ guestName: 'Ana', notes: 'Sin cebolla' }));
    expect(guestView.json().order.items[0]).not.toHaveProperty('addedByGuest');

    const staffView = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(staffView.statusCode).toBe(200);
    const task = staffView.json().tasks.find((candidate: any) => candidate.targetId === submitted.json().id);
    expect(task).toEqual(expect.objectContaining({ kind: 'ORDER_PREPARATION' }));
    expect(task.payload.items[0].participant).toEqual({ kind: 'GUEST', label: 'Ana' });
    expect(JSON.stringify(task)).not.toContain('guest-e13-technical-id');

    const kitchen = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurant.id}/kitchen-orders`,
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(kitchen.statusCode).toBe(200);
    expect(kitchen.json().orders.find((order: any) => order.id === submitted.json().id).items[0].guestName).toBe('Ana');
  });

  it('rechaza nombre no válido o mayor a 40 sin truncar ni crear una línea parcial', async () => {
    const session = await createSession('E13 límite');
    const before = await prisma.orderItem.count({ where: { order: { tableSessionId: session.id } } });
    const tooLong = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken: session.token,
        guestSessionId: 'guest-e13-limit',
        menuItemId: menuItem.id,
        quantity: 1,
        guestName: 'x'.repeat(41)
      }
    });
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual(expect.objectContaining({ code: 'GUEST_NAME_TOO_LONG' }));

    const wrongType = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken: session.token,
        guestSessionId: 'guest-e13-type',
        menuItemId: menuItem.id,
        quantity: 1,
        guestName: 42
      }
    });
    expect(wrongType.statusCode).toBe(400);
    expect(wrongType.json()).toEqual(expect.objectContaining({ code: 'INVALID_GUEST_NAME' }));
    expect(await prisma.orderItem.count({ where: { order: { tableSessionId: session.id } } })).toBe(before);
  });
});

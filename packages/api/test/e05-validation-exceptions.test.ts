import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { ConfigService } from '../src/services/config.service';
import { OrderService } from '../src/services/order.service';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

describe('E05 — validación por excepción', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let shift: any;
  let category: any;
  let gin: any;
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

  async function add(sessionToken: string, quantity: number, notes?: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken,
        guestSessionId: `guest-${randomUUID()}`,
        menuItemId: gin.id,
        quantity,
        ...(notes ? { notes } : {})
      }
    });
    expect(response.statusCode).toBe(201);
    return response.json();
  }

  async function submit(sessionToken: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/submit',
      payload: { sessionToken, idempotencyKey: `e05-${randomUUID()}` }
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function serviceSnapshot() {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'E05 Excepciones',
        slug: `e05-exceptions-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#4f46e5',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false,
            reviewQuantityThreshold: 2
          }
        }
      }
    });
    shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'E05 bebidas' } });
    gin = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Gin E05', price: 1000, isAvailable: true }
    });
    const waiter = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo E05',
        pinHash: await bcrypt.hash('6105', 10),
        role: 'WAITER'
      }
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '6105', terminalId: 'e05-terminal' }
    });
    expect(login.statusCode).toBe(200);
    expect(login.json().staffUser.id).toBe(waiter.id);
    waiterToken = login.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('envía cantidades normales y conserva la alergia como contexto informativo', async () => {
    const one = await createSession('E05 uno');
    await add(one.token, 1);
    const oneOrder = await submit(one.token);
    expect(oneOrder.status).toBe(OrderStatus.IN_KITCHEN);
    expect(oneOrder.reviewReason).toBeNull();

    const two = await createSession('E05 dos');
    await add(two.token, 2);
    const twoOrder = await submit(two.token);
    expect(twoOrder.status).toBe(OrderStatus.IN_KITCHEN);
    expect(twoOrder.reviewReason).toBeNull();

    const allergy = await createSession('E05 alergia');
    await add(allergy.token, 1, 'Alergia al gluten; carta validada');
    const allergyOrder = await submit(allergy.token);
    expect(allergyOrder.status).toBe(OrderStatus.IN_KITCHEN);
    const snapshot = await serviceSnapshot();
    const task = snapshot.tasks.find((candidate: any) => candidate.targetId === allergyOrder.id);
    expect(task?.kind).toBe('ORDER_PREPARATION');
    expect(task?.payload.allergenNotes).toEqual(['Alergia al gluten; carta validada']);
    expect(task?.payload.reviewReason).toBeUndefined();
  });

  it('genera revisión por umbral, acepta de forma idempotente y limpia el motivo al enviar', async () => {
    const session = await createSession('E05 umbral');
    await add(session.token, 3);
    const pending = await submit(session.token);
    expect(pending.status).toBe(OrderStatus.PENDING_VALIDATION);
    expect(pending.reviewReason).toEqual(expect.objectContaining({ code: 'QUANTITY_THRESHOLD' }));

    const snapshot = await serviceSnapshot();
    const reviewTask = snapshot.tasks.find((candidate: any) => candidate.targetId === pending.id);
    expect(reviewTask).toEqual(expect.objectContaining({ kind: 'ORDER_VALIDATION' }));
    expect(reviewTask.payload.reviewReason.code).toBe('QUANTITY_THRESHOLD');

    const first = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${pending.id}/validate`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: {}
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${pending.id}/validate`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: {}
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().status).toBe(OrderStatus.IN_KITCHEN);
    expect(second.json().status).toBe(OrderStatus.IN_KITCHEN);

    const stored = await prisma.order.findUniqueOrThrow({ where: { id: pending.id } });
    expect(stored.reviewReasonCode).toBeNull();
    expect(stored.reviewReasonDetail).toBeNull();
  });

  it('persiste stock cambiado como revisión, no lo acepta mientras siga agotado y permite rechazo idempotente sin cobro', async () => {
    const session = await createSession('E05 stock');
    await add(session.token, 1);
    await prisma.menuItem.update({ where: { id: gin.id }, data: { isAvailable: false } });

    const pending = await submit(session.token);
    expect(pending.status).toBe(OrderStatus.PENDING_VALIDATION);
    expect(pending.reviewReason).toEqual(expect.objectContaining({ code: 'STOCK_UNAVAILABLE' }));

    const blocked = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${pending.id}/validate`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: {}
    });
    expect(blocked.statusCode).toBe(422);
    expect(blocked.json().code).toBe('ITEM_NOT_AVAILABLE');

    const rejected = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${pending.id}/reject`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { reason: 'Stock confirmado como agotado' }
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().status).toBe(OrderStatus.CANCELLED);
    expect(rejected.json().cancellationReason).toBe('Stock confirmado como agotado');

    const replay = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${pending.id}/reject`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { reason: 'Otro texto que no debe sobrescribir' }
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().status).toBe(OrderStatus.CANCELLED);
    expect(replay.json().cancellationReason).toBe('Stock confirmado como agotado');

    const account = await OrderService.getSessionAccount(session.id);
    expect(account.consumoMinor).toBe(0);
    expect(account.pendingValidation).toHaveLength(0);
    expect(await prisma.paymentTransaction.count({ where: { orderId: pending.id } })).toBe(0);
    await prisma.menuItem.update({ where: { id: gin.id }, data: { isAvailable: true } });
  });

  it('el modo manual global sigue siendo auditable y genera revisión aunque la cantidad sea normal', async () => {
    await ConfigService.updateConfigTransacted(restaurant.id, { requireWaiterValidation: true }, 'E05_TEST');
    const session = await createSession('E05 manual');
    await add(session.token, 1);
    const pending = await submit(session.token);
    expect(pending.status).toBe(OrderStatus.PENDING_VALIDATION);
    expect(pending.reviewReason).toEqual(expect.objectContaining({ code: 'WAITER_VALIDATION_REQUIRED' }));

    const config = await ConfigService.getAdminConfig(restaurant.id);
    expect(config.reviewQuantityThreshold).toBe(2);
    const audit = await ConfigService.getAuditLogs(restaurant.id, 20);
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({ changedField: 'requireWaiterValidation', changedBy: 'E05_TEST' })
    ]));
    await ConfigService.updateConfigTransacted(restaurant.id, { requireWaiterValidation: false }, 'E05_TEST');
  });

  it('usa fallback IN_KITCHEN cuando falta restaurantModuleConfig (config ausente)', async () => {
    await prisma.restaurantModuleConfig.delete({ where: { restaurantId: restaurant.id } });
    try {
      const session = await createSession('E05 fallback');
      await add(session.token, 1);
      const order = await submit(session.token);
      expect(order.status).toBe(OrderStatus.IN_KITCHEN);
      expect(order.reviewReason).toBeNull();
    } finally {
      await prisma.restaurantModuleConfig.upsert({
        where: { restaurantId: restaurant.id },
        create: { restaurantId: restaurant.id, allowOrdering: true, requireWaiterValidation: false, reviewQuantityThreshold: 2 },
        update: { allowOrdering: true, requireWaiterValidation: false, reviewQuantityThreshold: 2 }
      });
    }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

describe('S05-S11 — mesa contextual, cocina, caja, identidad y señales', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let table: any;
  let availableTable: any;
  let paidTable: any;
  let session: any;
  let item: any;
  let waiter: any;
  let manager: any;
  let waiterToken: string;
  let managerToken: string;
  let manualOrder: any;

  const serviceUrl = () => `/v1/staff/restaurants/${restaurant.id}/service-workspace`;
  const serviceTaskUrl = (kind: string, targetId: string, action: string) =>
    `/v1/staff/service/tasks/${kind}/${targetId}/${action}`;

  async function snapshot(token = waiterToken) {
    const response = await app.inject({ method: 'GET', url: serviceUrl(), headers: { authorization: `Bearer ${token}` } });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  async function login(pin: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin, terminalId: `terminal-s-${pin}` }
    });
    expect(response.statusCode).toBe(200);
    return response.json().token as string;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'S05 Servicio completo',
        slug: `s05-service-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#4f46e5',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    const shift = await prisma.shift.create({ data: { restaurantId: restaurant.id } });
    table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa S05 larga',
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        posX: 140,
        posY: 120,
        width: 220,
        height: 90,
        capacity: 6
      }
    });
    availableTable = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa S05 disponible',
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.AVAILABLE,
        posX: 420,
        posY: 120,
        width: 120,
        height: 80,
        capacity: 4
      }
    });
    paidTable = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa S05 cobrada',
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.PAID,
        posX: 560,
        posY: 120,
        width: 120,
        height: 80,
        capacity: 4
      }
    });
    session = await prisma.tableSession.create({
      data: { tableId: table.id, shiftId: shift.id, token: randomUUID(), expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }
    });
    const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'S05 menú', orderIndex: 1 } });
    item = await prisma.menuItem.create({ data: { categoryId: category.id, name: 'S05 plato', description: 'Prueba', price: 1250, priceMinor: 125000, isAvailable: true } });

    const priorOrder = await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount: 1000,
        totalAmountMinor: 100000,
        source: 'GUEST_QR',
        items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: 1000, unitPriceMinor: 100000, addedByGuest: 'guest-s05' }] }
      }
    });
    expect(priorOrder.id).toBeTruthy();

    waiter = await prisma.staffUser.create({ data: { restaurantId: restaurant.id, name: 'Mozo S05', pinHash: await bcrypt.hash('6105', 10), role: 'WAITER' } });
    manager = await prisma.staffUser.create({ data: { restaurantId: restaurant.id, name: 'Encargado S05', pinHash: await bcrypt.hash('9915', 10), role: 'MANAGER' } });
    waiterToken = await login('6105');
    managerToken = await login('9915');
  });

  afterAll(async () => {
    await app.close();
  });

  it('S05: el pedido presencial crea una tanda nueva, comparte cuenta y audita actor/origen', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/staff/tables/${table.id}/orders`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { lines: [{ menuItemId: item.id, quantity: 2 }] }
    });
    expect(response.statusCode).toBe(201);
    manualOrder = response.json();
    expect(manualOrder.status).toBe(OrderStatus.IN_KITCHEN);
    expect(manualOrder.tableSessionId).toBe(session.id);
    expect(manualOrder.source).toBe('STAFF_TERMINAL');
    expect(manualOrder.createdByStaffUserId).toBe(waiter.id);
    expect(manualOrder.items[0].addedByGuest).toBe(waiter.id);

    const orders = await prisma.order.findMany({ where: { tableSessionId: session.id }, orderBy: { createdAt: 'asc' } });
    expect(orders).toHaveLength(2);
    expect(new Set(orders.map((order) => order.id)).size).toBe(2);
    expect(orders.find((order) => order.id === manualOrder.id)?.status).toBe(OrderStatus.IN_KITCHEN);

    const body = await snapshot();
    const account = body.accounts.find((entry: any) => entry.tableSessionId === session.id);
    expect(account.account.tandas.map((tanda: any) => tanda.orderId)).toEqual(expect.arrayContaining(orders.map((order) => order.id)));
    expect(account.account.consumoMinor).toBe(350000);
    expect(body.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'ORDER_PREPARATION', targetId: manualOrder.id, tableId: table.id, source: 'ORDER' })
    ]));
  });

  it('S05: una mesa disponible se ocupa antes de quedar señalizada en cocina', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/staff/tables/${availableTable.id}/orders`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { lines: [{ menuItemId: item.id, quantity: 1 }] }
    });
    expect(response.statusCode).toBe(201);

    const refreshed = await prisma.table.findUniqueOrThrow({ where: { id: availableTable.id } });
    expect(refreshed.currentState).toBe(TableFSMState.ORDER_IN_KITCHEN);
    expect(await prisma.occupancySession.count({ where: { tableId: availableTable.id, cleanedAt: null } })).toBe(1);
    expect(await prisma.tableSession.count({ where: { tableId: availableTable.id, closedAt: null } })).toBe(1);
  });

  it('S05: una mesa cobrada no acepta una comanda ni crea una cuenta huérfana', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/staff/tables/${paidTable.id}/orders`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { lines: [{ menuItemId: item.id, quantity: 1 }] }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('TABLE_NOT_ORDERABLE');
    expect(await prisma.order.count({ where: { tableSession: { tableId: paidTable.id } } })).toBe(0);
    expect(await prisma.tableSession.count({ where: { tableId: paidTable.id } })).toBe(0);
  });

  it('S06-S07: validar/listo/entregar transforma una tarea en la siguiente una sola vez', async () => {
    let body = await snapshot();
    const preparation = body.tasks.find((task: any) => task.kind === 'ORDER_PREPARATION' && task.targetId === manualOrder.id);
    expect(preparation).toBeTruthy();

    const claim = await app.inject({
      method: 'POST',
      url: serviceTaskUrl('ORDER_PREPARATION', manualOrder.id, 'claim'),
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(claim.statusCode).toBe(201);
    const state = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${manualOrder.id}/status`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { status: OrderStatus.READY_TO_SERVE }
    });
    expect(state.statusCode).toBe(200);
    const resolvedPreparation = await app.inject({
      method: 'POST',
      url: serviceTaskUrl('ORDER_PREPARATION', manualOrder.id, 'resolve'),
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(resolvedPreparation.statusCode).toBe(200);

    body = await snapshot();
    const delivery = body.tasks.find((task: any) => task.kind === 'ORDER_DELIVERY' && task.targetId === manualOrder.id);
    expect(delivery).toBeTruthy();
    expect(body.tasks.filter((task: any) => task.targetId === manualOrder.id)).toHaveLength(1);

    const deliveryClaim = await app.inject({
      method: 'POST',
      url: serviceTaskUrl('ORDER_DELIVERY', manualOrder.id, 'claim'),
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(deliveryClaim.statusCode).toBe(201);
    const delivered = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${manualOrder.id}/status`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { status: OrderStatus.SERVED }
    });
    expect(delivered.statusCode).toBe(200);
    const resolvedDelivery = await app.inject({
      method: 'POST',
      url: serviceTaskUrl('ORDER_DELIVERY', manualOrder.id, 'resolve'),
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(resolvedDelivery.statusCode).toBe(200);

    body = await snapshot();
    expect(body.tasks.some((task: any) => task.targetId === manualOrder.id)).toBe(false);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: manualOrder.id } })).status).toBe(OrderStatus.SERVED);
  });

  it('S08-S09: el cobro sigue siendo contextual, requiere manager y reintenta sin duplicar dinero', async () => {
    const body = await snapshot();
    const account = body.accounts.find((entry: any) => entry.tableSessionId === session.id);
    expect(account.account.saldoMinor).toBe(350000);

    const waiterSettle = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${waiterToken}` },
      payload: { idempotencyKey: `s05-waiter-${randomUUID()}`, expectedAccountVersion: account.account.version, method: 'WAITER_CASH' }
    });
    expect(waiterSettle.statusCode).toBe(403);

    const claim = await app.inject({
      method: 'POST',
      url: serviceTaskUrl('ACCOUNT_COLLECTION', session.id, 'claim'),
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(claim.statusCode).toBe(201);

    const key = `s05-settle-${randomUUID()}`;
    const payload = {
      idempotencyKey: key,
      expectedAccountVersion: account.account.version,
      method: 'WAITER_CASH',
      amountMinor: account.account.saldoMinor,
      tipMinor: 5000
    };
    const settled = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload
    });
    expect(settled.statusCode).toBe(201);
    expect(settled.json().account.saldoMinor).toBe(0);
    const replay = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${managerToken}` },
      payload
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);

    const resolved = await app.inject({
      method: 'POST',
      url: serviceTaskUrl('ACCOUNT_COLLECTION', session.id, 'resolve'),
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(resolved.statusCode).toBe(200);
    const reClaim = await app.inject({
      method: 'POST',
      url: serviceTaskUrl('ACCOUNT_COLLECTION', session.id, 'claim'),
      headers: { authorization: `Bearer ${waiterToken}` }
    });
    expect(reClaim.statusCode).toBe(409);
    expect(reClaim.json().code).toBe('TASK_NO_LONGER_AVAILABLE');
    expect((await snapshot()).accounts.find((entry: any) => entry.tableSessionId === session.id).account.saldoMinor).toBe(0);
  });

  it('S10-S11: el panel conserva una única frontera de polling, backoff y módulos secundarios explícitos', () => {
    const root = path.resolve(__dirname, '../../..');
    const workspace = fs.readFileSync(path.join(root, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');
    const appSource = fs.readFileSync(path.join(root, 'apps/staff-panel/src/App.tsx'), 'utf8');
    expect(workspace).toContain('getServiceWorkspace');
    expect(workspace).toContain('document.hidden ? 15000 : 5000');
    expect(workspace).toContain('Math.min(30000');
    expect(workspace).toContain('failures = ok ? 0 : failures + 1');
    expect(workspace).toContain('role="group" aria-labelledby="service-map-title service-map-description"');
    expect(appSource).toContain("activeTab !== 'service'");
    expect(appSource).toContain('<main className="space-y-4">');
    expect(appSource).toContain('Fila puerta');
    expect(appSource).toContain('Rewards');
  });
});

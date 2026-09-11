import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallType, TableFSMState } from '@mesaya/shared';

describe('S01-S03 — snapshot de Servicio y toma atómica', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let waiterA: any;
  let waiterB: any;
  let tableA: any;
  let sessionA: any;
  let tokenA: string;
  let tokenB: string;
  let callId: string;
  let orderId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'S01 Servicio',
        slug: `s01-service-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#4f46e5',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    const shift = await prisma.shift.create({ data: { restaurantId: restaurant.id } });
    tableA = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa S01 larga',
        sector: 'TERRAZA',
        currentState: TableFSMState.BILL_REQUESTED,
        posX: 120,
        posY: 160,
        width: 180,
        height: 90,
        capacity: 6
      }
    });
    const tableB = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa S01 cocina',
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.ORDER_IN_KITCHEN,
        posX: 420,
        posY: 160,
        width: 150,
        height: 80,
        capacity: 4
      }
    });
    sessionA = await prisma.tableSession.create({
      data: { tableId: tableA.id, shiftId: shift.id, token: randomUUID(), expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }
    });
    const sessionB = await prisma.tableSession.create({
      data: { tableId: tableB.id, shiftId: shift.id, token: randomUUID(), expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }
    });

    const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'S01 menú', orderIndex: 1 } });
    const item = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'S01 plato', description: 'Prueba', price: 1250, isAvailable: true }
    });
    const accountOrder = await prisma.order.create({ data: { tableSessionId: sessionA.id, status: 'CONFIRMED', totalAmount: 1250 } });
    await prisma.orderItem.create({ data: { orderId: accountOrder.id, menuItemId: item.id, quantity: 1, unitPrice: 1250, addedByGuest: 'guest-account-s01' } });
    const order = await prisma.order.create({ data: { tableSessionId: sessionB.id, status: 'PENDING_VALIDATION', totalAmount: 1250 } });
    await prisma.orderItem.create({ data: { orderId: order.id, menuItemId: item.id, quantity: 1, unitPrice: 1250, addedByGuest: 'guest-s01' } });
    orderId = order.id;

    const call = await prisma.callRequest.create({
      data: { tableSessionId: sessionA.id, type: CallType.WAITER, status: 'PENDING', activeKey: `${sessionA.id}:${CallType.WAITER}` }
    });
    callId = call.id;

    waiterA = await prisma.staffUser.create({ data: { restaurantId: restaurant.id, name: 'Mozo S01 A', pinHash: await bcrypt.hash('6101', 10), role: 'WAITER' } });
    waiterB = await prisma.staffUser.create({ data: { restaurantId: restaurant.id, name: 'Mozo S01 B', pinHash: await bcrypt.hash('6102', 10), role: 'WAITER' } });

    const loginA = await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: restaurant.slug, pin: '6101', terminalId: 'terminal-s01-a' } });
    const loginB = await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: restaurant.slug, pin: '6102', terminalId: 'terminal-s01-b' } });
    expect(loginA.statusCode).toBe(200);
    expect(loginB.statusCode).toBe(200);
    tokenA = loginA.json().token;
    tokenB = loginB.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('devuelve un snapshot único con mapa, necesidades de personas y cocina, y cuenta contextual', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.restaurantId).toBe(restaurant.id);
    expect(body.floorPlan.tables).toEqual(expect.arrayContaining([expect.objectContaining({ id: tableA.id, label: tableA.label })]));
    expect(body.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskKey: `CALL:${callId}`, kind: 'CALL', tableId: tableA.id, source: 'CALL_REQUEST' }),
      expect.objectContaining({ taskKey: `ORDER_VALIDATION:${orderId}`, kind: 'ORDER_VALIDATION', source: 'ORDER' })
    ]));
    expect(body.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ tableSessionId: sessionA.id })]));
    expect(JSON.stringify(body)).not.toContain(sessionA.token);
  });

  it('arbitra dos tomas concurrentes, conserva dueño visible y permite reasignar', async () => {
    const attempts = await Promise.all([
      app.inject({ method: 'POST', url: `/v1/staff/service/tasks/CALL/${callId}/claim`, headers: { authorization: `Bearer ${tokenA}` } }),
      app.inject({ method: 'POST', url: `/v1/staff/service/tasks/CALL/${callId}/claim`, headers: { authorization: `Bearer ${tokenB}` } })
    ]);
    const statuses = attempts.map((result) => result.statusCode).sort();
    expect(statuses).toEqual([201, 409]);
    const winnerIndex = attempts.findIndex((result) => result.statusCode === 201);
    const winnerToken = winnerIndex === 0 ? tokenA : tokenB;
    const loserToken = winnerIndex === 0 ? tokenB : tokenA;
    expect(attempts[winnerIndex].json()).toEqual(expect.objectContaining({ taskKey: `CALL:${callId}`, status: 'ACTIVE' }));
    expect(await prisma.serviceTaskClaim.count({ where: { taskKey: `CALL:${callId}`, status: 'ACTIVE' } })).toBe(1);

    const loserRelease = await app.inject({ method: 'POST', url: `/v1/staff/service/tasks/CALL/${callId}/release`, headers: { authorization: `Bearer ${loserToken}` } });
    expect(loserRelease.statusCode).toBe(403);
    const release = await app.inject({ method: 'POST', url: `/v1/staff/service/tasks/CALL/${callId}/release`, headers: { authorization: `Bearer ${winnerToken}` } });
    expect(release.statusCode).toBe(200);
    const reassigned = await app.inject({ method: 'POST', url: `/v1/staff/service/tasks/CALL/${callId}/claim`, headers: { authorization: `Bearer ${loserToken}` } });
    expect(reassigned.statusCode).toBe(201);
    expect(reassigned.json().staffUserId).toBe(winnerToken === tokenA ? waiterB.id : waiterA.id);
  });

  it('no reclama una tarea después de que el hecho subyacente terminó', async () => {
    await prisma.order.update({ where: { id: orderId }, data: { status: 'SERVED' } });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/staff/service/tasks/ORDER_VALIDATION/${orderId}/claim`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().code).toBe('TASK_NO_LONGER_AVAILABLE');
  });

  it('reconcilia una toma huérfana si el hecho termina antes de resolver la claim', async () => {
    const staleCall = await prisma.callRequest.create({
      data: { tableSessionId: sessionA.id, type: CallType.SUPPLIES, status: 'PENDING', activeKey: `${sessionA.id}:${CallType.SUPPLIES}` }
    });
    const claimed = await app.inject({
      method: 'POST',
      url: `/v1/staff/service/tasks/CALL/${staleCall.id}/claim`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(claimed.statusCode).toBe(201);

    const resolvedFact = await app.inject({
      method: 'PATCH',
      url: `/v1/calls/${staleCall.id}`,
      headers: { authorization: `Bearer ${tokenA}` },
      payload: { status: 'RESOLVED' }
    });
    expect(resolvedFact.statusCode).toBe(200);

    const snapshot = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
      headers: { authorization: `Bearer ${tokenA}` }
    });
    expect(snapshot.statusCode).toBe(200);
    expect(snapshot.json().tasks.some((task: any) => task.targetId === staleCall.id)).toBe(false);
    expect(await prisma.serviceTaskClaim.count({ where: { taskKey: `CALL:${staleCall.id}`, status: 'ACTIVE' } })).toBe(0);
  });
});

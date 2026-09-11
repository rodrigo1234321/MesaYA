import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

describe('E09 — deshacer entrega dentro de ventana', () => {
  let app: FastifyInstance;
  let restaurant: any; let shift: any; let item: any;
  let tokenA = '';

  async function mkTable(label: string, state = TableFSMState.OCCUPIED_NO_ORDER) {
    return prisma.table.create({ data: { restaurantId: restaurant.id, label: `${label}-${randomUUID().slice(0, 6)}`, sector: 'SALON_PRINCIPAL', currentState: state, capacity: 2 } });
  }
  async function mkSession(tableId: string) {
    return prisma.tableSession.create({ data: { tableId, shiftId: shift.id, token: randomUUID(), activeKey: `${tableId}-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600e3) } });
  }
  async function mkOrder(sessionId: string, status = OrderStatus.READY_TO_SERVE) {
    const order = await prisma.order.create({ data: { tableSessionId: sessionId, status, totalAmount: 1000, totalAmountMinor: 100000 } });
    await prisma.orderItem.create({ data: { orderId: order.id, menuItemId: item.id, quantity: 1, unitPrice: 1000, unitPriceMinor: 100000, addedByGuest: 'g1' } });
    return order;
  }
  const act = (targetId: string, token: string, body: any = {}) =>
    app.inject({ method: 'POST', url: `/v1/staff/service/tasks/ORDER_DELIVERY/${targetId}/act`, headers: { authorization: `Bearer ${token}` }, payload: body });

  beforeAll(async () => {
    app = await buildApp(); await app.ready();
    restaurant = await prisma.restaurant.create({ data: { name: 'E09', slug: `e09-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, templateId: 'GOURMET_OBSIDIAN', themeColor: '#111', moduleConfig: { create: { allowOrdering: true } } } });
    shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    const category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'E09 cat' } });
    item = await prisma.menuItem.create({ data: { categoryId: category.id, name: 'Plato E09', price: 1000, isAvailable: true } });
    await prisma.staffUser.create({ data: { restaurantId: restaurant.id, name: 'Mozo E09', pinHash: await bcrypt.hash('9109', 10), role: 'WAITER' } });
    const login = await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: restaurant.slug, pin: '9109', terminalId: 'e09-terminal-1' } });
    expect(login.statusCode).toBe(200);
    tokenA = login.json().token;
  });
  afterAll(async () => { await app.close(); });

  it('entrega normal READY_TO_SERVE -> SERVED con FSM EATING', async () => {
    const t = await mkTable('E09N'); const s = await mkSession(t.id); const o = await mkOrder(s.id);
    const r = await act(o.id, tokenA, { action: 'COMPLETE' });
    expect(r.statusCode).toBe(200);
    expect(await prisma.order.findUnique({ where: { id: o.id } }).then((x) => x?.status)).toBe(OrderStatus.SERVED);
    expect(await prisma.table.findUnique({ where: { id: t.id } }).then((x) => x?.currentState)).toBe(TableFSMState.EATING);
  });

  it('undo dentro de ventana revierte a READY_TO_SERVE + ORDER_IN_KITCHEN y deja pendiente visible', async () => {
    const t = await mkTable('E09U'); const s = await mkSession(t.id); const o = await mkOrder(s.id);
    const before = await prisma.order.count();
    expect((await act(o.id, tokenA, { action: 'COMPLETE' })).statusCode).toBe(200);
    const u = await act(o.id, tokenA, { action: 'UNDO' });
    expect(u.statusCode).toBe(200);
    expect(u.json().status).toBe(OrderStatus.READY_TO_SERVE);
    expect(await prisma.order.findUnique({ where: { id: o.id } }).then((x) => x?.status)).toBe(OrderStatus.READY_TO_SERVE);
    expect(await prisma.table.findUnique({ where: { id: t.id } }).then((x) => x?.currentState)).toBe(TableFSMState.ORDER_IN_KITCHEN);
    const evts = await prisma.tableStateEvent.findMany({ where: { tableId: t.id, toState: TableFSMState.ORDER_IN_KITCHEN } });
    expect(evts.length).toBeGreaterThanOrEqual(1);
    expect(await prisma.order.count()).toBe(before);
    const claims = await prisma.serviceTaskClaim.findMany({ where: { targetId: o.id } });
    expect(claims.filter((c) => c.status === 'ACTIVE').length).toBe(0);
  });

  it('undo vencido (31s) devuelve 409 DELIVERY_UNDO_EXPIRED', async () => {
    const t = await mkTable('E09E'); const s = await mkSession(t.id); const o = await mkOrder(s.id);
    expect((await act(o.id, tokenA, { action: 'COMPLETE' })).statusCode).toBe(200);
    await prisma.serviceTaskClaim.updateMany({
      where: { taskKey: `ORDER_DELIVERY:${o.id}`, status: 'RESOLVED' },
      data: { resolvedAt: new Date(Date.now() - 31_000), claimedAt: new Date(Date.now() - 31_000) }
    });
    const u = await act(o.id, tokenA, { action: 'UNDO' });
    expect(u.statusCode).toBe(409);
    expect(u.json().code).toBe('DELIVERY_UNDO_EXPIRED');
    expect(u.json().error).toMatch(/30 segundos/i);
  });

  it('undo repetido devuelve 409 DELIVERY_UNDO_UNAVAILABLE sin duplicar', async () => {
    const t = await mkTable('E09R'); const s = await mkSession(t.id); const o = await mkOrder(s.id);
    expect((await act(o.id, tokenA, { action: 'COMPLETE' })).statusCode).toBe(200);
    expect((await act(o.id, tokenA, { action: 'UNDO' })).statusCode).toBe(200);
    const beforeOrders = await prisma.order.count();
    const beforeClaims = await prisma.serviceTaskClaim.count({ where: { targetId: o.id } });
    const again = await act(o.id, tokenA, { action: 'UNDO' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('DELIVERY_UNDO_UNAVAILABLE');
    expect(await prisma.order.count()).toBe(beforeOrders);
    expect(await prisma.serviceTaskClaim.count({ where: { targetId: o.id } })).toBe(beforeClaims);
  });

  it('UNDO no permitido para CALL', async () => {
    const t = await mkTable('E09C'); const s = await mkSession(t.id);
    const c = await prisma.callRequest.create({ data: { tableSessionId: s.id, type: 'WAITER', status: 'PENDING' } });
    const r = await app.inject({ method: 'POST', url: `/v1/staff/service/tasks/CALL/${c.id}/act`, headers: { authorization: `Bearer ${tokenA}` }, payload: { action: 'UNDO' } });
    expect(r.statusCode).toBe(422);
  });
});

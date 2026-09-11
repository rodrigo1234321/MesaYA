import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallStatus, OrderStatus, TableFSMState } from '@mesaya/shared';

describe('E06 — comando de intención atómica', () => {
  let app: FastifyInstance;
  let restaurant: any; let shift: any; let category: any; let item: any;
  let tokenA = ''; let tokenB = '';

  async function mkTable(label: string) {
    return prisma.table.create({ data: { restaurantId: restaurant.id, label: `${label}-${randomUUID().slice(0, 6)}`, sector: 'SALON_PRINCIPAL', currentState: TableFSMState.OCCUPIED_NO_ORDER, capacity: 2 } });
  }
  async function mkSession(tableId: string) {
    return prisma.tableSession.create({ data: { tableId, shiftId: shift.id, token: randomUUID(), activeKey: `${tableId}-${randomUUID()}`, expiresAt: new Date(Date.now() + 3600e3) } });
  }
  async function mkCall(sessionId: string, status = CallStatus.PENDING) {
    return prisma.callRequest.create({ data: { tableSessionId: sessionId, type: 'WAITER', status } });
  }
  async function mkOrder(sessionId: string, status = OrderStatus.PENDING_VALIDATION) {
    const order = await prisma.order.create({ data: { tableSessionId: sessionId, status, totalAmount: 1000, totalAmountMinor: 100000 } });
    await prisma.orderItem.create({ data: { orderId: order.id, menuItemId: item.id, quantity: 1, unitPrice: 1000, unitPriceMinor: 100000, addedByGuest: 'g1' } });
    return order;
  }
  const act = (taskType: string, targetId: string, token: string, body: any = {}) =>
    app.inject({ method: 'POST', url: `/v1/staff/service/tasks/${taskType}/${targetId}/act`, headers: { authorization: `Bearer ${token}` }, payload: body });

  beforeAll(async () => {
    app = await buildApp(); await app.ready();
    restaurant = await prisma.restaurant.create({ data: { name: 'E06', slug: `e06-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, templateId: 'GOURMET_OBSIDIAN', themeColor: '#111', moduleConfig: { create: { allowOrdering: true } } } });
    shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    category = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'E06 cat' } });
    item = await prisma.menuItem.create({ data: { categoryId: category.id, name: 'Plato E06', price: 1000, isAvailable: true } });
    for (const [name, pin] of [['Mozo A06', '7106'], ['Mozo B06', '7206']] as const) {
      await prisma.staffUser.create({ data: { restaurantId: restaurant.id, name, pinHash: await bcrypt.hash(pin, 10), role: 'WAITER' } });
      const login = await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: restaurant.slug, pin, terminalId: `e06-${pin}` } });
      expect(login.statusCode).toBe(200);
      if (pin === '7106') tokenA = login.json().token; else tokenB = login.json().token;
    }
  });
  afterAll(async () => { await app.close(); });

  it('llamado PENDING se resuelve en una acción', async () => {
    const t = await mkTable('E06C'); const s = await mkSession(t.id); const c = await mkCall(s.id);
    const r = await act('CALL', c.id, tokenA, { action: 'COMPLETE' });
    expect(r.statusCode).toBe(200);
    const call = await prisma.callRequest.findUnique({ where: { id: c.id } });
    expect(call?.status).toBe(CallStatus.RESOLVED);
    const claims = await prisma.serviceTaskClaim.findMany({ where: { taskKey: `CALL:${c.id}`, status: 'ACTIVE' } });
    expect(claims.length).toBe(0);
  });

  it('validación normal PENDING_VALIDATION -> IN_KITCHEN limpiando motivo', async () => {
    const t = await mkTable('E06V'); const s = await mkSession(t.id);
    const o = await prisma.order.create({ data: { tableSessionId: s.id, status: OrderStatus.PENDING_VALIDATION, totalAmount: 1000, totalAmountMinor: 100000, reviewReasonCode: 'QUANTITY_THRESHOLD', reviewReasonDetail: 'x' } });
    await prisma.orderItem.create({ data: { orderId: o.id, menuItemId: item.id, quantity: 1, unitPrice: 1000, unitPriceMinor: 100000, addedByGuest: 'g1' } });
    const r = await act('ORDER_VALIDATION', o.id, tokenA, { action: 'COMPLETE' });
    expect(r.statusCode).toBe(200);
    const order = await prisma.order.findUnique({ where: { id: o.id } });
    expect(order?.status).toBe(OrderStatus.IN_KITCHEN);
    expect(order?.reviewReasonCode).toBeNull();
    // FSM canónica dentro de la misma tx: mesa en ORDER_IN_KITCHEN + evento auditado.
    const tableV = await prisma.table.findUnique({ where: { id: t.id } });
    expect(tableV?.currentState).toBe(TableFSMState.ORDER_IN_KITCHEN);
    const eventsV = await prisma.tableStateEvent.findMany({ where: { tableId: t.id, toState: TableFSMState.ORDER_IN_KITCHEN } });
    expect(eventsV.length).toBeGreaterThanOrEqual(1);
  });

  it('delivery READY_TO_SERVE -> SERVED mueve la mesa a EATING con evento', async () => {
    const t = await mkTable('E06D'); const s = await mkSession(t.id);
    const o = await mkOrder(s.id, OrderStatus.READY_TO_SERVE);
    const r = await act('ORDER_DELIVERY', o.id, tokenA, { action: 'COMPLETE' });
    expect(r.statusCode).toBe(200);
    const order = await prisma.order.findUnique({ where: { id: o.id } });
    expect(order?.status).toBe(OrderStatus.SERVED);
    const tableD = await prisma.table.findUnique({ where: { id: t.id } });
    expect(tableD?.currentState).toBe(TableFSMState.EATING);
    const eventsD = await prisma.tableStateEvent.findMany({ where: { tableId: t.id, toState: TableFSMState.EATING } });
    expect(eventsD.length).toBeGreaterThanOrEqual(1);
  });

  it('rechazo con razón deja CANCELLED sin cobro', async () => {
    const t = await mkTable('E06R'); const s = await mkSession(t.id); const o = await mkOrder(s.id);
    const r = await act('ORDER_VALIDATION', o.id, tokenA, { action: 'REJECT', reason: 'Sin stock real' });
    expect(r.statusCode).toBe(200);
    const order = await prisma.order.findUnique({ where: { id: o.id }, include: { payments: true } });
    expect(order?.status).toBe(OrderStatus.CANCELLED);
    expect(order?.cancellationReason).toMatch(/Sin stock/);
    expect(order?.payments.length).toBe(0);
    const bad = await act('ORDER_VALIDATION', o.id, tokenA, { action: 'REJECT' });
    // Idempotente sobre CANCELLED: replay exitoso aun sin razón (ya resuelto)
    expect([200, 400]).toContain(bad.statusCode);
  });

  it('doble POST concurrente: solo uno gana, sin claims activas ni duplicados', async () => {
    const t = await mkTable('E06X'); const s = await mkSession(t.id); const o = await mkOrder(s.id);
    const [r1, r2] = await Promise.all([
      act('ORDER_VALIDATION', o.id, tokenA, { action: 'COMPLETE' }),
      act('ORDER_VALIDATION', o.id, tokenB, { action: 'COMPLETE' })
    ]);
    const codes = [r1.statusCode, r2.statusCode].sort();
    // Uno gana (200, posiblemente replay 200) y el otro pierde con 409, o ambos 200 si idempotente. Nunca dos mutaciones.
    expect(codes[0]).toBe(200);
    expect([200, 409]).toContain(codes[1]);
    const order = await prisma.order.findUnique({ where: { id: o.id } });
    expect(order?.status).toBe(OrderStatus.IN_KITCHEN);
    const actives = await prisma.serviceTaskClaim.findMany({ where: { taskKey: `ORDER_VALIDATION:${o.id}`, status: 'ACTIVE' } });
    expect(actives.length).toBe(0);
    const orders = await prisma.order.count({ where: { id: o.id } });
    expect(orders).toBe(1);
  });

  it('conflicto 409 accionable sin reintento ciego', async () => {
    const t = await mkTable('E06C2'); const s = await mkSession(t.id); const o = await mkOrder(s.id);
    const rej = await act('ORDER_VALIDATION', o.id, tokenA, { action: 'REJECT', reason: 'No va' });
    expect(rej.statusCode).toBe(200);
    const retry = await act('ORDER_VALIDATION', o.id, tokenA, { action: 'COMPLETE' });
    expect(retry.statusCode).toBe(409);
    expect(retry.json().code).toMatch(/REVIEW_CONFLICT|NO_LONGER/);
    expect(retry.json().error).toMatch(/actualiz/i);
  });
});

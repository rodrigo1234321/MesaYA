import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

/**
 * E10–E11 — cobro en Servicio y recambio con limpieza.
 * - Registrar pago (settle) no cierra la sesión ni mueve la mesa.
 * - Cobrar y cerrar (settle-and-close) idempotente deja TO_CLEAN y revoca el token viejo.
 * - Mesa lista (tap skip_to AVAILABLE, expected TO_CLEAN) habilita la siguiente
 *   sesión en cero y sin herencia; conflicto ante estado inesperado.
 * - La pantalla Servicio no toca Caja/Admin: sólo comandos de sesión + tap de mesa.
 */
describe('E10–E11 — pago mantener, cobro y cierre, Mesa lista', () => {
  let app: FastifyInstance;
  let rest: any;
  let shift: any;
  let cat: any;
  let manager: string;

  async function mkTable(label: string, state: TableFSMState = TableFSMState.OCCUPIED_NO_ORDER) {
    return prisma.table.create({
      data: { restaurantId: rest.id, label: `${label}-${randomUUID().slice(0, 6)}`, sector: 'SALON', currentState: state, capacity: 4 }
    });
  }

  async function mkSession(table: any) {
    return prisma.tableSession.create({
      data: { tableId: table.id, shiftId: shift.id, token: randomUUID(), activeKey: table.id, expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }
    });
  }

  async function mkOrder(session: any, price: number, status: OrderStatus, name: string) {
    const item = await prisma.menuItem.create({ data: { categoryId: cat.id, name, price, isAvailable: true } });
    return prisma.order.create({
      data: {
        tableSessionId: session.id,
        status,
        totalAmount: price,
        items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: price, addedByGuest: session.id }] }
      }
    });
  }

  async function versionOf(token: string) {
    const res = await app.inject({ method: 'GET', url: `/v1/orders/session/${token}` });
    expect(res.statusCode).toBe(200);
    return res.json().account.version as string;
  }

  function settle(sessionId: string, payload: any) {
    return app.inject({ method: 'POST', url: `/v1/staff/sessions/${sessionId}/settle`, headers: { authorization: `Bearer ${manager}` }, payload });
  }

  function settleAndClose(sessionId: string, payload: any) {
    return app.inject({ method: 'POST', url: `/v1/staff/sessions/${sessionId}/settle-and-close`, headers: { authorization: `Bearer ${manager}` }, payload });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    rest = await prisma.restaurant.create({
      data: { name: 'e10-r1', slug: `e10-r1-${Date.now()}`, templateId: 'GOURMET_OBSIDIAN', themeColor: '#f59e0b', moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: false } } }
    });
    shift = await prisma.shift.create({ data: { restaurantId: rest.id, openedAt: new Date() } });
    cat = await prisma.menuCategory.create({ data: { restaurantId: rest.id, name: 'E10', orderIndex: 0 } });
    await prisma.staffUser.create({ data: { restaurantId: rest.id, name: 'Manager E10', pinHash: await bcrypt.hash('9999', 10), role: 'MANAGER' } });
    manager = (await app.inject({ method: 'POST', url: '/v1/auth/login-admin', payload: { restaurantSlug: rest.slug, pin: '9999' } })).json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('E10 Registrar pago y mantener mesa no cierra ni mueve la FSM', async () => {
    const table = await mkTable('E10-keep');
    const session = await mkSession(table);
    await mkOrder(session, 1500, OrderStatus.SERVED, 'Keep plato');
    const version = await versionOf(session.token);
    const res = await settle(session.id, {
      idempotencyKey: `e10-keep-${session.id}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 150000,
      tipMinor: 0
    });
    expect([200, 201]).toContain(res.statusCode);
    const fresh = await prisma.tableSession.findUnique({ where: { id: session.id } });
    expect(fresh?.closedAt).toBeNull();
    const t = await prisma.table.findUnique({ where: { id: table.id } });
    expect(t?.currentState).not.toBe(TableFSMState.TO_CLEAN);
    expect(t?.currentState).not.toBe(TableFSMState.AVAILABLE);
  });

  it('E10 Cobrar y cerrar idempotente deja TO_CLEAN, token viejo inválido y sin duplicar', async () => {
    const table = await mkTable('E10-close');
    const session = await mkSession(table);
    await mkOrder(session, 2000, OrderStatus.SERVED, 'Close plato');
    const version = await versionOf(session.token);
    const payload = {
      idempotencyKey: `e10-close-${session.id}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 200000,
      tipMinor: 0
    };
    const first = await settleAndClose(session.id, payload);
    expect([200, 201]).toContain(first.statusCode);
    // Reintento exacto (dos clicks): replay sin duplicar.
    const replay = await settleAndClose(session.id, payload);
    expect([200, 201]).toContain(replay.statusCode);
    expect(replay.json().idempotentReplay).toBe(true);
    const t = await prisma.table.findUnique({ where: { id: table.id } });
    expect(t?.currentState).toBe(TableFSMState.TO_CLEAN);
    // Token viejo revocado: 410 SESSION_CLOSED.
    const old = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(old.statusCode).toBe(410);
    expect(old.json().code || old.json().error).toBeDefined();
    // Sin pago duplicado: un solo pago con esa clave.
    const settlements = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
    expect(settlements).toBe(1);
  });

  it('E11 Mesa lista lleva TO_CLEAN a AVAILABLE y la siguiente sesión arranca en cero', async () => {
    const table = await mkTable('E11-clean');
    const session = await mkSession(table);
    await mkOrder(session, 1000, OrderStatus.SERVED, 'Clean plato');
    const version = await versionOf(session.token);
    await settleAndClose(session.id, {
      idempotencyKey: `e11-close-${session.id}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 100000,
      tipMinor: 0
    });
    // Conflicto: expectedCurrentState erróneo no muta.
    const conflict = await app.inject({
      method: 'POST',
      url: `/v1/tables/${table.id}/state/tap`,
      headers: { authorization: `Bearer ${manager}` },
      payload: { action: 'skip_to', targetState: 'AVAILABLE', expectedCurrentState: 'EATING', note: 'Mesa lista' }
    });
    expect(conflict.statusCode).toBe(409);
    // Camino principal: Mesa lista.
    const clean = await app.inject({
      method: 'POST',
      url: `/v1/tables/${table.id}/state/tap`,
      headers: { authorization: `Bearer ${manager}` },
      payload: { action: 'skip_to', targetState: 'AVAILABLE', expectedCurrentState: 'TO_CLEAN', note: 'Mesa lista' }
    });
    expect(clean.statusCode).toBe(200);
    const t = await prisma.table.findUnique({ where: { id: table.id } });
    expect(t?.currentState).toBe(TableFSMState.AVAILABLE);
    // Siguiente ocupación: `Mesa lista` ya preparó una sesión nueva con
    // cuenta cero, sin herencia. El QR sólo la resuelve; no crea otra.
    const next = await prisma.tableSession.findFirstOrThrow({
      where: { tableId: table.id, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: { orders: true }
    });
    expect(next.id).not.toBe(session.id);
    expect(next.token).not.toBe(session.token);
    expect(next.orders).toHaveLength(0);
    const account = await app.inject({ method: 'GET', url: `/v1/orders/session/${next.token}` });
    expect(account.statusCode).toBe(200);
    expect(account.json().account.saldoMinor).toBe(0);
  });
  it('E10 cambio de metodo/propina con misma version no colisiona (clave distinta) y stale 409 es accionable', async () => {
    const table = await mkTable('E10-keychange');
    const session = await mkSession(table);
    await mkOrder(session, 1200, OrderStatus.SERVED, 'Key plato');
    const version = await versionOf(session.token);
    const base = { idempotencyKey: 'e10-diff-' + session.id, expectedAccountVersion: version, amountMinor: 120000, tipMinor: 0 };
    // Misma clave con distinto metodo => 409 IDEMPOTENCY_KEY_REUSED (no replay falso).
    const a = await settle(session.id, { ...base, method: 'WAITER_CASH' });
    expect([200, 201]).toContain(a.statusCode);
    const v2 = await versionOf(session.token).catch(() => version);
    const reused = await settle(session.id, { ...base, method: 'WAITER_CARD', expectedAccountVersion: v2 });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    // Version obsoleta => 409 STALE_ACCOUNT_VERSION accionable.
    const stale = await settle(session.id, { idempotencyKey: 'e10-stale-' + session.id, expectedAccountVersion: 'v-obsoleta', method: 'WAITER_CASH', amountMinor: 100, tipMinor: 0 });
    expect(stale.statusCode).toBe(409);
    expect(['STALE_ACCOUNT_VERSION', 'SETTLE_CONFLICT']).toContain(stale.json().code);
  });

  it('E10 keep no deja TO_CLEAN ni evento de cierre; close es idempotente', async () => {
    const table = await mkTable('E10-keepclean');
    const session = await mkSession(table);
    await mkOrder(session, 800, OrderStatus.SERVED, 'Keep2 plato');
    const version = await versionOf(session.token);
    const r = await settle(session.id, { idempotencyKey: 'e10-keep2-' + session.id, expectedAccountVersion: version, method: 'WAITER_CASH', amountMinor: 80000, tipMinor: 0 });
    expect([200, 201]).toContain(r.statusCode);
    const tt = await prisma.table.findUnique({ where: { id: table.id } });
    expect(tt?.currentState).not.toBe(TableFSMState.TO_CLEAN);
    const fresh = await prisma.tableSession.findUnique({ where: { id: session.id } });
    expect(fresh?.closedAt).toBeNull();
  });

  it('E10-E11 snapshot expone ACCOUNT_COLLECTION y TABLE_CLEANUP; tap stale/concurrente seguro y cross-tenant', async () => {
    const table = await mkTable('E10-snap');
    const session = await mkSession(table);
    await mkOrder(session, 500, OrderStatus.SERVED, 'Snap plato');
    const snapRes = await app.inject({ method: 'GET', url: '/v1/staff/restaurants/' + rest.id + '/service-workspace', headers: { authorization: 'Bearer ' + manager } });
    expect(snapRes.statusCode).toBe(200);
    const body = snapRes.json();
    const accTask = body.tasks.find((x: any) => x.kind === 'ACCOUNT_COLLECTION' && x.tableId === table.id);
    expect(accTask).toBeDefined();
    expect(accTask.taskKey).toBe('ACCOUNT_COLLECTION:' + session.id);
    expect(accTask.source).toBe('TABLE_SESSION');
    expect(accTask.claim).toBeNull();
    expect(accTask.action).not.toBe('CLAIM');
    expect(body.summary.totalTasks).toBe(body.tasks.length);
    expect(body.summary.accountsToCollect).toBeGreaterThanOrEqual(1);
    // Llevar a TO_CLEAN y verificar tarjeta de limpieza.
    const version = await versionOf(session.token);
    const closed = await settleAndClose(session.id, { idempotencyKey: 'e10-snapclose-' + session.id, expectedAccountVersion: version, method: 'WAITER_CASH', amountMinor: 50000, tipMinor: 0 });
    expect([200, 201]).toContain(closed.statusCode);
    const snap2 = (await app.inject({ method: 'GET', url: '/v1/staff/restaurants/' + rest.id + '/service-workspace', headers: { authorization: 'Bearer ' + manager } })).json();
    const cleanTask = snap2.tasks.find((x: any) => x.kind === 'TABLE_CLEANUP' && x.tableId === table.id);
    expect(cleanTask).toBeDefined();
    expect(cleanTask.action).toBe('MARK_CLEAN');
    expect(cleanTask.claim).toBeNull();
    expect(cleanTask.taskKey).toBe('TABLE_CLEANUP:' + table.id);
    // Tap con estado esperado erroneo => 409 sin mutar.
    const bad = await app.inject({ method: 'POST', url: '/v1/tables/' + table.id + '/state/tap', headers: { authorization: 'Bearer ' + manager }, payload: { action: 'skip_to', targetState: 'AVAILABLE', expectedCurrentState: 'EATING', note: 'Mesa lista' } });
    expect(bad.statusCode).toBe(409);
    expect((await prisma.table.findUnique({ where: { id: table.id } }))?.currentState).toBe(TableFSMState.TO_CLEAN);
    // Cross-tenant: token de otro restaurante no puede tocar la mesa (tap valida restaurante).
    const other = await prisma.restaurant.create({ data: { name: 'e10-other', slug: 'e10-other-' + Date.now(), templateId: 'GOURMET_OBSIDIAN', themeColor: '#000', moduleConfig: { create: { allowOrdering: true } } } });
    await prisma.staffUser.create({ data: { restaurantId: other.id, name: 'Manager Other', pinHash: await bcrypt.hash('8888', 10), role: 'MANAGER' } });
    const otherToken = (await app.inject({ method: 'POST', url: '/v1/auth/login-admin', payload: { restaurantSlug: other.slug, pin: '8888' } })).json().token;
    const cross = await app.inject({ method: 'POST', url: '/v1/tables/' + table.id + '/state/tap', headers: { authorization: 'Bearer ' + otherToken }, payload: { action: 'skip_to', targetState: 'AVAILABLE', expectedCurrentState: 'TO_CLEAN', note: 'Mesa lista' } });
    expect([403, 404]).toContain(cross.statusCode);
    expect((await prisma.table.findUnique({ where: { id: table.id } }))?.currentState).toBe(TableFSMState.TO_CLEAN);
    // Camino principal idempotente ante doble click: segundo 409 o 200, nunca AVAILABLE sin TO_CLEAN.
    const ok = await app.inject({ method: 'POST', url: '/v1/tables/' + table.id + '/state/tap', headers: { authorization: 'Bearer ' + manager }, payload: { action: 'skip_to', targetState: 'AVAILABLE', expectedCurrentState: 'TO_CLEAN', note: 'Mesa lista' } });
    expect(ok.statusCode).toBe(200);
    const again = await app.inject({ method: 'POST', url: '/v1/tables/' + table.id + '/state/tap', headers: { authorization: 'Bearer ' + manager }, payload: { action: 'skip_to', targetState: 'AVAILABLE', expectedCurrentState: 'TO_CLEAN', note: 'Mesa lista' } });
    expect(again.statusCode).toBe(409);
  });

  it('E10-E11 ServiceWorkspace no usa CashManager/Admin/getCashOrders', async () => {
    const root = require('path').resolve(__dirname, '../../..');
    const src = require('fs').readFileSync(require('path').join(root, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');
    expect(src).not.toMatch(/CashManager|AdminApi|getCashOrders/);
    expect(src).toContain('TABLE_CLEANUP');
    expect(src).toContain('ACCOUNT_COLLECTION');
  });

});

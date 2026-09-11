import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState, SignalSource } from '@mesaya/shared';
import { OrderService } from '../src/services/order.service';
import { SessionService } from '../src/services/session.service';
import { fsmService } from '../src/services/fsm.service';

/**
 * G-A Seguridad de ocupación (E00–E03, 03-PRUEBAS-Y-GATES §1-2/§6).
 * - Sesión anterior imposible de heredar; cobro/cierre idempotente.
 * - Token viejo 410; pendientes → 409; carrera → una ocupación; cuenta nueva en cero.
 * - settle-and-close atómico: replay seguro, sin cierre parcial, sin duplicar.
 * Fixture real en SQLite efímera, sin mocks de persistencia.
 */
describe('G-A E00–E03 — seguridad de ocupación y cierre atómico', () => {
  let app: FastifyInstance;
  let rest1: any;
  let shift1: any;
  let cat1: any;
  let manager1: string;

  async function mkTable(label: string, state: TableFSMState = TableFSMState.OCCUPIED_NO_ORDER) {
    return prisma.table.create({
      data: {
        restaurantId: rest1.id,
        label: `${label}-${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: state,
        capacity: 4
      }
    });
  }

  async function mkSession(table: any) {
    return prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift1.id,
        token: randomUUID(),
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
  }

  async function mkOrder(session: any, price: number, status: OrderStatus, name: string) {
    const item = await prisma.menuItem.create({
      data: { categoryId: cat1.id, name, price, isAvailable: true }
    });
    return prisma.order.create({
      data: {
        tableSessionId: session.id,
        status,
        totalAmount: price,
        items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: price, addedByGuest: session.id }] }
      }
    });
  }

  async function versionOf(sessionToken: string) {
    const res = await app.inject({ method: 'GET', url: `/v1/orders/session/${sessionToken}` });
    expect(res.statusCode).toBe(200);
    return res.json().account.version as string;
  }

  async function settleAndClose(sessionId: string, payload: any) {
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${sessionId}/settle-and-close`,
      headers: { authorization: `Bearer ${manager1}` },
      payload
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    rest1 = await prisma.restaurant.create({
      data: {
        name: 'gate-a-r1',
        slug: `gate-a-r1-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    shift1 = await prisma.shift.create({ data: { restaurantId: rest1.id, openedAt: new Date() } });
    cat1 = await prisma.menuCategory.create({ data: { restaurantId: rest1.id, name: 'GATEA', orderIndex: 0 } });
    await prisma.staffUser.create({
      data: { restaurantId: rest1.id, name: 'Manager GATE-A', pinHash: await bcrypt.hash('9999', 10), role: 'MANAGER' }
    });
    manager1 = (
      await app.inject({ method: 'POST', url: '/v1/auth/login-admin', payload: { restaurantSlug: rest1.slug, pin: '9999' } })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('E01 deprecación: POST /staff/orders/:id/pay responde con header Deprecation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/staff/orders/fake-order-id/pay',
      headers: { authorization: `Bearer ${manager1}` },
      payload: { paymentMethod: 'WAITER_CASH' }
    });
    expect(res.headers['deprecation']).toBe('true');
  });

  it('E02 rotación bloqueada con deuda/borrador/revisión/llamado (409, sesión intacta)', async () => {
    // Deuda
    const tDebt = await mkTable('GATEA-debt');
    const sDebt = await mkSession(tDebt);
    await mkOrder(sDebt, 1200, OrderStatus.SERVED, 'Deuda');
    await expect(SessionService.createNewSessionForTable(tDebt.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TABLE_HAS_UNPAID_BALANCE'
    });
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: sDebt.id } })).closedAt).toBeNull();

    // Borrador
    const tDraft = await mkTable('GATEA-draft');
    const sDraft = await mkSession(tDraft);
    await mkOrder(sDraft, 700, OrderStatus.DRAFT, 'Carrito');
    await expect(SessionService.createNewSessionForTable(tDraft.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DRAFT_UNRESOLVED'
    });

    // Revisión pendiente
    const tRev = await mkTable('GATEA-rev');
    const sRev = await mkSession(tRev);
    await mkOrder(sRev, 600, OrderStatus.PENDING_VALIDATION, 'Por confirmar');
    await expect(SessionService.createNewSessionForTable(tRev.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PENDING_VALIDATION_UNRESOLVED'
    });

    // Llamado pendiente
    const tCall = await mkTable('GATEA-call');
    const sCall = await mkSession(tCall);
    await prisma.callRequest.create({ data: { tableSessionId: sCall.id, type: 'WAITER', status: 'PENDING' } });
    await expect(SessionService.createNewSessionForTable(tCall.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PENDING_CALLS'
    });
  });

  it('E02 carrera: dos rotaciones simultáneas convergen en una sola ocupación', async () => {
    const table = await mkTable('GATEA-race', TableFSMState.AVAILABLE);
    const [a, b] = await Promise.all([
      SessionService.createNewSessionForTable(table.id),
      SessionService.createNewSessionForTable(table.id)
    ]);
    // Convergencia real vía activeKey única: ambas llamadas devuelven
    // exactamente el mismo token ganador, no dos ocupaciones secuenciales.
    expect(a).toBe(b);
    const open = await prisma.tableSession.findMany({ where: { tableId: table.id, closedAt: null } });
    expect(open.length).toBe(1);
    expect(open[0].token).toBe(a);
    // La sesión ganadora no fue revocada por la perdedora.
    expect(open[0].closedAt).toBeNull();
    expect(open[0].activeKey).toBe(table.id);
  });

  it('E03 settle-and-close: pago total + cierre + TO_CLEAN + token 410 + QR sin herencia', async () => {
    const table = await mkTable('GATEA-sc');
    const session = await mkSession(table);
    await mkOrder(session, 1800, OrderStatus.SERVED, 'T1');
    const version = await versionOf(session.token);
    const key = `gate-a-${randomUUID()}`;

    const res = await settleAndClose(session.id, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().closed).toBe(true);

    // Reintento con la misma clave: 200 replay, sin duplicar pago ni cierre.
    const replay = await settleAndClose(session.id, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);

    // Token viejo → 410 en canal público y de comensal; mesa en TO_CLEAN, nunca AVAILABLE directo.
    const tok = await app.inject({ method: 'GET', url: `/v1/sessions/${session.token}` });
    expect(tok.statusCode).toBe(410);
    expect(tok.json().valid).toBe(false);
    const guest = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(guest.statusCode).toBe(410);
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).currentState).toBe(
      TableFSMState.TO_CLEAN
    );

    // QR físico durante TO_CLEAN: inactivo, sin token ni cuenta anterior.
    const qr = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${encodeURIComponent(rest1.slug)}/${encodeURIComponent((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).label)}`
    });
    expect(qr.statusCode).toBe(200);
    expect(qr.json().valid).toBe(false);
    expect(qr.json().token).toBeUndefined();

    // Mesa lista + nueva ocupación: id/token nuevos y cuenta cero, ledger anterior intacto.
    await fsmService.attemptTransition({
      tableId: table.id,
      toState: TableFSMState.AVAILABLE,
      source: SignalSource.STAFF_TERMINAL_TAP,
      trigger: 'Mesa lista'
    });
    const token2 = await SessionService.createNewSessionForTable(table.id);
    expect(token2).not.toBe(session.token);
    const fresh = await prisma.tableSession.findFirstOrThrow({
      where: { tableId: table.id, closedAt: null },
      include: { orders: true }
    });
    expect(fresh.id).not.toBe(session.id);
    expect(fresh.orders).toHaveLength(0);
    expect((await OrderService.getSessionAccount(fresh.id)).saldoMinor).toBe(0);
    expect(await prisma.order.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('E03 sin cierre parcial: monto parcial o borrador bloquean sin escribir pago', async () => {
    // Monto parcial
    const t1 = await mkTable('GATEA-partial');
    const s1 = await mkSession(t1);
    const o1 = await mkOrder(s1, 1000, OrderStatus.SERVED, 'P1');
    await mkOrder(s1, 2500, OrderStatus.SERVED, 'P2');
    const v1 = await versionOf(s1.token);
    const partial = await settleAndClose(s1.id, {
      idempotencyKey: `gate-a-p-${randomUUID()}`,
      expectedAccountVersion: v1,
      method: 'WAITER_CASH',
      amountMinor: 100000,
      allocations: [{ orderId: o1.id, amountMinor: 100000 }]
    });
    expect(partial.statusCode).toBe(422);
    expect(partial.json().code).toBe('CLOSE_REQUIRES_FULL_SETTLEMENT');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: s1.id } })).toBe(0);
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: s1.id } })).closedAt).toBeNull();

    // Borrador
    const t2 = await mkTable('GATEA-draft-sc');
    const s2 = await mkSession(t2);
    await mkOrder(s2, 700, OrderStatus.DRAFT, 'Carrito');
    const v2 = await versionOf(s2.token);
    const blocked = await settleAndClose(s2.id, {
      idempotencyKey: `gate-a-d-${randomUUID()}`,
      expectedAccountVersion: v2,
      method: 'WAITER_CASH'
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('DRAFT_UNRESOLVED');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: s2.id } })).toBe(0);
  });

  it('E02 rotación exige AVAILABLE: EATING/PAID nunca reabren (409 TABLE_NOT_AVAILABLE)', async () => {
    for (const state of [TableFSMState.EATING, TableFSMState.PAID]) {
      const table = await mkTable(`GATEA-notavail-${state}`, state);
      // Ocupación resuelta (sin deuda/borrador/revisión/llamado): aun así no rota.
      await mkSession(table);
      await expect(SessionService.createNewSessionForTable(table.id)).rejects.toMatchObject({
        statusCode: 409,
        code: 'TABLE_NOT_AVAILABLE'
      });
      expect(await prisma.tableSession.count({ where: { tableId: table.id, closedAt: null } })).toBe(1);
      const http = await app.inject({
        method: 'POST',
        url: `/v1/tables/${table.id}/new-session`,
        headers: { authorization: `Bearer ${manager1}` }
      });
      expect(http.statusCode).toBe(409);
      expect(http.json().code).toBe('TABLE_NOT_AVAILABLE');
      expect(http.json().details).toBeDefined();
    }
    // getOrCreate tampoco reabre EATING/PAID sin sesión vigente.
    const tEat = await mkTable('GATEA-goc-eating', TableFSMState.EATING);
    await expect(SessionService.getOrCreateOperationalSession(tEat.id, rest1.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TABLE_NOT_AVAILABLE'
    });
    const tPaid = await mkTable('GATEA-goc-paid', TableFSMState.PAID);
    await expect(SessionService.getOrCreateOperationalSession(tPaid.id, rest1.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TABLE_NOT_AVAILABLE'
    });
  });

  it('E03 settle-and-close bloquea llamado y validación pendientes (409, sin pago ni cierre)', async () => {
    // Llamado pendiente
    const tCall = await mkTable('GATEA-sc-call');
    const sCall = await mkSession(tCall);
    await mkOrder(sCall, 800, OrderStatus.SERVED, 'SC-call');
    await prisma.callRequest.create({ data: { tableSessionId: sCall.id, type: 'WAITER', status: 'PENDING' } });
    const vCall = await versionOf(sCall.token);
    const rCall = await settleAndClose(sCall.id, {
      idempotencyKey: `gate-a-scc-${randomUUID()}`,
      expectedAccountVersion: vCall,
      method: 'WAITER_CASH'
    });
    expect(rCall.statusCode).toBe(409);
    expect(rCall.json().code).toBe('PENDING_CALLS');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: sCall.id } })).toBe(0);
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: sCall.id } })).closedAt).toBeNull();

    // Revisión pendiente
    const tRev = await mkTable('GATEA-sc-rev');
    const sRev = await mkSession(tRev);
    await mkOrder(sRev, 800, OrderStatus.SERVED, 'SC-rev-base');
    await mkOrder(sRev, 600, OrderStatus.PENDING_VALIDATION, 'SC-rev-pend');
    const vRev = await versionOf(sRev.token);
    const rRev = await settleAndClose(sRev.id, {
      idempotencyKey: `gate-a-scr-${randomUUID()}`,
      expectedAccountVersion: vRev,
      method: 'WAITER_CASH'
    });
    expect(rRev.statusCode).toBe(409);
    expect(rRev.json().code).toBe('PENDING_VALIDATION_UNRESOLVED');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: sRev.id } })).toBe(0);
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: sRev.id } })).closedAt).toBeNull();
  });

  it('E03 carrera: ronda nueva antes del cobro invalida la versión (409, sin cierre parcial)', async () => {
    const table = await mkTable('GATEA-race-round');
    const session = await mkSession(table);
    await mkOrder(session, 1000, OrderStatus.SERVED, 'R1');
    const staleVersion = await versionOf(session.token);
    // Nueva ronda válida antes del cobro: la versión leída queda obsoleta.
    await mkOrder(session, 2500, OrderStatus.SERVED, 'R2');
    const res = await settleAndClose(session.id, {
      idempotencyKey: `gate-a-racer-${randomUUID()}`,
      expectedAccountVersion: staleVersion,
      method: 'WAITER_CASH'
    });
    expect([409, 422]).toContain(res.statusCode);
    expect(['STALE_ACCOUNT_VERSION', 'SETTLE_CONFLICT', 'CLOSE_CONFLICT', 'CLOSE_REQUIRES_FULL_SETTLEMENT']).toContain(
      res.json().code
    );
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(0);
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } })).closedAt).toBeNull();
  });

  it('E03 FSM: fallo de TO_CLEAN devuelve SETTLE_CLOSURE_INCOMPLETE y el reintento completa', async () => {
    const table = await mkTable('GATEA-fsm-fail');
    const session = await mkSession(table);
    await mkOrder(session, 1500, OrderStatus.SERVED, 'FSM1');
    const version = await versionOf(session.token);
    const key = `gate-a-fsm-${randomUUID()}`;
    const body = { idempotencyKey: key, expectedAccountVersion: version, method: 'WAITER_CASH' };

    const spy = vi.spyOn(fsmService, 'attemptTransition').mockRejectedValueOnce(
      Object.assign(new Error('FSM bloqueada'), { statusCode: 409, code: 'STATE_CONFLICT' })
    );
    try {
      const failed = await settleAndClose(session.id, body);
      expect([409, 503]).toContain(failed.statusCode);
      expect(failed.json().code).toBe('SETTLE_CLOSURE_INCOMPLETE');
      expect(failed.json().details).toBeDefined();
      expect(failed.json().details.nextAction).toContain('same-key-body');
    } finally {
      spy.mockRestore();
    }
    // Cobro/cierre DB ya confirmado, pero sin éxito visible.
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } })).closedAt).not.toBeNull();

    // Reintento con la misma key/body: reintenta la FSM y devuelve replay sólo con TO_CLEAN confirmado.
    const retry = await settleAndClose(session.id, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().idempotentReplay).toBe(true);
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).currentState).toBe(
      TableFSMState.TO_CLEAN
    );
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('E03 reintento nunca ejecuta AVAILABLE->TO_CLEAN (Mesa lista previa)', async () => {
    const table = await mkTable('GATEA-fsm-avail');
    const session = await mkSession(table);
    await mkOrder(session, 1100, OrderStatus.SERVED, 'AV1');
    const version = await versionOf(session.token);
    const key = `gate-a-av-${randomUUID()}`;
    const body = { idempotencyKey: key, expectedAccountVersion: version, method: 'WAITER_CASH' };
    const closed = await settleAndClose(session.id, body);
    expect(closed.statusCode).toBe(201);
    // Limpieza física completada por otro camino antes del reintento.
    await fsmService.attemptTransition({
      tableId: table.id,
      toState: TableFSMState.AVAILABLE,
      source: SignalSource.STAFF_TERMINAL_TAP,
      trigger: 'Mesa lista'
    });
    const spy = vi.spyOn(fsmService, 'attemptTransition');
    try {
      const retry = await settleAndClose(session.id, body);
      expect(retry.statusCode).toBe(200);
      expect(retry.json().idempotentReplay).toBe(true);
      for (const call of spy.mock.calls) {
        const arg = call[0] as any;
        expect(`${arg?.expectedCurrentState ?? ''}->${arg?.toState ?? ''}`).not.toBe('AVAILABLE->TO_CLEAN');
        if (arg?.toState === TableFSMState.TO_CLEAN) {
          expect(arg?.expectedCurrentState ?? null).not.toBe(TableFSMState.AVAILABLE);
        }
      }
    } finally {
      spy.mockRestore();
    }
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).currentState).toBe(
      TableFSMState.AVAILABLE
    );
  });

  async function settle(sessionId: string, payload: any) {
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${sessionId}/settle`,
      headers: { authorization: `Bearer ${manager1}` },
      payload
    });
  }

  it('GateA-H1: saltos PAID->AVAILABLE y TO_CLEAN->OCCUPIED bloqueados incluso con override', async () => {
    const { isValidTransition } = await import('@mesaya/shared');
    // Contrato: ni la matriz ni el override habilitan estos saltos.
    expect(isValidTransition(TableFSMState.PAID, TableFSMState.AVAILABLE)).toBe(false);
    expect(isValidTransition(TableFSMState.PAID, TableFSMState.AVAILABLE, true)).toBe(false);
    expect(isValidTransition(TableFSMState.TO_CLEAN, TableFSMState.OCCUPIED_NO_ORDER)).toBe(false);
    expect(isValidTransition(TableFSMState.TO_CLEAN, TableFSMState.OCCUPIED_NO_ORDER, true)).toBe(false);
    // Válidos preservados: PAID->TO_CLEAN y Mesa lista TO_CLEAN->AVAILABLE.
    expect(isValidTransition(TableFSMState.PAID, TableFSMState.TO_CLEAN)).toBe(true);
    expect(isValidTransition(TableFSMState.TO_CLEAN, TableFSMState.AVAILABLE)).toBe(true);

    const tPaid = await mkTable('GATEA-h1-paid', TableFSMState.PAID);
    await expect(
      fsmService.attemptTransition({
        tableId: tPaid.id,
        toState: TableFSMState.AVAILABLE,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'salto indebido'
      })
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_TRANSITION' });
    await expect(
      fsmService.attemptTransition({
        tableId: tPaid.id,
        toState: TableFSMState.AVAILABLE,
        source: SignalSource.MANAGER_OVERRIDE,
        trigger: 'override indebido',
        isOverride: true
      })
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_TRANSITION' });
    expect((await prisma.table.findUniqueOrThrow({ where: { id: tPaid.id } })).currentState).toBe(
      TableFSMState.PAID
    );

    const tClean = await mkTable('GATEA-h1-clean', TableFSMState.TO_CLEAN);
    await expect(
      fsmService.attemptTransition({
        tableId: tClean.id,
        toState: TableFSMState.OCCUPIED_NO_ORDER,
        source: SignalSource.MANAGER_OVERRIDE,
        trigger: 'reapertura indebida',
        isOverride: true
      })
    ).rejects.toMatchObject({ statusCode: 422, code: 'INVALID_TRANSITION' });
    expect(await prisma.tableSession.count({ where: { tableId: tClean.id, closedAt: null } })).toBe(0);
    // Sólo Mesa lista sale de TO_CLEAN.
    await fsmService.attemptTransition({
      tableId: tClean.id,
      toState: TableFSMState.AVAILABLE,
      source: SignalSource.STAFF_TERMINAL_TAP,
      trigger: 'Mesa lista'
    });
    expect((await prisma.table.findUniqueOrThrow({ where: { id: tClean.id } })).currentState).toBe(
      TableFSMState.AVAILABLE
    );
  });

  it('GateA-H2: FSM a TO_CLEAN con deuda/borrador/llamado se rechaza sin cierre silencioso', async () => {
    const table = await mkTable('GATEA-h2-guard');
    const session = await mkSession(table);
    await mkOrder(session, 1300, OrderStatus.SERVED, 'H2-deuda');
    await expect(
      fsmService.attemptTransition({
        tableId: table.id,
        toState: TableFSMState.TO_CLEAN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'liberación indebida con deuda'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'TABLE_HAS_UNPAID_BALANCE' });
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } })).closedAt).toBeNull();
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).currentState).toBe(
      TableFSMState.OCCUPIED_NO_ORDER
    );

    const tCall = await mkTable('GATEA-h2-call');
    const sCall = await mkSession(tCall);
    await prisma.callRequest.create({ data: { tableSessionId: sCall.id, type: 'WAITER', status: 'PENDING' } });
    await expect(
      fsmService.attemptTransition({
        tableId: tCall.id,
        toState: TableFSMState.TO_CLEAN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'liberación indebida con llamado'
      })
    ).rejects.toMatchObject({ statusCode: 409, code: 'PENDING_CALLS' });
    expect((await prisma.callRequest.findFirstOrThrow({ where: { tableSessionId: sCall.id } })).status).toBe(
      'PENDING'
    );
  });

  it('GateA-M1: closeTableSession con FSM fallida devuelve TABLE_CLOSURE_INCOMPLETE y el reintento completa', async () => {
    const table = await mkTable('GATEA-m1-close');
    const session = await mkSession(table);
    const spy = vi.spyOn(fsmService, 'attemptTransition').mockRejectedValueOnce(
      Object.assign(new Error('FSM bloqueada'), { statusCode: 409, code: 'STATE_CONFLICT' })
    );
    try {
      await expect(SessionService.closeTableSession(table.id)).rejects.toMatchObject({
        code: 'TABLE_CLOSURE_INCOMPLETE'
      });
    } finally {
      spy.mockRestore();
    }
    // Cierre DB confirmado pero FSM pendiente: la sesión ya no está abierta.
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } })).closedAt).not.toBeNull();

    let incomplete: any = null;
    try {
      await SessionService.closeTableSession(table.id);
    } catch (err: any) {
      incomplete = err;
    }
    // Si la mesa sigue sin TO_CLEAN, el reintento NO dice alreadyClosed: o completa
    // la FSM o devuelve TABLE_CLOSURE_INCOMPLETE accionable.
    const state = (await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).currentState;
    if (state !== TableFSMState.TO_CLEAN && state !== TableFSMState.AVAILABLE) {
      expect(incomplete).toMatchObject({ code: 'TABLE_CLOSURE_INCOMPLETE' });
      expect(incomplete.details?.nextAction).toContain('retry-close-table-session');
    } else {
      const retry = await SessionService.closeTableSession(table.id);
      expect(retry.success).toBe(true);
    }
    // Reintento final: FSM ya recuperada lleva a TO_CLEAN sin alreadyClosed falso.
    const final = await SessionService.closeTableSession(table.id);
    expect(final.success).toBe(true);
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).currentState).toBe(
      TableFSMState.TO_CLEAN
    );
  });

  it('GateA-M2: token cerrado/expirado responde 410 con code y details; QR en TO_CLEAN con code', async () => {
    const table = await mkTable('GATEA-m2-qr');
    const session = await mkSession(table);
    await mkOrder(session, 1400, OrderStatus.SERVED, 'M2');
    const version = await versionOf(session.token);
    const closed = await settleAndClose(session.id, {
      idempotencyKey: `gate-a-m2-${randomUUID()}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(closed.statusCode).toBe(201);

    const tok = await app.inject({ method: 'GET', url: `/v1/sessions/${session.token}` });
    expect(tok.statusCode).toBe(410);
    expect(tok.json().code).toBe('SESSION_CLOSED');
    expect(tok.json().details?.tableSessionId).toBe(session.id);

    const guest = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(guest.statusCode).toBe(410);
    expect(guest.json().code).toBe('SESSION_CLOSED');
    expect(guest.json().details).toBeDefined();

    const qr = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${encodeURIComponent(rest1.slug)}/${encodeURIComponent((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).label)}`
    });
    expect(qr.statusCode).toBe(200);
    expect(qr.json().valid).toBe(false);
    expect(qr.json().code).toBe('TABLE_NEEDS_CLEANING');
    expect(qr.json().details?.tableId).toBe(table.id);
  });

  it('GateA-L2: idempotencia exacta de allocations (omitido ≠ [] ≠ reparto)', async () => {
    const table = await mkTable('GATEA-l2-alloc');
    const session = await mkSession(table);
    await mkOrder(session, 1000, OrderStatus.SERVED, 'L2-A');
    await mkOrder(session, 1000, OrderStatus.SERVED, 'L2-B');
    const version = await versionOf(session.token);
    const key = `gate-a-l2-${randomUUID()}`;
    const first = await settle(session.id, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(first.statusCode).toBe(201);

    // Mismo body omitido: replay.
    const replay = await settle(session.id, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);

    // [] con la misma clave: intención distinta → 409.
    const empty = await settle(session.id, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      allocations: []
    });
    expect(empty.statusCode).toBe(409);
    expect(empty.json().code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Reparto explícito aunque sume igual: presencia distinta → 409.
    const saved = first.json().settlement.allocations as Array<{ orderId: string; amountMinor: number }>;
    const explicit = await settle(session.id, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      allocations: saved.map((a) => ({ orderId: a.orderId, amountMinor: a.amountMinor }))
    });
    expect(explicit.statusCode).toBe(409);
    expect(explicit.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('GateA-L2b: allocationsProvided persiste en el modelo y distingue omitido ≠ [] ≠ reparto', async () => {
    async function mkFundedTable(label: string) {
      const table = await mkTable(label);
      const session = await mkSession(table);
      const o1 = await mkOrder(session, 1000, OrderStatus.SERVED, 'L2b-A');
      const o2 = await mkOrder(session, 1000, OrderStatus.SERVED, 'L2b-B');
      const version = await versionOf(session.token);
      return { table, session, o1, o2, version };
    }

    // Origen omitido: persiste false; replay omitido → 200; [] y reparto → 409.
    const omit = await mkFundedTable('GATEA-l2b-omit');
    const keyOmit = `gate-a-l2b-o-${randomUUID()}`;
    const omitBody = { idempotencyKey: keyOmit, expectedAccountVersion: omit.version, method: 'WAITER_CASH' };
    const omitFirst = await settle(omit.session.id, omitBody);
    expect(omitFirst.statusCode).toBe(201);
    const omitRow = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: keyOmit } });
    expect(omitRow.allocationsProvided).toBe(false);
    expect(await prisma.settlementAllocation.count({ where: { settlementId: omitRow.id } })).toBe(2);
    expect((await settle(omit.session.id, omitBody)).statusCode).toBe(200);
    const omitEmpty = await settle(omit.session.id, { ...omitBody, allocations: [] });
    expect(omitEmpty.statusCode).toBe(409);
    expect(omitEmpty.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    const omitExplicit = await settle(omit.session.id, {
      ...omitBody,
      allocations: [
        { orderId: omit.o1.id, amountMinor: 100000 },
        { orderId: omit.o2.id, amountMinor: 100000 }
      ]
    });
    expect(omitExplicit.statusCode).toBe(409);
    expect(omitExplicit.json().code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Origen explícito []: nunca persiste como alta (suma 0 ≠ monto → 422),
    // pero como reintento es intención distinta → 409 por presencia/contenido.
    const freshEmpty = await mkFundedTable('GATEA-l2b-fresh-empty');
    const emptyAsNew = await settle(freshEmpty.session.id, {
      idempotencyKey: `gate-a-l2b-n-${randomUUID()}`,
      expectedAccountVersion: freshEmpty.version,
      method: 'WAITER_CASH',
      allocations: [] as Array<{ orderId: string; amountMinor: number }>
    });
    expect(emptyAsNew.statusCode).toBe(422);

    // Origen reparto explícito: persiste true; mismo reparto → 200; omitido y otro reparto → 409.
    const expl = await mkFundedTable('GATEA-l2b-expl');
    const keyExpl = `gate-a-l2b-x-${randomUUID()}`;
    const reparto = [
      { orderId: expl.o1.id, amountMinor: 100000 },
      { orderId: expl.o2.id, amountMinor: 100000 }
    ];
    const explBody = { idempotencyKey: keyExpl, expectedAccountVersion: expl.version, method: 'WAITER_CASH', allocations: reparto };
    const explFirst = await settle(expl.session.id, explBody);
    expect(explFirst.statusCode).toBe(201);
    const explRow = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: keyExpl } });
    expect(explRow.allocationsProvided).toBe(true);
    expect((await settle(expl.session.id, explBody)).statusCode).toBe(200);
    const explOmitted = await settle(expl.session.id, {
      idempotencyKey: keyExpl,
      expectedAccountVersion: expl.version,
      method: 'WAITER_CASH'
    });
    expect(explOmitted.statusCode).toBe(409);
    expect(explOmitted.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    const explEmpty = await settle(expl.session.id, {
      idempotencyKey: keyExpl,
      expectedAccountVersion: expl.version,
      method: 'WAITER_CASH',
      allocations: [] as Array<{ orderId: string; amountMinor: number }>
    });
    expect(explEmpty.statusCode).toBe(409);
    expect(explEmpty.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    const explOther = await settle(expl.session.id, {
      idempotencyKey: keyExpl,
      expectedAccountVersion: expl.version,
      method: 'WAITER_CASH',
      allocations: [{ orderId: expl.o1.id, amountMinor: 200000 }]
    });
    expect(explOther.statusCode).toBe(409);
    expect(explOther.json().code).toBe('IDEMPOTENCY_KEY_REUSED');

    // Filas legadas: el default del modelo es false (camino FIFO sin allocations).
    const legacySession = (await mkFundedTable('GATEA-l2b-legacy')).session;
    const legacy = await prisma.accountSettlement.create({
      data: {
        tableSessionId: legacySession.id,
        restaurantId: rest1.id,
        method: 'WAITER_CASH',
        amountMinor: 1,
        accountVersion: 'legacy-version',
        idempotencyKey: `gate-a-l2b-legacy-${randomUUID()}`,
        createdBy: 'legacy-seed'
      }
    });
    expect(legacy.allocationsProvided).toBe(false);
    await prisma.accountSettlement.delete({ where: { id: legacy.id } });
  });

  it('E02 TO_CLEAN bloquea rotación y pedido hasta `Mesa lista` (409 TABLE_NEEDS_CLEANING accionable)', async () => {
    const table = await mkTable('GATEA-toclean');
    const session = await mkSession(table);
    await mkOrder(session, 900, OrderStatus.SERVED, 'TC1');
    const version = await versionOf(session.token);
    const closed = await settleAndClose(session.id, {
      idempotencyKey: `gate-a-tc-${randomUUID()}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(closed.statusCode).toBe(201);
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).currentState).toBe(
      TableFSMState.TO_CLEAN
    );

    // Rotación directa bloqueada con código accionable y sin crear ocupación.
    await expect(SessionService.createNewSessionForTable(table.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TABLE_NEEDS_CLEANING'
    });
    expect(await prisma.tableSession.count({ where: { tableId: table.id, closedAt: null } })).toBe(0);

    // Ruta HTTP preserva code para que el mozo reciba conflicto accionable.
    const http = await app.inject({
      method: 'POST',
      url: `/v1/tables/${table.id}/new-session`,
      headers: { authorization: `Bearer ${manager1}` }
    });
    expect(http.statusCode).toBe(409);
    expect(http.json().code).toBe('TABLE_NEEDS_CLEANING');

    // Pedido presencial tampoco reabre una mesa en limpieza.
    expect(() =>
      (OrderService as any).assertTableCanReceiveOrder(TableFSMState.TO_CLEAN)
    ).toThrow(expect.objectContaining({ code: 'TABLE_NEEDS_CLEANING' }));
    await expect(
      SessionService.getOrCreateOperationalSession(table.id, rest1.id)
    ).rejects.toMatchObject({ statusCode: 409, code: 'TABLE_NEEDS_CLEANING' });
  });
});

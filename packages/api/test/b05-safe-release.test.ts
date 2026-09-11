import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { OrderService } from '../src/services/order.service';
import { SessionService } from '../src/services/session.service';
import { fsmService } from '../src/services/fsm.service';
import { SignalSource } from '@mesaya/shared';

/**
 * B05 — estados agregados y liberación segura (contrato C7, invariantes I5/I7).
 * Cierre explícito y atómico sobre la cuenta B03/B04 como verdad: sin deuda,
 * sin borrador, sin validación pendiente y sin llamados pendientes. Sin
 * auto-resolve, sin marcar fulfillment, sin borrar ledger. Pagada ≠ disponible.
 * Fixture real en SQLite efímera, sin mocks de persistencia.
 */
describe('B05 — liberación segura por cuenta', () => {
  let app: FastifyInstance;
  let rest1: any;
  let shift1: any;
  let cat1: any;
  let manager1: string;
  let waiter1: string;

  async function mkTable(label: string, extra: any = {}) {
    return prisma.table.create({
      data: {
        restaurantId: rest1.id,
        label: `${label}-${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4,
        ...extra
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

  async function mkCall(session: any, type: string) {
    return prisma.callRequest.create({
      data: { tableSessionId: session.id, type, status: 'PENDING' }
    });
  }

  async function settleReq(sessionId: string, token: string, payload: any) {
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${sessionId}/settle`,
      headers: { authorization: `Bearer ${token}` },
      payload
    });
  }

  async function settleFull(session: any, token: string) {
    const version = (
      await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` })
    ).json().account.version;
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${token}` },
      payload: { idempotencyKey: `b05-${randomUUID()}`, expectedAccountVersion: version, method: 'WAITER_CASH' }
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    rest1 = await prisma.restaurant.create({
      data: {
        name: 'b05-r1',
        slug: `b05-r1-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    shift1 = await prisma.shift.create({ data: { restaurantId: rest1.id, openedAt: new Date() } });
    cat1 = await prisma.menuCategory.create({ data: { restaurantId: rest1.id, name: 'B05', orderIndex: 0 } });
    await prisma.staffUser.create({
      data: { restaurantId: rest1.id, name: 'Manager B05', pinHash: await bcrypt.hash('9999', 10), role: 'MANAGER' }
    });
    await prisma.staffUser.create({
      data: { restaurantId: rest1.id, name: 'Mozo B05', pinHash: await bcrypt.hash('1234', 10), role: 'WAITER' }
    });
    manager1 = (
      await app.inject({ method: 'POST', url: '/v1/auth/login-admin', payload: { restaurantSlug: rest1.slug, pin: '9999' } })
    ).json().token;
    waiter1 = (
      await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: rest1.slug, pin: '1234' } })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('(1) settlement completo: fulfillment intacto y sin saldo pendiente', async () => {
    const table = await mkTable('Mesa B05-1');
    const session = await mkSession(table);
    await mkOrder(session, 1000, OrderStatus.SERVED, 'T1');
    await mkOrder(session, 2500, OrderStatus.IN_KITCHEN, 'T2');
    const res = await settleFull(session, manager1);
    expect(res.statusCode).toBe(201);

    const balance = await OrderService.hasUnpaidBalance(table.id);
    expect(balance.hasUnpaid).toBe(false);
    expect(balance.remainingMinor).toBe(0);
    expect(balance.remainingAmount).toBe(0);
    // Pagar no marca fulfillment: las tandas conservan su estado de cocina.
    const orders = await prisma.order.findMany({ where: { tableSessionId: session.id }, select: { status: true } });
    expect(orders.map((o) => o.status).sort()).toEqual([OrderStatus.IN_KITCHEN, OrderStatus.SERVED].sort());
  });

  it('(2) settlement parcial bloquea el cierre con 409 y no cambia closedAt', async () => {
    const table = await mkTable('Mesa B05-2');
    const session = await mkSession(table);
    const o1 = await mkOrder(session, 1000, OrderStatus.SERVED, 'T1');
    await mkOrder(session, 2500, OrderStatus.SERVED, 'T2');
    const version = (
      await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` })
    ).json().account.version;
    const partial = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: {
        idempotencyKey: `b05-p-${randomUUID()}`,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        amountMinor: 100000,
        allocations: [{ orderId: o1.id, amountMinor: 100000 }]
      }
    });
    expect(partial.statusCode).toBe(201);

    await expect(SessionService.closeTableSession(table.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TABLE_HAS_UNPAID_BALANCE'
    });
    const intact = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(intact.closedAt).toBeNull();
  });

  it('(3) draft y validación pendiente bloquean hasta resolución explícita y no se cobran', async () => {
    const table = await mkTable('Mesa B05-3');
    const session = await mkSession(table);
    const draft = await mkOrder(session, 700, OrderStatus.DRAFT, 'Carrito');
    const pending = await mkOrder(session, 600, OrderStatus.PENDING_VALIDATION, 'Por confirmar');

    await expect(SessionService.closeTableSession(table.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DRAFT_UNRESOLVED'
    });
    // El borrador no se borró ni se convirtió en consumo.
    expect(await prisma.order.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ status: OrderStatus.DRAFT });

    // Resolución explícita: validar la tanda pendiente por el canal de personal...
    await OrderService.validateOrder(pending.id, 'Mozo', rest1.id);
    // ...y descartar el borrador por su propio contrato (delete de ítem), no por el cierre.
    const draftItems = await prisma.orderItem.findMany({ where: { orderId: draft.id }, select: { id: true } });
    for (const item of draftItems) {
      await OrderService.removeItem(session.token, item.id);
    }
    expect(await prisma.order.deleteMany({ where: { id: draft.id } })).toMatchObject({ count: 1 });

    // La tanda validada sí integra consumo: se liquida y entonces cierra.
    const settled = await settleFull(session, manager1);
    expect(settled.statusCode).toBe(201);
    const closed = await SessionService.closeTableSession(table.id);
    expect(closed.success).toBe(true);
  });

  it('(4) llamados pendientes bloquean y no son auto-resueltos', async () => {
    const table = await mkTable('Mesa B05-4');
    const session = await mkSession(table);
    const call = await mkCall(session, 'WAITER');

    await expect(SessionService.closeTableSession(table.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'PENDING_CALLS'
    });
    // Sin auto-resolve: el llamado sigue pendiente tras el cierre fallido.
    expect((await prisma.callRequest.findUniqueOrThrow({ where: { id: call.id } })).status).toBe('PENDING');

    // Resolución explícita por el canal de personal, luego el cierre procede.
    const resolved = await app.inject({
      method: 'PATCH',
      url: `/v1/calls/${call.id}`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: { status: 'RESOLVED' }
    });
    expect(resolved.statusCode).toBe(200);
    const closed = await SessionService.closeTableSession(table.id);
    expect(closed.success).toBe(true);
    expect((await prisma.callRequest.findUniqueOrThrow({ where: { id: call.id } })).status).toBe('RESOLVED');
  });

  it('(5) cierre explícito tras saldo cero revoca token, marca TO_CLEAN y conserva ledger', async () => {
    const table = await mkTable('Mesa B05-5');
    const session = await mkSession(table);
    await mkOrder(session, 1800, OrderStatus.SERVED, 'T1');
    expect((await settleFull(session, manager1)).statusCode).toBe(201);

    const closed = await SessionService.closeTableSession(table.id);
    expect(closed.success).toBe(true);
    const after = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.closedAt).not.toBeNull();
    expect(after.activeKey).toBeNull();
    const tableAfter = await prisma.table.findUniqueOrThrow({ where: { id: table.id } });
    expect(tableAfter.currentState).toBe(TableFSMState.TO_CLEAN);
    expect(tableAfter.currentState).not.toBe(TableFSMState.AVAILABLE);
    // Ledger intacto: nada se borra al cerrar.
    expect(await prisma.order.count({ where: { tableSessionId: session.id } })).toBe(1);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
    // Token revocado: el canal público responde 410; caja del personal sigue disponible.
    const guest = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(guest.statusCode).toBe(410);
    const cash = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${rest1.id}/cash-orders`,
      headers: { authorization: `Bearer ${manager1}` }
    });
    expect(cash.statusCode).toBe(200);
  });

  it('(6) nueva ocupación: sesión/token/cuenta cero sin heredar ledger', async () => {
    const table = await mkTable('Mesa B05-6');
    const oldSession = await mkSession(table);
    await mkOrder(oldSession, 900, OrderStatus.SERVED, 'T1');
    expect((await settleFull(oldSession, manager1)).statusCode).toBe(201);
    expect((await SessionService.closeTableSession(table.id)).success).toBe(true);

    // E02: TO_CLEAN bloquea rotación hasta `Mesa lista`; verificar bloqueo accionable.
    await expect(SessionService.createNewSessionForTable(table.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'TABLE_NEEDS_CLEANING'
    });

    // Recambio canónico: `Mesa lista` (TO_CLEAN → AVAILABLE) habilita la siguiente ocupación.
    await fsmService.attemptTransition({
      tableId: table.id,
      toState: TableFSMState.AVAILABLE,
      source: SignalSource.STAFF_TERMINAL_TAP,
      trigger: 'Mesa lista'
    });

    const token = await SessionService.createNewSessionForTable(table.id);
    expect(token).not.toBe(oldSession.token);
    const fresh = await prisma.tableSession.findFirstOrThrow({
      where: { tableId: table.id, closedAt: null },
      include: { orders: true }
    });
    expect(fresh.token).toBe(token);
    expect(fresh.orders).toHaveLength(0);
    const account = await OrderService.getSessionAccount(fresh.id);
    expect(account.consumoMinor).toBe(0);
    expect(account.tandas).toHaveLength(0);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: fresh.id } })).toBe(0);
    // El ledger de la ocupación anterior sigue intacto y separado.
    expect(await prisma.order.count({ where: { tableSessionId: oldSession.id } })).toBe(1);
  });

  it('(7) otra mesa y mesa merged no comparten cuenta', async () => {
    const tableA = await mkTable('Mesa B05-7a');
    const tableB = await mkTable('Mesa B05-7b', { mergedWithTableId: tableA.id });
    const sessionA = await mkSession(tableA);
    const sessionB = await mkSession(tableB);
    await mkOrder(sessionA, 1000, OrderStatus.SERVED, 'A1');
    await mkOrder(sessionB, 2500, OrderStatus.SERVED, 'B1');

    const accountA = await OrderService.getSessionAccount(sessionA.id);
    const accountB = await OrderService.getSessionAccount(sessionB.id);
    expect(accountA.consumoMinor).toBe(100000);
    expect(accountB.consumoMinor).toBe(250000);

    // A limpia y cierra; B con deuda sigue bloqueada aunque estén "unidas" en el plano.
    expect((await settleFull(sessionA, manager1)).statusCode).toBe(201);
    expect((await SessionService.closeTableSession(tableA.id)).success).toBe(true);
    await expect(SessionService.closeTableSession(tableB.id)).rejects.toMatchObject({
      code: 'TABLE_HAS_UNPAID_BALANCE'
    });
    expect((await OrderService.getSessionAccount(sessionB.id)).saldoMinor).toBe(250000);
  });

  it('(8) carrera liquidar-vs-cerrar: estado final consistente sin 500 ni deuda perdida', async () => {
    const table = await mkTable('Mesa B05-8');
    const session = await mkSession(table);
    await mkOrder(session, 3000, OrderStatus.SERVED, 'T1');
    const version = (
      await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` })
    ).json().account.version;

    const [settleRes, closeRes] = await Promise.allSettled([
      app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${manager1}` },
        payload: { idempotencyKey: `b05-race-${randomUUID()}`, expectedAccountVersion: version, method: 'WAITER_CASH' }
      }),
      SessionService.closeTableSession(table.id)
    ]);
    const codes = [settleRes, closeRes].map((r) => {
      if (r.status === 'fulfilled') return 'statusCode' in r.value ? r.value.statusCode : 200;
      return (r.reason as any)?.statusCode || 500;
    });
    // Sin errores internos en ningún orden de llegada.
    expect(codes.every((c) => c !== 500)).toBe(true);
    const settledCount = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
    expect(settledCount).toBeLessThanOrEqual(1);
    const account = await OrderService.getSessionAccount(session.id);
    const closed = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
    if (closed.closedAt) {
      // Si cerró, fue sin deuda y con el pago registrado.
      expect(account.saldoMinor).toBe(0);
      expect(settledCount).toBe(1);
    } else {
      // Si sigue abierta, el pago quedó registrado y el saldo es cero.
      expect(settledCount).toBe(1);
      expect(account.saldoMinor).toBe(0);
    }
  });

  it('(10) sesión cerrada no acepta nuevos cobros; replay seguro intacto', async () => {
    const table = await mkTable('Mesa B05-10');
    const session = await mkSession(table);
    await mkOrder(session, 1500, OrderStatus.SERVED, 'T1');
    const version = (
      await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` })
    ).json().account.version;
    const key = `b05-closed-${randomUUID()}`;
    const payload = {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    };
    expect((await settleReq(session.id, manager1, payload)).statusCode).toBe(201);
    expect((await SessionService.closeTableSession(table.id)).success).toBe(true);

    // Replay de la misma intención tras el cierre: 200 seguro, sin duplicar.
    const replay = await settleReq(session.id, manager1, payload);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().idempotentReplay).toBe(true);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);

    // Nueva intención tras el cierre: 409 SESSION_CLOSED sin escribir.
    const fresh = await OrderService.getSessionAccount(session.id);
    const blocked = await settleReq(session.id, manager1, {
      idempotencyKey: `b05-closed-new-${randomUUID()}`,
      expectedAccountVersion: fresh.version,
      method: 'WAITER_CASH'
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SESSION_CLOSED');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } })).closedAt).not.toBeNull();
  });

  it('(9) permisos: waiter cierra mesa limpia, force exige manager+motivo y nunca salta deuda', async () => {
    const cleanTable = await mkTable('Mesa B05-9a');
    await mkSession(cleanTable);
    // Mozo cierra mesa limpia por la ruta (política vigente conservada).
    const waiterClose = await app.inject({
      method: 'POST',
      url: `/v1/tables/${cleanTable.id}/close-session`,
      headers: { authorization: `Bearer ${waiter1}` },
      payload: {}
    });
    expect(waiterClose.statusCode).toBe(200);

    // Mozo con force → 403 en ruta.
    const waiterForce = await app.inject({
      method: 'POST',
      url: `/v1/tables/${cleanTable.id}/close-session`,
      headers: { authorization: `Bearer ${waiter1}` },
      payload: { force: true, reason: 'quiero' }
    });
    expect(waiterForce.statusCode).toBe(403);

    // Manager con force SIN motivo → 400.
    const debtTable = await mkTable('Mesa B05-9b');
    const debtSession = await mkSession(debtTable);
    await mkOrder(debtSession, 1200, OrderStatus.SERVED, 'T1');
    const noReason = await app.inject({
      method: 'POST',
      url: `/v1/tables/${debtTable.id}/close-session`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: { force: true }
    });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().code).toBe('FORCE_REASON_REQUIRED');

    // Manager con force Y motivo ante deuda → 409: force nunca salta deuda.
    const withReason = await app.inject({
      method: 'POST',
      url: `/v1/tables/${debtTable.id}/close-session`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: { force: true, reason: 'cierre de prueba con deuda' }
    });
    expect(withReason.statusCode).toBe(409);
    expect(withReason.json().code).toBe('TABLE_HAS_UNPAID_BALANCE');
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: debtSession.id } })).closedAt).toBeNull();
  });
});

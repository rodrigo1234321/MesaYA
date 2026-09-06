import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState, SignalSource } from '@mesaya/shared';
import { BillService } from '../src/services/bill.service';
import { fsmService } from '../src/services/fsm.service';
import { eventBus } from '../src/lib/eventBus';
import crypto from 'crypto';

/**
 * Etapa 09 fix residual — regresión:
 * 1. Remanente no asignado en pagos dirigidos (participante / ítem) => 409
 *    UNALLOCATED_PAYMENT_REMAINDER con rollback total (sin PaymentTransaction).
 * 2. Idempotencia simétrica con requestedOrderItemId (normal + fallback P2002).
 * 3. participantId REVOKED / ajeno y sesión cerrada/expirada.
 * 4. FSM transaccional: falla de OccupancySession dentro de tx => rollback sin broadcast previo.
 */
describe('Etapa 09 residual — remanente dirigido, idempotencia por ítem, guards de sesión y FSM tx', () => {
  let app: FastifyInstance;
  let rest: any;
  let shift: any;
  let waiter: any;
  let manager: any;
  let tokenWaiter: string;
  let tokenManager: string;
  let menuItem: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const ts = Date.now();
    rest = await prisma.restaurant.create({
      data: { name: 'Residual 09', slug: `residual-09-${ts}` }
    });
    shift = await prisma.shift.create({
      data: { restaurantId: rest.id, activeKey: rest.id }
    });
    waiter = await prisma.staffUser.create({
      data: { restaurantId: rest.id, name: 'Mozo Residual', pinHash: 'x', role: 'WAITER' }
    });
    manager = await prisma.staffUser.create({
      data: { restaurantId: rest.id, name: 'Manager Residual', pinHash: 'y', role: 'MANAGER' }
    });
    tokenWaiter = app.jwt.sign({ sub: waiter.id, restaurantId: rest.id, role: 'WAITER', name: waiter.name });
    tokenManager = app.jwt.sign({ sub: manager.id, restaurantId: rest.id, role: 'MANAGER', name: manager.name });

    const cat = await prisma.menuCategory.create({
      data: { restaurantId: rest.id, name: `Carta Residual ${ts}` }
    });
    menuItem = await prisma.menuItem.create({
      data: { categoryId: cat.id, name: 'Plato Residual', price: 5000, priceCents: 500000, isAvailable: true }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  async function createTableWithSession(opts: {
    label: string;
    withItems: Array<{ participantIdx?: number; cents: number; claimedByIdx?: number }>;
    participantCount?: number;
  }) {
    const ts = Date.now() + Math.floor(Math.random() * 100000);
    const table = await prisma.table.create({
      data: { restaurantId: rest.id, label: `${opts.label} ${ts}`, currentState: TableFSMState.EATING }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: `tok-residual-${ts}-${Math.random()}`,
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 3600 * 1000)
      }
    });
    const participantCount = opts.participantCount ?? 2;
    const participants: any[] = [];
    for (let i = 0; i < participantCount; i++) {
      participants.push(
        await prisma.visitParticipant.create({
          data: {
            tableSessionId: session.id,
            displayName: `Comensal ${i}`,
            tokenHash: crypto.createHash('sha256').update(`res-token-${ts}-${i}`).digest('hex'),
            status: 'ACTIVE'
          }
        })
      );
    }
    const order = await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalCents: opts.withItems.reduce((s, it) => s + it.cents, 0),
        totalAmount: opts.withItems.reduce((s, it) => s + it.cents, 0) / 100,
        currency: 'ARS'
      }
    });
    const items: any[] = [];
    for (const spec of opts.withItems) {
      items.push(
        await prisma.orderItem.create({
          data: {
            orderId: order.id,
            menuItemId: menuItem.id,
            quantity: 1,
            unitPrice: spec.cents / 100,
            unitPriceCents: spec.cents,
            lineTotalCents: spec.cents,
            productNameSnapshot: 'Plato Residual',
            addedByGuest: 'Tester',
            participantId: spec.participantIdx !== undefined ? participants[spec.participantIdx].id : null,
            claimedByGuest: spec.claimedByIdx !== undefined ? participants[spec.claimedByIdx].id : null,
            currency: 'ARS',
            isPaid: false
          }
        })
      );
    }
    return { table, session, participants, order, items };
  }

  async function settle(body: any, token = tokenWaiter) {
    return app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${token}` },
      payload: body
    });
  }

  it('1. Pago dirigido a participante que excede su saldo asignable (sin exceder el global) => 409 UNALLOCATED_PAYMENT_REMAINDER y rollback total', async () => {
    const ts = Date.now();
    // Ana: $5.000 (500000) | Bruno: $3.000 (300000). Total $8.000.
    const { session, participants, items } = await createTableWithSession({
      label: 'Mesa Remanente Part',
      withItems: [
        { participantIdx: 0, claimedByIdx: 0, cents: 500000 },
        { participantIdx: 1, claimedByIdx: 1, cents: 300000 }
      ]
    });

    // Ana intenta pagar $6.000: cabe en el global ($8.000) pero su objetivo sólo cubre $5.000.
    const key = `rem-part-${ts}`;
    const res = await settle({
      tableSessionId: session.id,
      amountCents: 600000,
      paymentMethod: 'WAITER_CASH',
      participantId: participants[0].id,
      idempotencyKey: key
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('UNALLOCATED_PAYMENT_REMAINDER');

    // Rollback total: ni la transacción ni allocations persisten.
    const leaked = await prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } });
    expect(leaked).toBeNull();
    const allocs = await prisma.paymentAllocation.findMany({
      where: { orderItemId: { in: items.map((i: any) => i.id) } }
    });
    expect(allocs).toHaveLength(0);

    // Ítems intactos y saldo global intacto.
    for (const it of items) {
      const fresh = await prisma.orderItem.findUnique({ where: { id: it.id } });
      expect(fresh?.isPaid).toBe(false);
    }
    const bill = await BillService.calculateTableBill(session.id);
    expect(bill.paidCents).toBe(0);
    expect(bill.remainingCents).toBe(800000);
  });

  it('2. Pago dirigido a orderItemId que excede el saldo del ítem => 409 y rollback total', async () => {
    const ts = Date.now();
    const { session, items } = await createTableWithSession({
      label: 'Mesa Remanente Item',
      withItems: [{ cents: 300000 }, { cents: 500000 }]
    });

    const key = `rem-item-${ts}`;
    const res = await settle({
      tableSessionId: session.id,
      amountCents: 400000, // el ítem 0 sólo admite 300000; el global admite 800000
      paymentMethod: 'WAITER_CARD',
      orderItemId: items[0].id,
      idempotencyKey: key
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('UNALLOCATED_PAYMENT_REMAINDER');
    expect(await prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } })).toBeNull();
    const bill = await BillService.calculateTableBill(session.id);
    expect(bill.paidCents).toBe(0);
    expect(bill.remainingCents).toBe(800000);
  });

  it('3. Misma idempotencyKey con distinto orderItemId => 409 IDEMPOTENCY_CONFLICT; reintento idéntico => duplicate', async () => {
    const ts = Date.now();
    const { session, items } = await createTableWithSession({
      label: 'Mesa Idem Item',
      withItems: [{ cents: 300000 }, { cents: 300000 }]
    });

    const key = `idem-item-${ts}`;
    const first = await settle({
      tableSessionId: session.id,
      amountCents: 300000,
      paymentMethod: 'WAITER_CASH',
      orderItemId: items[0].id,
      idempotencyKey: key
    });
    expect(first.statusCode).toBe(201);

    // El objetivo dirigido quedó persistido para comparación simétrica.
    const persisted = await prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } });
    expect((persisted as any)?.requestedOrderItemId).toBe(items[0].id);

    // Misma clave, otro ítem, mismo importe/método => conflicto.
    const conflict = await settle({
      tableSessionId: session.id,
      amountCents: 300000,
      paymentMethod: 'WAITER_CASH',
      orderItemId: items[1].id,
      idempotencyKey: key
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe('IDEMPOTENCY_CONFLICT');

    // Reintento exacto (mismo ítem) => duplicate sin crear otra transacción.
    const retry = await settle({
      tableSessionId: session.id,
      amountCents: 300000,
      paymentMethod: 'WAITER_CASH',
      orderItemId: items[0].id,
      idempotencyKey: key
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect(retry.json().transaction.id).toBe(first.json().transaction.id);
    expect(await prisma.paymentTransaction.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('4. Participante REVOKED => 409 PARTICIPANT_NOT_ACTIVE y sin persistencia', async () => {
    const ts = Date.now();
    const { session, participants } = await createTableWithSession({
      label: 'Mesa Revoked',
      withItems: [{ participantIdx: 0, claimedByIdx: 0, cents: 500000 }]
    });
    await prisma.visitParticipant.update({
      where: { id: participants[0].id },
      data: { status: 'REVOKED', revokedAt: new Date() }
    });

    const key = `revoked-${ts}`;
    const res = await settle({
      tableSessionId: session.id,
      amountCents: 100000,
      paymentMethod: 'WAITER_CASH',
      participantId: participants[0].id,
      idempotencyKey: key
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('PARTICIPANT_NOT_ACTIVE');
    expect(await prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } })).toBeNull();
  });

  it('5. Sesión cerrada o expirada rechaza pagos nuevos pero conserva el reintento idempotente válido', async () => {
    const ts = Date.now();
    const { table, session } = await createTableWithSession({
      label: 'Mesa Cerrada',
      withItems: [{ cents: 500000 }]
    });

    // Pago válido previo al cierre.
    const key = `closed-retry-${ts}`;
    const first = await settle({
      tableSessionId: session.id,
      amountCents: 100000,
      paymentMethod: 'WAITER_CASH',
      idempotencyKey: key
    });
    expect(first.statusCode).toBe(201);

    // Cierre forzoso con deuda remanente.
    const closeRes = await app.inject({
      method: 'POST',
      url: `/v1/tables/${table.id}/close-session`,
      headers: { Authorization: `Bearer ${tokenManager}` },
      payload: { force: true }
    });
    expect(closeRes.statusCode).toBe(200);

    // Pago NUEVO sobre sesión cerrada => 409 SESSION_CLOSED sin persistencia.
    const freshKey = `closed-new-${ts}`;
    const blocked = await settle({
      tableSessionId: session.id,
      amountCents: 50000,
      paymentMethod: 'WAITER_CASH',
      idempotencyKey: freshKey
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().code).toBe('SESSION_CLOSED');
    expect(await prisma.paymentTransaction.findUnique({ where: { idempotencyKey: freshKey } })).toBeNull();

    // Reintento EXACTO del pago válido previo => duplicate (no SESSION_CLOSED).
    const retry = await settle({
      tableSessionId: session.id,
      amountCents: 100000,
      paymentMethod: 'WAITER_CASH',
      idempotencyKey: key
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);

    // Sesión expirada (abierta pero con TTL vencido) => 409 SESSION_EXPIRED.
    const expiredCtx = await createTableWithSession({
      label: 'Mesa Expirada',
      withItems: [{ cents: 200000 }]
    });
    await prisma.tableSession.update({
      where: { id: expiredCtx.session.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    const expKey = `expired-${ts}`;
    const expiredRes = await settle({
      tableSessionId: expiredCtx.session.id,
      amountCents: 50000,
      paymentMethod: 'WAITER_CASH',
      idempotencyKey: expKey
    });
    expect(expiredRes.statusCode).toBe(409);
    expect(expiredRes.json().code).toBe('SESSION_EXPIRED');
    expect(await prisma.paymentTransaction.findUnique({ where: { idempotencyKey: expKey } })).toBeNull();
  });

  it('6. Falla de OccupancySession dentro de tx => rollback sin broadcast previo; broadcasts FSM se difieren a post-commit', async () => {
    const ts = Date.now();
    const table = await prisma.table.create({
      data: { restaurantId: rest.id, label: `Mesa FSM Tx ${ts}`, currentState: TableFSMState.AVAILABLE }
    });
    const tableSpy = vi.spyOn(eventBus, 'broadcastTableState');
    const occSpy = vi.spyOn(eventBus, 'broadcastOccupancyCompleted');
    tableSpy.mockClear();
    occSpy.mockClear();

    // 6a. Transición en tx cuya ocupación falla => rollback total y cero broadcasts.
    await expect(
      prisma.$transaction(async (tx) => {
        const res = await fsmService.attemptTransition(
          {
            tableId: table.id,
            toState: TableFSMState.OCCUPIED_NO_ORDER,
            source: SignalSource.STAFF_TERMINAL_TAP,
            trigger: 'test rollback',
            isOverride: true
          },
          new Proxy(tx, {
            get(target: any, prop: string) {
              if (prop === 'occupancySession') {
                return new Proxy(target[prop], {
                  get(occTarget: any, occProp: string) {
                    if (occProp === 'create' || occProp === 'update') {
                      return async () => {
                        throw new Error('boom-occupancy');
                      };
                    }
                    const v = occTarget[occProp];
                    return typeof v === 'function' ? v.bind(occTarget) : v;
                  }
                });
              }
              const v = target[prop];
              return typeof v === 'function' ? v.bind(target) : v;
            }
          })
        );
        // El broadcast diferido NO debe haberse emitido dentro de la tx.
        expect(tableSpy).not.toHaveBeenCalled();
        expect(occSpy).not.toHaveBeenCalled();
        expect(typeof res.broadcast).toBe('function');
        throw new Error('boom-occupancy-outer');
      })
    ).rejects.toThrow('boom-occupancy');

    const afterRollback = await prisma.table.findUnique({ where: { id: table.id } });
    expect(afterRollback?.currentState).toBe(TableFSMState.AVAILABLE);
    expect(await prisma.tableStateEvent.count({ where: { tableId: table.id } })).toBe(0);
    expect(tableSpy).not.toHaveBeenCalled();
    expect(occSpy).not.toHaveBeenCalled();

    // 6b. Transición exitosa en tx => sin broadcasts hasta broadcast() post-commit.
    tableSpy.mockClear();
    occSpy.mockClear();
    const deferred = await prisma.$transaction(async (tx) => {
      const res = await fsmService.attemptTransition(
        {
          tableId: table.id,
          toState: TableFSMState.OCCUPIED_NO_ORDER,
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: 'test defer',
          isOverride: true
        },
        tx
      );
      expect(tableSpy).not.toHaveBeenCalled();
      expect(occSpy).not.toHaveBeenCalled();
      return res;
    });
    expect(tableSpy).not.toHaveBeenCalled();
    deferred.broadcast!();
    expect(tableSpy).toHaveBeenCalledTimes(1);

    tableSpy.mockRestore();
    occSpy.mockRestore();
  });

  it('7. Transición a TO_CLEAN en tx difiere call.updated hasta post-commit (no se pierde)', async () => {
    const ts = Date.now();
    const table = await prisma.table.create({
      data: { restaurantId: rest.id, label: `Mesa Calls Tx ${ts}`, currentState: TableFSMState.EATING }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: `tok-calls-tx-${ts}`,
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 3600 * 1000)
      }
    });
    const call = await prisma.callRequest.create({
      data: {
        tableSessionId: session.id,
        type: 'WAITER',
        status: 'PENDING',
        activeKey: `active-${ts}`
      }
    });

    const callSpy = vi.spyOn(eventBus, 'broadcastCall');
    const tableSpy = vi.spyOn(eventBus, 'broadcastTableState');
    callSpy.mockClear();
    tableSpy.mockClear();

    const deferred = await prisma.$transaction(async (tx) => {
      const res = await fsmService.attemptTransition(
        {
          tableId: table.id,
          toState: TableFSMState.TO_CLEAN,
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: 'test calls defer',
          isOverride: true
        },
        tx
      );
      // Nada emitido antes del commit.
      expect(callSpy).not.toHaveBeenCalled();
      expect(tableSpy).not.toHaveBeenCalled();
      return res;
    });

    // Post-commit: se emiten call.updated + table.state_changed.
    deferred.broadcast!();
    expect(callSpy).toHaveBeenCalledTimes(1);
    expect(callSpy.mock.calls[0][1]).toBe('call.updated');
    expect(tableSpy).toHaveBeenCalledTimes(1);

    const freshCall = await prisma.callRequest.findUnique({ where: { id: call.id } });
    expect(freshCall?.status).toBe('RESOLVED');

    callSpy.mockRestore();
    tableSpy.mockRestore();
  });
});

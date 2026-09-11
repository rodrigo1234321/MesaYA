import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

/**
 * B04 — liquidación presencial por CUENTA de TableSession (contrato C4).
 * Vía nueva POST /v1/staff/sessions/:id/settle; la vía legada por comanda queda
 * intacta. Fixture real en SQLite efímera, sin mocks de persistencia.
 * Importes del contrato en centavos (minor-unit); sin división digital.
 */
describe('B04 — liquidación por cuenta: atómica, idempotente y conciliada', () => {
  let app: FastifyInstance;
  let rest1: any;
  let rest2: any;
  let shift1: any;
  let cat1: any;
  let manager1: string;
  let waiter1: string;
  let manager2: string;

  async function mkSessionWithOrders(
    tandas: Array<{ price: number; status: OrderStatus; name: string }>,
    label: string
  ) {
    const table = await prisma.table.create({
      data: {
        restaurantId: rest1.id,
        label: `${label}-${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift1.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    const orders: any[] = [];
    let age = 90000;
    for (const t of tandas) {
      const item = await prisma.menuItem.create({
        data: { categoryId: cat1.id, name: t.name, price: t.price, isAvailable: true }
      });
      orders.push(
        await prisma.order.create({
          data: {
            tableSessionId: session.id,
            status: t.status,
            totalAmount: t.price,
            createdAt: new Date(Date.now() - age),
            items: {
              create: [{ menuItemId: item.id, quantity: 1, unitPrice: t.price, addedByGuest: session.id }]
            }
          }
        })
      );
      age -= 10000;
    }
    return { table, session, orders };
  }

  async function settle(sessionId: string, token: string, payload: any) {
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${sessionId}/settle`,
      headers: { authorization: `Bearer ${token}` },
      payload
    });
  }

  async function freshVersion(sessionId: string) {
    const res = await app.inject({ method: 'GET', url: `/v1/orders/session/${(await prisma.tableSession.findUniqueOrThrow({ where: { id: sessionId } })).token}` });
    return res.json().account.version as string;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    rest1 = await prisma.restaurant.create({
      data: {
        name: 'b04-r1',
        slug: `b04-r1-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    shift1 = await prisma.shift.create({ data: { restaurantId: rest1.id, openedAt: new Date() } });
    cat1 = await prisma.menuCategory.create({ data: { restaurantId: rest1.id, name: 'B04', orderIndex: 0 } });
    await prisma.staffUser.create({
      data: { restaurantId: rest1.id, name: 'Manager B04', pinHash: await bcrypt.hash('9999', 10), role: 'MANAGER' }
    });
    await prisma.staffUser.create({
      data: { restaurantId: rest1.id, name: 'Mozo B04', pinHash: await bcrypt.hash('1234', 10), role: 'WAITER' }
    });
    rest2 = await prisma.restaurant.create({
      data: { name: 'b04-r2', slug: `b04-r2-${Date.now()}`, templateId: 'GOURMET_OBSIDIAN', themeColor: '#f59e0b' }
    });
    await prisma.staffUser.create({
      data: { restaurantId: rest2.id, name: 'Manager R2', pinHash: await bcrypt.hash('7777', 10), role: 'MANAGER' }
    });

    const login = async (slug: string, pin: string) =>
      (await app.inject({ method: 'POST', url: '/v1/auth/login-admin', payload: { restaurantSlug: slug, pin } })).json().token;
    manager1 = await login(rest1.slug, '9999');
    manager2 = await login(rest2.slug, '7777');
    waiter1 = (
      await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: rest1.slug, pin: '1234' } })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('(1) cobro completo: saldo exacto, asignaciones únicas y cocina intacta', async () => {
    const { session, orders } = await mkSessionWithOrders(
      [
        { price: 1000, status: OrderStatus.SERVED, name: 'T1' },
        { price: 2500, status: OrderStatus.SERVED, name: 'T2' },
        { price: 500, status: OrderStatus.SERVED, name: 'T3' }
      ],
      'Mesa B04-1'
    );
    const res = await settle(session.id, manager1, {
      idempotencyKey: `b04-full-${randomUUID()}`,
      expectedAccountVersion: await freshVersion(session.id),
      method: 'WAITER_CASH'
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.settlement.amountMinor).toBe(400000);
    expect(body.settlement.tipMinor).toBe(0);
    expect(body.settlement.allocations).toHaveLength(3);
    expect(body.settlement.allocations.reduce((s: number, a: any) => s + a.amountMinor, 0)).toBe(400000);
    expect(body.account.saldoMinor).toBe(0);
    expect(body.account.paidMinor).toBe(400000);
    // Pagar no marca órdenes como PAID: fulfillment intacto.
    const after = await prisma.order.findMany({ where: { tableSessionId: session.id }, select: { id: true, status: true } });
    expect(after.map((o) => o.status).sort()).toEqual([OrderStatus.SERVED, OrderStatus.SERVED, OrderStatus.SERVED].sort());
    expect(after.map((o) => o.id).sort()).toEqual(orders.map((o: any) => o.id).sort());
  });

  it('(2) propina separada del consumo', async () => {
    const { session } = await mkSessionWithOrders(
      [{ price: 2000, status: OrderStatus.SERVED, name: 'T1' }],
      'Mesa B04-2'
    );
    const res = await settle(session.id, manager1, {
      idempotencyKey: `b04-tip-${randomUUID()}`,
      expectedAccountVersion: await freshVersion(session.id),
      method: 'WAITER_CARD',
      tipMinor: 20000
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().settlement.amountMinor).toBe(200000);
    expect(res.json().settlement.tipMinor).toBe(20000);
    expect(res.json().account.saldoMinor).toBe(0);
    expect(res.json().account.tipMinor).toBe(20000);
  });

  it('(3) reintento con misma clave y respuesta perdida: un solo registro', async () => {
    const { session } = await mkSessionWithOrders(
      [{ price: 1500, status: OrderStatus.SERVED, name: 'T1' }],
      'Mesa B04-3'
    );
    const key = `b04-retry-${randomUUID()}`;
    const payload = {
      idempotencyKey: key,
      expectedAccountVersion: await freshVersion(session.id),
      method: 'WAITER_CASH'
    };
    const first = await settle(session.id, manager1, payload);
    expect(first.statusCode).toBe(201);
    // "Respuesta perdida": el cliente reintenta idéntico sin haber visto la primera.
    const second = await settle(session.id, manager1, payload);
    expect(second.statusCode).toBe(200);
    expect(second.json().idempotentReplay).toBe(true);
    expect(second.json().settlement.id).toBe(first.json().settlement.id);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('(3b) misma clave + mismo monto + distinto reparto: 409 sin otro settlement', async () => {
    const { session, orders } = await mkSessionWithOrders(
      [
        { price: 1000, status: OrderStatus.SERVED, name: 'T1' },
        { price: 1000, status: OrderStatus.SERVED, name: 'T2' }
      ],
      'Mesa B04-3b'
    );
    const version = await freshVersion(session.id);
    const key = `b04-split-${randomUUID()}`;
    const first = await settle(session.id, manager1, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 200000,
      allocations: [
        { orderId: orders[0].id, amountMinor: 100000 },
        { orderId: orders[1].id, amountMinor: 100000 }
      ]
    });
    expect(first.statusCode).toBe(201);
    // Mismo monto, reparto distinto a otra tanda: NO es replay.
    const different = await settle(session.id, manager1, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 200000,
      allocations: [{ orderId: orders[0].id, amountMinor: 200000 }]
    });
    expect(different.statusCode).toBe(409);
    expect(different.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    // Mismo reparto con filas partidas distinto pero normalizado igual: replay.
    const sameSplit = await settle(session.id, manager1, {
      idempotencyKey: key,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 200000,
      allocations: [
        { orderId: orders[0].id, amountMinor: 50000 },
        { orderId: orders[0].id, amountMinor: 50000 },
        { orderId: orders[1].id, amountMinor: 100000 }
      ]
    });
    expect(sameSplit.statusCode).toBe(200);
    expect(sameSplit.json().idempotentReplay).toBe(true);
    expect(sameSplit.json().settlement.id).toBe(first.json().settlement.id);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('(4) misma clave con otra intención o sesión: 409 sin escribir', async () => {
    const a = await mkSessionWithOrders([{ price: 1200, status: OrderStatus.SERVED, name: 'T1' }], 'Mesa B04-4a');
    const b = await mkSessionWithOrders([{ price: 1200, status: OrderStatus.SERVED, name: 'T1' }], 'Mesa B04-4b');
    const key = `b04-reuse-${randomUUID()}`;
    const ok = await settle(a.session.id, manager1, {
      idempotencyKey: key,
      expectedAccountVersion: await freshVersion(a.session.id),
      method: 'WAITER_CASH'
    });
    expect(ok.statusCode).toBe(201);
    const otherSession = await settle(b.session.id, manager1, {
      idempotencyKey: key,
      expectedAccountVersion: await freshVersion(b.session.id),
      method: 'WAITER_CASH'
    });
    expect(otherSession.statusCode).toBe(409);
    expect(otherSession.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    const otherAmount = await settle(a.session.id, manager1, {
      idempotencyKey: key,
      expectedAccountVersion: (await app.inject({ method: 'GET', url: `/v1/orders/session/${a.session.token}` })).json().account.version,
      method: 'WAITER_CASH',
      amountMinor: 100
    });
    expect(otherAmount.statusCode).toBe(409);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: b.session.id } })).toBe(0);
  });

  it('(5) versión vieja tras nuevo consumo: 409 accionable y sin escritura', async () => {
    const { session } = await mkSessionWithOrders(
      [{ price: 1000, status: OrderStatus.SERVED, name: 'T1' }],
      'Mesa B04-5'
    );
    const stale = await freshVersion(session.id);
    // Nuevo consumo aceptado después de la lectura.
    const item = await prisma.menuItem.create({
      data: { categoryId: cat1.id, name: 'Extra', price: 500, isAvailable: true }
    });
    await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount: 500,
        items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: 500, addedByGuest: session.id }] }
      }
    });
    const res = await settle(session.id, manager1, {
      idempotencyKey: `b04-stale-${randomUUID()}`,
      expectedAccountVersion: stale,
      method: 'WAITER_CASH'
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('STALE_ACCOUNT_VERSION');
    expect(res.json().details?.currentVersion).toBe(await freshVersion(session.id));
    expect(res.json().details?.saldoMinor).toBe(150000);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(0);
  });

  it('(6) parcial válido concilia y overpayment se rechaza', async () => {
    const { session, orders } = await mkSessionWithOrders(
      [
        { price: 1000, status: OrderStatus.SERVED, name: 'T1' },
        { price: 2500, status: OrderStatus.SERVED, name: 'T2' }
      ],
      'Mesa B04-6'
    );
    const partial = await settle(session.id, manager1, {
      idempotencyKey: `b04-partial-${randomUUID()}`,
      expectedAccountVersion: await freshVersion(session.id),
      method: 'WAITER_CASH',
      amountMinor: 100000,
      allocations: [{ orderId: orders[0].id, amountMinor: 100000 }]
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json().account.saldoMinor).toBe(250000);
    expect(partial.json().account.paidMinor).toBe(100000);
    const over = await settle(session.id, manager1, {
      idempotencyKey: `b04-over-${randomUUID()}`,
      expectedAccountVersion: partial.json().account.version,
      method: 'WAITER_CASH',
      amountMinor: 250001
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('OVERPAYMENT');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('(7) mozo y otro tenant rechazados; manager correcto cobra', async () => {
    const { session } = await mkSessionWithOrders(
      [{ price: 800, status: OrderStatus.SERVED, name: 'T1' }],
      'Mesa B04-7'
    );
    const version = await freshVersion(session.id);
    const waiter = await settle(session.id, waiter1, {
      idempotencyKey: `b04-w-${randomUUID()}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(waiter.statusCode).toBe(403);
    const foreign = await settle(session.id, manager2, {
      idempotencyKey: `b04-f-${randomUUID()}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    expect(foreign.statusCode).toBe(403);
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(0);
    const ok = await settle(session.id, manager1, {
      idempotencyKey: `b04-m-${randomUUID()}`,
      expectedAccountVersion: version,
      method: 'WAITER_CARD'
    });
    expect(ok.statusCode).toBe(201);
  });

  it('(8) dos cobros lógicos concurrentes: uno efectivo, sin duplicar ni saldo negativo', async () => {
    const { session } = await mkSessionWithOrders(
      [{ price: 3000, status: OrderStatus.SERVED, name: 'T1' }],
      'Mesa B04-8'
    );
    const version = await freshVersion(session.id);
    const payload = (k: string) => ({
      idempotencyKey: k,
      expectedAccountVersion: version,
      method: 'WAITER_CASH'
    });
    const [r1, r2] = await Promise.allSettled([
      settle(session.id, manager1, payload(`b04-race-a-${randomUUID()}`)),
      settle(session.id, manager1, payload(`b04-race-b-${randomUUID()}`))
    ]);
    const codes = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value.statusCode : -1));
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(1);
    const total = await prisma.accountSettlement.aggregate({
      where: { tableSessionId: session.id },
      _sum: { amountMinor: true }
    });
    expect(total._sum.amountMinor).toBe(300000);
    const account = (
      await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` })
    ).json().account;
    expect(account.saldoMinor).toBe(0);
    expect(account.saldoMinor).toBeGreaterThanOrEqual(0);
  });

  it('(9) lectura cliente/caja conserva cuenta y saldo tras liquidar', async () => {
    const { session } = await mkSessionWithOrders(
      [
        { price: 1000, status: OrderStatus.SERVED, name: 'T1' },
        { price: 2000, status: OrderStatus.IN_KITCHEN, name: 'T2' }
      ],
      'Mesa B04-9'
    );
    const done = await settle(session.id, manager1, {
      idempotencyKey: `b04-read-${randomUUID()}`,
      expectedAccountVersion: await freshVersion(session.id),
      method: 'WAITER_CASH'
    });
    expect(done.statusCode).toBe(201);
    const client = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(client.json().account.consumoMinor).toBe(300000);
    expect(client.json().account.paidMinor).toBe(300000);
    expect(client.json().account.saldoMinor).toBe(0);
    expect(client.json().account.tandas).toHaveLength(2);
    const cash = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${rest1.id}/cash-orders`,
      headers: { authorization: `Bearer ${manager1}` }
    });
    const entry = (cash.json().accounts as any[]).find((a) => a.tableSessionId === session.id);
    expect(entry.version).toBe(client.json().account.version);
    expect(entry.saldoMinor).toBe(0);
  });

  it('(6b) filas duplicadas que exceden la tanda: 422; dentro del límite se fusionan', async () => {
    const { session, orders } = await mkSessionWithOrders(
      [
        { price: 1000, status: OrderStatus.SERVED, name: 'T1' },
        { price: 1000, status: OrderStatus.SERVED, name: 'T2' }
      ],
      'Mesa B04-6b'
    );
    const version = await freshVersion(session.id);
    // Suma global válida (200000 = saldo) pero T1 agregada (120000) supera su saldo (100000).
    const over = await settle(session.id, manager1, {
      idempotencyKey: `b04-dup-over-${randomUUID()}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 200000,
      allocations: [
        { orderId: orders[0].id, amountMinor: 60000 },
        { orderId: orders[0].id, amountMinor: 60000 },
        { orderId: orders[1].id, amountMinor: 80000 }
      ]
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe('OVERPAYMENT');
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(0);
    // Duplicadas dentro del límite: una sola fila por tanda (@@unique), trazable.
    const merged = await settle(session.id, manager1, {
      idempotencyKey: `b04-dup-ok-${randomUUID()}`,
      expectedAccountVersion: version,
      method: 'WAITER_CASH',
      amountMinor: 200000,
      allocations: [
        { orderId: orders[0].id, amountMinor: 40000 },
        { orderId: orders[0].id, amountMinor: 60000 },
        { orderId: orders[1].id, amountMinor: 100000 }
      ]
    });
    expect(merged.statusCode).toBe(201);
    expect(merged.json().settlement.allocations).toHaveLength(2);
    expect(merged.json().settlement.allocations.find((a: any) => a.orderId === orders[0].id)).toMatchObject({ amountMinor: 100000 });
    expect(merged.json().account.saldoMinor).toBe(0);
  });

  it('(6c) asignaciones exactas en varias tandas concilian al centavo', async () => {
    const { session, orders } = await mkSessionWithOrders(
      [
        { price: 1000, status: OrderStatus.SERVED, name: 'T1' },
        { price: 2500, status: OrderStatus.IN_KITCHEN, name: 'T2' },
        { price: 500, status: OrderStatus.SERVED, name: 'T3' }
      ],
      'Mesa B04-6c'
    );
    const res = await settle(session.id, manager1, {
      idempotencyKey: `b04-multi-${randomUUID()}`,
      expectedAccountVersion: await freshVersion(session.id),
      method: 'WAITER_CARD',
      amountMinor: 400000,
      allocations: [
        { orderId: orders[0].id, amountMinor: 100000 },
        { orderId: orders[1].id, amountMinor: 250000 },
        { orderId: orders[2].id, amountMinor: 50000 }
      ]
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().settlement.allocations).toHaveLength(3);
    expect(res.json().account.saldoMinor).toBe(0);
    expect(res.json().account.paidMinor).toBe(400000);
  });

  it('(6d) payloads inválidos: 400/422 accionables, nunca 500', async () => {
    const { session } = await mkSessionWithOrders(
      [{ price: 1000, status: OrderStatus.SERVED, name: 'T1' }],
      'Mesa B04-6d'
    );
    const version = await freshVersion(session.id);
    const base = { expectedAccountVersion: version, method: 'WAITER_CASH' };
    const cases: Array<[string, any, number]> = [
      ['allocations no array', { ...base, idempotencyKey: `k-${randomUUID()}`, allocations: 'x' }, 400],
      ['allocation sin orderId', { ...base, idempotencyKey: `k-${randomUUID()}`, amountMinor: 100, allocations: [{ amountMinor: 100 }] }, 400],
      ['amount no entero', { ...base, idempotencyKey: `k-${randomUUID()}`, amountMinor: 1.5 }, 422],
      ['amount inseguro', { ...base, idempotencyKey: `k-${randomUUID()}`, amountMinor: Number.MAX_SAFE_INTEGER + 1 }, 422],
      ['tip negativo', { ...base, idempotencyKey: `k-${randomUUID()}`, tipMinor: -1 }, 422],
      ['clave vacía', { ...base, idempotencyKey: '   ' }, 400],
      ['clave >200', { ...base, idempotencyKey: 'k'.repeat(201) }, 400]
    ];
    for (const [name, payload, expected] of cases) {
      const res = await settle(session.id, manager1, payload);
      expect(res.statusCode, name).toBe(expected);
      expect(res.json().code, name).toBeDefined();
    }
    expect(await prisma.accountSettlement.count({ where: { tableSessionId: session.id } })).toBe(0);
  });

  it('(5b) fingerprint determinista con timestamps iguales entre lecturas', async () => {
    const { session } = await mkSessionWithOrders(
      [{ price: 700, status: OrderStatus.SERVED, name: 'T1' }],
      'Mesa B04-5b'
    );
    const fixed = new Date('2026-09-08T04:00:00.000Z');
    const item = await prisma.menuItem.create({
      data: { categoryId: cat1.id, name: 'Misma hora', price: 300, isAvailable: true }
    });
    for (let i = 0; i < 2; i++) {
      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 300,
          createdAt: fixed,
          items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: 300, addedByGuest: session.id }] }
        }
      });
    }
    const first = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    const second = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(first.json().account.consumoMinor).toBe(130000);
    expect(second.json().account.version).toBe(first.json().account.version);
  });

  it('(10) esquema: tablas/columnas minor en ambos schemas, migración con backfill', async () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const sqlite = fs.readFileSync(path.join(root, 'packages', 'api', 'prisma', 'schema.prisma'), 'utf8');
    const pg = fs.readFileSync(path.join(root, 'packages', 'api', 'prisma', 'schema.supabase.prisma'), 'utf8');
    for (const schema of [sqlite, pg]) {
      expect(schema).toContain('model AccountSettlement');
      expect(schema).toContain('model SettlementAllocation');
      for (const col of ['totalAmountMinor', 'unitPriceMinor', 'priceMinor', 'amountMinor', 'tipAmountMinor', 'applicationFeeMinor', 'remainingAmountMinor', 'totalRevenueMinor']) {
        expect(schema).toContain(col);
      }
    }
    const migration = fs.readFileSync(
      path.join(root, 'packages', 'api', 'prisma', 'migrations-postgres', '20260908120000_b04_account_settlements', 'migration.sql'),
      'utf8'
    );
    expect(migration).toContain('CREATE TABLE "AccountSettlement"');
    expect(migration).toContain('CREATE TABLE "SettlementAllocation"');
    expect(migration).toContain('"SettlementAllocation_settlementId_orderId_key"');
    expect(migration).toContain('UPDATE "Order" SET "totalAmountMinor"');
    expect(migration).toContain('UPDATE "PaymentTransaction" SET "amountMinor"');
    expect(migration).toContain('UPDATE "OrderItem" SET "unitPriceMinor"');
    // Backfill solo-NULL (re-ejecutable) y sin destrucción.
    const updates = migration.split('\n').filter((l) => l.startsWith('UPDATE '));
    expect(updates.length).toBeGreaterThanOrEqual(10);
    expect(updates.every((l) => l.includes('WHERE') && l.includes('IS NULL'))).toBe(true);
    expect(migration).not.toContain('DROP TABLE');
    expect(migration).not.toContain('DELETE FROM');
    // Delegados generados (cliente Prisma regenerado con el schema B04).
    expect(typeof (prisma as any).accountSettlement?.create).toBe('function');
    expect(typeof (prisma as any).settlementAllocation?.create).toBe('function');
  });
});

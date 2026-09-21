import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

/**
 * E05 — División de cuenta presencial: FIXED / PERCENTAGE / EQUAL_PARTS
 * Pruebas focalizadas contra API/servicio real (SQLite efímera test-local).
 * Cubre: reparto determinista, partial mantiene sesión abierta, settle-and-close
 * parcial rechaza, módulo apagado, validaciones, idempotencia y tenant scope.
 */
describe('E05 — División de cuenta (split bill)', () => {
  let app: FastifyInstance;
  let restaurantA: any;
  let restaurantDisabled: any;
  let restaurantB: any;
  let shiftA: any;
  let shiftDisabled: any;
  let shiftB: any;
  let catA: any;
  let catDisabled: any;
  let managerA = '';
  let managerDisabled = '';
  let managerB = '';

  async function createSessionWithOrder(opts: {
    restaurantId: string;
    shiftId: string;
    catId: string;
    price: number; // pesos float, ej 100 => 10000 centavos
    qty?: number;
    labelPrefix?: string;
  }) {
    const price = opts.price;
    const qty = opts.qty ?? 1;
    const table = await prisma.table.create({
      data: {
        restaurantId: opts.restaurantId,
        label: `${opts.labelPrefix || 'E05'}-${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: TableFSMState.EATING,
        capacity: 4
      }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: opts.shiftId,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    const item = await prisma.menuItem.create({
      data: { categoryId: opts.catId, name: `Plato E05 ${randomUUID().slice(0,4)}`, price, isAvailable: true }
    });
    const totalMinor = Math.round(price * 100) * qty;
    const order = await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount: price * qty,
        totalAmountMinor: totalMinor,
        items: {
          create: [{
            menuItemId: item.id,
            quantity: qty,
            unitPrice: price,
            unitPriceMinor: Math.round(price * 100),
            addedByGuest: session.id
          }]
        }
      }
    });
    // versión fresca vía cuenta real
    const fresh = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    const version = fresh.json().account.version as string;
    const saldo = fresh.json().account.saldoMinor as number;
    return { table, session, order, item, version, saldo, totalMinor };
  }

  async function settle(sessionId: string, token: string, payload: any) {
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${sessionId}/settle`,
      headers: { authorization: `Bearer ${token}` },
      payload
    });
  }
  async function settleAndClose(sessionId: string, token: string, payload: any) {
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${sessionId}/settle-and-close`,
      headers: { authorization: `Bearer ${token}` },
      payload
    });
  }
  async function freshAccount(session: any) {
    const res = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    return res.json().account;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurantA = await prisma.restaurant.create({
      data: {
        name: 'E05-enabled',
        slug: `e05-a-${Date.now()}-${randomUUID().slice(0,4)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, allowSplitBill: true, allowWaitersToCollectCash: true } }
      }
    });
    restaurantDisabled = await prisma.restaurant.create({
      data: {
        name: 'E05-disabled',
        slug: `e05-disabled-${Date.now()}-${randomUUID().slice(0,4)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#222',
        moduleConfig: { create: { allowOrdering: true, allowSplitBill: false, allowWaitersToCollectCash: true } }
      }
    });
    restaurantB = await prisma.restaurant.create({
      data: {
        name: 'E05-tenant-B',
        slug: `e05-b-${Date.now()}-${randomUUID().slice(0,4)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#333'
      }
    });

    shiftA = await prisma.shift.create({ data: { restaurantId: restaurantA.id, openedAt: new Date() } });
    shiftDisabled = await prisma.shift.create({ data: { restaurantId: restaurantDisabled.id, openedAt: new Date() } });
    shiftB = await prisma.shift.create({ data: { restaurantId: restaurantB.id, openedAt: new Date() } });

    catA = await prisma.menuCategory.create({ data: { restaurantId: restaurantA.id, name: 'E05 cat' } });
    catDisabled = await prisma.menuCategory.create({ data: { restaurantId: restaurantDisabled.id, name: 'E05 cat disabled' } });
    await prisma.menuCategory.create({ data: { restaurantId: restaurantB.id, name: 'E05 cat B' } });

    await prisma.staffUser.create({ data: { restaurantId: restaurantA.id, name: 'Mgr A', pinHash: await bcrypt.hash('9999', 10), role: 'MANAGER' } });
    await prisma.staffUser.create({ data: { restaurantId: restaurantDisabled.id, name: 'Mgr D', pinHash: await bcrypt.hash('8888', 10), role: 'MANAGER' } });
    await prisma.staffUser.create({ data: { restaurantId: restaurantB.id, name: 'Mgr B', pinHash: await bcrypt.hash('7777', 10), role: 'MANAGER' } });

    const login = async (slug: string, pin: string) => (await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: slug, pin } })).json().token;
    managerA = await login(restaurantA.slug, '9999');
    managerDisabled = await login(restaurantDisabled.slug, '8888');
    managerB = await login(restaurantB.slug, '7777');
  });

  afterAll(async () => {
    for (const r of [restaurantA, restaurantDisabled, restaurantB]) {
      if (!r?.id) continue;
      await prisma.accountSettlement.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.orderItem.deleteMany({ where: { order: { tableSession: { table: { restaurantId: r.id } } } } }).catch(()=>{});
      await prisma.order.deleteMany({ where: { tableSession: { table: { restaurantId: r.id } } } }).catch(()=>{});
      await prisma.tableSession.deleteMany({ where: { table: { restaurantId: r.id } } }).catch(()=>{});
      await prisma.table.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.shift.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.staffUser.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.restaurantModuleConfigAudit.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.restaurantModuleConfig.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.restaurant.delete({ where: { id: r.id } }).catch(()=>{});
    }
    await app.close();
  });

  describe('FIXED, PERCENTAGE y EQUAL_PARTS', () => {
    it('FIXED liquida monto exacto y deja saldo reducido con sesión abierta', async () => {
      const { session, version, saldo } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 100 });
      expect(saldo).toBe(10000);
      const key = `e05-fixed-${session.id}`;
      const res = await settle(session.id, managerA, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'FIXED', amountMinor: 4000 }
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.settlement.amountMinor).toBe(4000);
      expect(body.account.saldoMinor).toBe(6000);
      // sesión sigue abierta
      const dbSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(dbSession.closedAt).toBeNull();
      const acc = await freshAccount(session);
      expect(acc.saldoMinor).toBe(6000);
      // firma persistida
      const row = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(row.splitSignature).toBe('FIXED:4000');
    });

    it('PERCENTAGE 33% sobre 10000 produce 3300 y reaparte correctamente', async () => {
      const { session, version } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 100 });
      const key = `e05-pct-${session.id}`;
      const res = await settle(session.id, managerA, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'PERCENTAGE', percentage: 33 }
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().settlement.amountMinor).toBe(3300); // round(10000*33/100)
      const row = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(row.splitSignature).toBe('PERCENTAGE:33');
      const acc = await freshAccount(session);
      expect(acc.saldoMinor).toBe(6700);
    });

    it('EQUAL_PARTS 3 partes en MISMA sesión (consumo total 10000) reparte 3334/3333/3333 y saldo 0; repetir parte => 409 SPLIT_PART_ALREADY_SETTLED', async () => {
      // Plan exige tres pagadores y saldo cero exacto: divide consumoMinor total (10000) en N partes floor(total/N)+1 para índices <= remainder
      const { session, version, saldo } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 100 });
      expect(saldo).toBe(10000);
      const baseKey = `e05-eq3-same-${session.id}`;
      const key1 = `${baseKey}-p1-${randomUUID().slice(0,4)}`;
      const r1 = await settle(session.id, managerA, {
        idempotencyKey: key1,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 1 }
      });
      expect(r1.statusCode).toBe(201);
      expect(r1.json().settlement.amountMinor).toBe(3334);
      expect(r1.json().account.saldoMinor).toBe(6666);
      const row1 = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: key1 } });
      expect(row1.splitSignature).toBe('EQUAL_PARTS:3:1');

      const key2 = `${baseKey}-p2-${randomUUID().slice(0,4)}`;
      const r2 = await settle(session.id, managerA, {
        idempotencyKey: key2,
        expectedAccountVersion: r1.json().account.version as string,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 2 }
      });
      expect(r2.statusCode).toBe(201);
      expect(r2.json().settlement.amountMinor).toBe(3333);
      expect(r2.json().account.saldoMinor).toBe(3333);
      const row2 = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: key2 } });
      expect(row2.splitSignature).toBe('EQUAL_PARTS:3:2');

      const key3 = `${baseKey}-p3-${randomUUID().slice(0,4)}`;
      const r3 = await settle(session.id, managerA, {
        idempotencyKey: key3,
        expectedAccountVersion: r2.json().account.version as string,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 3 }
      });
      expect(r3.statusCode).toBe(201);
      expect(r3.json().settlement.amountMinor).toBe(3333);
      expect(r3.json().account.saldoMinor).toBe(0);
      const row3 = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: key3 } });
      expect(row3.splitSignature).toBe('EQUAL_PARTS:3:3');
      // saldo cero exacto en misma sesión (tres pagadores)
      const finalAcc = await freshAccount(session);
      expect(finalAcc.saldoMinor).toBe(0);
      expect(finalAcc.consumoMinor).toBe(10000);
      // repetir misma parte con clave distinta => 409 SPLIT_PART_ALREADY_SETTLED sin fila nueva
      const beforeCount = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      expect(beforeCount).toBe(3);
      const dupKey = `${baseKey}-dup-p1-${randomUUID().slice(0,4)}`;
      const dup = await settle(session.id, managerA, {
        idempotencyKey: dupKey,
        expectedAccountVersion: r3.json().account.version as string,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 1 }
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('SPLIT_PART_ALREADY_SETTLED');
      const afterCount = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      expect(afterCount).toBe(3);
      const dupRow = await prisma.accountSettlement.findUnique({ where: { idempotencyKey: dupKey } });
      expect(dupRow).toBeNull();
    });
  });

  describe('partial mantiene sesión abierta y reduce saldo; settle-and-close parcial rechaza', () => {
    it('settle-and-close con split parcial rechaza 422 y no cierra sesión ni tabla', async () => {
      const { session, version, table } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 100 });
      const res = await settleAndClose(session.id, managerA, {
        idempotencyKey: `e05-close-partial-${session.id}`,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'FIXED', amountMinor: 5000 } // mitad del saldo
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('CLOSE_REQUIRES_FULL_SETTLEMENT');
      const dbSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(dbSession.closedAt).toBeNull();
      const dbTable = await prisma.table.findUniqueOrThrow({ where: { id: table.id } });
      expect(dbTable.currentState).not.toBe(TableFSMState.TO_CLEAN);
      // ninguna liquidación parcial con close debe haber quedado
      const count = await prisma.accountSettlement.count({ where: { idempotencyKey: `e05-close-partial-${session.id}` } });
      expect(count).toBe(0);
    });
  });

  describe('módulo apagado rechaza el split sin mutación', () => {
    it('split con allowSplitBill=false responde 403 SPLIT_BILL_DISABLED y no crea settlement', async () => {
      const cat = catDisabled;
      const table = await prisma.table.create({ data: { restaurantId: restaurantDisabled.id, label: `E05-dis-${randomUUID().slice(0,4)}`, currentState: TableFSMState.EATING } });
      const session = await prisma.tableSession.create({ data: { tableId: table.id, shiftId: shiftDisabled.id, token: randomUUID(), expiresAt: new Date(Date.now()+ 3600000) } });
      const item = await prisma.menuItem.create({ data: { categoryId: cat.id, name: 'Plato dis', price: 50, isAvailable: true } });
      await prisma.order.create({ data: { tableSessionId: session.id, status: OrderStatus.SERVED, totalAmount: 50, totalAmountMinor: 5000, items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: 50, unitPriceMinor: 5000, addedByGuest: session.id }] } } });
      const fresh = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
      const version = fresh.json().account.version as string;
      const key = `e05-disabled-${session.id}`;
      const before = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      const res = await settle(session.id, managerDisabled, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'PERCENTAGE', percentage: 50 }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('SPLIT_BILL_DISABLED');
      const after = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      expect(after).toBe(before);
    });
  });

  describe('validaciones invalid modes/ranges/parts (4xx, no 500)', () => {
    it.each([
      [{ mode: 'UNKNOWN' }, /Modo de división inválido/],
      [{ mode: 'FIXED', amountMinor: 0 }, /entero seguro > 0/],
      [{ mode: 'FIXED', amountMinor: -100 }, /entero seguro > 0/],
      [{ mode: 'PERCENTAGE', percentage: 0 }, /entero entre 1 y 100/],
      [{ mode: 'PERCENTAGE', percentage: 101 }, /entero entre 1 y 100/],
      [{ mode: 'PERCENTAGE', percentage: 50.5 }, /entero entre 1 y 100/],
      [{ mode: 'EQUAL_PARTS', parts: 1 }, /entero seguro >= 2/],
      [{ mode: 'EQUAL_PARTS', parts: 0 }, /entero seguro >= 2/],
      [{ mode: 'EQUAL_PARTS', parts: 2 }, /entre 1 y el número de partes/],
      [{ mode: 'EQUAL_PARTS', parts: 3 }, /entre 1 y el número de partes/],
      [{ mode: 'EQUAL_PARTS', parts: 2, partIndex: 3 }, /entre 1 y el número de partes/],
      [{ mode: 'EQUAL_PARTS', parts: 2, partIndex: 0 }, /entre 1 y el número de partes/],
    ])('split %j rechaza 422 sin mutación', async (split, msg) => {
      const { session, version } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 20 });
      const key = `e05-invalid-${session.id}-${randomUUID().slice(0,4)}`;
      const before = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      const res = await settle(session.id, managerA, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split
      });
      expect([400,422]).toContain(res.statusCode);
      expect(res.json().message || res.json().error || JSON.stringify(res.json())).toMatch(msg);
      const after = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      expect(after).toBe(before);
    });
  });

  describe('idempotencia y 409 por split distinto', () => {
    it('idempotent replay de la misma operación no duplica', async () => {
      const { session, version } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 80 });
      const key = `e05-replay-${session.id}`;
      const payload = {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 2, partIndex: 1 }
      };
      const r1 = await settle(session.id, managerA, payload);
      expect(r1.statusCode).toBe(201);
      expect(r1.json().idempotentReplay).toBe(false);
      const r2 = await settle(session.id, managerA, payload);
      expect(r2.statusCode).toBe(200);
      expect(r2.json().idempotentReplay).toBe(true);
      expect(r2.json().settlement.id).toBe(r1.json().settlement.id);
      const count = await prisma.accountSettlement.count({ where: { idempotencyKey: key } });
      expect(count).toBe(1);
      const row = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(row.splitSignature).toBe('EQUAL_PARTS:2:1');
    });

    it('misma clave con split diferente devuelve 409 aunque monto coincida', async () => {
      // saldo 10000: FIXED 5000 y PERCENTAGE 50 => ambos 5000 pero firma distinta => 409
      const { session, version } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 100 });
      const key = `e05-409-same-amount-${session.id}`;
      const r1 = await settle(session.id, managerA, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'FIXED', amountMinor: 5000 }
      });
      expect(r1.statusCode).toBe(201);
      // intento replay con misma clave pero split distinto (PERCENTAGE 50 => 5000)
      const r2 = await settle(session.id, managerA, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'PERCENTAGE', percentage: 50 }
      });
      expect(r2.statusCode).toBe(409);
      expect(r2.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
      // también con mismo monto pero EQUAL_PARTS distinto partIndex
      const { session: s2, version: v2 } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 9 }); // 900 centavos, 3 partes: 300 c/u exacto
      const key2 = `e05-409-partindex-${s2.id}`;
      const a1 = await settle(s2.id, managerA, {
        idempotencyKey: key2,
        expectedAccountVersion: v2,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 1 }
      });
      expect(a1.statusCode).toBe(201);
      const a2 = await settle(s2.id, managerA, {
        idempotencyKey: key2,
        expectedAccountVersion: v2,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 2 }
      });
      expect(a2.statusCode).toBe(409);
    });
  });

  describe('tenant y scope existente', () => {
    it('rechaza split cross-tenant con 403 sin mutación', async () => {
      const { session, version } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 30 });
      const key = `e05-tenant-${session.id}`;
      const before = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      const res = await settle(session.id, managerB, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        split: { mode: 'PERCENTAGE', percentage: 50 }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
      const after = await prisma.accountSettlement.count({ where: { tableSessionId: session.id } });
      expect(after).toBe(before);
    });

    it('legacy/no-split sigue funcionando y es idempotente', async () => {
      const { session, version, saldo } = await createSessionWithOrder({ restaurantId: restaurantA.id, shiftId: shiftA.id, catId: catA.id, price: 40 });
      expect(saldo).toBe(4000);
      const key = `e05-legacy-${session.id}`;
      const r1 = await settle(session.id, managerA, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        amountMinor: 4000
      });
      expect(r1.statusCode).toBe(201);
      const row = await prisma.accountSettlement.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(row.splitSignature).toBeNull();
      const r2 = await settle(session.id, managerA, {
        idempotencyKey: key,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        amountMinor: 4000
      });
      expect(r2.statusCode).toBe(200);
      expect(r2.json().idempotentReplay).toBe(true);
    });
  });
});

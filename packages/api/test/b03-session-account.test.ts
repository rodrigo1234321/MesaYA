import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { OrderService } from '../src/services/order.service';

/**
 * B03 — cuenta agregada por TableSession (contrato 04-CONTRATO-CUENTA-B01 C1–C4).
 * Fixture real en SQLite efímera, sin mocks de persistencia. Importes expuestos en
 * centavos como PROYECCIÓN redondeada desde el Float legado (persistencia minor-unit
 * pendiente de B04; ver C3). La UI aún no consume `account` (C06/S08).
 *
 * S1 (mesa principal): CONFIRMED 1000 + IN_KITCHEN 2500 + READY_TO_SERVE 500 +
 *   SERVED 800 + PENDING_VALIDATION 600 + CANCELLED 999 + DRAFT 700,
 *   más un pago APPROVED de 1000 con propina 100 sobre la primera tanda.
 *   Consumo esperado: 4800 (480000); pagado: 1000; propina: 100; saldo: 3800.
 * S2 (otra mesa, mismo restaurante): SERVED 900. R2 (otro restaurante): SERVED 500.
 */
describe('B03 — cuenta de sesión agregada, exacta y aislada', () => {
  let app: FastifyInstance;
  let rest1: any;
  let session1: any;
  let session2: any;
  let table1: any;
  let table2: any;
  let managerToken1: string;

  async function mkRestaurant(name: string, pin: string) {
    const rest = await prisma.restaurant.create({
      data: {
        name,
        slug: `${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    const shift = await prisma.shift.create({
      data: { restaurantId: rest.id, openedAt: new Date() }
    });
    await prisma.staffUser.create({
      data: {
        restaurantId: rest.id,
        name: `Encargado ${name}`,
        pinHash: await bcrypt.hash(pin, 10),
        role: 'MANAGER'
      }
    });
    const cat = await prisma.menuCategory.create({
      data: { restaurantId: rest.id, name: `Cat ${name}`, orderIndex: 0 }
    });
    return { rest, shift, cat };
  }

  async function mkSession(rest: any, shift: any, label: string) {
    const table = await prisma.table.create({
      data: {
        restaurantId: rest.id,
        label,
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    return { table, session };
  }

  async function mkOrder(
    session: any,
    cat: any,
    name: string,
    price: number,
    status: OrderStatus,
    ageMs: number
  ) {
    const item = await prisma.menuItem.create({
      data: { categoryId: cat.id, name, price, isAvailable: true }
    });
    return prisma.order.create({
      data: {
        tableSessionId: session.id,
        status,
        totalAmount: price,
        createdAt: new Date(Date.now() - ageMs),
        items: {
          create: [{ menuItemId: item.id, quantity: 1, unitPrice: price, addedByGuest: session.id }]
        }
      }
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const r1 = await mkRestaurant('b03-r1', '9999');
    rest1 = r1.rest;
    const s1 = await mkSession(rest1, r1.shift, 'Mesa B03-1');
    table1 = s1.table;
    session1 = s1.session;
    const s2 = await mkSession(rest1, r1.shift, 'Mesa B03-2');
    table2 = s2.table;
    session2 = s2.session;

    const t = 90000;
    const orderA = await mkOrder(session1, r1.cat, 'A conf', 1000, OrderStatus.CONFIRMED, t + 60);
    await mkOrder(session1, r1.cat, 'B kitchen', 2500, OrderStatus.IN_KITCHEN, t + 50);
    await mkOrder(session1, r1.cat, 'C ready', 500, OrderStatus.READY_TO_SERVE, t + 40);
    await mkOrder(session1, r1.cat, 'D served', 800, OrderStatus.SERVED, t + 30);
    await mkOrder(session1, r1.cat, 'E pending', 600, OrderStatus.PENDING_VALIDATION, t + 20);
    await mkOrder(session1, r1.cat, 'F cancelled', 999, OrderStatus.CANCELLED, t + 10);
    await mkOrder(session1, r1.cat, 'G draft', 700, OrderStatus.DRAFT, t);

    // Pago registrado por la vía existente (lectura B03; la liquidación B04 no se implementa).
    await prisma.paymentTransaction.create({
      data: {
        orderId: orderA.id,
        tableSessionId: session1.id,
        guestSessionId: session1.id,
        method: 'WAITER_CASH',
        amount: 1000,
        tipAmount: 100,
        status: 'APPROVED',
        idempotencyKey: `b03-${randomUUID()}`
      }
    });

    await mkOrder(session2, r1.cat, 'S2 served', 900, OrderStatus.SERVED, t);

    const r2 = await mkRestaurant('b03-r2', '8888');
    const s3 = await mkSession(r2.rest, r2.shift, 'Mesa B03-R2');
    await mkOrder(s3.session, r2.cat, 'R2 served', 500, OrderStatus.SERVED, t);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-admin',
      payload: { restaurantSlug: rest1.slug, pin: '9999' }
    });
    expect(login.statusCode).toBe(200);
    managerToken1 = login.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('excluye DRAFT/PENDING_VALIDATION/CANCELLED y suma las cuatro tandas aceptadas', async () => {
    const account = await OrderService.getSessionAccount(session1.id);
    expect(account.consumoMinor).toBe(480000);
    expect(account.tandas).toHaveLength(4);
    expect(account.tandas.map((t) => t.status).sort()).toEqual(
      [OrderStatus.CONFIRMED, OrderStatus.IN_KITCHEN, OrderStatus.READY_TO_SERVE, OrderStatus.SERVED].sort()
    );
    expect(account.pendingValidation).toHaveLength(1);
    expect(account.pendingValidation[0].totalMinor).toBe(60000);
    expect(account.draft?.totalMinor).toBe(70000);
  });

  it('concilia pagado/propina/saldo en unidades exactas sin mezclar fulfillment', async () => {
    const account = await OrderService.getSessionAccount(session1.id);
    expect(account.paidMinor).toBe(100000);
    expect(account.tipMinor).toBe(10000);
    expect(account.saldoMinor).toBe(380000);
    // El pago no cambia estados de preparación: las tandas siguen aceptadas, no pagadas.
    expect(account.tandas.every((t) => t.status !== OrderStatus.PAID)).toBe(true);
  });

  it('cliente y caja devuelven el mismo total y la misma versión', async () => {
    const client = await app.inject({ method: 'GET', url: `/v1/orders/session/${session1.token}` });
    expect(client.statusCode).toBe(200);
    const cash = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${rest1.id}/cash-orders`,
      headers: { authorization: `Bearer ${managerToken1}` }
    });
    expect(cash.statusCode).toBe(200);
    const cashAccount = (cash.json().accounts as any[]).find(
      (a) => a.tableSessionId === session1.id
    );
    expect(cashAccount).toBeDefined();
    expect(client.json().account.consumoMinor).toBe(cashAccount.consumoMinor);
    expect(client.json().account.version).toBe(cashAccount.version);
    expect(client.json().account.version).toMatch(/^[0-9a-f]{16}$/);
  });

  it('la versión es estable entre lecturas idénticas y cambia ante un cambio contable', async () => {
    const first = await OrderService.getSessionAccount(session1.id);
    const second = await OrderService.getSessionAccount(session1.id);
    expect(second.version).toBe(first.version);

    // Cambio contable relevante: nueva tanda aceptada en la misma sesión.
    const extraItem = await prisma.menuItem.create({
      data: { categoryId: (await prisma.menuCategory.findFirstOrThrow({ where: { restaurantId: rest1.id } })).id, name: 'H extra', price: 300, isAvailable: true }
    });
    await prisma.order.create({
      data: {
        tableSessionId: session1.id,
        status: OrderStatus.SERVED,
        totalAmount: 300,
        items: {
          create: [{ menuItemId: extraItem.id, quantity: 1, unitPrice: 300, addedByGuest: session1.id }]
        }
      }
    });

    const third = await OrderService.getSessionAccount(session1.id);
    expect(third.version).not.toBe(first.version);
    expect(third.consumoMinor).toBe(first.consumoMinor + 30000);
    expect(third.saldoMinor).toBe(first.saldoMinor + 30000);

    // Tras el cambio, cliente y caja siguen devolviendo el mismo DTO (total + versión).
    const client = await app.inject({ method: 'GET', url: `/v1/orders/session/${session1.token}` });
    const cash = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${rest1.id}/cash-orders`,
      headers: { authorization: `Bearer ${managerToken1}` }
    });
    expect(client.statusCode).toBe(200);
    expect(cash.statusCode).toBe(200);
    const cashAccount = (cash.json().accounts as any[]).find(
      (a) => a.tableSessionId === session1.id
    );
    expect(client.json().account.version).toBe(third.version);
    expect(client.json().account.version).toBe(cashAccount.version);
    expect(client.json().account.consumoMinor).toBe(cashAccount.consumoMinor);
  });

  it('aísla por sesión y restaurante sin fugas ni duplicados', async () => {
    const account2 = await OrderService.getSessionAccount(session2.id);
    expect(account2.consumoMinor).toBe(90000);
    expect(account2.tandas).toHaveLength(1);

    const cash = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${rest1.id}/cash-orders`,
      headers: { authorization: `Bearer ${managerToken1}` }
    });
    const accounts = cash.json().accounts as any[];
    const bySession = new Set(accounts.map((a) => a.tableSessionId));
    // Una entrada por sesión, sin duplicados.
    expect(bySession.size).toBe(accounts.length);
    // S1 y S2 presentes; la sesión de R2 (500) ausente: sin fuga de tenant.
    expect(bySession.has(session1.id)).toBe(true);
    expect(bySession.has(session2.id)).toBe(true);
    expect(accounts.every((a) => a.tableSessionId !== undefined)).toBe(true);
    const legacy = cash.json().orders as any[];
    // Filas legadas: solo mesas de R1 (sin fuga de tenant hacia R2).
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.every((o) => o.tableId === table1.id || o.tableId === table2.id)).toBe(true);
  });
});

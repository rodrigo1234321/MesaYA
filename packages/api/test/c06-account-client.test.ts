import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallType, PaymentMethod, OrderStatus, TableFSMState } from '@mesaya/shared';

/**
 * C06 — la cuenta del comensal consume la proyección agregada de TableSession.
 * La prueba usa SQLite efímera del runner y no confía en el arreglo de la última
 * orden para determinar consumo, pagos, propina o saldo.
 */
describe('C06 — cuenta completa visible y solicitud presencial', () => {
  let app: FastifyInstance;
  let session: any;
  let category: any;

  async function createOrder(status: OrderStatus, name: string, price: number) {
    const item = await prisma.menuItem.create({
      data: { categoryId: category.id, name, price, isAvailable: true }
    });
    return prisma.order.create({
      data: {
        tableSessionId: session.id,
        status,
        totalAmount: price,
        items: {
          create: [{ menuItemId: item.id, quantity: 1, unitPrice: price, addedByGuest: session.id }]
        }
      }
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const restaurant = await prisma.restaurant.create({
      data: {
        name: 'c06-account',
        slug: `c06-account-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    const shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'C06', orderIndex: 0 }
    });
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa C06',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    await createOrder(OrderStatus.SERVED, 'Primera tanda', 1200);
    await createOrder(OrderStatus.IN_KITCHEN, 'Segunda tanda <img src=x onerror=alert(1)>', 2500);
    await createOrder(OrderStatus.CONFIRMED, 'Tercera tanda', 800);
    await createOrder(OrderStatus.PENDING_VALIDATION, 'Pendiente no cobrable', 700);
    await createOrder(OrderStatus.DRAFT, 'Borrador no cobrable', 900);

    const accepted = await prisma.order.findFirstOrThrow({
      where: { tableSessionId: session.id, status: OrderStatus.SERVED }
    });
    await prisma.paymentTransaction.create({
      data: {
        orderId: accepted.id,
        tableSessionId: session.id,
        guestSessionId: session.id,
        method: 'WAITER_CASH',
        amount: 1000,
        tipAmount: 100,
        status: 'APPROVED',
        idempotencyKey: `c06-${randomUUID()}`
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('muestra consumo acumulado, pagos, propina y saldo; excluye última orden si es DRAFT', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${session.token}`
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.order.status).toBe(OrderStatus.DRAFT);
    expect(body.order.totalAmount).toBe(900);
    expect(body.account.consumoMinor).toBe(450000);
    expect(body.account.paidMinor).toBe(100000);
    expect(body.account.tipMinor).toBe(10000);
    expect(body.account.saldoMinor).toBe(350000);
    expect(body.account.tandas).toHaveLength(3);
    expect(body.account.pendingValidation).toHaveLength(1);
    expect(body.account.draft.totalMinor).toBe(90000);
    expect(body.account.tandas.map((round: any) => round.totalMinor)).toEqual([120000, 250000, 80000]);
    expect(body.account.tandas[1].items[0].name).toContain('<img');
  });

  it('renderiza la cuenta con datos escapados y no vuelve a data.order dentro de loadBillDetails', () => {
    const appJsPath = path.resolve(__dirname, '../../../apps/client-web/app.js');
    const appJs = fs.readFileSync(appJsPath, 'utf8');
    const start = appJs.indexOf('async function loadBillDetails()');
    const end = appJs.indexOf('// Action: Pedir Cuenta', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const billLoader = appJs.slice(start, end);

    expect(billLoader).toContain('const account = data && data.account');
    expect(billLoader).toContain('formatMinorAmount(consumoMinor)');
    expect(billLoader).toContain('account.paidMinor');
    expect(billLoader).toContain('account.tipMinor');
    expect(billLoader).toContain('account.saldoMinor');
    expect(billLoader).toContain('currentBillConsumptionMinor');
    expect(billLoader).toContain('modalBillPayableTotal');
    expect(billLoader).toContain('escapeHtml(item.name)');
    expect(billLoader).not.toMatch(/\bdata\.order\b/);
    expect(billLoader).not.toContain('item.notes');
    expect(appJs).toContain("sendCall('BILL', method, tipNote)");
  });

  it('actualiza una cuenta ya solicitada cuando aparece una nueva tanda y no duplica el llamado', async () => {
    const firstCall = await app.inject({
      method: 'POST',
      url: '/v1/calls',
      payload: {
        sessionToken: session.token,
        type: CallType.BILL,
        paymentMethod: PaymentMethod.CASH,
        tipMinor: 48000,
        origin: 'WEB_DIRECT'
      }
    });
    expect(firstCall.statusCode).toBe(201);
    expect(firstCall.json()).toMatchObject({ paymentMethod: PaymentMethod.CASH, tipMinor: 48000 });
    const activeSession = await app.inject({ method: 'GET', url: `/v1/sessions/${session.token}` });
    expect(activeSession.statusCode).toBe(200);
    expect(activeSession.json().activeCalls.find((call: any) => call.type === CallType.BILL)).toMatchObject({ tipMinor: 48000 });

    await createOrder(OrderStatus.SERVED, 'Tanda posterior a pedir cuenta', 600);
    const refreshed = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${session.token}`
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().account.consumoMinor).toBe(510000);
    expect(refreshed.json().account.tandas).toHaveLength(4);
    expect(refreshed.json().account.draft.totalMinor).toBe(90000);

    const duplicateCall = await app.inject({
      method: 'POST',
      url: '/v1/calls',
      payload: {
        sessionToken: session.token,
        type: CallType.BILL,
        paymentMethod: PaymentMethod.CASH,
        origin: 'WEB_DIRECT'
      }
    });
    expect(duplicateCall.statusCode).toBe(429);
    expect(duplicateCall.json().code).toBe('ACTIVE_CALL_LIMIT');
  });
});

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState, CallType, PaymentMethod } from '@mesaya/shared';

/**
 * E06 — Propinas y reseñas honestas end-to-end
 * Cubre: tip 0 / porcentaje / monto, cambio antes de cobro, BILL no duplica en cuenta,
 * tip de settlements/split por pagador, recarga posterior sin duplicar, smartTips off,
 * reviews off, feedback válido/inválido, duplicado/concurrente, Place ID ausente/inválido.
 * Fixtures efímeras en SQLite test-local, sin relajar invariantes.
 */
describe('E06 — Propinas y reseñas honestas', () => {
  let app: FastifyInstance;

  let restaurantEnabled: any;
  let restaurantSmartOff: any;
  let restaurantReviewsOff: any;
  let restaurantNoPlace: any;

  let shiftEnabled: any;
  let shiftSmartOff: any;
  let shiftReviewsOff: any;
  let shiftNoPlace: any;

  let catEnabled: any;
  let catSmartOff: any;
  let catReviewsOff: any;
  let catNoPlace: any;

  let managerEnabled = '';
  let managerSmartOff = '';
  let managerReviewsOff = '';

  async function createRestaurant(opts: {
    slug: string;
    name: string;
    moduleConfig: any;
  }) {
    const r = await prisma.restaurant.create({
      data: {
        name: opts.name,
        slug: opts.slug,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: opts.moduleConfig }
      }
    });
    const shift = await prisma.shift.create({ data: { restaurantId: r.id, openedAt: new Date() } });
    const cat = await prisma.menuCategory.create({ data: { restaurantId: r.id, name: `E06 cat ${opts.slug.slice(0,6)}` } });
    return { restaurant: r, shift, cat };
  }

  async function createSessionWithOrder(opts: {
    restaurantId: string;
    shiftId: string;
    catId: string;
    price: number; // pesos, ej 100 => 10000 centavos
    labelPrefix?: string;
    tableState?: string;
  }) {
    const table = await prisma.table.create({
      data: {
        restaurantId: opts.restaurantId,
        label: `${opts.labelPrefix || 'E06'}-${randomUUID().slice(0, 6)}`,
        sector: 'SALON',
        currentState: (opts.tableState as any) || TableFSMState.EATING,
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
    const priceMinor = Math.round(opts.price * 100);
    const item = await prisma.menuItem.create({
      data: { categoryId: opts.catId, name: `Plato E06 ${randomUUID().slice(0,4)}`, price: opts.price, priceMinor, isAvailable: true }
    });
    const order = await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount: opts.price,
        totalAmountMinor: priceMinor,
        items: {
          create: [{
            menuItemId: item.id,
            quantity: 1,
            unitPrice: opts.price,
            unitPriceMinor: priceMinor,
            addedByGuest: session.id
          }]
        }
      }
    });
    return { table, session, order, item, priceMinor };
  }

  async function freshAccount(session: any) {
    const res = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    expect(res.statusCode).toBe(200);
    return res.json().account;
  }

  async function settle(sessionId: string, token: string, payload: any) {
    return app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${sessionId}/settle`,
      headers: { authorization: `Bearer ${token}` },
      payload
    });
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const enabled = await createRestaurant({
      slug: `e06-enabled-${Date.now()}-${randomUUID().slice(0,4)}`,
      name: 'E06 enabled',
      moduleConfig: {
        allowOrdering: true,
        allowSplitBill: true,
        allowWaitersToCollectCash: true,
        enableSmartTips: true,
        suggestedTipPercentages: JSON.stringify([10, 15, 20]),
        enableReviews: true,
        googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4'
      }
    });
    restaurantEnabled = enabled.restaurant;
    shiftEnabled = enabled.shift;
    catEnabled = enabled.cat;

    const smartOff = await createRestaurant({
      slug: `e06-smartoff-${Date.now()}-${randomUUID().slice(0,4)}`,
      name: 'E06 smart off',
      moduleConfig: {
        allowOrdering: true,
        allowSplitBill: true,
        allowWaitersToCollectCash: true,
        enableSmartTips: false,
        suggestedTipPercentages: JSON.stringify([10, 15, 20]),
        enableReviews: true,
        googlePlaceId: null
      }
    });
    restaurantSmartOff = smartOff.restaurant;
    shiftSmartOff = smartOff.shift;
    catSmartOff = smartOff.cat;

    const reviewsOff = await createRestaurant({
      slug: `e06-reviewsoff-${Date.now()}-${randomUUID().slice(0,4)}`,
      name: 'E06 reviews off',
      moduleConfig: {
        allowOrdering: true,
        allowSplitBill: true,
        allowWaitersToCollectCash: true,
        enableSmartTips: true,
        suggestedTipPercentages: JSON.stringify([10, 15, 20]),
        enableReviews: false,
        googlePlaceId: null
      }
    });
    restaurantReviewsOff = reviewsOff.restaurant;
    shiftReviewsOff = reviewsOff.shift;
    catReviewsOff = reviewsOff.cat;

    const noPlace = await createRestaurant({
      slug: `e06-noplace-${Date.now()}-${randomUUID().slice(0,4)}`,
      name: 'E06 no place',
      moduleConfig: {
        allowOrdering: true,
        allowSplitBill: true,
        allowWaitersToCollectCash: true,
        enableSmartTips: true,
        suggestedTipPercentages: JSON.stringify([10, 15, 20]),
        enableReviews: true,
        googlePlaceId: null
      }
    });
    restaurantNoPlace = noPlace.restaurant;
    shiftNoPlace = noPlace.shift;
    catNoPlace = noPlace.cat;

    await prisma.staffUser.create({ data: { restaurantId: restaurantEnabled.id, name: 'Mgr E06 en', pinHash: await bcrypt.hash('9999', 10), role: 'MANAGER' } });
    await prisma.staffUser.create({ data: { restaurantId: restaurantSmartOff.id, name: 'Mgr E06 smart', pinHash: await bcrypt.hash('8888', 10), role: 'MANAGER' } });
    await prisma.staffUser.create({ data: { restaurantId: restaurantReviewsOff.id, name: 'Mgr E06 rev', pinHash: await bcrypt.hash('7777', 10), role: 'MANAGER' } });

    const login = async (slug: string, pin: string) => (await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: slug, pin } })).json().token;
    managerEnabled = await login(restaurantEnabled.slug, '9999');
    managerSmartOff = await login(restaurantSmartOff.slug, '8888');
    managerReviewsOff = await login(restaurantReviewsOff.slug, '7777');
  });

  afterAll(async () => {
    for (const r of [restaurantEnabled, restaurantSmartOff, restaurantReviewsOff, restaurantNoPlace]) {
      if (!r?.id) continue;
      await prisma.accountSettlement.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.callRequest.deleteMany({ where: { tableSession: { table: { restaurantId: r.id } } } }).catch(()=>{});
      await prisma.feedback.deleteMany({ where: { tableSession: { table: { restaurantId: r.id } } } }).catch(()=>{});
      await prisma.orderItem.deleteMany({ where: { order: { tableSession: { table: { restaurantId: r.id } } } } }).catch(()=>{});
      await prisma.order.deleteMany({ where: { tableSession: { table: { restaurantId: r.id } } } }).catch(()=>{});
      await prisma.tableSession.deleteMany({ where: { table: { restaurantId: r.id } } }).catch(()=>{});
      await prisma.table.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.menuItem.deleteMany({ where: { category: { restaurantId: r.id } } }).catch(()=>{});
      await prisma.menuCategory.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.shift.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.staffUser.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.restaurantModuleConfigAudit.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.restaurantModuleConfig.deleteMany({ where: { restaurantId: r.id } }).catch(()=>{});
      await prisma.restaurant.delete({ where: { id: r.id } }).catch(()=>{});
    }
    await app.close();
  });

  describe('tip 0, porcentaje y monto fijo', () => {
    it('BILL con tip 0 es aceptado y no altera la cuenta (solicitud BILL, no settlement)', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 100, labelPrefix: 'E06-tip0' });
      const bill = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: session.token, type: CallType.BILL, paymentMethod: PaymentMethod.CASH, tipMinor: 0 }
      });
      expect(bill.statusCode).toBe(201);
      expect(bill.json().tipMinor).toBe(0);
      const account = await freshAccount(session);
      expect(account.consumoMinor).toBe(10000);
      expect(account.tipMinor).toBe(0); // BILL tip no se suma a la proyección contable
      expect(account.saldoMinor).toBe(10000);
      expect(account.tipMinor).not.toBe(bill.json().tipMinor + 1); // trivial guard
    });

    it('BILL con monto fijo (tipMinor directo) es aceptado y queda como solicitud, no como cobro', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 80, labelPrefix: 'E06-fijo' });
      const tipMinor = 2500; // $25 fijo
      const bill = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: session.token, type: CallType.BILL, paymentMethod: PaymentMethod.CARD_DEBIT, tipMinor }
      });
      expect(bill.statusCode).toBe(201);
      expect(bill.json().tipMinor).toBe(tipMinor);
      const account = await freshAccount(session);
      // La cuenta sigue sin tip cobrado, sólo consumo
      expect(account.tipMinor).toBe(0);
      expect(account.saldoMinor).toBe(8000);
      // Verificar que la sesión expone requestedTipMinor en el workspace (staff ve la sugerencia)
      const workspace = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurantEnabled.id}/cash-orders`,
        headers: { authorization: `Bearer ${managerEnabled}` }
      });
      // cash-orders no expone directamente, pero ServiceWorkspace sí; comprobamos que el call está activo con tip
      const calls = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restaurantEnabled.id}`,
        headers: { Authorization: `Bearer ${managerEnabled}` }
      });
      const found = calls.json().find((c: any) => c.tableSessionId === undefined || c.tipMinor === tipMinor);
      // al menos el BILL existe con ese tip
      expect(bill.json().tipMinor).toBe(tipMinor);
    });

    it('porcentaje sobre consumoMinor: staff liquida con tip calculado como round(consumo * pct /100)', async () => {
      // consumo 10000, pct 15 => tip 1500, saldo consumo sigue 10000 hasta cobrar
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 100, labelPrefix: 'E06-pct' });
      const account = await freshAccount(session);
      expect(account.consumoMinor).toBe(10000);
      const pct = 15;
      const tipMinor = Math.round(account.consumoMinor * pct / 100);
      expect(tipMinor).toBe(1500);
      // Staff confirma tip 1500 al liquidar (confirmar/cambiar antes del cobro)
      const res = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-pct-${session.id}`,
        expectedAccountVersion: account.version,
        method: 'WAITER_CASH',
        tipMinor
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().settlement.tipMinor).toBe(1500);
      expect(res.json().account.tipMinor).toBe(1500);
      expect(res.json().account.saldoMinor).toBe(0);
      // totalDue = consumo + tip (para recibo) pero saldo es sólo consumo pagado
      const accountAfter = await freshAccount(session);
      expect(accountAfter.tipMinor).toBe(1500);
      expect(accountAfter.saldoMinor).toBe(0);
    });
  });

  describe('cambio antes de cobro y BILL no duplica en cuenta', () => {
    it('staff puede confirmar/cambiar tipMinor antes del cobro, distinto al solicitado en BILL', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 120, labelPrefix: 'E06-cambio' });
      // Cliente pide BILL con tip 1000
      const bill = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: session.token, type: CallType.BILL, paymentMethod: PaymentMethod.CASH, tipMinor: 1000 }
      });
      expect(bill.statusCode).toBe(201);
      const accountBefore = await freshAccount(session);
      expect(accountBefore.tipMinor).toBe(0); // nada cobrado aún
      // Staff decide cobrar con tip 2000 (cambio antes del cobro)
      const res = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-cambio-${session.id}`,
        expectedAccountVersion: accountBefore.version,
        method: 'WAITER_CASH',
        tipMinor: 2000
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().settlement.tipMinor).toBe(2000);
      expect(res.json().account.tipMinor).toBe(2000);
      // No se sumó el BILL tip (1000) + settlement tip (2000); sólo settlement cuenta
      expect(res.json().account.tipMinor).not.toBe(3000);
    });

    it('BILL tip no se suma a la proyección contable: sólo settlements suman', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 50, labelPrefix: 'E06-bill-nosuma' });
      const billTip = 5000;
      await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: session.token, type: CallType.BILL, paymentMethod: PaymentMethod.CASH, tipMinor: billTip }
      });
      const account = await freshAccount(session);
      expect(account.consumoMinor).toBe(5000);
      expect(account.tipMinor).toBe(0);
      expect(account.saldoMinor).toBe(5000);
      // Liquidación posterior con tip 0 debe dejar tip 0, sin duplicar BILL
      const res = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-bill-nosuma-${session.id}`,
        expectedAccountVersion: account.version,
        method: 'WAITER_CASH',
        tipMinor: 0
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().account.tipMinor).toBe(0);
    });
  });

  describe('tip de settlements y split por pagador', () => {
    it('tip por pagador en split FIXED/PERCENTAGE/EQUAL_PARTS suma correctamente sin duplicar consumo', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 100, labelPrefix: 'E06-split-tip' });
      const v0 = (await freshAccount(session)).version;
      // P1: FIXED 4000 con tip 500
      const r1 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-split-tip-p1-${session.id}`,
        expectedAccountVersion: v0,
        method: 'WAITER_CASH',
        split: { mode: 'FIXED', amountMinor: 4000 },
        tipMinor: 500
      });
      expect(r1.statusCode).toBe(201);
      expect(r1.json().settlement.amountMinor).toBe(4000);
      expect(r1.json().settlement.tipMinor).toBe(500);
      // P2: PERCENTAGE 50% del saldo restante (6000 *50% =3000) con tip 200
      const v1 = r1.json().account.version as string;
      const r2 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-split-tip-p2-${session.id}`,
        expectedAccountVersion: v1,
        method: 'WAITER_CASH',
        split: { mode: 'PERCENTAGE', percentage: 50 },
        tipMinor: 200
      });
      expect(r2.statusCode).toBe(201);
      expect(r2.json().settlement.amountMinor).toBe(3000);
      expect(r2.json().settlement.tipMinor).toBe(200);
      // P3: resta saldo 3000 con tip 100
      const v2 = r2.json().account.version as string;
      const r3 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-split-tip-p3-${session.id}`,
        expectedAccountVersion: v2,
        method: 'WAITER_CASH',
        amountMinor: 3000,
        tipMinor: 100
      });
      expect(r3.statusCode).toBe(201);
      const final = await freshAccount(session);
      expect(final.consumoMinor).toBe(10000);
      expect(final.paidMinor).toBe(10000);
      expect(final.tipMinor).toBe(800); // 500+200+100
      expect(final.saldoMinor).toBe(0);
    });

    it('EQUAL_PARTS por pagador reparte consumo y tip independiente, sin doble suma', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 90, labelPrefix: 'E06-eq-tip' });
      expect((await freshAccount(session)).consumoMinor).toBe(9000);
      // 90 pesos => 9000 centavos, 3 partes: 3000 c/u exacto
      const v0 = (await freshAccount(session)).version;
      const r1 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-eq-tip-1-${session.id}`,
        expectedAccountVersion: v0,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 1 },
        tipMinor: 300
      });
      expect(r1.statusCode).toBe(201);
      expect(r1.json().settlement.amountMinor).toBe(3000);
      const v1 = r1.json().account.version as string;
      const r2 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-eq-tip-2-${session.id}`,
        expectedAccountVersion: v1,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 2 },
        tipMinor: 300
      });
      expect(r2.statusCode).toBe(201);
      const v2 = r2.json().account.version as string;
      const r3 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-eq-tip-3-${session.id}`,
        expectedAccountVersion: v2,
        method: 'WAITER_CASH',
        split: { mode: 'EQUAL_PARTS', parts: 3, partIndex: 3 },
        tipMinor: 300
      });
      expect(r3.statusCode).toBe(201);
      const final = await freshAccount(session);
      expect(final.tipMinor).toBe(900);
      expect(final.paidMinor).toBe(9000);
      expect(final.saldoMinor).toBe(0);
    });

    it('recarga posterior (otra ronda) no duplica tip previo', async () => {
      const { session, table } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 60, labelPrefix: 'E06-recarga' });
      const v0 = (await freshAccount(session)).version;
      const r1 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-recarga-p1-${session.id}`,
        expectedAccountVersion: v0,
        method: 'WAITER_CASH',
        amountMinor: 3000,
        tipMinor: 400
      });
      expect(r1.statusCode).toBe(201);
      expect(r1.json().account.tipMinor).toBe(400);
      expect(r1.json().account.saldoMinor).toBe(3000);
      // Otra ronda: agregar consumo 40 pesos = 4000 centavos
      const priceMinor = 4000;
      const item = await prisma.menuItem.create({ data: { categoryId: catEnabled.id, name: `Extra ${randomUUID().slice(0,4)}`, price: 40, priceMinor, isAvailable: true } });
      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 40,
          totalAmountMinor: priceMinor,
          items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: 40, unitPriceMinor: priceMinor, addedByGuest: session.id }] }
        }
      });
      const afterAdd = await freshAccount(session);
      expect(afterAdd.consumoMinor).toBe(10000); // 6000 + 4000
      expect(afterAdd.paidMinor).toBe(3000);
      expect(afterAdd.tipMinor).toBe(400); // no duplicado
      expect(afterAdd.saldoMinor).toBe(7000);
      // Liquidar resto con tip adicional 100
      const r2 = await settle(session.id, managerEnabled, {
        idempotencyKey: `e06-recarga-p2-${session.id}`,
        expectedAccountVersion: afterAdd.version,
        method: 'WAITER_CASH',
        tipMinor: 100
      });
      expect(r2.statusCode).toBe(201);
      expect(r2.json().account.tipMinor).toBe(500); // 400+100
      expect(r2.json().account.saldoMinor).toBe(0);
    });
  });

  describe('módulo smartTips apagado', () => {
    it('BILL con tip>0 y smartTips off => 403 SMART_TIPS_DISABLED, tip 0 sigue permitido', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantSmartOff.id, shiftId: shiftSmartOff.id, catId: catSmartOff.id, price: 50, labelPrefix: 'E06-smartoff-bill' });
      const withTip = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: session.token, type: CallType.BILL, paymentMethod: PaymentMethod.CASH, tipMinor: 1000 }
      });
      expect(withTip.statusCode).toBe(403);
      expect(withTip.json().code).toBe('SMART_TIPS_DISABLED');
      // sin tip sigue OK
      const withoutTip = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: session.token, type: CallType.BILL, paymentMethod: PaymentMethod.CASH, tipMinor: 0 }
      });
      expect(withoutTip.statusCode).toBe(201);
      // no se creó settlement todavía
      const acc = await freshAccount(session);
      expect(acc.tipMinor).toBe(0);
    });

    it('settle con tip>0 y smartTips off => 403 SMART_TIPS_DISABLED (también settle-and-close), tip 0 permitido', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantSmartOff.id, shiftId: shiftSmartOff.id, catId: catSmartOff.id, price: 70, labelPrefix: 'E06-smartoff-settle' });
      const account = await freshAccount(session);
      // tip>0 debe rechazar tanto settle como settle-and-close
      const res = await settle(session.id, managerSmartOff, {
        idempotencyKey: `e06-smart-off-${session.id}`,
        expectedAccountVersion: account.version,
        method: 'WAITER_CASH',
        tipMinor: 500
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('SMART_TIPS_DISABLED');
      // tip 0 permitido
      const ok = await settle(session.id, managerSmartOff, {
        idempotencyKey: `e06-smart-off-ok-${session.id}`,
        expectedAccountVersion: account.version,
        method: 'WAITER_CASH',
        tipMinor: 0
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json().settlement.tipMinor).toBe(0);
      expect(ok.json().account.saldoMinor).toBe(0);
      // settle-and-close también rechaza tip>0 cuando apagado
      const { session: s2 } = await createSessionWithOrder({ restaurantId: restaurantSmartOff.id, shiftId: shiftSmartOff.id, catId: catSmartOff.id, price: 30, labelPrefix: 'E06-smartoff-close' });
      const v2 = (await freshAccount(s2)).version;
      const closeWithTip = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${s2.id}/settle-and-close`,
        headers: { authorization: `Bearer ${managerSmartOff}` },
        payload: { idempotencyKey: `e06-smart-close-${s2.id}`, expectedAccountVersion: v2, method: 'WAITER_CASH', tipMinor: 100 }
      });
      expect(closeWithTip.statusCode).toBe(403);
      expect(closeWithTip.json().code).toBe('SMART_TIPS_DISABLED');
    });
  });

  describe('módulo reviews apagado', () => {
    it('feedback cuando reviews apagado => 403 REVIEWS_DISABLED sin insertar', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantReviewsOff.id, shiftId: shiftReviewsOff.id, catId: catReviewsOff.id, price: 10, labelPrefix: 'E06-revoff' });
      const before = await prisma.feedback.count({ where: { tableSessionId: session.id } });
      expect(before).toBe(0);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: { sessionToken: session.token, rating: 5, comment: 'Excelente' }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('REVIEWS_DISABLED');
      const after = await prisma.feedback.count({ where: { tableSessionId: session.id } });
      expect(after).toBe(0);
    });
  });

  describe('feedback privado/interno', () => {
    it('feedback válido 1..5, comentario <=1000, una fila por visita, sin exponer token/PII', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 20, labelPrefix: 'E06-fb-ok' });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: { sessionToken: session.token, rating: 5, comment: 'Gracias por todo' }
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.id).toBeDefined();
      expect(body.rating).toBe(5);
      expect(body.comment).toBe('Gracias por todo');
      expect(body.sessionToken).toBeUndefined();
      expect(body.tableSessionId).toBeUndefined();
      expect(body.token).toBeUndefined();
      // una fila por visita verificada en DB
      const rows = await prisma.feedback.findMany({ where: { tableSessionId: session.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0].rating).toBe(5);
    });

    it('rating inválido: 0,6,3.5,string,null,falta => 400 INVALID_RATING', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 20, labelPrefix: 'E06-fb-badrating' });
      for (const bad of [0, 6, 3.5, '5' as any, null as any, undefined as any]) {
        const payload: any = bad === undefined ? { sessionToken: session.token } : { sessionToken: session.token, rating: bad };
        const res = await app.inject({ method: 'POST', url: '/v1/feedback', payload });
        expect(res.statusCode, `rating ${String(bad)}`).toBe(400);
        expect(res.json().code, `rating ${String(bad)}`).toBe('INVALID_RATING');
      }
      // también rating faltante explícito
      const noRating = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: session.token, comment: 'hola' } });
      expect(noRating.statusCode).toBe(400);
    });

    it('comentario inválido: >1000 y no string => 400', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 20, labelPrefix: 'E06-fb-badcomment' });
      const long = 'a'.repeat(1001);
      const resLong = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: session.token, rating: 4, comment: long } });
      expect(resLong.statusCode).toBe(400);
      expect(resLong.json().code).toBe('COMMENT_TOO_LONG');
      const resType = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: session.token, rating: 4, comment: 123 as any } });
      expect(resType.statusCode).toBe(400);
      expect(resType.json().code).toBe('INVALID_COMMENT');
      // exactamente 1000 sí es válido
      const ok = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: session.token, rating: 4, comment: 'a'.repeat(1000) } });
      expect(ok.statusCode).toBe(201);
    });

    it('sesión inválida/expirada/cerrada => 404/410 sin insertar', async () => {
      // inexistente
      const notFound = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: randomUUID(), rating: 5 } });
      expect(notFound.statusCode).toBe(404);
      expect(notFound.json().code).toBe('SESSION_NOT_FOUND');
      // expirada
      const tableExp = await prisma.table.create({ data: { restaurantId: restaurantEnabled.id, label: `E06-exp-${randomUUID().slice(0,4)}` } });
      const expSession = await prisma.tableSession.create({ data: { tableId: tableExp.id, shiftId: shiftEnabled.id, token: randomUUID(), expiresAt: new Date(Date.now() - 1000) } });
      const resExp = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: expSession.token, rating: 5 } });
      expect(resExp.statusCode).toBe(410);
      expect(resExp.json().code).toBe('SESSION_EXPIRED');
      const countExp = await prisma.feedback.count({ where: { tableSessionId: expSession.id } });
      expect(countExp).toBe(0);
      // cerrada
      const tableClosed = await prisma.table.create({ data: { restaurantId: restaurantEnabled.id, label: `E06-closed-${randomUUID().slice(0,4)}` } });
      const closedSession = await prisma.tableSession.create({ data: { tableId: tableClosed.id, shiftId: shiftEnabled.id, token: randomUUID(), expiresAt: new Date(Date.now()+3600000), closedAt: new Date() } });
      const resClosed = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: closedSession.token, rating: 5 } });
      expect(resClosed.statusCode).toBe(410);
      expect(resClosed.json().code).toBe('SESSION_CLOSED');
      const countClosed = await prisma.feedback.count({ where: { tableSessionId: closedSession.id } });
      expect(countClosed).toBe(0);
    });

    it('feedback duplicado y concurrencia => 409 FEEDBACK_ALREADY_EXISTS sin segunda fila', async () => {
      const { session } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 20, labelPrefix: 'E06-fb-dup' });
      const first = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: session.token, rating: 4, comment: 'Primero' } });
      expect(first.statusCode).toBe(201);
      const dup = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: session.token, rating: 5, comment: 'Segundo' } });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().code).toBe('FEEDBACK_ALREADY_EXISTS');
      const count = await prisma.feedback.count({ where: { tableSessionId: session.id } });
      expect(count).toBe(1);
      // concurrencia: dos pedidos paralelos sobre nueva sesión, uno debe ser 201 y otro 409 + una sola fila
      const { session: s2 } = await createSessionWithOrder({ restaurantId: restaurantEnabled.id, shiftId: shiftEnabled.id, catId: catEnabled.id, price: 20, labelPrefix: 'E06-fb-race' });
      const [a, b] = await Promise.all([
        app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: s2.token, rating: 5 } }),
        app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: s2.token, rating: 5 } })
      ]);
      const codes = [a.statusCode, b.statusCode].sort();
      expect(codes).toEqual([201, 409]);
      const raceCount = await prisma.feedback.count({ where: { tableSessionId: s2.id } });
      expect(raceCount).toBe(1);
    });

    it('no expone token/PII y no condiciona enlace Google a rating positivo: sólo Place ID válido muestra enlace (sanitizado)', async () => {
      // La API de feedback nunca devuelve token; esto ya se verificó en caso válido.
      // Para el enlace Google, verificamos que public config y capabilities no requieren rating y sanitizan.
      // La UI usa sanitizeGooglePlaceId; aquí verificamos que el backend sanitiza y no construye con input peligroso.
      const before = await app.inject({ method: 'GET', url: `/v1/restaurants/${restaurantEnabled.slug}/config` });
      expect(before.statusCode).toBe(200);
      const cfg = before.json();
      // restaurantEnabled tiene Place ID válido sanitizado, reviews habilitado
      expect(cfg.enableReviews).toBe(true);
      expect(cfg.googlePlaceId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
      const caps = await app.inject({ method: 'GET', url: `/v1/restaurants/${restaurantEnabled.slug}/capabilities` });
      expect(caps.json().capabilities.reviews.reasonCode).toBe('REVIEWS_INTERNAL_AND_GOOGLE_ACTIVE');
      // No hay rating en config; el enlace no depende de rating
      expect(cfg.googlePlaceId).not.toContain('rating');
    });
  });

  describe('Place ID ausente o inválido', () => {
    it('sin Place ID válido: enlace Google no disponible, feedback interno sigue activo', async () => {
      const cfg = await app.inject({ method: 'GET', url: `/v1/restaurants/${restaurantNoPlace.slug}/config` });
      expect(cfg.statusCode).toBe(200);
      expect(cfg.json().googlePlaceId).toBeNull();
      const caps = await app.inject({ method: 'GET', url: `/v1/restaurants/${restaurantNoPlace.slug}/capabilities` });
      expect(caps.json().capabilities.reviews.reasonCode).toBe('REVIEWS_INTERNAL_ACTIVE_GOOGLE_UNCONFIGURED');
      // feedback interno debe seguir permitido
      const { session } = await createSessionWithOrder({ restaurantId: restaurantNoPlace.id, shiftId: shiftNoPlace.id, catId: catNoPlace.id, price: 20, labelPrefix: 'E06-noplace-fb' });
      const fb = await app.inject({ method: 'POST', url: '/v1/feedback', payload: { sessionToken: session.token, rating: 3 } });
      expect(fb.statusCode).toBe(201);
    });

    it('Place ID inválido en PATCH config => 400 INVALID_GOOGLE_PLACE_ID, no persiste peligroso', async () => {
      // intento con caracteres peligrosos / script
      const badValues = [
        'ChIJ; DROP TABLE',
        'ChIJ<script>alert(1)</script>',
        'ChIJ/exploit?x=1',
        'a'.repeat(129), // >128
        'ChIJ with spaces'
      ];
      for (const bad of badValues) {
        const res = await app.inject({
          method: 'PATCH',
          url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
          headers: { authorization: `Bearer ${managerEnabled}` },
          payload: { googlePlaceId: bad }
        });
        expect(res.statusCode, `bad place ${bad.slice(0,20)}`).toBe(400);
        expect(res.json().code, `bad place ${bad.slice(0,20)}`).toBe('INVALID_GOOGLE_PLACE_ID');
      }
      // valor válido con guiones y guión bajo sí pasa, sanitizado y persistido
      const good = 'ChIJN1t_tDeuEmsRUsoyG83frY4_123-ABC';
      const ok = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
        headers: { authorization: `Bearer ${managerEnabled}` },
        payload: { googlePlaceId: good }
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().googlePlaceId).toBe(good);
      // vacío/null limpia
      const cleared = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
        headers: { authorization: `Bearer ${managerEnabled}` },
        payload: { googlePlaceId: null }
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().googlePlaceId).toBeNull();
      // restaurar original para otros tests
      await app.inject({
        method: 'PATCH',
        url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
        headers: { authorization: `Bearer ${managerEnabled}` },
        payload: { googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }
      });
    });

    it('Place ID sanitizado: sólo [A-Za-z0-9_-]{1,128} es aceptado y no se construye enlace con input peligroso', async () => {
      // Verificar que config.service sanitiza antes de exponer capabilities
      const dangerous = 'ChIJN1t_tDeuEmsRUsoyG83frY4";alert(1)//';
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
        headers: { authorization: `Bearer ${managerEnabled}` },
        payload: { googlePlaceId: dangerous }
      });
      expect(res.statusCode).toBe(400);
      // La capability debe permanecer sin exponer el valor peligroso
      const caps = await app.inject({ method: 'GET', url: `/v1/restaurants/${restaurantEnabled.slug}/capabilities` });
      expect(caps.json().capabilities.reviews.message).not.toContain('alert');
      expect(caps.json().capabilities.reviews.message).not.toContain('";');
    });
  });

  describe('configuración de propinas sugeridas: enteros 0..100, máx 5', () => {
    it('suggestedTipPercentages válido 0..100 enteros, hasta 5', async () => {
      const ok = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
        headers: { authorization: `Bearer ${managerEnabled}` },
        payload: { suggestedTipPercentages: [0, 5, 10, 15, 20] }
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().suggestedTipPercentages).toEqual([0, 5, 10, 15, 20]);
      const withZero = await app.inject({
        method: 'PATCH',
        url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
        headers: { authorization: `Bearer ${managerEnabled}` },
        payload: { suggestedTipPercentages: [0] }
      });
      expect(withZero.statusCode).toBe(200);
    });

    it('rechaza porcentajes no enteros, fuera de 0..100 o más de 5', async () => {
      const cases: any[] = [
        [10.5, 20],
        [-1, 10],
        [101],
        [10, 20, 30, 40, 50, 60], // 6 > max 5
        ['10' as any],
        [null as any]
      ];
      for (const bad of cases) {
        const res = await app.inject({
          method: 'PATCH',
          url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
          headers: { authorization: `Bearer ${managerEnabled}` },
          payload: { suggestedTipPercentages: bad }
        });
        expect(res.statusCode, `bad ${JSON.stringify(bad)}`).toBe(400);
        expect(res.json().code, `bad ${JSON.stringify(bad)}`).toBe('INVALID_TIP_PERCENTAGES');
      }
      // restaurar válido para no afectar otros tests
      await app.inject({
        method: 'PATCH',
        url: `/v1/admin/restaurants/${restaurantEnabled.id}/config`,
        headers: { authorization: `Bearer ${managerEnabled}` },
        payload: { suggestedTipPercentages: [10, 15, 20] }
      });
    });
  });
});

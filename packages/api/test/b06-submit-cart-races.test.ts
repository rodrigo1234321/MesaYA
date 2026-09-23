import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { OrderService } from '../src/services/order.service';
import { SessionService } from '../src/services/session.service';
import { eventBus } from '../src/lib/eventBus';

afterEach(() => vi.restoreAllMocks());

/**
 * B06 — envíos, reintentos y carreras (matriz T09–T12).
 * Doble submit idempotente (con y sin clave), replay tras timeout, arbitraje
 * cierre/expiración/liquidación, carrito colaborativo concurrente y revalidación
 * de disponibilidad/precio al commit con snapshot histórico intacto.
 * Fixture real en SQLite efímera, sin mocks de persistencia.
 */
describe('B06 — submit idempotente y carrito concurrente', () => {
  let app: FastifyInstance;
  let rest1: any;
  let shift1: any;
  let cat1: any;
  let manager1: string;

  async function mkSession(label: string) {
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
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    return { table, session };
  }

  async function mkItem(name: string, price: number) {
    return prisma.menuItem.create({ data: { categoryId: cat1.id, name, price, isAvailable: true } });
  }

  async function add(sessionToken: string, menuItemId: string, quantity = 1) {
    return OrderService.addItem({ sessionToken, menuItemId, quantity } as any);
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    rest1 = await prisma.restaurant.create({
      data: {
        name: 'b06-r1',
        slug: `b06-r1-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    shift1 = await prisma.shift.create({ data: { restaurantId: rest1.id, openedAt: new Date() } });
    cat1 = await prisma.menuCategory.create({ data: { restaurantId: rest1.id, name: 'B06', orderIndex: 0 } });
    await prisma.staffUser.create({
      data: { restaurantId: rest1.id, name: 'Manager B06', pinHash: await bcrypt.hash('9999', 10), role: 'MANAGER' }
    });
    manager1 = (
      await app.inject({ method: 'POST', url: '/v1/auth/login-admin', payload: { restaurantSlug: rest1.slug, pin: '9999' } })
    ).json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('T10a doble submit concurrente con la misma clave: un único ticket', async () => {
    const { session } = await mkSession('Mesa B06-10a');
    const item = await mkItem('Plato A', 1000);
    await add(session.token, item.id);
    const key = `b06-double-${randomUUID()}`;
    const [r1, r2] = await Promise.allSettled([
      OrderService.submitOrder(session.token, { idempotencyKey: key }),
      OrderService.submitOrder(session.token, { idempotencyKey: key })
    ]);
    expect(r1.status).toBe('fulfilled');
    expect(r2.status).toBe('fulfilled');
    const o1 = (r1 as PromiseFulfilledResult<any>).value;
    const o2 = (r2 as PromiseFulfilledResult<any>).value;
    expect(o1.id).toBe(o2.id);
    expect(await prisma.order.count({ where: { tableSessionId: session.id, status: { not: 'DRAFT' } } })).toBe(1);
    expect(await prisma.submitReceipt.count({ where: { tableSessionId: session.id } })).toBe(1);
  });

  it('T10b replay tras timeout: la misma clave devuelve la tanda original con borrador nuevo', async () => {
    const { session } = await mkSession('Mesa B06-10b');
    const item = await mkItem('Plato B', 1200);
    await add(session.token, item.id);
    const key = `b06-replay-${randomUUID()}`;
    const first = await OrderService.submitOrder(session.token, { idempotencyKey: key });
    // El cliente, sin haber visto la respuesta, agrega otro plato (borrador nuevo)...
    await add(session.token, item.id);
    // ...y reintenta con la MISMA clave: recupera la tanda original, no duplica.
    const replay = await OrderService.submitOrder(session.token, { idempotencyKey: key });
    expect(replay.id).toBe(first.id);
    expect(await prisma.order.count({ where: { tableSessionId: session.id, status: { not: 'DRAFT' } } })).toBe(1);
    // El borrador nuevo sigue intacto para un envío posterior con clave nueva.
    const draft = await prisma.order.findFirst({ where: { tableSessionId: session.id, status: 'DRAFT' }, include: { items: true } });
    expect(draft?.items).toHaveLength(1);
  });

  it('T10c doble submit sin clave sobre el mismo borrador: misma tanda, sin duplicar', async () => {
    const { session } = await mkSession('Mesa B06-10c');
    const item = await mkItem('Plato C', 800);
    await add(session.token, item.id);
    const [r1, r2] = await Promise.allSettled([
      OrderService.submitOrder(session.token),
      OrderService.submitOrder(session.token)
    ]);
    const ids = [r1, r2].map((r) => (r.status === 'fulfilled' ? (r as PromiseFulfilledResult<any>).value.id : null));
    expect(ids[0]).toBeDefined();
    expect(ids[1]).toBeDefined();
    expect(ids[0]).toBe(ids[1]);
  });

  it('T09 liquidar y seguir pidiendo: versión nueva, settlement intacto, clave vieja 409', async () => {
    const { session } = await mkSession('Mesa B06-09');
    const item = await mkItem('Plato D', 2000);
    await add(session.token, item.id);
    // Modo validación vigente: el envío queda PENDING hasta que el mozo lo acepta.
    const sent = await OrderService.submitOrder(session.token, { idempotencyKey: `b06-t9-${randomUUID()}` });
    await OrderService.validateOrder(sent.id, 'Mozo', rest1.id);
    const v1 = (await OrderService.getSessionAccount(session.id)).version;
    const settled = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: { idempotencyKey: `b06-t9s-${randomUUID()}`, expectedAccountVersion: v1, method: 'WAITER_CASH' }
    });
    expect(settled.statusCode).toBe(201);
    // Pedir cuenta no cierra: un postre posterior entra como tanda nueva, sin huérfanos.
    await add(session.token, item.id);
    const dessertSent = await OrderService.submitOrder(session.token, { idempotencyKey: `b06-t9d-${randomUUID()}` });
    await OrderService.validateOrder(dessertSent.id, 'Mozo', rest1.id);
    const dessert = dessertSent;
    expect(dessert.tableSessionId).toBe(session.id);
    const account = await OrderService.getSessionAccount(session.id);
    expect(account.version).not.toBe(v1);
    expect(account.consumoMinor).toBe(400000);
    expect(account.saldoMinor).toBe(200000);
    // Un cobro con la versión vieja se rechaza: no oculta consumo.
    const stale = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${session.id}/settle`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: { idempotencyKey: `b06-t9o-${randomUUID()}`, expectedAccountVersion: v1, method: 'WAITER_CASH' }
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('STALE_ACCOUNT_VERSION');
  });

  it('T09b envío sobre sesión cerrada o expirada: 410 sin huérfanos', async () => {
    const closed = await mkSession('Mesa B06-09b1');
    const item = await mkItem('Plato E', 500);
    // Cierre sobre mesa sin pendientes (B05: con borrador bloquearía con DRAFT_UNRESOLVED).
    await SessionService.closeTableSession(closed.table.id);
    await expect(OrderService.submitOrder(closed.session.token)).rejects.toMatchObject({
      statusCode: 410,
      code: 'SESSION_CLOSED'
    });
    const expired = await mkSession('Mesa B06-09b2');
    await prisma.tableSession.update({
      where: { id: expired.session.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    await expect(OrderService.addItem({ sessionToken: expired.session.token, menuItemId: item.id, quantity: 1 } as any)).rejects.toMatchObject({
      statusCode: 410,
      code: 'SESSION_EXPIRED'
    });
    // Sin huérfanos: nada enviado en sesiones no vigentes.
    expect(await prisma.order.count({ where: { tableSessionId: { in: [closed.session.id, expired.session.id] }, status: { not: 'DRAFT' } } })).toBe(0);
  });

  it('T11 dos comensales agregan a la vez: un borrador, líneas y total exactos', async () => {
    const { session } = await mkSession('Mesa B06-11');
    const [itemA, itemB] = await Promise.all([mkItem('Plato F', 1000), mkItem('Plato G', 2500)]);
    // Disparo concurrente: el perdedor del lock puede recibir 409 accionable.
    // Recuperación contractual del cliente: reintentar una vez (nunca duplicar a ciegas).
    const attempt = (item: any, qty: number) => add(session.token, item.id, qty);
    const params = [
      { item: itemA, qty: 2 },
      { item: itemB, qty: 1 }
    ];
    const results = await Promise.allSettled(params.map((p) => attempt(p.item, p.qty)));
    for (let i = 0; i < results.length; i++) {
      for (let n = 0; n < 3; n++) {
        const r = results[i];
        if (r.status === 'fulfilled' || (r as PromiseRejectedResult).reason?.statusCode !== 409) break;
        results[i] = (await Promise.allSettled([attempt(params[i].item, params[i].qty)]))[0];
      }
    }
    for (const r of results) {
      expect(r.status, JSON.stringify(r.status === 'rejected' ? (r as PromiseRejectedResult).reason : null)).toBe('fulfilled');
    }
    const drafts = await prisma.order.findMany({ where: { tableSessionId: session.id, status: 'DRAFT' }, include: { items: true } });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].items).toHaveLength(2);
    expect(drafts[0].totalAmount).toBe(4500);
    const account = await OrderService.getSessionAccount(session.id);
    expect(account.draft?.totalMinor).toBe(450000);
  });

  it('ORDER_REVIEW_REQUIRED bloquea cliente, mozo, carga manual, pre-pedido y envío/validación aun con isAvailable=true', async () => {
    const item = await mkItem('Fauno precio a consultar', 0);
    await prisma.menuItem.update({
      where: { id: item.id },
      data: { isAvailable: true, tags: JSON.stringify(['ORDER_REVIEW_REQUIRED', 'PRICE_FROM']) }
    });
    const reviewError = { statusCode: 422, code: 'ITEM_NOT_AVAILABLE' };

    const guest = await mkSession('Mesa review guest');
    await expect(add(guest.session.token, item.id)).rejects.toMatchObject(reviewError);

    const staff = await mkSession('Mesa review staff');
    await expect(OrderService.addItemByStaff({
      tableId: staff.table.id,
      menuItemId: item.id,
      quantity: 1,
      staffRestaurantId: rest1.id
    })).rejects.toMatchObject(reviewError);

    const manual = await mkSession('Mesa review manual');
    await expect(OrderService.addManualOrderByStaff({
      tableId: manual.table.id,
      lines: [{ menuItemId: item.id, quantity: 1 }],
      staffRestaurantId: rest1.id
    })).rejects.toMatchObject(reviewError);

    const preorder = await mkSession('Mesa review preorder');
    await expect(OrderService.addPreOrderByStaff({
      tableId: preorder.table.id,
      lines: [{ menuItemId: item.id, quantity: 1 }],
      staffRestaurantId: rest1.id
    })).rejects.toMatchObject(reviewError);
    await expect(prisma.$transaction((tx) => OrderService.addPreOrderByStaffTx(tx, {
      tableId: preorder.table.id,
      lines: [{ menuItemId: item.id, quantity: 1 }],
      staffRestaurantId: rest1.id
    }))).rejects.toMatchObject(reviewError);

    const submit = await mkSession('Mesa review submit');
    const draft = await prisma.order.create({
      data: {
        tableSessionId: submit.session.id,
        items: { create: [{ menuItemId: item.id, quantity: 1, unitPrice: 0, addedByGuest: 'review-test' }] }
      }
    });
    const submitted = await OrderService.submitOrder(submit.session.token);
    expect(submitted.id).toBe(draft.id);
    const pending = await prisma.order.findUniqueOrThrow({ where: { id: draft.id } });
    expect(pending.status).toBe('PENDING_VALIDATION');
    expect(pending.reviewReasonCode).toBe('STOCK_UNAVAILABLE');
    await expect(OrderService.validateOrder(pending.id, 'Mozo', rest1.id)).rejects.toMatchObject(reviewError);
  });

  it('T11b borrado concurrente del mismo ítem: uno gana, otro 404/409, total consistente', async () => {
    const { session } = await mkSession('Mesa B06-11b');
    const item = await mkItem('Plato H', 700);
    const draft = await add(session.token, item.id);
    const itemId = draft.items[0].id;
    const attemptRemove = () => OrderService.removeItem(session.token, itemId);
    const results = await Promise.allSettled([attemptRemove(), attemptRemove()]);
    // 409 de lock es contractual: se reintenta de forma consciente (acotado).
    for (let i = 0; i < results.length; i++) {
      for (let n = 0; n < 3; n++) {
        const r = results[i];
        if (r.status === 'fulfilled' || (r as PromiseRejectedResult).reason?.statusCode !== 409) break;
        results[i] = await attemptRemove().then(
          (v) => ({ status: 'fulfilled', value: v }) as PromiseSettledResult<any>,
          (e) => ({ status: 'rejected', reason: e }) as PromiseSettledResult<any>
        );
      }
    }
    const codes = results.map((r) =>
      r.status === 'fulfilled' ? 200 : ((r as PromiseRejectedResult).reason?.statusCode || 500)
    );
    expect(codes).toContain(200);
    // El perdedor ve 404 (ya borrado) o 409 (lock, ya reintentado): nunca 500 ni doble borrado.
    expect(codes.every((c) => c === 200 || c === 404)).toBe(true);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    const rest = await prisma.orderItem.findMany({ where: { orderId: draft.id } });
    expect(rest).toHaveLength(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: draft.id } })).totalAmount).toBe(0);
  });

  it('T12 plato agotado al enviar: queda en revisión con motivo persistido', async () => {
    const { session } = await mkSession('Mesa B06-12');
    const okItem = await mkItem('Plato I', 900);
    const doomedItem = await mkItem('Plato J', 1100);
    await add(session.token, okItem.id);
    const draftBefore = await add(session.token, doomedItem.id);
    expect(draftBefore.items.find((i: any) => i.menuItemId === doomedItem.id)).toBeDefined();
    await prisma.menuItem.update({ where: { id: doomedItem.id }, data: { isAvailable: false } });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/submit',
      payload: { sessionToken: session.token }
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('PENDING_VALIDATION');
    expect(res.json().reviewReason?.code).toBe('STOCK_UNAVAILABLE');
    expect(await prisma.order.count({ where: { tableSessionId: session.id, status: 'DRAFT' } })).toBe(0);
    expect(await prisma.order.count({ where: { tableSessionId: session.id, status: 'PENDING_VALIDATION' } })).toBe(1);
  });

  it('T12b precio cambiado antes de enviar: rige la instantánea tomada al agregar', async () => {
    const { session } = await mkSession('Mesa B06-12b');
    const item = await mkItem('Plato K', 1000);
    await add(session.token, item.id, 2);
    await prisma.menuItem.update({ where: { id: item.id }, data: { price: 2500 } });
    const submitted = await OrderService.submitOrder(session.token, { idempotencyKey: `b06-snap-${randomUUID()}` });
    const line = submitted.items.find((i: any) => i.menuItemId === item.id);
    expect(line?.unitPrice).toBe(1000);
    expect(submitted.totalAmount).toBe(2000);
    const stored = await prisma.orderItem.findMany({ where: { orderId: submitted.id } });
    expect(stored[0].unitPriceMinor).toBe(100000);
  });

  it('R1 retry no duplica aviso operativo: replay y pin no emiten order.submitted', async () => {
    const { session } = await mkSession('Mesa B06-R1');
    const item = await mkItem('Plato R', 600);
    await add(session.token, item.id);
    const spy = vi.spyOn(eventBus, 'broadcast');
    const key = `b06-bc-${randomUUID()}`;
    const countSubmitted = () =>
      spy.mock.calls.filter((c) => c[1] === 'order.submitted').length;
    await OrderService.submitOrder(session.token, { idempotencyKey: key });
    expect(countSubmitted()).toBe(1);
    // Retry con la misma clave: replay sin nuevo aviso.
    await OrderService.submitOrder(session.token, { idempotencyKey: key });
    expect(countSubmitted()).toBe(1);
    // Pin de clave nueva sobre tanda histórica: tampoco avisa.
    await OrderService.submitOrder(session.token, { idempotencyKey: `b06-bc2-${randomUUID()}` });
    expect(countSubmitted()).toBe(1);
  });

  it('R2 guarda transaccional: cierre/expiración no dejan escritura huérfana', async () => {
    const closed = await mkSession('Mesa B06-R2a');
    await SessionService.closeTableSession(closed.table.id);
    const item = await mkItem('Plato S', 500);
    await expect(add(closed.session.token, item.id)).rejects.toMatchObject({
      statusCode: 410,
      code: 'SESSION_CLOSED'
    });
    await expect(OrderService.submitOrder(closed.session.token)).rejects.toMatchObject({
      statusCode: 410,
      code: 'SESSION_CLOSED'
    });
    await expect(OrderService.removeItem(closed.session.token, 'inexistente')).rejects.toMatchObject({
      statusCode: 410
    });
    expect(await prisma.order.count({ where: { tableSessionId: closed.session.id } })).toBe(0);

    const expired = await mkSession('Mesa B06-R2b');
    await prisma.tableSession.update({
      where: { id: expired.session.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });
    await expect(add(expired.session.token, item.id)).rejects.toMatchObject({
      statusCode: 410,
      code: 'SESSION_EXPIRED'
    });
    expect(await prisma.order.count({ where: { tableSessionId: expired.session.id } })).toBe(0);
  });

  it('R3 borradores históricos duplicados: 409 sin elección arbitraria; singleton se vincula', async () => {
    const multi = await mkSession('Mesa B06-R3a');
    const item = await mkItem('Plato T', 400);
    await prisma.order.createMany({
      data: [
        { tableSessionId: multi.session.id, status: OrderStatus.DRAFT, totalAmount: 0 },
        { tableSessionId: multi.session.id, status: OrderStatus.DRAFT, totalAmount: 0 }
      ]
    });
    await expect(add(multi.session.token, item.id)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DRAFT_CONFLICT'
    });
    await expect(OrderService.submitOrder(multi.session.token)).rejects.toMatchObject({
      statusCode: 409,
      code: 'DRAFT_CONFLICT'
    });
    // Nada escrito sobre los duplicados: siguen los 2, sin ítems.
    expect(await prisma.order.count({ where: { tableSessionId: multi.session.id, status: 'DRAFT' } })).toBe(2);

    const single = await mkSession('Mesa B06-R3b');
    const legacy = await prisma.order.create({
      data: { tableSessionId: single.session.id, status: OrderStatus.DRAFT, totalAmount: 0 }
    });
    expect(legacy.draftKey).toBeNull();
    await add(single.session.token, item.id);
    const bound = await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } });
    expect(bound.draftKey).toBe(single.session.id);
    expect(await prisma.orderItem.count({ where: { orderId: legacy.id } })).toBe(1);
  });

  it('R4 clave nueva sobre tanda histórica: pin atómico estable, sin deriva', async () => {
    const { session } = await mkSession('Mesa B06-R4');
    const item = await mkItem('Plato U', 700);
    await add(session.token, item.id);
    const o1 = await OrderService.submitOrder(session.token);
    // Clave sin borrador y sin tanda: 400 legado, sin recibo.
    const empty = await mkSession('Mesa B06-R4e');
    await expect(
      OrderService.submitOrder(empty.session.token, { idempotencyKey: `b06-pin-e-${randomUUID()}` })
    ).rejects.toMatchObject({ statusCode: 400, code: 'EMPTY_ORDER' });
    expect(await prisma.submitReceipt.count({ where: { tableSessionId: empty.session.id } })).toBe(0);

    // Pin: la clave queda asociada a O1 para siempre.
    const pinKey = `b06-pin-${randomUUID()}`;
    const pinned = await OrderService.submitOrder(session.token, { idempotencyKey: pinKey });
    expect(pinned.id).toBe(o1.id);
    // Nueva tanda con otra clave...
    await add(session.token, item.id);
    const o2 = await OrderService.submitOrder(session.token, { idempotencyKey: `b06-pin2-${randomUUID()}` });
    expect(o2.id).not.toBe(o1.id);
    // ...y la clave pineada sigue devolviendo O1 no matter what.
    const stable = await OrderService.submitOrder(session.token, { idempotencyKey: pinKey });
    expect(stable.id).toBe(o1.id);
    expect(await prisma.submitReceipt.count({ where: { idempotencyKey: pinKey } })).toBe(1);
  });

  it('RX1 carrera cierre-vs-agregado: nunca ambos con éxito ni huérfanos', async () => {
    for (let round = 0; round < 6; round++) {
      const { table, session } = await mkSession(`Mesa B06-X1-${round}`);
      const item = await mkItem(`Plato X1-${round}`, 500);
      const [closeRes, addRes] = await Promise.allSettled([
        SessionService.closeTableSession(table.id),
        add(session.token, item.id)
      ]);
      const closeCode =
        closeRes.status === 'fulfilled' ? 200 : ((closeRes as PromiseRejectedResult).reason?.statusCode || 500);
      const addCode =
        addRes.status === 'fulfilled' ? 200 : ((addRes as PromiseRejectedResult).reason?.statusCode || 500);
      // Solo salidas contractuales: éxito coherente, 409 o 410. Nunca 500.
      expect([200, 409, 410].includes(closeCode), `cierre ronda ${round}: ${closeCode}`).toBe(true);
      expect([200, 409, 410].includes(addCode), `agregado ronda ${round}: ${addCode}`).toBe(true);
      const closedNow = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
      const orderCount = await prisma.order.count({ where: { tableSessionId: session.id } });
      if (closeCode === 200 && !(closeRes.status === 'fulfilled' && (closeRes as any).value?.alreadyClosed)) {
        // Ganó el cierre: el agregado fue rechazado ANTES de escribir.
        expect(closedNow.closedAt).not.toBeNull();
        expect(orderCount).toBe(0);
        expect(addCode === 409 || addCode === 410).toBe(true);
      }
      if (addCode === 200) {
        // Ganó el agregado: el cierre vio el borrador y se bloqueó; sesión abierta.
        expect(closedNow.closedAt).toBeNull();
        expect(closeCode).toBe(409);
        expect(orderCount).toBe(1);
      }
    }
  });

  it('RX2 carrera cobro-vs-envío: sin 500, sin huérfanos ni saldo oculto', async () => {
    const { session } = await mkSession('Mesa B06-X2');
    const item = await mkItem('Plato X2', 2000);
    await add(session.token, item.id);
    const sent = await OrderService.submitOrder(session.token, { idempotencyKey: `b06-x2-${randomUUID()}` });
    await OrderService.validateOrder(sent.id, 'Mozo', rest1.id);
    await add(session.token, item.id); // borrador nuevo pendiente de envío
    const version = (await OrderService.getSessionAccount(session.id)).version;
    const [settleRes, submitRes] = await Promise.allSettled([
      app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${manager1}` },
        payload: { idempotencyKey: `b06-x2s-${randomUUID()}`, expectedAccountVersion: version, method: 'WAITER_CASH' }
      }),
      OrderService.submitOrder(session.token, { idempotencyKey: `b06-x2n-${randomUUID()}` })
    ]);
    const settleCode = settleRes.status === 'fulfilled' ? settleRes.value.statusCode : 500;
    const submitCode = submitRes.status === 'fulfilled' ? 200 : ((submitRes as PromiseRejectedResult).reason?.statusCode || 500);
    expect([200, 201, 409].includes(settleCode)).toBe(true);
    expect(submitCode).toBe(200);
    // Consistencia desde filas crudas: nada oculto ni duplicado.
    const orders = await prisma.order.findMany({
      where: { tableSessionId: session.id, status: { notIn: ['DRAFT', 'PENDING_VALIDATION', 'CANCELLED'] } },
      include: { payments: true }
    });
    const settlements = await prisma.accountSettlement.findMany({ where: { tableSessionId: session.id } });
    const consumo = orders.reduce((s, o) => s + Math.round(o.totalAmount * 100), 0);
    const legacyPaid = orders.flatMap((o) => o.payments)
      .filter((p) => p.status === 'APPROVED' || p.status === 'MANUAL_SETTLED')
      .reduce((s, p) => s + Math.round(p.amount * 100), 0);
    const settledPaid = settlements.reduce((s, x) => s + x.amountMinor, 0);
    const account = await OrderService.getSessionAccount(session.id);
    expect(account.consumoMinor).toBe(consumo);
    expect(account.paidMinor).toBe(legacyPaid + settledPaid);
    expect(account.saldoMinor).toBe(consumo - legacyPaid - settledPaid);
    // Sin huérfanos: la sesión sigue abierta (nadie la cerró en este test).
    expect((await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } })).closedAt).toBeNull();
  });

  it('R5 priceMinor sincronizado en escritores de catálogo', async () => {
    // Alta por ruta con manager: priceMinor no-null desde el origen.
    const created = await app.inject({
      method: 'POST',
      url: `/v1/restaurants/${rest1.slug}/menu/items`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: { categoryId: cat1.id, name: 'Plato V', price: 1350 }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().priceMinor).toBe(135000);
    const itemId = created.json().id;
    // PATCH de precio: minor sincronizado (no desfasado tras backfill).
    const patched = await app.inject({
      method: 'PATCH',
      url: `/v1/restaurants/${rest1.slug}/menu/items/${itemId}`,
      headers: { authorization: `Bearer ${manager1}` },
      payload: { price: 1500 }
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().priceMinor).toBe(150000);
    const stored = await prisma.menuItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(stored.priceMinor).toBe(150000);
  });

  it('T12c plato no disponible al agregar: 422 inmediato', async () => {
    const { session } = await mkSession('Mesa B06-12c');
    const item = await mkItem('Plato L', 400);
    await prisma.menuItem.update({ where: { id: item.id }, data: { isAvailable: false } });
    await expect(add(session.token, item.id)).rejects.toMatchObject({
      statusCode: 422,
      code: 'ITEM_NOT_AVAILABLE'
    });
  });

  it('T11c eliminar último ítem deja borrador vacío con total 0 y permite re-agregar sin pérdida de enviados', async () => {
    const { session } = await mkSession('Mesa B06-11c');
    const sentItem = await mkItem('Plato 11c-sent', 1200);
    const draftItemA = await mkItem('Plato 11c-A', 800);
    const draftItemB = await mkItem('Plato 11c-B', 900);
    // Tanda previa enviada (consumo 1200) — verifica que borrar borrador no afecta consumo.
    await add(session.token, sentItem.id);
    const sent = await OrderService.submitOrder(session.token, { idempotencyKey: `b06-11c-sent-${randomUUID()}` });
    await OrderService.validateOrder(sent.id, 'Mozo', rest1.id);
    const accountBefore = await OrderService.getSessionAccount(session.id);
    expect(accountBefore.consumoMinor).toBe(120000);
    // Borrador con 2 ítems.
    await add(session.token, draftItemA.id, 1);
    const draft2 = await add(session.token, draftItemB.id, 2);
    expect(draft2.items).toHaveLength(2);
    expect(draft2.totalAmount).toBe(800 + 1800);
    const toRemoveB = draft2.items.find((i: any) => i.menuItemId === draftItemB.id)!.id;
    const afterFirstRemove = await OrderService.removeItem(session.token, toRemoveB);
    expect(afterFirstRemove.items).toHaveLength(1);
    expect(afterFirstRemove.totalAmount).toBe(800);
    expect(afterFirstRemove.status).toBe('DRAFT');
    // Eliminar último ítem restante.
    const lastId = afterFirstRemove.items[0].id;
    const afterLastRemove = await OrderService.removeItem(session.token, lastId);
    expect(afterLastRemove.items).toHaveLength(0);
    expect(afterLastRemove.totalAmount).toBe(0);
    expect(afterLastRemove.status).toBe('DRAFT');
    const draftRow = await prisma.order.findUniqueOrThrow({ where: { id: afterLastRemove.id } });
    expect(draftRow.totalAmount).toBe(0);
    expect(draftRow.totalAmountMinor).toBe(0);
    // Cuenta no afectada; borrador vacío con totalMinor 0.
    const accountEmpty = await OrderService.getSessionAccount(session.id);
    expect(accountEmpty.consumoMinor).toBe(120000);
    expect(accountEmpty.draft?.totalMinor).toBe(0);
    // Re-agregar funciona: nuevo ítem reutiliza mismo borrador (mismo orderId) y total exacto.
    const again = await add(session.token, draftItemA.id, 3);
    expect(again.id).toBe(afterLastRemove.id);
    expect(again.items).toHaveLength(1);
    expect(again.items[0].quantity).toBe(3);
    expect(again.totalAmount).toBe(2400);
    // Doble borrado del ítem ya quitado: 404 sin 500.
    await expect(OrderService.removeItem(session.token, lastId)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('T12d stock cambiado con otro ítem conserva la tanda y permite recuperación al reponer stock', async () => {
    const { session } = await mkSession('Mesa B06-12d');
    const ok1 = await mkItem('Plato 12d-ok1', 1000);
    const doomed = await mkItem('Plato 12d-doomed', 1500);
    const ok2 = await mkItem('Plato 12d-ok2', 700);
    await add(session.token, ok1.id, 1);
    const draftBefore = await add(session.token, doomed.id, 1);
    await add(session.token, ok2.id, 2);
    const doomedLineId = draftBefore.items.find((i: any) => i.menuItemId === doomed.id)!.id;
    await prisma.menuItem.update({ where: { id: doomed.id }, data: { isAvailable: false } });
    const fail = await app.inject({
      method: 'POST',
      url: '/v1/orders/submit',
      payload: { sessionToken: session.token, idempotencyKey: `b06-12d-${randomUUID()}` }
    });
    expect(fail.statusCode).toBe(200);
    expect(fail.json().status).toBe('PENDING_VALIDATION');
    expect(fail.json().reviewReason?.code).toBe('STOCK_UNAVAILABLE');
    // La tanda conserva las 3 líneas y queda fuera del consumo hasta resolver la excepción.
    const pendingAfterReview = await prisma.order.findFirst({
      where: { tableSessionId: session.id, status: 'PENDING_VALIDATION' },
      include: { items: true }
    });
    expect(pendingAfterReview?.items).toHaveLength(3);
    expect(pendingAfterReview?.items.map((item: any) => item.id)).toContain(doomedLineId);
    expect(await prisma.order.count({ where: { tableSessionId: session.id, status: 'DRAFT' } })).toBe(0);
    // Recuperación: reponer stock y aceptar la misma tanda, sin reenvío ni duplicado.
    await prisma.menuItem.update({ where: { id: doomed.id }, data: { isAvailable: true } });
    const submitted = await OrderService.getOrderById(pendingAfterReview!.id);
    expect(submitted?.items).toHaveLength(3);
    expect(submitted?.totalAmount).toBe(1000 + 1500 + 1400);
    let account = await OrderService.getSessionAccount(session.id);
    expect(account.pendingValidation).toHaveLength(1);
    expect(account.pendingValidation[0].totalMinor).toBe(390000);
    expect(account.consumoMinor).toBe(0);
    expect(account.draft).toBeNull();
    await OrderService.validateOrder(submitted!.id, 'Mozo', rest1.id);
    account = await OrderService.getSessionAccount(session.id);
    expect(account.consumoMinor).toBe(390000);
    expect(account.pendingValidation).toHaveLength(0);
  });
});

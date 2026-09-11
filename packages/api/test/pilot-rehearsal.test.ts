import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/index';

/**
 * Etapa 28 — Ensayo integral del piloto con datos ficticios.
 *
 * Recorrido completo sin editar la DB entre pasos (sólo fixtures en
 * beforeAll y limpieza en afterAll): manager abre turno → QR activa mesa →
 * llamado → atención → pedido → cocina → pedido de cuenta → cobro presencial
 * autorizado → cierre → token revocado. Más: aislamiento A/B, dos clientes
 * simultáneos, interrupción (backend caído) y reinicio con estado persistido,
 * contención de pagos digitales (503) y cobro no autorizado (403 sin writes).
 *
 * Corre en SQLite (runner aislado) y en PostgreSQL desechable
 * (`test-postgres.mjs`), donde además se levanta UI real para capturas.
 */
describe('Etapa 28 — Ensayo integral del piloto (datos ficticios)', () => {
  let app: FastifyInstance;
  const timings: { fase: string; ms: number }[] = [];
  const timed = async <T>(fase: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    try {
      return await fn();
    } finally {
      timings.push({ fase, ms: Date.now() - t0 });
    }
  };

  let restA: any;
  let restB: any;
  let tableA1: any;
  let tableA2: any;
  let tableB1: any;
  let itemA: any;
  let tokenManagerA = '';
  let tokenWaiterA = '';
  let tokenManagerB = '';
  let tokenWaiterB = '';
  let shiftAId = '';
  let sessionTokenA1 = '';
  let sessionTokenA2 = '';
  let orderA1Id = '';
  let billCallId = '';

  const auth = (t: string) => ({ authorization: `Bearer ${t}` });

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const suffix = randomUUID().slice(0, 8);
    restA = await prisma.restaurant.create({
      data: { name: `Ensayo Piloto A ${suffix}`, slug: `ensayo-a-${suffix}` }
    });
    restB = await prisma.restaurant.create({
      data: { name: `Ensayo Piloto B ${suffix}`, slug: `ensayo-b-${suffix}` }
    });

    const mkStaff = (restaurantId: string, name: string, role: string) =>
      prisma.staffUser.create({ data: { restaurantId, name, pinHash: `hash-${suffix}`, role } });
    const [managerA, waiterA, managerB, waiterB] = await Promise.all([
      mkStaff(restA.id, 'Encargada A', 'MANAGER'),
      mkStaff(restA.id, 'Mozo A', 'WAITER'),
      mkStaff(restB.id, 'Encargado B', 'MANAGER'),
      mkStaff(restB.id, 'Mozo B', 'WAITER')
    ]);
    tokenManagerA = app.jwt.sign({ sub: managerA.id, role: 'MANAGER', restaurantId: restA.id });
    tokenWaiterA = app.jwt.sign({ sub: waiterA.id, role: 'WAITER', restaurantId: restA.id });
    tokenManagerB = app.jwt.sign({ sub: managerB.id, role: 'MANAGER', restaurantId: restB.id });
    tokenWaiterB = app.jwt.sign({ sub: waiterB.id, role: 'WAITER', restaurantId: restB.id });

    [tableA1, tableA2] = await Promise.all([
      prisma.table.create({ data: { restaurantId: restA.id, label: 'Mesa Ensayo 1', posX: 10, posY: 10 } }),
      prisma.table.create({ data: { restaurantId: restA.id, label: 'Mesa Ensayo 2', posX: 200, posY: 10 } })
    ]);
    tableB1 = await prisma.table.create({
      data: { restaurantId: restB.id, label: 'Mesa Ensayo B1', posX: 10, posY: 10 }
    });

    const catA = await prisma.menuCategory.create({ data: { restaurantId: restA.id, name: 'Ficticias A' } });
    itemA = await prisma.menuItem.create({
      data: { categoryId: catA.id, name: 'Plato Ficticio', price: 5000 }
    });
  });

  afterAll(async () => {
    console.log('\nTiempos del ensayo (ms por fase):');
    for (const t of timings) console.log(`  ${String(t.ms).padStart(6)} ms  ${t.fase}`);
    try {
      await app?.close();
    } catch (_) {}
    if (restA) await prisma.restaurant.delete({ where: { id: restA.id } }).catch(() => undefined);
    if (restB) await prisma.restaurant.delete({ where: { id: restB.id } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('1. manager abre turno y el QR activa la mesa (A1)', async () => {
    await timed('apertura de turno', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/shifts/open',
        headers: auth(tokenManagerA),
        payload: { restaurantId: restA.id }
      });
      expect(res.statusCode).toBe(201);
      shiftAId = res.json().shift.id;
      expect(shiftAId).toBeTruthy();
    });

    await timed('QR activa mesa', async () => {
      const qr = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${restA.slug}/${encodeURIComponent(tableA1.label)}`
      });
      expect(qr.statusCode).toBe(200);
      expect(qr.json().valid).toBe(true);
      sessionTokenA1 = qr.json().token;

      const direct = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionTokenA1}` });
      expect(direct.statusCode).toBe(200);
      expect(direct.json().table.id).toBe(tableA1.id);
    });
  });

  it('2. llamado del comensal y atención del mozo (A1)', async () => {
    let callId = '';
    await timed('llamado + atención', async () => {
      const call = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: sessionTokenA1, type: 'WAITER', origin: 'WEB_DIRECT', note: 'Ensayo: hielo' }
      });
      expect(call.statusCode).toBe(201);
      callId = call.json().id;

      const progress = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${callId}`,
        headers: auth(tokenWaiterA),
        payload: { status: 'IN_PROGRESS' }
      });
      expect(progress.statusCode).toBe(200);

      const resolved = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${callId}`,
        headers: auth(tokenWaiterA),
        payload: { status: 'RESOLVED' }
      });
      expect(resolved.statusCode).toBe(200);
    });
  });

  it('3. pedido del comensal llega a cocina y avanza (A1)', async () => {
    await timed('pedido + cocina', async () => {
      const add = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: { sessionToken: sessionTokenA1, menuItemId: itemA.id, quantity: 2, guestSessionId: 'ensayo-guest-1' }
      });
      expect(add.statusCode).toBe(201);
      expect(add.json().totalAmount).toBe(10000);
      orderA1Id = add.json().id;

      const submit = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken: sessionTokenA1 }
      });
      expect(submit.statusCode).toBe(200);

      const validate = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderA1Id}/validate`,
        headers: auth(tokenWaiterA)
      });
      expect(validate.statusCode).toBe(200);
      expect(validate.json().status).toBe('IN_KITCHEN');

      const kds = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
        headers: auth(tokenWaiterA)
      });
      expect(kds.statusCode).toBe(200);
      expect(kds.json().orders.some((o: any) => o.tableId === tableA1.id)).toBe(true);

      for (const status of ['READY_TO_SERVE', 'SERVED']) {
        const adv = await app.inject({
          method: 'PATCH',
          url: `/v1/staff/orders/${orderA1Id}/status`,
          headers: auth(tokenWaiterA),
          payload: { status }
        });
        expect(adv.statusCode).toBe(200);
        expect(adv.json().status).toBe(status);
      }
    });
  });

  it('4. dos clientes simultáneos en A (A1 + A2) sin interferencia', async () => {
    await timed('dos clientes simultáneos', async () => {
      const qr2 = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${restA.slug}/${encodeURIComponent(tableA2.label)}`
      });
      expect(qr2.statusCode).toBe(200);
      sessionTokenA2 = qr2.json().token;
      expect(sessionTokenA2).not.toBe(sessionTokenA1);

      const [c1, c2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: '/v1/calls',
          payload: { sessionToken: sessionTokenA1, type: 'WAITER', origin: 'WEB_DIRECT' }
        }),
        app.inject({
          method: 'POST',
          url: '/v1/calls',
          payload: { sessionToken: sessionTokenA2, type: 'WAITER', origin: 'WEB_DIRECT' }
        })
      ]);
      expect(c1.statusCode).toBe(201);
      expect(c2.statusCode).toBe(201);

      // Resolver ambos para dejar la cancha limpia al pedido de cuenta
      for (const c of [c1.json().id, c2.json().id]) {
        const r = await app.inject({
          method: 'PATCH',
          url: `/v1/calls/${c}`,
          headers: auth(tokenWaiterA),
          payload: { status: 'RESOLVED' }
        });
        expect(r.statusCode).toBe(200);
      }
    });
  });

  it('5. restaurante B aislado: opera solo y no toca A', async () => {
    await timed('aislamiento A/B', async () => {
      const openB = await app.inject({
        method: 'POST',
        url: '/v1/shifts/open',
        headers: auth(tokenManagerB),
        payload: { restaurantId: restB.id }
      });
      expect(openB.statusCode).toBe(201);

      // Mozo B intenta validar la orden de A: rechazo + cero escrituras
      const cross = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderA1Id}/validate`,
        headers: auth(tokenWaiterB)
      });
      expect([403, 404]).toContain(cross.statusCode);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderA1Id } })).status).toBe('SERVED');

      // Mozo B no ve llamados de A
      const callsB = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: auth(tokenWaiterB)
      });
      expect([403, 404]).toContain(callsB.statusCode);
    });
  });

  it('6. pedido de cuenta sin pago digital: 503 contenido + cobro presencial autorizado', async () => {
    await timed('cuenta y cobro presencial', async () => {
      const bill = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: sessionTokenA1, type: 'BILL', paymentMethod: 'CASH', origin: 'WEB_DIRECT' }
      });
      expect(bill.statusCode).toBe(201);
      billCallId = bill.json().id;

      // Sin éxito de pago falso: split digital bloqueado
      const split = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderA1Id}/split-session`,
        payload: { mode: 'EQUAL_PARTS', totalParts: 2 }
      });
      expect(split.statusCode).toBe(503);
      expect(split.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');

      // Mozo no puede cobrar: 403 sin escrituras
      const waiterPay = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderA1Id}/pay`,
        headers: auth(tokenWaiterA),
        payload: { paymentMethod: 'WAITER_CASH' }
      });
      expect(waiterPay.statusCode).toBe(403);
      expect(await prisma.paymentTransaction.count({ where: { orderId: orderA1Id } })).toBe(0);

      // Manager cobra presencial en efectivo, sin proveedor digital
      const pay = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderA1Id}/pay`,
        headers: auth(tokenManagerA),
        payload: { paymentMethod: 'WAITER_CASH' }
      });
      expect(pay.statusCode).toBe(200);
      const tx = await prisma.paymentTransaction.findFirstOrThrow({ where: { orderId: orderA1Id } });
      expect(tx.method).toBe('WAITER_CASH');
      expect(tx.mpPaymentId).toBeNull();

      const done = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${billCallId}`,
        headers: auth(tokenWaiterA),
        payload: { status: 'RESOLVED' }
      });
      expect(done.statusCode).toBe(200);
    });
  });

  it('7. interrupción y reinicio: el estado persistido se recupera y el recorrido continúa', async () => {
    let downtimeMs = 0;
    await timed('corte + reinicio + continuidad', async () => {
      // Estado antes del corte
      const shiftBefore = await prisma.shift.findUniqueOrThrow({ where: { id: shiftAId } });
      expect(shiftBefore.closedAt).toBeNull();

      // Corte: backend caído, el cliente lo observa como fallo
      await app.close();
      const tDown = Date.now();
      let observedFailure = false;
      try {
        await app.inject({ method: 'GET', url: `/v1/sessions/${sessionTokenA1}` });
      } catch (_) {
        observedFailure = true;
      }
      expect(observedFailure).toBe(true);

      // Reinicio: nueva instancia sobre la MISMA base, sin tocar datos
      app = await buildApp();
      await app.ready();
      downtimeMs = Date.now() - tDown;

      // El estado persistido sigue: turno abierto, sesión válida, orden SERVED/PAID
      const current = await app.inject({
        method: 'GET',
        url: `/v1/shifts/current?restaurantId=${restA.id}`,
        headers: auth(tokenWaiterA)
      });
      expect(current.statusCode).toBe(200);

      const session = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionTokenA1}` });
      expect(session.statusCode).toBe(200);
      expect(session.json().valid).toBe(true);

      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderA1Id } });
      expect(['SERVED', 'PAID']).toContain(order.status);
    });
    timings.push({ fase: 'backend caído (ms)', ms: downtimeMs });
  });

  it('8. cierre de turno revoca el token y cierra sesiones', async () => {
    await timed('cierre + revocación', async () => {
      const close = await app.inject({
        method: 'POST',
        url: `/v1/shifts/${shiftAId}/close`,
        headers: auth(tokenManagerA),
        payload: { restaurantId: restA.id }
      });
      expect(close.statusCode).toBe(200);

      // Contrato vigente E02: token revocado → 410 + valid:false...
      const gone = await app.inject({ method: 'GET', url: `/v1/sessions/${sessionTokenA1}` });
      expect(gone.statusCode).toBe(410);
      expect(gone.json().valid).toBe(false);

      // ...y cualquier acción con el token revocado es 410 Gone.
      const deadCall = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: { sessionToken: sessionTokenA1, type: 'WAITER', origin: 'WEB_DIRECT' }
      });
      expect(deadCall.statusCode).toBe(410);
      expect(['SESSION_CLOSED', 'SHIFT_CLOSED']).toContain(deadCall.json().code);

      const sessions = await prisma.tableSession.findMany({ where: { tableId: tableA1.id } });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((s) => s.closedAt !== null)).toBe(true);
    });
  });
});

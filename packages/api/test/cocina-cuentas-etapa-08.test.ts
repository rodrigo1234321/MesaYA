import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { BillService } from '../src/services/bill.service';
import crypto from 'crypto';

describe('COCINA-CUENTAS Etapa 08 — UI de Mi Parte, Caja de Staff y Flujo de 3 Personas', () => {
  let app: FastifyInstance;

  // Tenant Principal: Restaurant A
  let restA: any;
  let shiftA: any;
  let tableA: any;
  let sessionA: any;
  let staffWaiterA: any;
  let staffManagerA: any;
  let tokenWaiterA: string;
  let tokenManagerA: string;

  // Participantes del flujo de 3 personas
  let participantAna: any;
  let participantBruno: any;
  let participantCarla: any;
  let tokenAna: string;
  let tokenBruno: string;
  let tokenCarla: string;

  // Ítems de la carta
  let itemPlatoAna: any;       // $4500.00 = 450000 cents
  let itemPlatoBruno: any;     // $3800.00 = 380000 cents
  let itemBebidaCarla: any;    // $1200.00 = 120000 cents
  let itemEntradaCompartida: any; // $2500.00 = 250000 cents

  // Orden y comanda activa
  let orderA: any;
  let orderItemAna: any;
  let orderItemBruno: any;
  let orderItemCarla: any;
  let orderItemCompartida: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    // 1. Crear Restaurante y Turno
    restA = await prisma.restaurant.create({
      data: {
        name: 'Trattoria 3 Personas',
        slug: `trattoria-flujo3-${timestamp}`,
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false,
            allowSplitBill: true
          }
        }
      }
    });

    shiftA = await prisma.shift.create({
      data: { restaurantId: restA.id, activeKey: restA.id }
    });

    // 2. Mesa y Sesión
    tableA = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa 1 Flujo 3P',
        currentState: TableFSMState.EATING
      }
    });

    sessionA = await prisma.tableSession.create({
      data: {
        tableId: tableA.id,
        shiftId: shiftA.id,
        token: `tok-session-flujo3-${timestamp}`,
        activeKey: tableA.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });

    // 3. Staff Mozo y Encargada
    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Marcos',
        pinHash: '$2b$10$dummyHashMarcos',
        role: 'WAITER'
      }
    });

    staffManagerA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Encargada Silvana',
        pinHash: '$2b$10$dummyHashSilvana',
        role: 'MANAGER'
      }
    });

    tokenWaiterA = app.jwt.sign({
      sub: staffWaiterA.id,
      restaurantId: restA.id,
      role: 'WAITER',
      name: staffWaiterA.name
    });

    tokenManagerA = app.jwt.sign({
      sub: staffManagerA.id,
      restaurantId: restA.id,
      role: 'MANAGER',
      name: staffManagerA.name
    });

    // 4. Crear Participantes: Ana, Bruno, Carla
    tokenAna = `tok-ana-${timestamp}`;
    const hashAna = crypto.createHash('sha256').update(tokenAna).digest('hex');
    participantAna = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Ana',
        tokenHash: hashAna,
        status: 'ACTIVE'
      }
    });

    tokenBruno = `tok-bruno-${timestamp}`;
    const hashBruno = crypto.createHash('sha256').update(tokenBruno).digest('hex');
    participantBruno = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Bruno',
        tokenHash: hashBruno,
        status: 'ACTIVE'
      }
    });

    tokenCarla = `tok-carla-${timestamp}`;
    const hashCarla = crypto.createHash('sha256').update(tokenCarla).digest('hex');
    participantCarla = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Carla',
        tokenHash: hashCarla,
        status: 'ACTIVE'
      }
    });

    // 5. Carta de Menú con precios en centavos
    const cat = await prisma.menuCategory.create({
      data: { restaurantId: restA.id, name: 'General' }
    });

    itemPlatoAna = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Ravioles Caseros',
        price: 4500,
        priceCents: 450000,
        isAvailable: true
      }
    });

    itemPlatoBruno = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Bife de Chorizo',
        price: 3800,
        priceCents: 380000,
        isAvailable: true
      }
    });

    itemBebidaCarla = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Limonada de Menta',
        price: 1200,
        priceCents: 120000,
        isAvailable: true
      }
    });

    itemEntradaCompartida = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Bruschettas Mediterráneas',
        price: 2500,
        priceCents: 250000,
        isAvailable: true
      }
    });

    // 6. Crear Orden con las comandas de las 3 personas (Total: $12.000 = 1.200.000 centavos)
    orderA = await prisma.order.create({
      data: {
        tableSessionId: sessionA.id,
        status: OrderStatus.CONFIRMED,
        totalAmount: 12000,
        totalCents: 1200000,
        currency: 'ARS'
      }
    });

    orderItemAna = await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        menuItemId: itemPlatoAna.id,
        quantity: 1,
        unitPrice: 4500,
        unitPriceCents: 450000,
        lineTotalCents: 450000,
        currency: 'ARS',
        productNameSnapshot: itemPlatoAna.name,
        addedByGuest: 'Ana',
        participantId: participantAna.id,
        claimedByGuest: participantAna.id,
        claimVersion: 0
      }
    });

    orderItemBruno = await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        menuItemId: itemPlatoBruno.id,
        quantity: 1,
        unitPrice: 3800,
        unitPriceCents: 380000,
        lineTotalCents: 380000,
        currency: 'ARS',
        productNameSnapshot: itemPlatoBruno.name,
        addedByGuest: 'Bruno',
        participantId: participantBruno.id,
        claimedByGuest: participantBruno.id,
        claimVersion: 0
      }
    });

    orderItemCarla = await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        menuItemId: itemBebidaCarla.id,
        quantity: 1,
        unitPrice: 1200,
        unitPriceCents: 120000,
        lineTotalCents: 120000,
        currency: 'ARS',
        productNameSnapshot: itemBebidaCarla.name,
        addedByGuest: 'Carla',
        participantId: participantCarla.id,
        claimedByGuest: participantCarla.id,
        claimVersion: 0
      }
    });

    orderItemCompartida = await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        menuItemId: itemEntradaCompartida.id,
        quantity: 1,
        unitPrice: 2500,
        unitPriceCents: 250000,
        lineTotalCents: 250000,
        currency: 'ARS',
        productNameSnapshot: itemEntradaCompartida.name,
        addedByGuest: 'Ana',
        participantId: participantAna.id, // Pedida por Ana, inicialmente sin asignar
        claimedByGuest: null,
        claimVersion: 0
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. Consulta autoritativa de la cuenta por el comensal via GET /v1/orders/bills/session/:token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/orders/bills/session/${sessionA.token}`
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.currency).toBe('ARS');
    expect(body.totalCents).toBe(1200000); // $12.000 en centavos
    expect(body.paidCents).toBe(0);
    expect(body.remainingCents).toBe(1200000);
    expect(body.status).toBe('OPEN');
    expect(body.items).toHaveLength(4);
  });

  it('2. Flujo de 3 personas: verificación de subtotales individuales de "Mi Parte"', async () => {
    const bill = await BillService.calculateTableBill(sessionA.id);

    // Ana: Plato ($4500)
    const itemsAna = bill.items.filter(
      (i: any) => i.claimedByGuest === participantAna.id
    );
    const subtotalAna = itemsAna.reduce((sum: number, it: any) => sum + it.lineTotalCents, 0);
    expect(subtotalAna).toBe(450000);

    // Bruno: Plato ($3800)
    const itemsBruno = bill.items.filter(
      (i: any) => i.claimedByGuest === participantBruno.id
    );
    const subtotalBruno = itemsBruno.reduce((sum: number, it: any) => sum + it.lineTotalCents, 0);
    expect(subtotalBruno).toBe(380000);

    // Carla: Bebida ($1200)
    const itemsCarla = bill.items.filter(
      (i: any) => i.claimedByGuest === participantCarla.id
    );
    const subtotalCarla = itemsCarla.reduce((sum: number, it: any) => sum + it.lineTotalCents, 0);
    expect(subtotalCarla).toBe(120000);

    // Ítem compartido sin asignar ($2500)
    const unassigned = bill.items.filter((i: any) => !i.claimedByGuest);
    expect(unassigned).toHaveLength(1);
    expect(unassigned[0].lineTotalCents).toBe(250000);

    // Suma de partes + sin asignar = Total de la mesa
    expect(subtotalAna + subtotalBruno + subtotalCarla + unassigned[0].lineTotalCents).toBe(bill.totalCents);
  });

  it('3. Reclamación interactiva del plato compartido por Carla con control de versión', async () => {
    // Carla reclama la entrada compartida
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/bills/claim-item',
      payload: {
        sessionToken: sessionA.token,
        participantToken: tokenCarla,
        orderItemId: orderItemCompartida.id,
        expectedVersion: 0
      }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.item.claimedByGuest).toBe(participantCarla.id);
    expect(body.item.claimVersion).toBe(1);

    // Verificar que ahora Carla tiene asignado su plato + la entrada
    const updatedBill = await BillService.calculateTableBill(sessionA.id);
    const itemsCarla = updatedBill.items.filter(
      (i: any) => i.claimedByGuest === participantCarla.id
    );
    const subtotalCarla = itemsCarla.reduce((sum: number, it: any) => sum + it.lineTotalCents, 0);
    expect(subtotalCarla).toBe(120000 + 250000); // 370000 cents ($3700)
  });

  it('4. Conflicto de concurrencia optimista 409 si Bruno intenta reclamar con la versión desactualizada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/bills/claim-item',
      payload: {
        sessionToken: sessionA.token,
        participantToken: tokenBruno,
        orderItemId: orderItemCompartida.id,
        expectedVersion: 0 // Bruno tiene la versión 0, pero ya avanzó a 1
      }
    });

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe('CLAIM_VERSION_MISMATCH');
  });

  it('5. Reparto determinista en partes iguales ($N=3) sobre $12.000 con suma 100% conservada', async () => {
    const bill = await BillService.calculateTableBill(sessionA.id);
    const equal3 = bill.splitEqualOptions.find((p: any) => p.parts === 3);

    expect(equal3).toBeDefined();
    expect(equal3!.distribution).toHaveLength(3);
    expect(equal3!.distribution[0].amountCents).toBe(400000); // $4000 exactos
    expect(equal3!.distribution[1].amountCents).toBe(400000);
    expect(equal3!.distribution[2].amountCents).toBe(400000);

    const sumParts = equal3!.distribution.reduce((acc: number, p: any) => acc + p.amountCents, 0);
    expect(sumParts).toBe(bill.totalCents);
  });

  it('6. Staff consulta la cuenta de la mesa via GET /v1/staff/tables/:tableId/bill', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/staff/tables/${tableA.id}/bill`,
      headers: { Authorization: `Bearer ${tokenWaiterA}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.tableId).toBe(tableA.id);
    expect(body.currency).toBe('ARS');
    expect(body.remainingCents).toBe(1200000);
    expect(body.status).toBe('OPEN');
  });

  it('7. Cobro parcial 1: Staff cobra la parte de Ana ($4500) en Efectivo (WAITER_CASH)', async () => {
    const idempotencyKey = `flow3-pay-ana-${Date.now()}`;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableId: tableA.id,
        amountCents: 450000,
        paymentMethod: 'WAITER_CASH',
        tipCents: 50000, // $500 de propina
        idempotencyKey
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bill.remainingCents).toBe(750000); // $12000 - $4500 = $7500 (750.000 cents)
    expect(body.bill.status).toBe('OPEN');
  });

  it('8. Cobro parcial 2: Staff cobra la parte de Bruno ($3800) con Tarjeta (WAITER_CARD)', async () => {
    const idempotencyKey = `flow3-pay-bruno-${Date.now()}`;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableId: tableA.id,
        amountCents: 380000,
        paymentMethod: 'WAITER_CARD',
        tipCents: 0,
        idempotencyKey
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bill.remainingCents).toBe(370000); // $7500 - $3800 = $3700 (370.000 cents)
    expect(body.bill.status).toBe('OPEN');
  });

  it('9. Bloqueo 409 OVERPAYMENT_NOT_ALLOWED si staff intenta cobrar más de lo que resta', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableId: tableA.id,
        amountCents: 500000, // $5000 intenta cobrar cuando solo resta $3700
        paymentMethod: 'WAITER_CASH',
        idempotencyKey: `overpay-attempt-${Date.now()}`
      }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OVERPAYMENT_NOT_ALLOWED');
  });

  it('10. Bloqueo de cierre de mesa con deuda remanente (409 UNPAID_BALANCE_EXISTS)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/tables/${tableA.id}/close-session`,
      headers: { Authorization: `Bearer ${tokenManagerA}` }
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('UNPAID_BALANCE_EXISTS');
  });

  it('11. Cobro final 3: Staff cobra el saldo remanente exacto ($3700) con QR Presencial (WAITER_MP_QR)', async () => {
    const idempotencyKey = `flow3-pay-carla-${Date.now()}`;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableId: tableA.id,
        amountCents: 370000,
        paymentMethod: 'WAITER_MP_QR',
        tipCents: 30000,
        idempotencyKey
      }
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.bill.remainingCents).toBe(0);
    expect(body.bill.status).toBe('PAID');

    // Mesa y órdenes pasaron a PAID
    const dbTable = await prisma.table.findUnique({ where: { id: tableA.id } });
    expect(dbTable?.currentState).toBe(TableFSMState.PAID);

    const dbOrder = await prisma.order.findUnique({ where: { id: orderA.id } });
    expect(dbOrder?.status).toBe(OrderStatus.PAID);
  });

  it('12. Reversión autorizada de pago: Staff revierte el pago de Carla restaurando saldo y estado EATING', async () => {
    // Obtener los pagos asentados
    const bill = await BillService.calculateTableBill(sessionA.id);
    const lastPayment = bill.payments.find((p: any) => p.method === 'WAITER_MP_QR');
    expect(lastPayment).toBeDefined();

    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/payments/${lastPayment!.id}/revert`,
      headers: { Authorization: `Bearer ${tokenManagerA}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);

    // La mesa vuelve a EATING
    const dbTable = await prisma.table.findUnique({ where: { id: tableA.id } });
    expect(dbTable?.currentState).toBe(TableFSMState.EATING);

    // Saldo remanente reabierto en $3700 (370.000 cents)
    const reopenedBill = await BillService.calculateTableBill(sessionA.id);
    expect(reopenedBill.remainingCents).toBe(370000);
    expect(reopenedBill.status).toBe('OPEN');
  });

  it('13. Re-cobro final y cierre exitoso de la sesión de mesa sin deuda', async () => {
    // Re-cobrar los 370.000 centavos
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableId: tableA.id,
        amountCents: 370000,
        paymentMethod: 'WAITER_CASH',
        idempotencyKey: `recobro-final-${Date.now()}`
      }
    });
    expect(payRes.statusCode).toBe(201);

    const bill = await BillService.calculateTableBill(sessionA.id);
    expect(bill.remainingCents).toBe(0);
    expect(bill.status).toBe('PAID');

    // Ahora el cierre de mesa procede exitosamente con token de Encargada
    const closeRes = await app.inject({
      method: 'POST',
      url: `/v1/tables/${tableA.id}/close-session`,
      headers: { Authorization: `Bearer ${tokenManagerA}` }
    });

    expect(closeRes.statusCode).toBe(200);
  });
});

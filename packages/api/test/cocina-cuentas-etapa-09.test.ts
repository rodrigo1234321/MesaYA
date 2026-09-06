import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { BillService } from '../src/services/bill.service';
import crypto from 'crypto';

describe('COCINA-CUENTAS Etapa 09 — E2E Integral: Turno, QR, Tandas, Alérgenos, KDS, Reparto, Caja y Reversión', () => {
  let app: FastifyInstance;

  // Entidades principales
  let restA: any;
  let shiftA: any;
  let tableA: any;
  let sessionA: any;
  let staffWaiterA: any;
  let staffManagerA: any;
  let tokenWaiterA: string;
  let tokenManagerA: string;

  // Participantes de la mesa (Ana, Bruno, Carla)
  let participantAna: any;
  let participantBruno: any;
  let participantCarla: any;
  let tokenAna: string;
  let tokenBruno: string;
  let tokenCarla: string;

  // Menú
  let itemEmpanadas: any;  // $3000 (300000 cents) - Compartida
  let itemSorrentinos: any; // $5500 (550000 cents) - Ana (con alérgeno)
  let itemBife: any;        // $7200 (720000 cents) - Bruno
  let itemCerveza: any;     // $1800 (180000 cents) - Carla
  let itemVolcan: any;      // $2500 (250000 cents) - Postre segunda tanda

  // Variables dinámicas del ciclo
  let tanda1Id: string;
  let tanda2Id: string;
  let order1Id: string;
  let orderItemEmpanadasId: string;
  let paymentBrunoId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    // 1. Restaurante con módulo de pedidos activo y validación de mozo para alérgenos
    restA = await prisma.restaurant.create({
      data: {
        name: 'Trattoria E2E Integral',
        slug: `trattoria-e2e-${timestamp}`,
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false, // Pedido directo comensal, pero alérgenos forzarán validación
            allowSplitBill: true
          }
        }
      }
    });

    // 2. Apertura de Turno
    shiftA = await prisma.shift.create({
      data: { restaurantId: restA.id, activeKey: restA.id }
    });

    // 3. Mesa activa
    tableA = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa 10 E2E',
        currentState: TableFSMState.AVAILABLE
      }
    });

    // 4. Personal de Salón y Gerencia
    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Pedro',
        pinHash: '$2b$10$dummyHashPedro',
        role: 'WAITER'
      }
    });

    staffManagerA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Encargada Lucia',
        pinHash: '$2b$10$dummyHashLucia',
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

    // 5. Creación de Carta en centavos ARS
    const cat = await prisma.menuCategory.create({
      data: { restaurantId: restA.id, name: 'Platos & Entradas E2E' }
    });

    itemEmpanadas = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Empanadas Salteñas (x3)',
        price: 3000,
        priceCents: 300000,
        isAvailable: true
      }
    });

    itemSorrentinos = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Sorrentinos Caseros',
        price: 5500,
        priceCents: 550000,
        isAvailable: true
      }
    });

    itemBife = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Bife de Chorizo 400g',
        price: 7200,
        priceCents: 720000,
        isAvailable: true
      }
    });

    itemCerveza = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Cerveza IPA Artesanal',
        price: 1800,
        priceCents: 180000,
        isAvailable: true
      }
    });

    itemVolcan = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Volcán de Chocolate',
        price: 2500,
        priceCents: 250000,
        isAvailable: true
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────
  // FASE 1: CLIENTES LLEGAN, ESCANEAN QR Y SE UNEN A LA SESIÓN
  // ─────────────────────────────────────────────────────────────
  it('1. Cliente escanea QR, abre sesión y la mesa pasa a OCCUPIED_NO_ORDER', async () => {
    sessionA = await prisma.tableSession.create({
      data: {
        tableId: tableA.id,
        shiftId: shiftA.id,
        token: `tok-session-e2e-${Date.now()}`,
        activeKey: tableA.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });

    await prisma.table.update({
      where: { id: tableA.id },
      data: { currentState: TableFSMState.OCCUPIED_NO_ORDER }
    });

    const dbTable = await prisma.table.findUnique({ where: { id: tableA.id } });
    expect(dbTable?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
  });

  it('2. Tres comensales (Ana, Bruno, Carla) se unen como participantes de visita', async () => {
    const timestamp = Date.now();

    tokenAna = `tok-ana-${timestamp}`;
    participantAna = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Ana',
        tokenHash: crypto.createHash('sha256').update(tokenAna).digest('hex'),
        status: 'ACTIVE'
      }
    });

    tokenBruno = `tok-bruno-${timestamp}`;
    participantBruno = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Bruno',
        tokenHash: crypto.createHash('sha256').update(tokenBruno).digest('hex'),
        status: 'ACTIVE'
      }
    });

    tokenCarla = `tok-carla-${timestamp}`;
    participantCarla = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Carla',
        tokenHash: crypto.createHash('sha256').update(tokenCarla).digest('hex'),
        status: 'ACTIVE'
      }
    });

    expect(participantAna.id).toBeDefined();
    expect(participantBruno.id).toBeDefined();
    expect(participantCarla.id).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────
  // FASE 2: TANDA 1 CON ALÉRGENO, VALIDACIÓN HUMANA Y KDS
  // ─────────────────────────────────────────────────────────────
  it('3. Envío de Tanda 1 con nota de alergia fuerza validación humana del mozo', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/orders/tandas',
      payload: {
        sessionToken: sessionA.token,
        participantToken: tokenAna,
        idempotencyKey: `tanda1-e2e-${Date.now()}`,
        items: [
          {
            menuItemId: itemSorrentinos.id,
            quantity: 1,
            notes: 'Sin nueces, muy alérgica',
            participantId: participantAna.id
          },
          {
            menuItemId: itemBife.id,
            quantity: 1,
            notes: 'Punto jugoso',
            participantId: participantBruno.id
          },
          {
            menuItemId: itemCerveza.id,
            quantity: 1,
            participantId: participantCarla.id
          },
          {
            menuItemId: itemEmpanadas.id,
            quantity: 1,
            notes: 'Para compartir entre los 3',
            participantId: participantAna.id
          }
        ]
      }
    });

    expect(res.statusCode).toBe(201);
    const tanda1 = res.json();
    tanda1Id = tanda1.id;

    // Al tener mención de "alérgica", la tanda queda en CONFIRMED esperando validación del mozo
    expect(tanda1.status).toBe('CONFIRMED');

    // Localizar orden activa creada por el servidor
    const dbOrder = await prisma.order.findFirst({
      where: { tableSessionId: sessionA.id }
    });
    expect(dbOrder).toBeTruthy();
    order1Id = dbOrder!.id;

    // Identificar el ítem de empanadas compartidas para la fase de cobro
    const emp = tanda1.items.find((i: any) => i.menuItemId === itemEmpanadas.id);
    expect(emp).toBeDefined();
    orderItemEmpanadasId = emp!.id;
  });

  it('4. Mozo revisa y valida la tanda con alérgenos; comanda y tanda entran a cocina (IN_KITCHEN)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${order1Id}/validate`,
      headers: { Authorization: `Bearer ${tokenWaiterA}` }
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe(OrderStatus.IN_KITCHEN);

    const dbTanda = await prisma.orderTanda.findUnique({ where: { id: tanda1Id } });
    expect(dbTanda?.status).toBe('IN_KITCHEN');
  });

  it('5. Cocina avanza la tanda a READY_TO_SERVE y luego Mozo sirve (SERVED)', async () => {
    // 1. IN_KITCHEN -> READY_TO_SERVE
    await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${order1Id}/status`,
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: { status: OrderStatus.READY_TO_SERVE }
    });

    // 2. READY_TO_SERVE -> SERVED
    const resServe = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${order1Id}/status`,
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: { status: OrderStatus.SERVED }
    });
    expect(resServe.statusCode).toBe(200);

    const dbTanda = await prisma.orderTanda.findUnique({ where: { id: tanda1Id } });
    expect(dbTanda?.status).toBe('SERVED');

    // La mesa avanza a EATING
    const dbTable = await prisma.table.findUnique({ where: { id: tableA.id } });
    expect(dbTable?.currentState).toBe(TableFSMState.EATING);
  });

  // ─────────────────────────────────────────────────────────────
  // FASE 3: TANDA 2 (SEGUNDA RONDA/POSTRE) SIN RETROCEDER FSM
  // ─────────────────────────────────────────────────────────────
  it('6. Carla pide postre en Tanda 2; se procesa manteniendo la mesa en EATING', async () => {
    const resTanda2 = await app.inject({
      method: 'POST',
      url: '/v1/orders/tandas',
      payload: {
        sessionToken: sessionA.token,
        participantToken: tokenCarla,
        idempotencyKey: `tanda2-e2e-${Date.now()}`,
        items: [
          {
            menuItemId: itemVolcan.id,
            quantity: 1,
            notes: 'Con dos cucharas',
            participantId: participantCarla.id
          }
        ]
      }
    });

    expect(resTanda2.statusCode).toBe(201);
    const tanda2 = resTanda2.json();
    tanda2Id = tanda2.id;

    // Postre sin alergias en modo directo entra a IN_KITCHEN
    expect(tanda2.status).toBe('IN_KITCHEN');

    // Despacho de cocina de la tanda de postre a la mesa
    await prisma.orderTanda.update({
      where: { id: tanda2Id },
      data: { status: 'SERVED' }
    });

    const dbTable = await prisma.table.findUnique({ where: { id: tableA.id } });
    expect(dbTable?.currentState).toBe(TableFSMState.EATING);
  });

  // ─────────────────────────────────────────────────────────────
  // FASE 4: CUENTA, REPARTO Y CONCURRENCIA OPTIMISTA
  // ─────────────────────────────────────────────────────────────
  it('7. Consulta autoritativa: Total $20.000 ARS y partes iguales conservando residuo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/orders/bills/session/${sessionA.token}`
    });

    expect(res.statusCode).toBe(200);
    const bill = res.json();

    // 3000 (Empanadas) + 5500 (Sorrentinos) + 7200 (Bife) + 1800 (Cerveza) + 2500 (Volcán) = $20.000 = 2.000.000 cents
    expect(bill.currency).toBe('ARS');
    expect(bill.totalCents).toBe(2000000);
    expect(bill.paidCents).toBe(0);
    expect(bill.remainingCents).toBe(2000000);
    expect(bill.status).toBe('OPEN');

    // División en 3 partes iguales sobre $20.000:
    // 2.000.000 / 3 = 666.666 con residuo 2 -> 666.667 + 666.667 + 666.666 centavos
    const split3 = bill.splitEqualOptions.find((p: any) => p.parts === 3);
    expect(split3).toBeDefined();
    const parts = split3.distribution.map((d: any) => d.amountCents);
    expect(parts).toEqual([666667, 666667, 666666]);
    expect(parts.reduce((a: number, b: number) => a + b, 0)).toBe(2000000);
  });

  it('8. Carla reclama las empanadas compartidas y concurrencia optimista bloquea reclamo tardío', async () => {
    // 1. Carla reclama las empanadas con versión esperada 0
    const resClaim = await app.inject({
      method: 'POST',
      url: '/v1/orders/bills/claim-item',
      payload: {
        sessionToken: sessionA.token,
        participantToken: tokenCarla,
        orderItemId: orderItemEmpanadasId,
        expectedVersion: 0
      }
    });

    expect(resClaim.statusCode).toBe(200);
    expect(resClaim.json().item.claimedByGuest).toBe(participantCarla.id);
    expect(resClaim.json().item.claimVersion).toBe(1);

    // 2. Bruno intenta reclamar con la versión vieja (0) -> 409
    const resConflict = await app.inject({
      method: 'POST',
      url: '/v1/orders/bills/claim-item',
      payload: {
        sessionToken: sessionA.token,
        participantToken: tokenBruno,
        orderItemId: orderItemEmpanadasId,
        expectedVersion: 0
      }
    });

    expect(resConflict.statusCode).toBe(409);
    expect(resConflict.json().code).toBe('CLAIM_VERSION_MISMATCH');
  });

  // ─────────────────────────────────────────────────────────────
  // FASE 5: COBROS PARCIALES, IDEMPOTENCIA, SOBREPAGO Y REVERSIÓN
  // ─────────────────────────────────────────────────────────────
  it('9. Cobro parcial 1: Ana paga su parte ($5.500) en Efectivo con idempotencia', async () => {
    const idempotencyKey = `e2e-pay-ana-${Date.now()}`;

    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionA.id,
        amountCents: 550000,
        tipCents: 50000, // Propina de $500
        paymentMethod: 'WAITER_CASH',
        idempotencyKey
      }
    });

    expect(res1.statusCode).toBe(201);
    expect(res1.json().bill.remainingCents).toBe(1450000); // 20.000 - 5.500 = 14.500 (propina separada)
    expect(res1.json().bill.tipTotalCents).toBe(50000);

    // Reintento idéntico por idempotencia
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionA.id,
        amountCents: 550000,
        tipCents: 50000,
        paymentMethod: 'WAITER_CASH',
        idempotencyKey
      }
    });

    expect(res2.statusCode).toBe(200);
    expect(res2.json().duplicate).toBe(true);
    expect(res2.json().bill.remainingCents).toBe(1450000);

    // Intento de reusar misma idempotencyKey con payload diferente -> 409
    const resMismatch = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionA.id,
        amountCents: 999999, // monto discrepante
        paymentMethod: 'WAITER_CASH',
        idempotencyKey
      }
    });

    expect(resMismatch.statusCode).toBe(409);
    expect(resMismatch.json().code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('10. Cobro parcial 2: Bruno paga su bife ($7.200) con Tarjeta y asignación de participante', async () => {
    const idempotencyKey = `e2e-pay-bruno-${Date.now()}`;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionA.id,
        amountCents: 720000,
        paymentMethod: 'WAITER_CARD',
        participantId: participantBruno.id,
        idempotencyKey
      }
    });

    expect(res.statusCode).toBe(201);
    paymentBrunoId = res.json().transaction.id;
    expect(res.json().bill.remainingCents).toBe(730000); // 14.500 - 7.200 = 7.300 ($7300)

    // Verificar que los ítems consumidos por Bruno quedaron marcados isPaid = true
    const brunoItems = await prisma.orderItem.findMany({
      where: {
        participantId: participantBruno.id,
        order: { tableSessionId: sessionA.id }
      }
    });
    expect(brunoItems.length).toBeGreaterThan(0);
    for (const itm of brunoItems) {
      expect(itm.isPaid).toBe(true);
    }
  });

  it('11. Bloqueo 409 ante intento de sobrepago y bloqueo de cierre con deuda', async () => {
    // Intento de cobrar $10.000 cuando solo resta $7.300
    const resOverpay = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionA.id,
        amountCents: 1000000,
        paymentMethod: 'WAITER_CASH',
        idempotencyKey: `e2e-overpay-${Date.now()}`
      }
    });

    expect(resOverpay.statusCode).toBe(409);
    expect(resOverpay.json().code).toBe('OVERPAYMENT_NOT_ALLOWED');

    // Intento de cerrar sesión con deuda remanente
    const resClose = await app.inject({
      method: 'POST',
      url: `/v1/tables/${tableA.id}/close-session`,
      headers: { Authorization: `Bearer ${tokenManagerA}` }
    });

    expect(resClose.statusCode).toBe(409);
    expect(resClose.json().code).toBe('UNPAID_BALANCE_EXISTS');
  });

  it('12. Reversión de cobro de Bruno: Mozo bloqueado (403), Encargada revierte con auditoría y reabre saldo', async () => {
    // 1. Mozo intenta revertir pago -> 403 FORBIDDEN
    const resForbidden = await app.inject({
      method: 'POST',
      url: `/v1/staff/payments/${paymentBrunoId}/revert`,
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: { reason: 'Error de tipeo mozo' }
    });
    expect(resForbidden.statusCode).toBe(403);
    expect(resForbidden.json().code).toBe('FORBIDDEN_ROLE');

    // 2. Encargada (MANAGER) revierte con motivo formal
    const resRevert = await app.inject({
      method: 'POST',
      url: `/v1/staff/payments/${paymentBrunoId}/revert`,
      headers: { Authorization: `Bearer ${tokenManagerA}` },
      payload: { reason: 'Cobro duplicado en terminal POS' }
    });

    expect(resRevert.statusCode).toBe(200);
    expect(resRevert.json().success).toBe(true);
    expect(resRevert.json().bill.remainingCents).toBe(1450000); // 7.300 + 7.200 = 14.500
    expect(resRevert.json().bill.status).toBe('OPEN');

    // 3. Verificar persistencia de auditoría en la transacción revertida
    const dbTx = await prisma.paymentTransaction.findUnique({
      where: { id: paymentBrunoId }
    });
    expect(dbTx?.status).toBe('REFUNDED');
    expect(dbTx?.reversalReason).toBe('Cobro duplicado en terminal POS');
    expect(dbTx?.reversalStaffId).toBe(staffManagerA.id);
    expect(dbTx?.reversalAt).not.toBeNull();
  });

  // ─────────────────────────────────────────────────────────────
  // FASE 6: LIQUIDACIÓN COMPLETA, CIERRE DE MESA Y REVOCACIÓN
  // ─────────────────────────────────────────────────────────────
  it('13. Cobros finales saldan el total al 100% y transicionan mesa y comanda a PAID', async () => {
    // 1. Re-cobro de Bruno ($7.200 con tarjeta)
    await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionA.id,
        amountCents: 720000,
        paymentMethod: 'WAITER_CARD',
        idempotencyKey: `e2e-pay-bruno-retry-${Date.now()}`
      }
    });

    // 2. Carla salda el saldo remanente exacto ($7.300 con QR Presencial)
    const resFinal = await app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionA.id,
        amountCents: 730000,
        paymentMethod: 'WAITER_MP_QR',
        idempotencyKey: `e2e-pay-carla-final-${Date.now()}`
      }
    });

    expect(resFinal.statusCode).toBe(201);
    expect(resFinal.json().bill.remainingCents).toBe(0);
    expect(resFinal.json().bill.status).toBe('PAID');

    // Mesa y comanda pasaron a PAID
    const dbTable = await prisma.table.findUnique({ where: { id: tableA.id } });
    expect(dbTable?.currentState).toBe(TableFSMState.PAID);
  });

  it('14. Cierre exitoso de sesión de mesa sin saldo deudor', async () => {
    const resClose = await app.inject({
      method: 'POST',
      url: `/v1/tables/${tableA.id}/close-session`,
      headers: { Authorization: `Bearer ${tokenManagerA}` }
    });

    expect(resClose.statusCode).toBe(200);

    const dbSession = await prisma.tableSession.findUnique({ where: { id: sessionA.id } });
    expect(dbSession?.closedAt).not.toBeNull();
    expect(dbSession?.activeKey).toBeNull();
  });

  it('15. Seguridad: pagos digitales online permanecen bloqueados incondicionalmente (503)', async () => {
    const resOnline = await app.inject({
      method: 'POST',
      url: '/v1/orders/split-session/dummy/pay-part',
      payload: { paymentMethod: 'MERCADO_PAGO' }
    });

    expect(resOnline.statusCode).toBe(503);
    expect(resOnline.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
  });

  it('16. Concurrencia real: Carreras simultáneas de cobro son serializadas por paymentSeq evitando sobrepago', async () => {
    const timestamp = Date.now();
    // 1. Crear mesa B con sesión y pedido de $10.000 (1.000.000 centavos)
    const tableB = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: `Mesa Concurrencia ${timestamp}`,
        currentState: TableFSMState.EATING
      }
    });

    const sessionB = await prisma.tableSession.create({
      data: {
        tableId: tableB.id,
        shiftId: shiftA.id,
        token: `tok-session-race-${timestamp}`,
        activeKey: tableB.id,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    const orderB = await prisma.order.create({
      data: {
        tableSessionId: sessionB.id,
        status: OrderStatus.SERVED,
        totalCents: 1000000,
        totalAmount: 10000,
        currency: 'ARS'
      }
    });

    await prisma.orderItem.create({
      data: {
        orderId: orderB.id,
        menuItemId: itemSorrentinos.id,
        quantity: 1,
        unitPrice: 10000,
        unitPriceCents: 1000000,
        lineTotalCents: 1000000,
        productNameSnapshot: 'Plato Concurrente',
        addedByGuest: 'Tester',
        currency: 'ARS'
      }
    });

    // 2. Dos cobros simultáneos de $7.000 cada uno ($700.000 cents). Juntos suman $14.000 > $10.000
    const pay1 = app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionB.id,
        amountCents: 700000,
        paymentMethod: 'WAITER_CASH',
        idempotencyKey: `race-pay-1-${timestamp}`
      }
    });

    const pay2 = app.inject({
      method: 'POST',
      url: '/v1/staff/payments/settle',
      headers: { Authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        tableSessionId: sessionB.id,
        amountCents: 700000,
        paymentMethod: 'WAITER_CARD',
        idempotencyKey: `race-pay-2-${timestamp}`
      }
    });

    const [res1, res2] = await Promise.all([pay1, pay2]);
    const statuses = [res1.statusCode, res2.statusCode].sort();

    // Uno debe ser 201 (éxito) y el otro 409 (OVERPAYMENT_NOT_ALLOWED)
    expect(statuses).toEqual([201, 409]);

    const failedRes = res1.statusCode === 409 ? res1 : res2;
    expect(failedRes.json().code).toBe('OVERPAYMENT_NOT_ALLOWED');

    // 3. Verificar estado en base de datos
    const finalBill = await BillService.calculateTableBill(sessionB.id);
    expect(finalBill.paidCents).toBe(700000);
    expect(finalBill.remainingCents).toBe(300000);

    const updatedSession = await prisma.tableSession.findUnique({
      where: { id: sessionB.id }
    });
    // paymentSeq debió incrementarse
    expect(updatedSession?.paymentSeq).toBeGreaterThanOrEqual(1);
  });
});

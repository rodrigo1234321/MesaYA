import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { BillService } from '../src/services/bill.service';
import { SessionService } from '../src/services/session.service';

describe('COCINA-CUENTAS Etapa 07 — Cuenta Dividida Backend, Asignaciones y Cobros Parciales', () => {
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
  let participantAna: any;
  let participantBruno: any;
  let participantCarla: any;
  let tokenAna: string;
  let tokenBruno: string;

  // Menu items
  let itemPasta: any;
  let itemBurger: any;
  let itemSharedEmpanadas: any;

  // Active Order & Items
  let orderA: any;
  let orderItemPasta: any;
  let orderItemBurger: any;
  let orderItemEmpanadas: any;

  // Tenant Secundario: Restaurant B (para test de aislamiento)
  let restB: any;
  let shiftB: any;
  let tableB: any;
  let sessionB: any;
  let staffWaiterB: any;
  let tokenWaiterB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    // 1. Setup Restaurant A
    restA = await prisma.restaurant.create({
      data: {
        name: 'Resto Split ARS',
        slug: `split-resto-${timestamp}`,
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

    tableA = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa 4',
        currentState: TableFSMState.EATING
      }
    });

    sessionA = await prisma.tableSession.create({
      data: {
        tableId: tableA.id,
        shiftId: shiftA.id,
        token: `token-session-split-${timestamp}`,
        activeKey: tableA.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });

    // Staff Users
    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Juan',
        pinHash: '$2b$10$dummyHashWaiterA',
        role: 'WAITER'
      }
    });

    staffManagerA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Encargada Maria',
        pinHash: '$2b$10$dummyHashManagerA',
        role: 'MANAGER'
      }
    });

    tokenWaiterA = app.jwt.sign({
      sub: staffWaiterA.id,
      role: staffWaiterA.role,
      restaurantId: restA.id
    });

    tokenManagerA = app.jwt.sign({
      sub: staffManagerA.id,
      role: staffManagerA.role,
      restaurantId: restA.id
    });

    // Menu Category & Items in ARS
    const cat = await prisma.menuCategory.create({
      data: { restaurantId: restA.id, name: 'Platos y Entradas' }
    });

    itemPasta = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Sorrentinos Caseros',
        price: 3500,
        priceCents: 350000,
        isAvailable: true
      }
    });

    itemBurger = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Smash Burger Doble',
        price: 3500,
        priceCents: 350000,
        isAvailable: true
      }
    });

    itemSharedEmpanadas = await prisma.menuItem.create({
      data: {
        categoryId: cat.id,
        name: 'Entrada Empanadas (x3)',
        price: 3000,
        priceCents: 300000,
        isAvailable: true
      }
    });

    // Participantes de la visita
    tokenAna = `ana-token-${timestamp}`;
    const hashAna = require('crypto').createHash('sha256').update(tokenAna).digest('hex');
    participantAna = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Ana',
        tokenHash: hashAna,
        status: 'ACTIVE'
      }
    });

    tokenBruno = `bruno-token-${timestamp}`;
    const hashBruno = require('crypto').createHash('sha256').update(tokenBruno).digest('hex');
    participantBruno = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Bruno',
        tokenHash: hashBruno,
        status: 'ACTIVE'
      }
    });

    const hashCarla = require('crypto').createHash('sha256').update(`carla-token-${timestamp}`).digest('hex');
    participantCarla = await prisma.visitParticipant.create({
      data: {
        tableSessionId: sessionA.id,
        displayName: 'Carla',
        tokenHash: hashCarla,
        status: 'ACTIVE'
      }
    });

    // Comanda unificada: Total $10.000 (10.000 centavos x 100 = 1.000.000 cents, o 3500+3500+3000 = 10000 ARS)
    // Usamos:
    // Pasta: 3.500 centavos
    // Burger: 3.500 centavos
    // Empanadas: 3.000 centavos
    // Total: 10.000 centavos ($100.00) para comprobar el caso canónico de la especificación
    orderA = await prisma.order.create({
      data: {
        tableSessionId: sessionA.id,
        status: OrderStatus.SERVED,
        totalCents: 10000,
        totalAmount: 100,
        currency: 'ARS'
      }
    });

    orderItemPasta = await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        menuItemId: itemPasta.id,
        quantity: 1,
        unitPrice: 35,
        unitPriceCents: 3500,
        lineTotalCents: 3500,
        currency: 'ARS',
        productNameSnapshot: 'Sorrentinos Caseros',
        participantId: participantAna.id,
        addedByGuest: 'Ana',
        claimVersion: 0
      }
    });

    orderItemBurger = await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        menuItemId: itemBurger.id,
        quantity: 1,
        unitPrice: 35,
        unitPriceCents: 3500,
        lineTotalCents: 3500,
        currency: 'ARS',
        productNameSnapshot: 'Smash Burger Doble',
        participantId: participantBruno.id,
        addedByGuest: 'Bruno',
        claimVersion: 0
      }
    });

    orderItemEmpanadas = await prisma.orderItem.create({
      data: {
        orderId: orderA.id,
        menuItemId: itemSharedEmpanadas.id,
        quantity: 1,
        unitPrice: 30,
        unitPriceCents: 3000,
        lineTotalCents: 3000,
        currency: 'ARS',
        productNameSnapshot: 'Entrada Empanadas (x3)',
        addedByGuest: 'Carla',
        claimVersion: 0
      }
    });

    // 2. Setup Restaurant B (tenant ajeno)
    restB = await prisma.restaurant.create({
      data: {
        name: 'Otro Resto B',
        slug: `resto-b-${timestamp}`
      }
    });
    shiftB = await prisma.shift.create({
      data: { restaurantId: restB.id, activeKey: restB.id }
    });
    tableB = await prisma.table.create({
      data: {
        restaurantId: restB.id,
        label: 'Mesa 1',
        currentState: TableFSMState.OCCUPIED_NO_ORDER
      }
    });
    sessionB = await prisma.tableSession.create({
      data: {
        tableId: tableB.id,
        shiftId: shiftB.id,
        token: `token-session-b-${timestamp}`,
        activeKey: tableB.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });
    staffWaiterB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo B',
        pinHash: '$2b$10$dummyHashWaiterB',
        role: 'WAITER'
      }
    });
    tokenWaiterB = app.jwt.sign({
      sub: staffWaiterB.id,
      role: staffWaiterB.role,
      restaurantId: restB.id
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. CÁLCULO DE CUENTA EN CENTAVOS ENTEROS Y REPARTO DETERMINISTA
  // ─────────────────────────────────────────────────────────────
  describe('1. Cuenta en centavos enteros y reparto determinista', () => {
    it('GET /v1/orders/bills/session/:token devuelve total en centavos ARS, saldo pendiente y desglose de participantes', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/bills/session/${sessionA.token}`
      });

      expect(res.statusCode).toBe(200);
      const bill = res.json();
      expect(bill.currency).toBe('ARS');
      expect(bill.totalCents).toBe(10000);
      expect(bill.paidCents).toBe(0);
      expect(bill.remainingCents).toBe(10000);
      expect(bill.status).toBe('OPEN');
      expect(bill.items.length).toBe(3);
      expect(bill.participants.length).toBe(3);

      // Verificación de que ítems tienen línea en centavos
      const pasta = bill.items.find((i: any) => i.id === orderItemPasta.id);
      expect(pasta.lineTotalCents).toBe(3500);
      expect(pasta.unitPriceCents).toBe(3500);
      expect(pasta.participantName).toBe('Ana');
    });

    it('División en 3 partes iguales de 10.000 centavos: genera exactamente 3.334 + 3.333 + 3.333', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/bills/session/${sessionA.token}`
      });

      expect(res.statusCode).toBe(200);
      const bill = res.json();
      const split3 = bill.splitEqualOptions.find((opt: any) => opt.parts === 3);
      expect(split3).toBeDefined();

      const cents = split3.distribution.map((d: any) => d.amountCents);
      expect(cents).toEqual([3334, 3333, 3333]);

      // Suma estrictamente igual al saldo pendiente
      const sum = cents.reduce((a: number, b: number) => a + b, 0);
      expect(sum).toBe(10000);

      // Re-lectura determinista: el centavo restante permanece asignado a la primera posición
      const res2 = await app.inject({
        method: 'GET',
        url: `/v1/orders/bills/session/${sessionA.token}`
      });
      const cents2 = res2.json().splitEqualOptions.find((opt: any) => opt.parts === 3).distribution.map((d: any) => d.amountCents);
      expect(cents2).toEqual([3334, 3333, 3333]);
    });

    it('Plato compartido: reparto exacto sin pérdida de centavos', () => {
      const parts = BillService.calculateSharedItemSplit(3000, 3);
      expect(parts).toEqual([1000, 1000, 1000]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(3000);

      // Si fueran 1000 centavos entre 3 personas: 334 + 333 + 333
      const partsOdd = BillService.calculateSharedItemSplit(1000, 3);
      expect(partsOdd).toEqual([334, 333, 333]);
      expect(partsOdd.reduce((a, b) => a + b, 0)).toBe(1000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. RECLAMO INDIVIDUAL DE PLATOS Y CONCURRENCIA OPTIMISTA
  // ─────────────────────────────────────────────────────────────
  describe('2. Reclamo de platos y control de concurrencia optimista', () => {
    it('Comensal Ana reclama su plato con expectedVersion: 0', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/bills/claim-item',
        payload: {
          sessionToken: sessionA.token,
          participantToken: tokenAna,
          orderItemId: orderItemPasta.id,
          expectedVersion: 0
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.item.claimedByGuest).toBe(participantAna.id);
      expect(data.item.claimVersion).toBe(1);
    });

    it('Conflicto de concurrencia (409): Bruno intenta reclamar el mismo plato con versión desactualizada expectedVersion: 0', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/bills/claim-item',
        payload: {
          sessionToken: sessionA.token,
          participantToken: tokenBruno,
          orderItemId: orderItemPasta.id,
          expectedVersion: 0 // La versión real es 1
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CLAIM_VERSION_MISMATCH');
    });

    it('Ana des-reclama (unclaim) el plato con expectedVersion: 1', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/bills/claim-item',
        payload: {
          sessionToken: sessionA.token,
          participantToken: tokenAna,
          orderItemId: orderItemPasta.id,
          expectedVersion: 1,
          unclaim: true
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.item.claimedByGuest).toBeNull();
      expect(data.item.claimVersion).toBe(2);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. COBROS PRESENCIALES PARCIALES (CASH/CARD) Y PROPINA SEPARADA
  // ─────────────────────────────────────────────────────────────
  describe('3. Cobros presenciales, idempotencia y propina separada', () => {
    it('Staff registra cobro parcial en efectivo de 3.334 centavos con propina voluntaria de 500 centavos', async () => {
      const idempotencyKey = `pay_part_1_${Date.now()}`;
      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 3334,
          tipCents: 500,
          paymentMethod: 'WAITER_CASH',
          idempotencyKey
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.transaction.status).toBe('MANUAL_SETTLED');
      expect(data.transaction.method).toBe('WAITER_CASH');
      expect(data.transaction.amountCents).toBe(3334);
      expect(data.transaction.tipCents).toBe(500);
      expect(data.transaction.amountFloat).toBe(33.34);
      expect(data.transaction.tipFloat).toBe(5);

      // La propina no reduce la deuda de consumo: saldo remanente es 10000 - 3334 = 6666
      expect(data.bill.remainingCents).toBe(6666);
      expect(data.bill.paidCents).toBe(3334);
      expect(data.bill.tipTotalCents).toBe(500);
      expect(data.bill.status).toBe('OPEN');
    });

    it('Idempotencia: reintentar con la misma idempotencyKey e importes idénticos retorna la transacción previa sin duplicar cobros', async () => {
      const idempotencyKey = `pay_part_1_dedup_${Date.now()}`;

      // Primer llamado
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 1000,
          tipCents: 0,
          paymentMethod: 'WAITER_CARD',
          idempotencyKey
        }
      });
      expect(res1.statusCode).toBe(201);
      const tx1 = res1.json().transaction;

      // Segundo llamado idéntico
      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 1000,
          tipCents: 0,
          paymentMethod: 'WAITER_CARD',
          idempotencyKey
        }
      });
      expect(res2.statusCode).toBe(200);
      const tx2 = res2.json().transaction;
      expect(tx2.id).toBe(tx1.id);
      expect(res2.json().duplicate).toBe(true);

      // Saldo remanente dedujo 1000 una sola vez: 6666 - 1000 = 5666
      expect(res2.json().bill.remainingCents).toBe(5666);
    });

    it('Conflicto de idempotencia (409): reusar la misma idempotencyKey con diferente importe es rechazado', async () => {
      const idempotencyKey = `conflict_key_${Date.now()}`;

      await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 1000,
          paymentMethod: 'WAITER_CASH',
          idempotencyKey
        }
      });

      // Mismo key con amountCents = 2000
      const resConflict = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 2000,
          paymentMethod: 'WAITER_CASH',
          idempotencyKey
        }
      });

      expect(resConflict.statusCode).toBe(409);
      expect(resConflict.json().code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('Prevención de sobrepago (409): intentar cobrar más del saldo remanente es rechazado', async () => {
      const billRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/bills/session/${sessionA.token}`
      });
      const remaining = billRes.json().remainingCents;

      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: remaining + 5000, // Sobrepago
          paymentMethod: 'WAITER_CASH',
          idempotencyKey: `overpay_${Date.now()}`
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('OVERPAYMENT_NOT_ALLOWED');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. AISLAMIENTO MULTI-TENANT Y PERMISOS DE STAFF
  // ─────────────────────────────────────────────────────────────
  describe('4. Aislamiento multi-tenant y seguridad de cobro', () => {
    it('Staff del Restaurante B no puede cobrar mesas del Restaurante A (403)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 1000,
          paymentMethod: 'WAITER_CASH',
          idempotencyKey: `tenant_hack_${Date.now()}`
        }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
    });

    it('Staff del Restaurante B no puede consultar la cuenta de la mesa de Restaurante A (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/tables/${tableA.id}/bill`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. REVERSIÓN AUTORIZADA DE COBROS
  // ─────────────────────────────────────────────────────────────
  describe('5. Reversión de cobros presenciales', () => {
    it('Staff autorizado revierte un cobro presencial y reabre el saldo correspondiente', async () => {
      const idempotencyKey = `to_revert_${Date.now()}`;
      const payRes = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 1200,
          paymentMethod: 'WAITER_CARD',
          idempotencyKey
        }
      });
      expect(payRes.statusCode).toBe(201);
      const txId = payRes.json().transaction.id;
      const remainingAfterPay = payRes.json().bill.remainingCents;

      // Revertir pago
      const revertRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/payments/${txId}/revert`,
        headers: { authorization: `Bearer ${tokenManagerA}` }
      });

      expect(revertRes.statusCode).toBe(200);
      const data = revertRes.json();
      expect(data.success).toBe(true);

      // El saldo se reabrió sumando de nuevo los 1200 centavos
      expect(data.bill.remainingCents).toBe(remainingAfterPay + 1200);

      // Verificar en DB que la transacción pasó a REFUNDED
      const dbTx = await prisma.paymentTransaction.findUnique({ where: { id: txId } });
      expect(dbTx?.status).toBe('REFUNDED');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. BLOQUEO DE CIERRE DE SESIÓN CON DEUDA PENDIENTE
  // ─────────────────────────────────────────────────────────────
  describe('6. Bloqueo de cierre de sesión con deuda pendiente', () => {
    it('Rechaza cerrar sesión de mesa si existe saldo pendiente de pago (409)', async () => {
      // sessionA tiene saldo deudor abierto
      const bill = await BillService.calculateTableBill(sessionA.id);
      expect(bill.remainingCents).toBeGreaterThan(0);

      // Intentar cerrar la sesión sin force
      await expect(SessionService.closeTableSession(tableA.id)).rejects.toThrow();

      // Vía endpoint HTTP de manager sin force: 409
      const res = await app.inject({
        method: 'POST',
        url: `/v1/tables/${tableA.id}/close-session`,
        headers: { authorization: `Bearer ${tokenManagerA}` }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('UNPAID_BALANCE_EXISTS');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. LIQUIDACIÓN TOTAL Y TRANSICIÓN DE MESA A PAID
  // ─────────────────────────────────────────────────────────────
  describe('7. Liquidación final al 100% y transición de orden/mesa a PAID', () => {
    it('Cobro del saldo exacto restante marca la orden y mesa como PAID', async () => {
      const billRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/bills/session/${sessionA.token}`
      });
      const exactRemaining = billRes.json().remainingCents;
      expect(exactRemaining).toBeGreaterThan(0);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: exactRemaining,
          paymentMethod: 'WAITER_CASH',
          idempotencyKey: `final_clear_${Date.now()}`
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.bill.remainingCents).toBe(0);
      expect(data.bill.status).toBe('PAID');

      // Verificar orden en DB en estado PAID
      const dbOrder = await prisma.order.findUnique({ where: { id: orderA.id } });
      expect(dbOrder?.status).toBe(OrderStatus.PAID);

      // Verificar mesa en FSM en estado PAID
      const dbTable = await prisma.table.findUnique({ where: { id: tableA.id } });
      expect(dbTable?.currentState).toBe(TableFSMState.PAID);
    });

    it('Una vez pagada al 100%, nuevos cobros son rechazados con 409 BILL_ALREADY_PAID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/payments/settle',
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          tableSessionId: sessionA.id,
          amountCents: 1000,
          paymentMethod: 'WAITER_CASH',
          idempotencyKey: `after_paid_${Date.now()}`
        }
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('BILL_ALREADY_PAID');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. MANTENIMIENTO ESTRICTO DEL BLOQUEO DE PAGOS DIGITALES (503)
  // ─────────────────────────────────────────────────────────────
  describe('8. Endpoints de pagos digitales permanecen deshabilitados (503)', () => {
    it('POST /v1/orders/items/claim retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items/claim',
        payload: {
          sessionToken: sessionA.token,
          orderItemId: orderItemPasta.id,
          guestSessionId: 'guest-dummy',
          expectedVersion: 0
        }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });

    it('POST /v1/orders/:id/split-session retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/orders/${orderA.id}/split-session`,
        payload: { mode: 'EQUAL_PARTS', totalParts: 2 }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });

    it('POST /v1/orders/split-session/:id/pay-part retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/split-session/dummy-id/pay-part',
        payload: { guestSessionId: 'g1', paymentMethod: 'MERCADO_PAGO' }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });
  });
});

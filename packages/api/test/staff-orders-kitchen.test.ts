import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

describe('Etapa 15 — Autorizar cocina, estados de pedidos, transiciones permitidas y cobro manual', () => {
  let app: FastifyInstance;

  // Tenant A: Trattoria Alpha
  let restA: any;
  let shiftA: any;
  let tableA1: any;
  let tableA2: any;
  let sessionA1: any;
  let sessionA2: any;
  let catA: any;
  let itemA1: any; // Bife de Chorizo ($5000, available)
  let itemA2: any; // Vino Reserva ($3000, available)
  let itemUnavailableA: any; // Postre Especial ($1800, unavailable)
  let staffWaiterA: any;
  let tokenWaiterA: string;
  let staffManagerA: any;
  let tokenManagerA: string;

  // Tenant B: Bodegón Beta (para pruebas de cruce y aislamiento de tenant)
  let restB: any;
  let shiftB: any;
  let tableB1: any;
  let sessionB1: any;
  let catB: any;
  let itemB1: any; // Milanesa Napolitana ($4500, available)
  let staffWaiterB: any;
  let tokenWaiterB: string;
  let staffManagerB: any;
  let tokenManagerB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // ─────────────────────────────────────────────────────────────
    // 1. Setup Tenant A
    // ─────────────────────────────────────────────────────────────
    restA = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Alpha (Tenant A)',
        slug: `alpha-staff-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#3b82f6',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
      }
    });

    shiftA = await prisma.shift.create({
      data: {
        restaurantId: restA.id,
        openedAt: new Date()
      }
    });

    tableA1 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa A-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    tableA2 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa A-2',
        sector: 'TERRAZA',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
      }
    });

    sessionA1 = await prisma.tableSession.create({
      data: {
        tableId: tableA1.id,
        shiftId: shiftA.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    sessionA2 = await prisma.tableSession.create({
      data: {
        tableId: tableA2.id,
        shiftId: shiftA.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    catA = await prisma.menuCategory.create({
      data: {
        restaurantId: restA.id,
        name: 'Platos Principales A',
        orderIndex: 0
      }
    });

    itemA1 = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Bife de Chorizo',
        price: 5000,
        isAvailable: true
      }
    });

    itemA2 = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Vino Reserva',
        price: 3000,
        isAvailable: true
      }
    });

    itemUnavailableA = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Postre Especial Agotado',
        price: 1800,
        isAvailable: false
      }
    });

    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Juan A',
        pinHash: await bcrypt.hash('1111', 10),
        role: 'WAITER'
      }
    });

    staffManagerA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Gerente Carlos A',
        pinHash: await bcrypt.hash('2222', 10),
        role: 'MANAGER'
      }
    });

    const loginWaiterA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '1111' }
    });
    expect(loginWaiterA.statusCode).toBe(200);
    tokenWaiterA = loginWaiterA.json().token;

    const loginManagerA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '2222' }
    });
    expect(loginManagerA.statusCode).toBe(200);
    tokenManagerA = loginManagerA.json().token;

    // ─────────────────────────────────────────────────────────────
    // 2. Setup Tenant B
    // ─────────────────────────────────────────────────────────────
    restB = await prisma.restaurant.create({
      data: {
        name: 'Bodegón Beta (Tenant B)',
        slug: `beta-staff-${Date.now()}`,
        templateId: 'RUSTIC_WARMTH',
        themeColor: '#10b981',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
      }
    });

    shiftB = await prisma.shift.create({
      data: {
        restaurantId: restB.id,
        openedAt: new Date()
      }
    });

    tableB1 = await prisma.table.create({
      data: {
        restaurantId: restB.id,
        label: 'Mesa B-1',
        sector: 'SALON_B',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    sessionB1 = await prisma.tableSession.create({
      data: {
        tableId: tableB1.id,
        shiftId: shiftB.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    catB = await prisma.menuCategory.create({
      data: {
        restaurantId: restB.id,
        name: 'Platos Bodegón B',
        orderIndex: 0
      }
    });

    itemB1 = await prisma.menuItem.create({
      data: {
        categoryId: catB.id,
        name: 'Milanesa Napolitana',
        price: 4500,
        isAvailable: true
      }
    });

    staffWaiterB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Moza Ana B',
        pinHash: await bcrypt.hash('3333', 10),
        role: 'WAITER'
      }
    });

    staffManagerB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Gerente Martin B',
        pinHash: await bcrypt.hash('4444', 10),
        role: 'MANAGER'
      }
    });

    const loginWaiterB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '3333' }
    });
    expect(loginWaiterB.statusCode).toBe(200);
    tokenWaiterB = loginWaiterB.json().token;

    const loginManagerB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '4444' }
    });
    expect(loginManagerB.statusCode).toBe(200);
    tokenManagerB = loginManagerB.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 1: Protección de rutas staff: autenticación y aislamiento tenant
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 1: Autenticación y aislamiento de tenant estricto (Checklist 1)', () => {
    it('Rechaza con 401 consulta de kitchen-orders sin token de staff (anónimo)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`
      });
      expect(res.statusCode).toBe(401);
    });

    it('Rechaza con 403 consulta de kitchen-orders con staff de otro tenant', async () => {
      // Staff de Tenant B intentando ver comandas de Tenant A (por ID)
      const resById = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(resById.statusCode).toBe(403);
      expect(resById.json().code).toBe('STAFF_TENANT_MISMATCH');

      // Staff de Tenant B intentando ver comandas de Tenant A (por Slug)
      const resBySlug = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.slug}/kitchen-orders`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(resBySlug.statusCode).toBe(403);
      expect(resBySlug.json().code).toBe('STAFF_TENANT_MISMATCH');
    });

    it('Permite consulta de kitchen-orders a staff autenticado de su propio tenant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().orders).toBeDefined();
      expect(Array.isArray(res.json().orders)).toBe(true);
    });

    it('Rechaza con 401 validación de comanda sin token de staff (anónimo)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/some-order-id/validate`
      });
      expect(res.statusCode).toBe(401);
    });

    it('Rechaza con 401 carga directa de plato por staff sin token (anónimo)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        payload: { menuItemId: itemA1.id, quantity: 1 }
      });
      expect(res.statusCode).toBe(401);
    });

    it('Rechaza con 403 carga directa de plato en mesa de otro tenant', async () => {
      // Mozo B intentando cargar plato a Mesa A-1
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { menuItemId: itemA1.id, quantity: 1 }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
    });

    it('Rechaza con 404 carga de ítem perteneciente a otro restaurante (cruce de menú)', async () => {
      // Mozo A cargando ítem de Menú B a Mesa A-1
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { menuItemId: itemB1.id, quantity: 1 }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('ITEM_NOT_FOUND');
    });

    it('Rechaza con 422 carga de ítem no disponible', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { menuItemId: itemUnavailableA.id, quantity: 1 }
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('ITEM_NOT_AVAILABLE');
    });

    it('Rechaza cantidades inválidas (0, negativas, fraccionarias, >50) y notas excesivas', async () => {
      // Cantidad 0
      const resZero = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { menuItemId: itemA1.id, quantity: 0 }
      });
      expect(resZero.statusCode).toBe(400);

      // Cantidad negativa
      const resNeg = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { menuItemId: itemA1.id, quantity: -2 }
      });
      expect(resNeg.statusCode).toBe(400);

      // Cantidad decimal
      const resFloat = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { menuItemId: itemA1.id, quantity: 1.5 }
      });
      expect(resFloat.statusCode).toBe(400);

      // Cantidad mayor a 50
      const resTooBig = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { menuItemId: itemA1.id, quantity: 51 }
      });
      expect(resTooBig.statusCode).toBe(400);
      expect(resTooBig.json().code).toBe('QUANTITY_LIMIT_EXCEEDED');

      // Notas de más de 500 caracteres
      const resLongNotes = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { menuItemId: itemA1.id, quantity: 1, notes: 'A'.repeat(501) }
      });
      expect(resLongNotes.statusCode).toBe(400);
      expect(resLongNotes.json().code).toBe('NOTES_TOO_LONG');
    });

    it('Permite carga válida de platos por el mozo y actualiza total y estado FSM a ORDER_IN_KITCHEN', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          menuItemId: itemA1.id,
          quantity: 2,
          notes: 'Poco cocido'
        }
      });
      expect(res.statusCode).toBe(201);
      const order = res.json();
      expect(order.status).toBe(OrderStatus.IN_KITCHEN);
      expect(order.totalAmount).toBe(10000); // 2 * 5000
      expect(order.items.length).toBe(1);
      expect(order.items[0].name).toBe('Bife de Chorizo');
      expect(order.items[0].quantity).toBe(2);

      // Verificar que la mesa en la BD transicionó a ORDER_IN_KITCHEN
      const updatedTable = await prisma.table.findUnique({ where: { id: tableA1.id } });
      expect(updatedTable?.currentState).toBe(TableFSMState.ORDER_IN_KITCHEN);
    });

    it('Rechaza con 401 actualización de estado sin token (anónimo)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/some-order-id/status`,
        payload: { status: OrderStatus.READY_TO_SERVE }
      });
      expect(res.statusCode).toBe(401);
    });

    it('Rechaza con 403 actualización de estado de orden perteneciente a otro restaurante', async () => {
      // Creamos una orden en Tenant A
      const orderA = await prisma.order.findFirst({
        where: { tableSessionId: sessionA1.id }
      });
      expect(orderA).toBeTruthy();

      // Mozo B intenta modificar el estado de la orden de Tenant A
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderA!.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { status: OrderStatus.READY_TO_SERVE }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');

      // Validamos que el estado en la base no cambió
      const unmodifiedOrder = await prisma.order.findUnique({ where: { id: orderA!.id } });
      expect(unmodifiedOrder?.status).toBe(OrderStatus.IN_KITCHEN);
    });

    it('Rechaza con 403 validación de orden de otro restaurante', async () => {
      // Creamos una orden PENDING_VALIDATION en Tenant A
      const pendingOrder = await prisma.order.create({
        data: {
          tableSessionId: sessionA2.id,
          status: OrderStatus.PENDING_VALIDATION,
          totalAmount: 3000
        }
      });

      // Mozo B intenta validar la comanda de Tenant A
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${pendingOrder.id}/validate`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');

      // Comprobar ausencia de escrituras: la orden sigue en PENDING_VALIDATION
      const unmodified = await prisma.order.findUnique({ where: { id: pendingOrder.id } });
      expect(unmodified?.status).toBe(OrderStatus.PENDING_VALIDATION);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 2: Tabla de transiciones y esquema enum (Checklist 2)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 2: Transiciones permitidas, esquema enum y protección de estados finales (Checklist 2)', () => {
    let orderFlow: any;

    beforeAll(async () => {
      // Crear orden fresca para probar ciclo de vida
      orderFlow = await prisma.order.create({
        data: {
          tableSessionId: sessionA2.id,
          status: OrderStatus.PENDING_VALIDATION,
          totalAmount: 6000
        }
      });
    });

    it('Rechaza con 400 estado inventado o ausente fuera del enum OrderStatus', async () => {
      // Estado ausente
      const resMissing = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderFlow.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {}
      });
      expect(resMissing.statusCode).toBe(400);

      // Estado inventado
      const resInvented = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderFlow.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: 'SUPER_COOKED_EXTRA_DELICIOUS' }
      });
      expect(resInvented.statusCode).toBe(400);
      expect(resInvented.json().code).toBe('INVALID_ORDER_STATUS');

      // Estado no cambió
      const unmodified = await prisma.order.findUnique({ where: { id: orderFlow.id } });
      expect(unmodified?.status).toBe(OrderStatus.PENDING_VALIDATION);
    });

    it('Rechaza con 422 saltos prohibidos según ALLOWED_ORDER_TRANSITIONS', async () => {
      // De PENDING_VALIDATION a SERVED no está permitido directamente
      const resSkip = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderFlow.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.SERVED }
      });
      expect(resSkip.statusCode).toBe(422);
      expect(resSkip.json().code).toBe('INVALID_ORDER_TRANSITION');

      // Orden intacta en PENDING_VALIDATION
      const check = await prisma.order.findUnique({ where: { id: orderFlow.id } });
      expect(check?.status).toBe(OrderStatus.PENDING_VALIDATION);
    });

    it('Permite transiciones operativas válidas paso a paso: PENDING_VALIDATION -> IN_KITCHEN -> READY_TO_SERVE -> SERVED', async () => {
      // 1. Validar a IN_KITCHEN
      const resToKitchen = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderFlow.id}/validate`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(resToKitchen.statusCode).toBe(200);
      expect(resToKitchen.json().status).toBe(OrderStatus.IN_KITCHEN);

      // Idempotencia en validate: si ya está IN_KITCHEN responde 200 sin error
      const resToKitchenRepeat = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderFlow.id}/validate`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(resToKitchenRepeat.statusCode).toBe(200);
      expect(resToKitchenRepeat.json().status).toBe(OrderStatus.IN_KITCHEN);

      // 2. IN_KITCHEN -> READY_TO_SERVE
      const resReady = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderFlow.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.READY_TO_SERVE }
      });
      expect(resReady.statusCode).toBe(200);
      expect(resReady.json().status).toBe(OrderStatus.READY_TO_SERVE);

      // Idempotencia en PATCH status: el mismo estado responde 200
      const resReadyRepeat = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderFlow.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.READY_TO_SERVE }
      });
      expect(resReadyRepeat.statusCode).toBe(200);
      expect(resReadyRepeat.json().status).toBe(OrderStatus.READY_TO_SERVE);

      // 3. READY_TO_SERVE -> SERVED
      const resServed = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderFlow.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.SERVED }
      });
      expect(resServed.statusCode).toBe(200);
      expect(resServed.json().status).toBe(OrderStatus.SERVED);
    });

    it('Rechaza regresión prohibida desde SERVED hacia IN_KITCHEN (422)', async () => {
      const resRegress = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderFlow.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.IN_KITCHEN }
      });
      expect(resRegress.statusCode).toBe(422);
      expect(resRegress.json().code).toBe('INVALID_ORDER_TRANSITION');

      const check = await prisma.order.findUnique({ where: { id: orderFlow.id } });
      expect(check?.status).toBe(OrderStatus.SERVED);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 3: Cobro manual exclusivo de manager y trazabilidad presencial (Checklist 3)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 3: Cobro manual exclusivo de manager presencial (Checklist 3)', () => {
    let orderToPay: any;

    beforeAll(async () => {
      orderToPay = await prisma.order.create({
        data: {
          tableSessionId: sessionA1.id,
          status: OrderStatus.SERVED,
          totalAmount: 12500
        }
      });
    });

    it('Rechaza con 403 intento de cobro (status: PAID) por un MOZO (rol WAITER)', async () => {
      // Vía PATCH /status
      const resPatch = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderToPay.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.PAID, paymentMethod: 'WAITER_CASH' }
      });
      expect(resPatch.statusCode).toBe(403);
      expect(resPatch.json().code).toBe('MANAGER_ROLE_REQUIRED');

      // Vía POST /pay
      const resPay = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderToPay.id}/pay`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { paymentMethod: 'WAITER_CASH' }
      });
      expect(resPay.statusCode).toBe(403);
      expect(resPay.json().code).toBe('MANAGER_ROLE_REQUIRED');

      // Comprobar ausencia de escrituras: la orden no cambió a PAID
      const unmodified = await prisma.order.findUnique({ where: { id: orderToPay.id } });
      expect(unmodified?.status).toBe(OrderStatus.SERVED);

      // Comprobar que no se crearon transacciones de pago
      const txCount = await prisma.paymentTransaction.count({ where: { orderId: orderToPay.id } });
      expect(txCount).toBe(0);
    });

    it('Rechaza método de pago presencial inválido (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderToPay.id}/pay`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { paymentMethod: 'CRYPTO_BITCOIN' }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_PAYMENT_METHOD');

      // La orden sigue en SERVED
      const unmodified = await prisma.order.findUnique({ where: { id: orderToPay.id } });
      expect(unmodified?.status).toBe(OrderStatus.SERVED);
    });

    it('Permite cobro manual exitoso por MANAGER con WAITER_CASH o WAITER_CARD, registrando trazabilidad y sin confirmación de proveedor digital', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderToPay.id}/pay`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          paymentMethod: 'WAITER_CASH',
          tipAmount: 1500
        }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.order.status).toBe(OrderStatus.PAID);
      expect(data.transaction).toBeDefined();
      expect(data.transaction.status).toBe('MANUAL_SETTLED'); // Estado manual presencial trazable
      expect(data.transaction.method).toBe('WAITER_CASH');
      expect(data.transaction.amount).toBe(12500);
      expect(data.transaction.tipAmount).toBe(1500);
      expect(data.transaction.recordedBy).toBe(staffManagerA.id);

      // Verificar en base de datos la transacción: mpPaymentId DEBE ser null (no es pasarela digital)
      const tx = await prisma.paymentTransaction.findFirst({
        where: { orderId: orderToPay.id }
      });
      expect(tx).toBeTruthy();
      expect(tx?.mpPaymentId).toBeNull();
      expect(tx?.status).toBe('MANUAL_SETTLED');
      expect(tx?.resolvedAt).toBeTruthy();
      expect(tx?.guestSessionId).toBe(staffManagerA.id);
    });

    it('Rechaza cualquier modificación posterior sobre una orden ya en estado final PAID (409 ORDER_FINAL_STATE)', async () => {
      // 1. Intentar volver a IN_KITCHEN
      const resToKitchen = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${orderToPay.id}/status`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { status: OrderStatus.IN_KITCHEN }
      });
      expect(resToKitchen.statusCode).toBe(409);
      expect(resToKitchen.json().code).toBe('ORDER_FINAL_STATE');

      // 2. Intentar validar
      const resValidate = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderToPay.id}/validate`,
        headers: { authorization: `Bearer ${tokenManagerA}` }
      });
      expect(resValidate.statusCode).toBe(409);
      expect(resValidate.json().code).toBe('ORDER_FINAL_STATE');

      // 3. Intentar cobrarla de nuevo (segundo cierre)
      const resPayAgain = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderToPay.id}/pay`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { paymentMethod: 'WAITER_CARD' }
      });
      expect(resPayAgain.statusCode).toBe(409);
      expect(resPayAgain.json().code).toBe('ORDER_FINAL_STATE');

      // Verificar que NO se duplicaron transacciones
      const count = await prisma.paymentTransaction.count({ where: { orderId: orderToPay.id } });
      expect(count).toBe(1);
    });

    it('Rechaza modificaciones sobre una comanda cancelada (CANCELLED) (409 ORDER_FINAL_STATE)', async () => {
      const cancelledOrder = await prisma.order.create({
        data: {
          tableSessionId: sessionA2.id,
          status: OrderStatus.CANCELLED,
          totalAmount: 0
        }
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${cancelledOrder.id}/status`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { status: OrderStatus.IN_KITCHEN }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ORDER_FINAL_STATE');

      // La orden sigue CANCELLED
      const check = await prisma.order.findUnique({ where: { id: cancelledOrder.id } });
      expect(check?.status).toBe(OrderStatus.CANCELLED);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 4: Corrección de FSM: PAID -> EATING corregido (Checklist 4)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 4: Corrección de FSM: Al cobrar comanda la mesa transiciona a PAID, no a EATING (Checklist 4)', () => {
    let tableFsmTest: any;
    let sessionFsmTest: any;
    let orderFsmTest: any;

    beforeAll(async () => {
      tableFsmTest = await prisma.table.create({
        data: {
          restaurantId: restA.id,
          label: 'Mesa FSM-1',
          sector: 'SALON',
          currentState: TableFSMState.EATING,
          capacity: 4
        }
      });

      sessionFsmTest = await prisma.tableSession.create({
        data: {
          tableId: tableFsmTest.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
        }
      });

      orderFsmTest = await prisma.order.create({
        data: {
          tableSessionId: sessionFsmTest.id,
          status: OrderStatus.SERVED,
          totalAmount: 8500
        }
      });
    });

    it('Mesa en EATING pasa a TableFSMState.PAID al cobrarse la comanda por el manager (nunca regresa a EATING)', async () => {
      // Verificar estado previo de la mesa
      const tableBefore = await prisma.table.findUnique({ where: { id: tableFsmTest.id } });
      expect(tableBefore?.currentState).toBe(TableFSMState.EATING);

      // Cobro por manager
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderFsmTest.id}/pay`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { paymentMethod: 'WAITER_CARD' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().order.status).toBe(OrderStatus.PAID);

      // Verificar que el estado de la mesa en BD ahora es TableFSMState.PAID y NO EATING
      const tableAfter = await prisma.table.findUnique({ where: { id: tableFsmTest.id } });
      expect(tableAfter?.currentState).toBe(TableFSMState.PAID);
      expect(tableAfter?.currentState).not.toBe(TableFSMState.EATING);
    });

    it('Mesa en BILL_REQUESTED también transiciona a TableFSMState.PAID al cobrarse la comanda', async () => {
      const tableBillReq = await prisma.table.create({
        data: {
          restaurantId: restA.id,
          label: 'Mesa FSM-2',
          sector: 'SALON',
          currentState: TableFSMState.BILL_REQUESTED,
          capacity: 2
        }
      });

      const sessionBillReq = await prisma.tableSession.create({
        data: {
          tableId: tableBillReq.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
        }
      });

      const orderBillReq = await prisma.order.create({
        data: {
          tableSessionId: sessionBillReq.id,
          status: OrderStatus.SERVED,
          totalAmount: 4200
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderBillReq.id}/pay`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { paymentMethod: 'WAITER_CASH' }
      });
      expect(res.statusCode).toBe(200);

      const tableAfter = await prisma.table.findUnique({ where: { id: tableBillReq.id } });
      expect(tableAfter?.currentState).toBe(TableFSMState.PAID);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 5: Pagos digitales y división de cuenta permanecen bloqueados (503)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 5: Pagos digitales bloqueados en piloto presencial (Regla de oro)', () => {
    it('POST /v1/orders/items/claim retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items/claim',
        payload: { orderItemId: 'fake-item-id', guestSessionId: 'guest-1' }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });

    it('POST /v1/orders/:id/split-session retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/fake-order-id/split-session',
        payload: { mode: 'EQUAL_PARTS', totalParts: 2 }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });

    it('POST /v1/orders/split-session/:id/pay-part retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/split-session/fake-id/pay-part',
        payload: { guestSessionId: 'guest-1' }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });
  });
});

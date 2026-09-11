import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { FastifyInstance } from 'fastify';
import { CallType, PaymentMethod, CallStatus, TableFSMState } from '@mesaya/shared';

describe('MesaYA (RTMS) Full System End-to-End Test Suite', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let staffToken: string;
  let adminToken: string;
  let table1: any;
  let sessionToken: string;
  let stateTable: any;
  let stateSessionToken: string;
  let activeCallId: string;
  let menuItem: any;
  let activeOrderId: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Retrieve seeded restaurant
    restaurant = await prisma.restaurant.findUnique({
      where: { slug: 'trattoria-del-puerto' },
      include: { tables: true }
    });

    expect(restaurant).toBeDefined();
    expect(restaurant.slug).toBe('trattoria-del-puerto');

    // El rate limit es persistente para soportar varias instancias. Limpiar
    // sólo el bucket de login de esta fixture mantiene la suite repetible sin
    // tocar buckets de otros restaurantes ni relajar la política productiva.
    await prisma.rateLimitBucket.deleteMany({
      where: {
        OR: [
          { key: { startsWith: `login:tenant:${restaurant.id}:ip:` } },
          { key: { startsWith: 'call:session:' } },
          { key: { startsWith: `waitlist:tenant:${restaurant.id}:ip:` } }
        ]
      }
    });

    table1 = restaurant.tables.find((t: any) => t.label === 'Mesa 1') || restaurant.tables[0];
    expect(table1).toBeDefined();

    // Ensure pristine idempotent state for table1
    await prisma.feedback.deleteMany({ where: { tableSession: { tableId: table1.id } } });
    await prisma.callRequest.deleteMany({ where: { tableSession: { tableId: table1.id } } });
    await prisma.orderItem.deleteMany({ where: { order: { tableSession: { tableId: table1.id } } } });
    await prisma.order.deleteMany({ where: { tableSession: { tableId: table1.id } } });
    await prisma.tableSession.updateMany({
      where: { tableId: table1.id },
      data: { closedAt: null, expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) }
    });
    await prisma.table.update({
      where: { id: table1.id },
      data: { currentState: TableFSMState.AVAILABLE, stateChangedAt: new Date() }
    });

    // The state-engine/QR-revocation checks need an independent clean table.
    // table1 is intentionally used by the ordering/account scenarios above;
    // after those scenarios it has an unpaid balance and must be rejected by
    // the production safety guard instead of being reused for a positive FSM
    // transition test.
    const stateShift = await prisma.shift.findFirst({
      where: { restaurantId: restaurant.id, closedAt: null }
    }) || await prisma.shift.create({
      data: { restaurantId: restaurant.id, openedAt: new Date() }
    });
    stateTable = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `E2E State ${randomUUID().slice(0, 8)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.AVAILABLE,
        stateChangedAt: new Date(),
        capacity: 4
      }
    });
    const stateSession = await prisma.tableSession.create({
      data: {
        tableId: stateTable.id,
        shiftId: stateShift.id,
        token: randomUUID(),
        activeKey: stateTable.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    stateSessionToken = stateSession.token;

    await prisma.restaurantModuleConfig.upsert({
      where: { restaurantId: restaurant.id },
      create: {
        restaurantId: restaurant.id,
        allowOrdering: true,
        allowSplitBill: true,
        requireWaiterValidation: true,
        enableWaitlist: true,
        enableWaitlistPreOrder: true
      },
      update: {
        allowOrdering: true,
        allowSplitBill: true,
        requireWaiterValidation: true,
        enableWaitlist: true,
        enableWaitlistPreOrder: true
      }
    });

    // Get a menu item for ordering test
    menuItem = await prisma.menuItem.findFirst({
      where: { category: { restaurantId: restaurant.id } }
    });
    expect(menuItem).toBeDefined();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. HEALTH & PLATFORM DIRECTORY
  // ─────────────────────────────────────────────────────────────
  describe('1. Health & Platform Directory', () => {
    it('GET /health returns 200 OK with server metadata', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('MesaYA API');
    });

    it('GET /v1/health returns 200 OK with v1 service identifier', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.status).toBe('ok');
      expect(data.service).toBe('MesaYA API v1');
    });

    it('GET /v1/restaurants returns the list of restaurants including trattoria-del-puerto', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/restaurants' });
      expect(res.statusCode).toBe(200);
      const list = res.json();
      expect(Array.isArray(list)).toBe(true);
      const found = list.find((r: any) => r.slug === 'trattoria-del-puerto');
      expect(found).toBeDefined();
      expect(found.name).toBe('Trattoria del Puerto');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. STAFF & ADMIN AUTHENTICATION
  // ─────────────────────────────────────────────────────────────
  describe('2. Staff & Admin Authentication', () => {
    it('POST /v1/staff/login rejects invalid PIN with 401', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug: 'trattoria-del-puerto',
          pin: '0000'
        }
      });
      expect(res.statusCode).toBe(401);
      const data = res.json();
      expect(data.error).toBeDefined();
    });

    it('POST /v1/staff/login succeeds with seeded waiter PIN (1234)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug: 'trattoria-del-puerto',
          pin: '1234'
        }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.token).toBeDefined();
      expect(data.staffUser).toBeDefined();
      expect(data.staffUser.name).toContain('Mozo');
      expect(data.staffUser.role).toBe('WAITER');

      staffToken = data.token;
    });

    it('POST /v1/auth/login-admin succeeds with seeded manager PIN (9999)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login-admin',
        payload: {
          restaurantSlug: 'trattoria-del-puerto',
          pin: '9999'
        }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.token).toBeDefined();
      expect(data.staffUser.role).toBe('MANAGER');

      adminToken = data.token;
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. MENU RETRIEVAL & CATEGORIES
  // ─────────────────────────────────────────────────────────────
  describe('3. Menu & Categories', () => {
    it('GET /v1/restaurants/:slug/menu returns full categorised menu', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/restaurants/trattoria-del-puerto/menu'
      });
      expect(res.statusCode).toBe(200);
      const menu = res.json();
      expect(Array.isArray(menu.categories)).toBe(true);
      expect(menu.categories.length).toBeGreaterThan(0);

      // Verify structure of first category & items
      const firstCat = menu.categories[0];
      expect(firstCat.name).toBeDefined();
      expect(Array.isArray(firstCat.items)).toBe(true);
      if (firstCat.items.length > 0) {
        expect(firstCat.items[0].name).toBeDefined();
        expect(firstCat.items[0].price).toBeGreaterThan(0);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. COMENSAL SESSION & QR RESOLUTION
  // ─────────────────────────────────────────────────────────────
  describe('4. Comensal Session & QR Resolution', () => {
    it('GET /v1/sessions/:slug/:tableLabel resolves QR scan and returns sessionToken', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/trattoria-del-puerto/${encodeURIComponent(table1.label)}`
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(true);
      expect(data.token).toBeDefined();
      expect(data.restaurant.name).toBe('Trattoria del Puerto');
      expect(data.table.label).toBe(table1.label);

      sessionToken = data.token;
    });

    it('GET /v1/sessions/:token returns session data via direct token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${sessionToken}`
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(true);
      expect(data.table.id).toBe(table1.id);
    });

    it('GET /v1/sessions/:token with invalid token returns valid: false or 404', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/sessions/invalid-non-existent-token-123'
      });
      const data = res.json();
      expect(res.statusCode === 404 || data.valid === false).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. CALLS LIFECYCLE (LLAMADOS AL MOZO & PEDIDO DE CUENTA)
  // ─────────────────────────────────────────────────────────────
  describe('5. Calls Lifecycle & Anti-Ghost Call Protection', () => {
    it('POST /v1/calls creates a WAITER call request', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken,
          type: CallType.WAITER,
          origin: 'WEB_DIRECT',
          note: 'Por favor traer hielo'
        }
      });
      expect(res.statusCode).toBe(201);
      const call = res.json();
      expect(call.id).toBeDefined();
      expect(call.type).toBe(CallType.WAITER);
      expect(call.status).toBe(CallStatus.PENDING);
      expect(call.note).toBe('Por favor traer hielo');

      activeCallId = call.id;
    });

    it('POST /v1/calls rejects duplicate active call on same table', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken,
          type: CallType.WAITER,
          origin: 'WEB_DIRECT'
        }
      });
      // Should fail with client error (400 or 409)
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
      const data = res.json();
      expect(data.error).toBeDefined();
    });

    it('GET /v1/calls lists the active call for the restaurant staff', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restaurant.id}`,
        headers: {
          Authorization: `Bearer ${staffToken}`
        }
      });
      expect(res.statusCode).toBe(200);
      const calls = res.json();
      expect(Array.isArray(calls)).toBe(true);
      const found = calls.find((c: any) => c.id === activeCallId);
      expect(found).toBeDefined();
      expect(found.status).toBe(CallStatus.PENDING);
    });

    it('PATCH /v1/calls/:id changes status to IN_PROGRESS by staff', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${activeCallId}`,
        headers: {
          Authorization: `Bearer ${staffToken}`
        },
        payload: {
          status: CallStatus.IN_PROGRESS
        }
      });
      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.status).toBe(CallStatus.IN_PROGRESS);
    });

    it('PATCH /v1/calls/:id changes status to RESOLVED by staff', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${activeCallId}`,
        headers: {
          Authorization: `Bearer ${staffToken}`
        },
        payload: {
          status: CallStatus.RESOLVED
        }
      });
      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.status).toBe(CallStatus.RESOLVED);
    });

    it('POST /v1/calls allows new BILL call after previous is resolved', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken,
          type: CallType.BILL,
          paymentMethod: PaymentMethod.MERCADO_PAGO,
          origin: 'WEB_DIRECT'
        }
      });
      expect(res.statusCode).toBe(201);
      const billCall = res.json();
      expect(billCall.type).toBe(CallType.BILL);
      expect(billCall.paymentMethod).toBe(PaymentMethod.MERCADO_PAGO);

      // Comensal cancels bill request
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/v1/calls/${billCall.id}/cancel`,
        payload: { sessionToken }
      });
      expect(cancelRes.statusCode).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. COLLABORATIVE CART & ORDERS
  // ─────────────────────────────────────────────────────────────
  describe('6. Collaborative Cart & Orders', () => {
    it('GET /v1/orders/session/:token returns current cart order', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionToken}`
      });
      expect(res.statusCode).toBe(200);
    });

    it('POST /v1/orders/items adds an item to the collaborative cart', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken,
          menuItemId: menuItem.id,
          quantity: 2,
          notes: 'Sin sal añadida',
          guestSessionId: 'guest-alpha-1'
        }
      });
      expect(res.statusCode).toBe(201);
      const order = res.json();
      expect(order.id).toBeDefined();
      expect(order.items.length).toBeGreaterThan(0);
      expect(order.totalAmount).toBe(menuItem.price * 2);

      activeOrderId = order.id;
    });

    it('POST /v1/orders/submit submits order to kitchen', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken }
      });
      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(['PENDING_VALIDATION', 'IN_KITCHEN']).toContain(order.status);
    });

    it('POST /v1/staff/orders/:id/validate validates the comanda by staff', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${activeOrderId}/validate`,
        headers: {
          Authorization: `Bearer ${staffToken}`
        }
      });
      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(order.status).toBe('IN_KITCHEN');
    });

    it('POST /v1/staff/tables/:tableId/orders/items allows waiter to directly load orders for verbal requests', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${table1.id}/orders/items`,
        headers: {
          Authorization: `Bearer ${staffToken}`
        },
        payload: {
          menuItemId: menuItem.id,
          quantity: 1,
          notes: 'Punto jugoso (pedido tomado verbalmente)'
        }
      });
      expect(res.statusCode).toBe(201);
      const order = res.json();
      expect(order.id).toBeDefined();
      expect(order.status).toBe('IN_KITCHEN');
    });

    it('GET /v1/staff/restaurants/:id/kitchen-orders lists all active kitchen comandas (KDS)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurant.id}/kitchen-orders`,
        headers: {
          Authorization: `Bearer ${staffToken}`
        }
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBeGreaterThan(0);
      const found = data.orders.find((o: any) => o.tableId === table1.id);
      expect(found).toBeDefined();
      expect(found.tableLabel).toBe(table1.label);
      expect(found.items.length).toBeGreaterThan(0);
    });

    it('PATCH /v1/staff/orders/:id/status updates kitchen comanda to READY_TO_SERVE', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${activeOrderId}/status`,
        headers: {
          Authorization: `Bearer ${staffToken}`
        },
        payload: {
          status: 'READY_TO_SERVE'
        }
      });
      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(order.status).toBe('READY_TO_SERVE');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6.1 DIGITAL PAYMENTS & SPLIT BILL CONTAINMENT (PILOT MODE)
  // ─────────────────────────────────────────────────────────────
  describe('6.1 Digital Payments & Split Bill Containment (Pilot Mode)', () => {
    it('POST /v1/orders/:id/split-session is rejected with 503 DIGITAL_PAYMENTS_UNAVAILABLE even if allowSplitBill=true', async () => {
      // 1. Explicitly ensure allowSplitBill is set to true in config
      await prisma.restaurantModuleConfig.update({
        where: { restaurantId: restaurant.id },
        data: { allowSplitBill: true }
      });

      const res = await app.inject({
        method: 'POST',
        url: `/v1/orders/${activeOrderId}/split-session`,
        payload: {
          mode: 'EQUAL_PARTS',
          totalParts: 2
        }
      });

      expect(res.statusCode).toBe(503);
      const data = res.json();
      expect(data.code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
      expect(data.error).toContain('no disponibles');

      // Verify zero records written to splitBillSession for this order
      const splitSessionsCount = await prisma.splitBillSession.count({
        where: { orderId: activeOrderId }
      });
      expect(splitSessionsCount).toBe(0);
    });

    it('POST /v1/orders/items/claim is rejected with 503 DIGITAL_PAYMENTS_UNAVAILABLE and item remains unclaimed', async () => {
      const order = await prisma.order.findUnique({
        where: { id: activeOrderId },
        include: { items: true }
      });
      expect(order).toBeDefined();
      expect(order!.items.length).toBeGreaterThan(0);
      const targetItem = order!.items[0];

      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items/claim',
        payload: {
          orderItemId: targetItem.id,
          guestSessionId: 'guest-split-claimant',
          expectedVersion: targetItem.claimVersion
        }
      });

      expect(res.statusCode).toBe(503);
      const data = res.json();
      expect(data.code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');

      // Verify item was NOT claimed
      const itemAfter = await prisma.orderItem.findUnique({
        where: { id: targetItem.id }
      });
      expect(itemAfter?.claimedByGuest).toBeNull();
    });

    it('POST /v1/orders/split-session/:id/pay-part is rejected with 503 DIGITAL_PAYMENTS_UNAVAILABLE with or without session token', async () => {
      const dummySplitId = 'split-sess-test-dummy';

      // Without token
      const res1 = await app.inject({
        method: 'POST',
        url: `/v1/orders/split-session/${dummySplitId}/pay-part`,
        payload: { guestSessionId: 'g1', paymentMethod: 'MERCADO_PAGO' }
      });
      expect(res1.statusCode).toBe(503);
      expect(res1.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');

      // With session token header
      const res2 = await app.inject({
        method: 'POST',
        url: `/v1/orders/split-session/${dummySplitId}/pay-part`,
        headers: { 'x-session-token': sessionToken },
        payload: { guestSessionId: 'g1', paymentMethod: 'MERCADO_PAGO' }
      });
      expect(res2.statusCode).toBe(503);
      expect(res2.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });

    it('Repeating pay-part never creates PaymentTransaction nor alters order/table balance and status', async () => {
      const txCountBefore = await prisma.paymentTransaction.count();
      const orderBefore = await prisma.order.findUnique({
        where: { id: activeOrderId }
      });
      expect(orderBefore).toBeDefined();
      const statusBefore = orderBefore!.status;
      const amountBefore = orderBefore!.totalAmount;

      for (let i = 1; i <= 3; i++) {
        const res = await app.inject({
          method: 'POST',
          url: `/v1/orders/split-session/dummy-session-id/pay-part`,
          payload: {
            guestSessionId: `guest-repeat-${i}`,
            paymentMethod: 'MERCADO_PAGO'
          }
        });
        expect(res.statusCode).toBe(503);
        expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
      }

      const txCountAfter = await prisma.paymentTransaction.count();
      expect(txCountAfter).toBe(txCountBefore);

      const orderAfter = await prisma.order.findUnique({
        where: { id: activeOrderId }
      });
      expect(orderAfter!.status).toBe(statusBefore);
      expect(orderAfter!.totalAmount).toBe(amountBefore);
      expect(orderAfter!.status).not.toBe('PAID');
    });

    it('Requesting bill via calls API (CallType.BILL) notifies staff without fake payment success or PAID status', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken,
          type: CallType.BILL,
          paymentMethod: PaymentMethod.CASH,
          origin: 'WEB_DIRECT',
          note: 'Cobro en mesa con efectivo'
        }
      });

      expect(res.statusCode).toBe(201);
      const billCall = res.json();
      expect(billCall.type).toBe(CallType.BILL);
      expect(billCall.status).toBe(CallStatus.PENDING);

      // Order should remain unchanged and NOT marked PAID
      const order = await prisma.order.findUnique({
        where: { id: activeOrderId }
      });
      expect(order!.status).not.toBe('PAID');

      // Cancel the call to leave clean state
      await app.inject({
        method: 'POST',
        url: `/v1/calls/${billCall.id}/cancel`,
        payload: { sessionToken }
      });
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. SALON FLOOR PLAN & KONVA GEOMETRY
  // ─────────────────────────────────────────────────────────────
  describe('7. Salon Floor Plan & Konva Geometry', () => {
    it('GET /v1/floor-plan/:restaurantId returns complete layout and tables', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/floor-plan/${restaurant.slug}`,
        headers: { authorization: `Bearer ${staffToken}` }
      });
      expect(res.statusCode).toBe(200);
      const plan = res.json();
      expect(plan.layout).toBeDefined();
      expect(plan.layout.canvasWidth).toBeGreaterThan(0);
      expect(plan.layout.canvasHeight).toBeGreaterThan(0);
      expect(Array.isArray(plan.zones)).toBe(true);
      expect(Array.isArray(plan.tables)).toBe(true);

      // Verify Konva geometry fields exist on every table
      const sampleTable = plan.tables[0];
      expect(typeof sampleTable.posX).toBe('number');
      expect(typeof sampleTable.posY).toBe('number');
      expect(typeof sampleTable.width).toBe('number');
      expect(typeof sampleTable.height).toBe('number');
      expect(sampleTable.shape).toBeDefined();
      expect(sampleTable.currentState).toBeDefined();
    });

    it('PATCH /v1/tables/:tableId/position updates table coordinates', async () => {
      const planRes = await app.inject({
        method: 'GET',
        url: `/v1/floor-plan/${restaurant.slug}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });
      expect(planRes.statusCode).toBe(200);
      const expectedVersion = planRes.json().layout.version;
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/tables/${table1.id}/position`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          posX: 320,
          posY: 240,
          rotation: 45,
          expectedVersion
        }
      });
      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.success).toBe(true);
      expect(updated.layoutVersion).toBe(expectedVersion + 1);
    });

    it('PUT /v1/floor-plan/:restaurantId accepts valid sector, isOutdoor, and mergedWithTableId', async () => {
      const allTables = await prisma.table.findMany({ where: { restaurantId: restaurant.id } });
      const t1 = allTables[0];
      const t2 = allTables[1];

      const res = await app.inject({
        method: 'PUT',
        url: `/v1/floor-plan/${restaurant.slug}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tables: allTables.map((t: any) => ({
            id: t.id,
            label: t.label,
            posX: t.posX,
            posY: t.posY,
            width: t.width,
            height: t.height,
            rotation: t.rotation,
            shape: t.shape,
            capacity: t.capacity,
            floorZoneId: t.floorZoneId,
            sector: t.id === t1.id ? 'TERRAZA' : t.sector,
            isOutdoor: t.id === t1.id ? true : t.isOutdoor,
            mergedWithTableId: t.id === t1.id ? t2.id : t.mergedWithTableId
          }))
        }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);

      const verifyT1 = await prisma.table.findUnique({ where: { id: t1.id } });
      expect(verifyT1?.sector).toBe('TERRAZA');
      expect(verifyT1?.isOutdoor).toBe(true);
      expect(verifyT1?.mergedWithTableId).toBe(t2.id);
    });

    it('PUT /v1/floor-plan/:restaurantId rejects invalid types for sector, isOutdoor, and mergedWithTableId', async () => {
      const allTables = await prisma.table.findMany({ where: { restaurantId: restaurant.id } });
      const t1 = allTables[0];

      // Invalid sector (number instead of string)
      const res1 = await app.inject({
        method: 'PUT',
        url: `/v1/floor-plan/${restaurant.slug}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tables: [{ id: t1.id, posX: 100, posY: 100, sector: 12345 }]
        }
      });
      expect(res1.statusCode).toBe(400);

      // Invalid isOutdoor (string instead of boolean)
      const res2 = await app.inject({
        method: 'PUT',
        url: `/v1/floor-plan/${restaurant.slug}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tables: [{ id: t1.id, posX: 100, posY: 100, isOutdoor: 'not-a-bool' }]
        }
      });
      expect(res2.statusCode).toBe(400);

      // Invalid mergedWithTableId (boolean instead of string/null)
      const res3 = await app.inject({
        method: 'PUT',
        url: `/v1/floor-plan/${restaurant.slug}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          tables: [{ id: t1.id, posX: 100, posY: 100, mergedWithTableId: true }]
        }
      });
      expect(res3.statusCode).toBe(400);
    });

    it('DELETE /floor-plan/:restaurantId/tables/:tableId succeeds without duplicated success property', async () => {
      const tempTable = await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          // La base demo es persistente cuando Vitest se ejecuta directamente.
          // Mantener la fixture única evita colisiones entre corridas.
          label: `Mesa Temp Delete ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          posX: 999,
          posY: 999,
          currentState: TableFSMState.AVAILABLE
        }
      });

      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/floor-plan/${restaurant.slug}/tables/${tempTable.id}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(body.message).toBe('Mesa eliminada correctamente');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 8. FEEDBACK & ETHICAL REVIEW ROUTING
  // ─────────────────────────────────────────────────────────────
  describe('8. Feedback & Ethical Review Routing', () => {
    it('POST /v1/feedback accepts valid comensal feedback during active session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken,
          rating: 5,
          comment: 'Excelente atención y las pastas exquisitas.'
        }
      });
      expect(res.statusCode).toBe(201);
      const fb = res.json();
      expect(fb.id).toBeDefined();
      expect(fb.rating).toBe(5);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 9. RTMS 1-TAP SALON TABLET STATE ENGINE
  // ─────────────────────────────────────────────────────────────
  describe('9. RTMS 1-Tap State Engine', () => {
    it('POST /v1/tables/:tableId/state/tap advances state with action=next', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/tables/${stateTable.id}/state/tap`,
        headers: { authorization: `Bearer ${staffToken}` },
        payload: {
          action: 'next'
        }
      });
      expect(res.statusCode).toBe(200);
      const result = res.json();
      expect(result.success).toBe(true);
      expect(result.newState).toBeDefined();
    });

    it('POST /v1/tables/:tableId/state/tap with action=skip_to jumps directly to TO_CLEAN and closes active session', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/tables/${stateTable.id}/state/tap`,
        headers: { authorization: `Bearer ${staffToken}` },
        payload: {
          action: 'skip_to',
          targetState: TableFSMState.TO_CLEAN,
          note: 'Comensales se retiraron tras pago'
        }
      });
      expect(res.statusCode).toBe(200);
      const result = res.json();
      expect(result.success).toBe(true);
      expect(result.newState).toBe(TableFSMState.TO_CLEAN);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 10. VIRTUAL WAITLIST (FILA VIRTUAL)
  // ─────────────────────────────────────────────────────────────
  describe('10. Virtual Waitlist', () => {
    it('POST /v1/waitlist/join registers diner in queue', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: 'trattoria-del-puerto',
          guestName: 'Comensal Test Fila',
          phone: '+5492235998877',
          partySize: 4,
          notes: 'Preferencia mesa exterior'
        }
      });
      expect(res.statusCode).toBe(201);
      const entry = res.json();
      expect(entry.id).toBeDefined();
      expect(entry.positionInQueue).toBeGreaterThan(0);
      expect(entry.status).toBe('WAITING');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 11. TABLE SESSION CLOSE & QR INVALIDATION
  // ─────────────────────────────────────────────────────────────
  describe('11. Table Session Close & QR Invalidation', () => {
    it('POST /v1/tables/:id/close-session closes session and revokes QR', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/tables/${stateTable.id}/close-session`,
        headers: {
          Authorization: `Bearer ${adminToken}`
        }
      });
      expect(res.statusCode).toBe(200);
      const result = res.json();
      expect(result.success).toBe(true);
    });

    it('GET /v1/sessions/:token returns isClosed: true after manager closes table', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${stateSessionToken}`
      });
      const data = res.json();
      expect(data.valid).toBe(false);
      expect(data.isClosed).toBe(true);
      expect(data.error).toContain('ha finalizado');
    });
  });
});

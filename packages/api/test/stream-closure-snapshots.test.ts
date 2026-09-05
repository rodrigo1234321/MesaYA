import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { eventBus } from '../src/lib/eventBus';
import { TableFSMState, Sector, CallType, PaymentMethod, OrderStatus } from '@mesaya/shared';
import { buildStaffStreamUrl } from '../../../apps/staff-panel/src/hooks/useSSE';

describe('Etapa 17 — Cerrar SSE público y definir snapshots', () => {
  let app: FastifyInstance;

  // Tenant A: Alpha Bistro
  let restA: any;
  let shiftA: any;
  let tableA1: any;
  let tableA2: any;
  let sessionA1: any;
  let callA1: any;
  let orderA1: any;
  let staffWaiterA: any;
  let tokenWaiterA: string;

  // Tenant B: Beta Trattoria (para pruebas de aislamiento tenant)
  let restB: any;
  let shiftB: any;
  let tableB1: any;
  let staffWaiterB: any;
  let tokenWaiterB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // ─────────────────────────────────────────────────────────────
    // 1. Setup Tenant A
    // ─────────────────────────────────────────────────────────────
    restA = await prisma.restaurant.create({
      data: {
        name: 'Alpha Bistro (Stream Test)',
        slug: `alpha-stream-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#3b82f6',
        moduleConfig: {
          create: {
            enableWaitlist: true,
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
      }
    });

    shiftA = await prisma.shift.create({
      data: {
        restaurantId: restA.id,
        openedAt: new Date(),
        closedAt: null
      }
    });

    tableA1 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa S-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    tableA2 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa S-2',
        sector: 'TERRAZA',
        currentState: TableFSMState.AVAILABLE,
        capacity: 2
      }
    });

    const expiresA1 = new Date(Date.now() + 3600 * 1000);
    sessionA1 = await prisma.tableSession.create({
      data: {
        tableId: tableA1.id,
        shiftId: shiftA.id,
        token: `guest-session-token-${Date.now()}`,
        expiresAt: expiresA1
      }
    });

    callA1 = await prisma.callRequest.create({
      data: {
        tableSessionId: sessionA1.id,
        type: CallType.WAITER,
        status: 'PENDING',
        paymentMethod: PaymentMethod.CASH,
        note: 'Por favor traer sal'
      }
    });

    const catA = await prisma.menuCategory.create({
      data: {
        restaurantId: restA.id,
        name: 'Platos',
        orderIndex: 0
      }
    });

    const itemA = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Ravioles Caseros',
        description: 'Con salsa bolognesa',
        price: 8500,
        isAvailable: true
      }
    });

    orderA1 = await prisma.order.create({
      data: {
        tableSessionId: sessionA1.id,
        status: OrderStatus.CONFIRMED,
        totalAmount: 8500,
        items: {
          create: [
            {
              menuItemId: itemA.id,
              quantity: 1,
              unitPrice: 8500,
              notes: 'Sin queso',
              addedByGuest: 'guest-anon-1'
            }
          ]
        }
      }
    });

    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Alpha',
        pinHash: await bcrypt.hash('2222', 10),
        role: 'WAITER'
      }
    });

    const loginResA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '2222' }
    });
    expect(loginResA.statusCode).toBe(200);
    tokenWaiterA = loginResA.json().token;

    // ─────────────────────────────────────────────────────────────
    // 2. Setup Tenant B
    // ─────────────────────────────────────────────────────────────
    restB = await prisma.restaurant.create({
      data: {
        name: 'Beta Trattoria (Stream Test)',
        slug: `beta-stream-${Date.now()}`,
        templateId: 'RUSTIC_WARMTH',
        themeColor: '#10b981'
      }
    });

    shiftB = await prisma.shift.create({
      data: {
        restaurantId: restB.id,
        openedAt: new Date(),
        closedAt: null
      }
    });

    tableB1 = await prisma.table.create({
      data: {
        restaurantId: restB.id,
        label: 'Mesa B-1',
        sector: 'SALON',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4
      }
    });

    staffWaiterB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo Beta',
        pinHash: await bcrypt.hash('3333', 10),
        role: 'WAITER'
      }
    });

    const loginResB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '3333' }
    });
    expect(loginResB.statusCode).toBe(200);
    tokenWaiterB = loginResB.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 1: Deshabilitación estricta de SSE /stream (Checklist 1, 3, 4)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 1: Cierre definitivo de /stream con respuesta rápida 410 GONE', () => {
    it('GET /stream anónimo sin query devuelve 410 GONE sin datos ni stream abierto', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/stream'
      });

      expect(res.statusCode).toBe(410);
      const json = res.json();
      expect(json.code).toBe('SSE_STREAM_DISABLED');
      expect(json.message).toContain('deshabilitado');
      // No debe ser text/event-stream
      expect(res.headers['content-type']).not.toContain('text/event-stream');
      expect(res.headers['content-type']).toContain('application/json');
    });

    it('GET /stream con restaurantId válido devuelve 410 y no abre stream ni expone snapshot del salón', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/stream?restaurantId=${restA.id}`
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SSE_STREAM_DISABLED');
      // Verificar ausencia de filtración de snapshot
      expect(res.body).not.toContain('floor_plan.snapshot');
      expect(res.body).not.toContain('Mesa S-1');
      expect(res.body).not.toContain(sessionA1.token);
    });

    it('GET /stream con restaurantId y token JWT en query string devuelve 410 y no procesa JWT en URL', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/stream?restaurantId=${restA.id}&token=${tokenWaiterA}`
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SSE_STREAM_DISABLED');
      expect(res.headers['content-type']).not.toContain('text/event-stream');
    });

    it('GET /stream con Authorization Bearer header devuelve 410 GONE (stream cerrado para todos)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/stream',
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SSE_STREAM_DISABLED');
    });

    it('POST /stream devuelve 410 GONE (fastify.all)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/stream',
        payload: { restaurantId: restA.id }
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SSE_STREAM_DISABLED');
    });

    it('GET /v1/stream también devuelve 410 GONE (prefijo API)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/stream?restaurantId=' + restA.id
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SSE_STREAM_DISABLED');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 2: Invitado no accede a snapshots del salón ni otras mesas
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 2: Aislamiento del invitado / comensal frente a vistas del salón y terceros', () => {
    it('Invitado anónimo o con token de mesa no puede acceder a /calls del restaurante (401)', async () => {
      // Sin cabecera
      const resAnon = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`
      });
      expect(resAnon.statusCode).toBe(401);

      // Usando token de mesa como Bearer (no es un JWT de staff)
      const resGuest = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${sessionA1.token}` }
      });
      expect(resGuest.statusCode).toBe(401);
    });

    it('Invitado con token de mesa no puede acceder al plano general /floor-plan (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/floor-plan/${restA.id}`,
        headers: { authorization: `Bearer ${sessionA1.token}` }
      });
      expect(res.statusCode).toBe(401);
    });

    it('Invitado con token de mesa no puede consultar la lista de mesas /restaurants/:id/tables (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/restaurants/${restA.id}/tables`,
        headers: { authorization: `Bearer ${sessionA1.token}` }
      });
      expect(res.statusCode).toBe(401);
    });

    it('Invitado con token de mesa no puede consultar comandas de cocina del restaurante (401)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
        headers: { authorization: `Bearer ${sessionA1.token}` }
      });
      expect(res.statusCode).toBe(401);
    });

    it('Invitado consulta snapshot propio vía GET /sessions/:token y sólo ve su propia mesa y llamado', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${sessionA1.token}`
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.valid).toBe(true);

      // Datos de mesa propia
      expect(json.table).toBeDefined();
      expect(json.table.id).toBe(tableA1.id);
      expect(json.table.label).toBe('Mesa S-1');

      // Su llamado activo propio
      expect(json.activeCall).toBeDefined();
      expect(json.activeCall.id).toBe(callA1.id);
      expect(json.activeCall.type).toBe(CallType.WAITER);

      // Cero visibilidad de otras mesas del restaurante
      expect(json.tables).toBeUndefined();
      expect(res.body).not.toContain('Mesa S-2');
      expect(res.body).not.toContain('Mesa B-1');
    });

    it('Invitado consulta GET /orders/active y sólo ve la comanda de su propia mesa', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/orders/active',
        headers: { 'x-session-token': sessionA1.token }
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.order).toBeDefined();
      expect(json.order.id).toBe(orderA1.id);
      expect(json.order.tableSessionId).toBe(sessionA1.id);
      expect(json.order.items).toHaveLength(1);
      expect(json.order.items[0].notes).toBe('Sin queso');

      // No expone pedidos de otros ni llamadas a otras mesas
      expect(res.body).not.toContain(tableB1.id);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 3: Aislamiento tenant en snapshots de staff y no leak de datos
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 3: Aislamiento tenant A/B y ausencia de tokens/teléfonos ajenos en snapshots', () => {
    it('Staff de Tenant B no puede acceder al snapshot de llamados de Tenant A (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('Por favor traer sal');
    });

    it('Staff de Tenant B no puede acceder al snapshot de plano /floor-plan de Tenant A (404/403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/floor-plan/${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('Mesa S-1');
    });

    it('Staff de Tenant B no puede acceder al snapshot de mesas de Tenant A (404/403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/restaurants/${restA.id}/tables`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('Mesa S-1');
    });

    it('Staff de Tenant B no puede acceder a las comandas de cocina de Tenant A (403)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain('Ravioles Caseros');
    });

    it('Snapshot de llamadas para Staff Tenant A no expone tokens de sesión ni teléfonos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });

      expect(res.statusCode).toBe(200);
      const calls = res.json();
      expect(Array.isArray(calls)).toBe(true);
      expect(calls.length).toBeGreaterThanOrEqual(1);

      const foundCall = calls.find((c: any) => c.id === callA1.id);
      expect(foundCall).toBeDefined();
      expect(foundCall.tableLabel).toBe('Mesa S-1');

      // Verificar que NO se fuga el sessionToken de la mesa
      expect(foundCall).not.toHaveProperty('sessionToken');
      expect(foundCall).not.toHaveProperty('token');
      expect(res.body).not.toContain(sessionA1.token);
      // No contiene teléfonos
      expect(foundCall).not.toHaveProperty('phone');
    });

    it('Snapshot de plano /floor-plan para Staff Tenant A no expone activeSessionToken de comensales', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/floor-plan/${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.tables).toBeDefined();

      const table1DTO = data.tables.find((t: any) => t.id === tableA1.id);
      expect(table1DTO).toBeDefined();
      expect(table1DTO.label).toBe('Mesa S-1');

      // CRÍTICO: activeSessionToken debe ser null para evitar robo de sesiones
      expect(table1DTO.activeSessionToken).toBeNull();
      expect(res.body).not.toContain(sessionA1.token);
    });

    it('Snapshot de mesas /restaurants/:id/tables para Staff Tenant A tiene activeToken en null', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/restaurants/${restA.id}/tables`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });

      expect(res.statusCode).toBe(200);
      const tables = res.json();
      expect(Array.isArray(tables)).toBe(true);

      for (const t of tables) {
        expect(t.activeToken).toBeNull();
        expect(t).not.toHaveProperty('token');
      }
      expect(res.body).not.toContain(sessionA1.token);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 4: Resiliencia de eventBus sin clientes SSE
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 4: Resiliencia de eventBus', () => {
    it('eventBus.addClient es no-op y broadcast no falla ni fuga eventos', () => {
      // Intentar agregar un mock reply
      const mockReply: any = { raw: { write: () => {} } };
      expect(() => eventBus.addClient('client-1', restA.id, mockReply)).not.toThrow();

      // Disparar broadcast debe ser seguro sin clientes conectados
      expect(() => eventBus.broadcast(restA.id, 'test.event', { foo: 'bar' })).not.toThrow();
      expect(() =>
        eventBus.broadcastCall(
          {
            id: 'call-x',
            restaurantId: restA.id,
            tableId: tableA1.id,
            tableLabel: 'Mesa S-1',
            sector: 'SALON',
            type: CallType.WAITER,
            paymentMethod: PaymentMethod.CASH,
            status: 'PENDING',
            origin: 'QR',
            createdAt: new Date().toISOString()
          },
          'call.created'
        )
      ).not.toThrow();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 5: Contrato del consumidor staff-panel y erradicación de JWT en URL
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 5: Contrato del consumidor staff-panel (ausencia de JWT en URL)', () => {
    it('buildStaffStreamUrl construye la URL sin incluir token ni credenciales bearer en query params', () => {
      const url = buildStaffStreamUrl(restA.id);
      const parsed = new URL(url);

      // Debe incluir restaurantId
      expect(parsed.searchParams.get('restaurantId')).toBe(restA.id);

      // No debe contener token, authorization ni ninguna credencial
      expect(parsed.searchParams.has('token')).toBe(false);
      expect(parsed.searchParams.has('authorization')).toBe(false);
      expect(parsed.searchParams.has('bearer')).toBe(false);
      expect(url).not.toContain('token=');
      expect(url).not.toContain('Bearer');
      expect(url).not.toContain(tokenWaiterA);
    });

    it('Aun existiendo JWT en storage o sesión, el consumidor nunca lo incorpora a la URL legacy', () => {
      // Simular presencia de token de staff
      const dummyStaffJwt = tokenWaiterA;
      expect(dummyStaffJwt).toBeDefined();

      const url = buildStaffStreamUrl(restA.id);
      expect(url).not.toContain(dummyStaffJwt);
      expect(url).not.toContain('token=');
    });

    it('Inspección estática de useSSE.ts confirma eliminación de getAuthToken y queryParams.set(token)', () => {
      const useSSESource = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/staff-panel/src/hooks/useSSE.ts'),
        'utf8'
      );
      // No debe anexar token a queryParams
      expect(useSSESource).not.toMatch(/queryParams\.set\(\s*['"]token['"]/);
      // No debe leer StaffApi.getAuthToken
      expect(useSSESource).not.toMatch(/StaffApi\.getAuthToken/);
    });
  });
});


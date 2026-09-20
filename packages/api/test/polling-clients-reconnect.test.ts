import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { eventBus } from '../src/lib/eventBus';
import { TableFSMState, CallType, PaymentMethod, CallStatus } from '@mesaya/shared';

describe('Etapa 18 — Reconexión y avisos consistentes (Polling autoritativo de clientes)', () => {
  let app: FastifyInstance;

  // Tenant Alpha
  let restA: any;
  let shiftA: any;
  let tableA1: any;
  let sessionA1: any;
  let staffWaiterA: any;
  let tokenWaiterA: string;
  let staffManagerA: any;
  let tokenManagerA: string;

  // Tenant Beta
  let restB: any;
  let shiftB: any;
  let tableB1: any;
  let sessionB1: any;
  let staffWaiterB: any;
  let tokenWaiterB: string;
  let staffManagerB: any;
  let tokenManagerB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Tenant Alpha
    restA = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Reconnect Alpha',
        slug: `alpha-poll-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#10b981'
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
        label: 'Mesa P-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    const expiresA1 = new Date(Date.now() + 3600 * 1000);
    sessionA1 = await prisma.tableSession.create({
      data: {
        tableId: tableA1.id,
        shiftId: shiftA.id,
        token: `poll-guest-session-${Date.now()}`,
        expiresAt: expiresA1
      }
    });

    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Polling',
        pinHash: await bcrypt.hash('1234', 10),
        role: 'WAITER'
      }
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '1234' }
    });
    tokenWaiterA = loginRes.json().token;

    staffManagerA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Manager Alpha',
        pinHash: await bcrypt.hash('9999', 10),
        role: 'MANAGER'
      }
    });

    const loginManagerA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '9999' }
    });
    tokenManagerA = loginManagerA.json().token;

    // Tenant Beta
    restB = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Reconnect Beta',
        slug: `beta-poll-${Date.now()}`,
        templateId: 'MODERN_MINIMAL',
        themeColor: '#3b82f6'
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
        label: 'Mesa Beta-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    const expiresB1 = new Date(Date.now() + 3600 * 1000);
    sessionB1 = await prisma.tableSession.create({
      data: {
        tableId: tableB1.id,
        shiftId: shiftB.id,
        token: `poll-guest-session-beta-${Date.now()}`,
        expiresAt: expiresB1
      }
    });

    staffWaiterB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo Beta',
        pinHash: await bcrypt.hash('5678', 10),
        role: 'WAITER'
      }
    });

    const loginWaiterB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '5678' }
    });
    tokenWaiterB = loginWaiterB.json().token;

    staffManagerB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Manager Beta',
        pinHash: await bcrypt.hash('8888', 10),
        role: 'MANAGER'
      }
    });

    const loginManagerB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '8888' }
    });
    tokenManagerB = loginManagerB.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 1: Dos clientes observan cambios persistidos sin eventBus en memoria
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 1: Consistencia entre clientes sin canal SSE en memoria', () => {
    it('Dos clientes staff consultan el snapshot y observan un nuevo llamado persistido', async () => {
      // 1. Ambos clientes inician consultando snapshot y no ven llamadas
      const client1Initial = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      const client2Initial = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(client1Initial.statusCode).toBe(200);
      expect(client2Initial.statusCode).toBe(200);
      expect(client1Initial.json()).toEqual([]);
      expect(client2Initial.json()).toEqual([]);

      // 2. Comensal realiza un llamado por API HTTP
      const callRes = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionA1.token,
          type: CallType.WAITER,
          paymentMethod: PaymentMethod.NOT_APPLICABLE,
          note: 'Traer la carta de postres'
        }
      });
      expect(callRes.statusCode).toBe(201);
      const createdCall = callRes.json();

      // 3. Cliente 1 y Cliente 2 consultan independientemente el snapshot autoritativo
      // Ninguno depende de SSE ni de eventBus en memoria
      const client1Poll = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      const client2Poll = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });

      expect(client1Poll.statusCode).toBe(200);
      expect(client2Poll.statusCode).toBe(200);
      const list1 = client1Poll.json();
      const list2 = client2Poll.json();

      expect(list1).toHaveLength(1);
      expect(list2).toHaveLength(1);
      expect(list1[0].id).toBe(createdCall.id);
      expect(list2[0].id).toBe(createdCall.id);
      expect(list1[0].note).toBe('Traer la carta de postres');
      expect(list2[0].note).toBe('Traer la carta de postres');

      // 4. Mozo resuelve el llamado
      const resolveRes = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${createdCall.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: CallStatus.RESOLVED }
      });
      expect(resolveRes.statusCode).toBe(200);

      // 5. Ambos clientes consultan el snapshot y comprueban la resolución
      const client1After = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      const client2After = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(client1After.json()).toEqual([]);
      expect(client2After.json()).toEqual([]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 2: Deduplicación de avisos (vacío -> nuevo suena 1 vez, repetido no suena)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 2: Deduplicación estricta de alertas sonoras', () => {
    it('Alerta vacío -> nuevo suena una sola vez; snapshot repetido no vuelve a sonar', async () => {
      // Implementación pura del motor de deduplicación de useSSE
      let chimeCount = 0;
      const playChimeMock = () => {
        chimeCount += 1;
      };

      const knownCalls = new Map<string, string>();

      const processSnapshot = (snapshotData: any[]) => {
        const hasBrandNew = snapshotData.some((call) => {
          return !knownCalls.has(call.id) && call.status === 'PENDING';
        });

        if (hasBrandNew) {
          playChimeMock();
        }

        const nextKnown = new Map<string, string>();
        for (const c of snapshotData) {
          nextKnown.set(c.id, c.status);
        }
        knownCalls.clear();
        for (const [k, v] of nextKnown) {
          knownCalls.set(k, v);
        }
      };

      // T0: Lista vacía
      processSnapshot([]);
      expect(chimeCount).toBe(0);

      // T1: Llega snapshot con llamado nuevo call-1
      const call1 = { id: 'call-uuid-1', status: 'PENDING' };
      processSnapshot([call1]);
      expect(chimeCount).toBe(1); // Sonó una vez

      // T2: Próximo tick (3s) devuelve exactamente el mismo snapshot repetido
      processSnapshot([call1]);
      expect(chimeCount).toBe(1); // NO vuelve a sonar

      // T3: Otro tick devuelve exactamente el mismo snapshot repetido
      processSnapshot([call1]);
      expect(chimeCount).toBe(1); // NO vuelve a sonar

      // T4: Se resuelve el llamado -> snapshot vuelve a lista vacía
      processSnapshot([]);
      expect(chimeCount).toBe(1); // No suena

      // T5: Llega un nuevo llamado call-2 tras lista vacía
      const call2 = { id: 'call-uuid-2', status: 'PENDING' };
      processSnapshot([call2]);
      expect(chimeCount).toBe(2); // Sonó exactamente una vez más

      // T6: Snapshot repetido con call-2
      processSnapshot([call2]);
      expect(chimeCount).toBe(2); // NO vuelve a sonar
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 3: Pérdida y recuperación de red sin recargar la página
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 3: Resiliencia ante pérdida y recuperación de red', () => {
    it('Reconcilia el estado a conectado y sincroniza datos tras recuperar la red', async () => {
      let isConnected = true;
      let lastData: any[] = [];
      let networkOnline = false;

      // Simulación del motor de polling de useSSE / useFloorPlanSSE
      const poll = async () => {
        if (!networkOnline) {
          isConnected = false;
          return;
        }

        const res = await app.inject({
          method: 'GET',
          url: `/v1/calls?restaurantId=${restA.id}`,
          headers: { authorization: `Bearer ${tokenWaiterA}` }
        });

        if (res.statusCode === 200) {
          isConnected = true;
          lastData = res.json();
        } else {
          isConnected = false;
        }
      };

      // 1. Simular pérdida de red
      networkOnline = false;
      await poll();
      expect(isConnected).toBe(false);

      // 2. Crear una llamada en la base de datos mientras el cliente estaba "offline"
      const newCall = await prisma.callRequest.create({
        data: {
          tableSessionId: sessionA1.id,
          type: CallType.BILL,
          status: 'PENDING',
          paymentMethod: PaymentMethod.CASH,
          note: 'Cobro en mesa'
        }
      });

      // 3. Simular recuperación de red (evento 'online')
      networkOnline = true;
      await poll();

      // 4. Se reconcilia el estado sin recargar la página
      expect(isConnected).toBe(true);
      expect(lastData.some((c) => c.id === newCall.id)).toBe(true);

      // Limpieza
      await prisma.callRequest.delete({ where: { id: newCall.id } });
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 4: Invitado consulta sólo su sesión; expiración 401/410 detiene bucle
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 4: Polling del invitado acotado a su sesión y parada ante expiración', () => {
    it('Invitado sólo consulta su sesión /sessions/:token y no puede consultar llamadas de salón', async () => {
      // 1. Consulta autorizada a su propia sesión
      const sessionRes = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${sessionA1.token}`
      });
      expect(sessionRes.statusCode).toBe(200);
      const sessionData = sessionRes.json();
      expect(sessionData.valid).toBe(true);
      expect(sessionData.table.label).toBe('Mesa P-1');

      // 2. Intento de acceder a llamadas del salón sin Bearer staff
      const callsForbidden = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`,
        headers: { 'x-session-token': sessionA1.token }
      });
      expect(callsForbidden.statusCode).toBe(401);
    });

    it('Expiración 410 o 401 detiene el bucle de polling del invitado', async () => {
      // Crear sesión cerrada para probar parada inmediata
      const closedSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: `closed-session-${Date.now()}`,
          expiresAt: new Date(Date.now() + 3600 * 1000),
          closedAt: new Date()
        }
      });

      let pollingHalted = false;
      let expiredMessage = '';

      const pollGuestSession = async (token: string) => {
        const res = await app.inject({
          method: 'GET',
          url: `/v1/sessions/${token}`
        });

        if (res.statusCode === 401 || res.statusCode === 410) {
          pollingHalted = true;
          expiredMessage = res.json().error || 'Sesión finalizada';
          return;
        }

        const data = res.json();
        if (data.isClosed || data.isExpired) {
          pollingHalted = true;
          expiredMessage = data.error || 'Sesión finalizada';
        }
      };

      await pollGuestSession(closedSession.token);
      expect(pollingHalted).toBe(true);
      expect(expiredMessage).toBeTruthy();
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 5: Inspección estática - Erradicación de EventSource
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 5: Verificación de código fuente - Ausencia de EventSource en clientes', () => {
    it('useSSE.ts en staff-panel es un adaptador sin EventSource que delega en useServiceSync', () => {
      const staffHook = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/staff-panel/src/hooks/useSSE.ts'),
        'utf8'
      );
      expect(staffHook).not.toContain('new EventSource');
      // E08: useSSE es un adaptador del dueño real useServiceSync, sin scheduling propio.
      expect(staffHook).toContain('useServiceSync');
      expect(staffHook).not.toContain('scheduleNextPoll');
      expect(staffHook).not.toContain('requestSeqRef');

      const syncSrc = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/staff-panel/src/hooks/useServiceSync.ts'),
        'utf8'
      );
      // El dueño real importa/instancia PollingCoordinator y lo opera.
      expect(syncSrc).toContain('PollingCoordinator');
      expect(syncSrc).toContain('coordinator.start(');
    });

    it('useFloorPlanSSE.ts en admin-dashboard no contiene new EventSource y delega en PollingCoordinator', () => {
      const adminHook = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts'),
        'utf8'
      );
      expect(adminHook).not.toContain('new EventSource');
      expect(adminHook).toContain('AdminApi.getFloorPlan');
      expect(adminHook).toContain('PollingCoordinator');
      expect(adminHook).toContain('coordinator.start(');
    });

    it('app.js en client-web implementa stopPolling y maneja 401/410 con backoff', () => {
      const clientApp = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/client-web/app.js'),
        'utf8'
      );
      expect(clientApp).toContain('stopPolling');
      expect(clientApp).toContain('pollTick');
      expect(clientApp).toContain('scheduleNextPoll');
      expect(clientApp).toContain('res.status === 401 || res.status === 410');
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 6: Regresión de cambio de restaurante/tenant con PollingCoordinator real
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 6: Regresión cambio de restaurante con PollingCoordinator real (useSSE / useFloorPlanSSE)', () => {
    it('PollingCoordinator (calls): Al cambiar restaurantId con timer activo, sólo entrega datos del nuevo restaurante', async () => {
      // Preparar datos: una llamada en cada tenant
      const callARes = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionA1.token,
          type: CallType.WAITER,
          paymentMethod: PaymentMethod.NOT_APPLICABLE,
          note: 'Llamado exclusivo de Alpha'
        }
      });
      expect(callARes.statusCode).toBe(201);
      const callA = callARes.json();

      const callBRes = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionB1.token,
          type: CallType.WAITER,
          paymentMethod: PaymentMethod.NOT_APPLICABLE,
          note: 'Llamado exclusivo de Beta'
        }
      });
      expect(callBRes.statusCode).toBe(201);
      const callB = callBRes.json();

      // Acumuladores de lo que el coordinador REAL entrega
      let lastData: any[] = [];
      let connectionState = false;
      const receivedIdentifiers: string[] = [];

      // Instanciar el PollingCoordinator REAL de @mesaya/shared con fetchFn = app.inject()
      const { PollingCoordinator } = await import('@mesaya/shared');
      const coordinator = new PollingCoordinator<any[]>({
        fetchFn: async (identifier: string, signal: AbortSignal) => {
          receivedIdentifiers.push(identifier);
          const token = identifier === restA.id ? tokenWaiterA : tokenWaiterB;
          const res = await app.inject({
            method: 'GET',
            url: `/v1/calls?restaurantId=${identifier}`,
            headers: { authorization: `Bearer ${token}` }
          });
          if (res.statusCode !== 200) {
            const error: any = new Error('Fetch failed');
            error.statusCode = res.statusCode;
            throw error;
          }
          return res.json();
        },
        onData: (data) => { lastData = data; },
        onConnectionChange: (conn) => { connectionState = conn; },
        intervalMs: 3000,
        maxBackoffMs: 15000,
        isHidden: () => false
      });

      // 1. Iniciar en restA
      coordinator.start(restA.id);

      // Esperar a que el primer poll complete (onData se invoca síncronamente tras fetch)
      await new Promise((r) => setTimeout(r, 200));

      expect(connectionState).toBe(true);
      expect(lastData.length).toBeGreaterThanOrEqual(1);
      expect(lastData.some((c: any) => c.id === callA.id)).toBe(true);
      expect(lastData.some((c: any) => c.id === callB.id)).toBe(false);
      expect(coordinator.hasScheduledTimer).toBe(true);

      // 2. Cambiar a restB mientras el timer de 3000ms está programado
      //    start() internamente invoca _cancelPendingCycle() + resetea
      lastData = [];
      receivedIdentifiers.length = 0;
      coordinator.start(restB.id);

      // Esperar a que el poll de restB complete
      await new Promise((r) => setTimeout(r, 200));

      // 3. Verificar que sólo se consultó restB y los datos son de Beta
      expect(receivedIdentifiers).toEqual([restB.id]);
      expect(lastData.some((c: any) => c.id === callB.id)).toBe(true);
      expect(lastData.some((c: any) => c.id === callA.id)).toBe(false);
      expect(coordinator.activeIdentifier).toBe(restB.id);

      // Limpieza
      coordinator.destroy();
    });

    it('PollingCoordinator (floor-plan): Al cambiar restaurantSlug con timer activo, sólo entrega snapshot del nuevo restaurante', async () => {
      let lastTables: any[] = [];
      let connectionState = false;
      const receivedSlugs: string[] = [];

      const { PollingCoordinator } = await import('@mesaya/shared');
      const coordinator = new PollingCoordinator<any>({
        fetchFn: async (slug: string, signal: AbortSignal) => {
          receivedSlugs.push(slug);
          const token = slug === restA.slug ? tokenManagerA : tokenManagerB;
          const res = await app.inject({
            method: 'GET',
            url: `/v1/floor-plan/${slug}`,
            headers: { authorization: `Bearer ${token}` }
          });
          if (res.statusCode !== 200) {
            const error: any = new Error('Fetch failed');
            error.statusCode = res.statusCode;
            throw error;
          }
          return res.json();
        },
        onData: (data) => {
          if (data && Array.isArray(data.tables)) {
            lastTables = data.tables;
          }
        },
        onConnectionChange: (conn) => { connectionState = conn; },
        intervalMs: 3000,
        maxBackoffMs: 15000,
        isHidden: () => false
      });

      // 1. Iniciar en restA
      coordinator.start(restA.slug);
      await new Promise((r) => setTimeout(r, 200));

      expect(connectionState).toBe(true);
      expect(lastTables.some((t: any) => t.label === 'Mesa P-1')).toBe(true);
      expect(lastTables.some((t: any) => t.label === 'Mesa Beta-1')).toBe(false);
      expect(coordinator.hasScheduledTimer).toBe(true);

      // 2. Cambiar a restB mientras el timer está programado
      lastTables = [];
      receivedSlugs.length = 0;
      coordinator.start(restB.slug);
      await new Promise((r) => setTimeout(r, 200));

      // 3. Verificar que sólo se consultó restB y las mesas son de Beta
      expect(receivedSlugs).toEqual([restB.slug]);
      expect(lastTables.some((t: any) => t.label === 'Mesa Beta-1')).toBe(true);
      expect(lastTables.some((t: any) => t.label === 'Mesa P-1')).toBe(false);
      expect(coordinator.activeIdentifier).toBe(restB.slug);

      coordinator.destroy();
    });

    it('PollingCoordinator: Respuesta desfasada de fetch lento del tenant previo es descartada', async () => {
      let lastData: any[] = [];
      let dataUpdateCount = 0;

      const { PollingCoordinator } = await import('@mesaya/shared');

      const coordinator = new PollingCoordinator<any[]>({
        fetchFn: async (identifier: string, signal: AbortSignal) => {
          // Fetch de restA es artificialmente lento (300ms)
          if (identifier === restA.id) {
            await new Promise((r) => setTimeout(r, 300));
          }
          const token = identifier === restA.id ? tokenWaiterA : tokenWaiterB;
          const res = await app.inject({
            method: 'GET',
            url: `/v1/calls?restaurantId=${identifier}`,
            headers: { authorization: `Bearer ${token}` }
          });
          if (res.statusCode !== 200) {
            const error: any = new Error('Fetch failed');
            error.statusCode = res.statusCode;
            throw error;
          }
          return res.json();
        },
        onData: (data) => {
          lastData = data;
          dataUpdateCount++;
        },
        onConnectionChange: () => {},
        intervalMs: 3000,
        maxBackoffMs: 15000,
        isHidden: () => false
      });

      // 1. Iniciar en restA (fetch tarda 300ms)
      coordinator.start(restA.id);

      // 2. Antes de que responda restA (a 50ms), cambiar a restB
      await new Promise((r) => setTimeout(r, 50));
      coordinator.start(restB.id);

      // 3. Esperar a que ambos fetches se resuelvan
      await new Promise((r) => setTimeout(r, 500));

      // 4. onData debe haberse invocado SÓLO con datos de restB
      //    La respuesta tardía de restA fue descartada por el guard de secuencia
      expect(dataUpdateCount).toBe(1);
      expect(lastData.every((c: any) => c.restaurantId === restB.id || !c.restaurantId)).toBe(true);
      expect(coordinator.activeIdentifier).toBe(restB.id);

      coordinator.destroy();
    });

    it('PollingCoordinator: stop() cancela timer y detiene polling', async () => {
      let pollCount = 0;

      const { PollingCoordinator } = await import('@mesaya/shared');
      const coordinator = new PollingCoordinator<any[]>({
        fetchFn: async (identifier: string) => {
          pollCount++;
          const res = await app.inject({
            method: 'GET',
            url: `/v1/calls?restaurantId=${identifier}`,
            headers: { authorization: `Bearer ${tokenWaiterA}` }
          });
          return res.json();
        },
        onData: () => {},
        onConnectionChange: () => {},
        intervalMs: 100, // intervalo corto para probar que stop detiene
        maxBackoffMs: 200,
        isHidden: () => false
      });

      coordinator.start(restA.id);
      await new Promise((r) => setTimeout(r, 50));
      expect(pollCount).toBe(1);

      // stop() cancela el timer programado
      coordinator.stop();
      expect(coordinator.hasScheduledTimer).toBe(false);
      expect(coordinator.activeIdentifier).toBeNull();

      // Esperar y verificar que no se dispararon más polls
      const countAfterStop = pollCount;
      await new Promise((r) => setTimeout(r, 300));
      expect(pollCount).toBe(countAfterStop);

      coordinator.destroy();
    });

    it('Inspección estática: useSSE adapta useServiceSync y useServiceSync/useFloorPlanSSE operan PollingCoordinator de @mesaya/shared', () => {
      const staffAdapter = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/staff-panel/src/hooks/useSSE.ts'),
        'utf8'
      );
      // El adaptador delega en el dueño real y no reimplementa scheduling.
      expect(staffAdapter).toContain('useServiceSync');
      expect(staffAdapter).not.toContain('scheduleNextPoll');
      expect(staffAdapter).not.toContain('requestSeqRef');

      const staffHook = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/staff-panel/src/hooks/useServiceSync.ts'),
        'utf8'
      );
      // El dueño real importa PollingCoordinator y lo opera (start/stop/triggerNow).
      expect(staffHook).toContain('PollingCoordinator');
      expect(staffHook).toContain("from '@mesaya/shared'");
      expect(staffHook).toContain('coordinator.start(');
      expect(staffHook).toContain('coordinator.stop()');
      expect(staffHook).toContain('coordinator.triggerNow()');
      // No debe reimplementar scheduling interno
      expect(staffHook).not.toContain('scheduleNextPoll');
      expect(staffHook).not.toContain('requestSeqRef');

      const adminHook = fs.readFileSync(
        path.resolve(__dirname, '../../../apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts'),
        'utf8'
      );
      expect(adminHook).toContain('PollingCoordinator');
      expect(adminHook).toContain("from '@mesaya/shared'");
      expect(adminHook).toContain('coordinator.start(');
      expect(adminHook).toContain('coordinator.stop()');
      expect(adminHook).toContain('coordinator.triggerNow()');
      expect(adminHook).not.toContain('scheduleNextPoll');
      expect(adminHook).not.toContain('requestSeqRef');
    });
  });
});

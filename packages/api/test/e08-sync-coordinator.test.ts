import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PollingCoordinator, ServiceWorkspaceDTO, CallStatus, TableFSMState } from '@mesaya/shared';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { StaffService } from '../src/services/staff.service';
import { CallService } from '../src/services/call.service';
import { CallOrigin, CallType, PaymentMethod } from '@mesaya/shared';

const ROOT = join(__dirname, '..', '..', '..');
const appSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/App.tsx'), 'utf8');
const wsSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');
const syncHookSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/hooks/useServiceSync.ts'), 'utf8');
const audioSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/lib/audio.ts'), 'utf8');

describe('E08 — Sincronización única y avisos permanentes (S10, S11, H07, D03)', () => {
  let app: FastifyInstance;
  const restaurantSlug = `rest-e08-${Date.now()}`;
  let restaurantId: string;
  let waiter: any;
  let waiterToken: string;
  let table1: any;
  let shift: any;
  let session1: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const restaurant = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E08 Sync',
        slug: restaurantSlug,
        themeColor: '#345678',
        templateId: 'MODERN_DARK'
      }
    });
    restaurantId = restaurant.id;

    waiter = await StaffService.createStaff(restaurantId, 'Mozo E08', '4321', 'WAITER');

    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug, pin: '4321' }
    });
    waiterToken = loginRes.json().token;

    shift = await prisma.shift.create({
      data: { restaurantId, activeKey: restaurantId }
    });

    table1 = await prisma.table.create({
      data: {
        restaurantId,
        label: 'Mesa 08',
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_NO_ORDER
      }
    });

    session1 = await prisma.tableSession.create({
      data: {
        tableId: table1.id,
        shiftId: shift.id,
        activeKey: table1.id,
        token: `session-e08-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });
  });

  afterAll(async () => {
    if (restaurantId) {
      await prisma.callRequest.deleteMany({ where: { tableSessionId: session1?.id } }).catch(() => undefined);
      await prisma.tableSession.deleteMany({ where: { tableId: table1?.id } }).catch(() => undefined);
      await prisma.table.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.shift.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.staffUser.deleteMany({ where: { restaurantId } }).catch(() => undefined);
      await prisma.rateLimitBucket.deleteMany({ where: { key: { contains: restaurantId } } }).catch(() => undefined);
      await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    }
    await app.close();
  });

  describe('1. Contratos estáticos y eliminación de verde falso (H07 / D03)', () => {
    it('App.tsx nunca usa activeTab para calcular o falsificar el estado conectado', () => {
      expect(appSrc).not.toMatch(/connected\s*=\s*activeTab/);
      expect(appSrc).not.toMatch(/activeTab\s*===\s*'service'\s*\|\|\s*connected/);
      // Debe usar useServiceSync
      expect(appSrc).toContain('useServiceSync');
    });

    it('ServiceWorkspace recibe syncSnapshot y no arranca ciclo duplicado', () => {
      expect(wsSrc).toContain('syncSnapshot?: ServiceWorkspaceDTO | null');
      expect(wsSrc).toContain('onRefresh?:');
      expect(wsSrc).toContain('if (syncSnapshot !== undefined)');
    });

    it('useServiceSync implementa reconexión en foco y online', () => {
      expect(syncHookSrc).toContain('visibilitychange');
      expect(syncHookSrc).toContain('triggerNow');
      expect(syncHookSrc).toContain('online');
      expect(syncHookSrc).toContain('playChimeAlert');
    });

    it('audio.ts provee desbloqueo y prueba de sonido con activación de usuario', () => {
      expect(audioSrc).toContain('unlockAudio');
      expect(audioSrc).toContain('playChimeAlert');
      expect(appSrc).toContain('Probar sonido');
    });
  });

  describe('2. Coordinador de sincronización HTTP puro y descarte fuera de orden (S11)', () => {
    it('gestiona respuestas normales y cancela ciclos limpios sin solapamiento', async () => {
      let receivedData: ServiceWorkspaceDTO | null = null;
      let connectionState = false;

      const coordinator = new PollingCoordinator<ServiceWorkspaceDTO>({
        fetchFn: async (id: string, signal: AbortSignal) => {
          const res = await app.inject({
            method: 'GET',
            url: `/v1/staff/restaurants/${id}/service-workspace`,
            headers: { authorization: `Bearer ${waiterToken}` }
          });
          if (res.statusCode !== 200) throw new Error('API Error');
          return res.json();
        },
        onData: (data) => { receivedData = data; },
        onConnectionChange: (conn) => { connectionState = conn; },
        intervalMs: 1000,
        maxBackoffMs: 5000,
        isHidden: () => false
      });

      coordinator.start(restaurantId);

      // Esperar primer tick
      await new Promise((r) => setTimeout(r, 200));

      expect(connectionState).toBe(true);
      expect(receivedData).toBeDefined();
      expect(receivedData?.restaurantId).toBe(restaurantId);
      expect(Array.isArray(receivedData?.tasks)).toBe(true);

      coordinator.stop();
      expect(coordinator.activeIdentifier).toBeNull();
    });

    it('descarta respuestas desfasadas cuando un request posterior termina antes (S11)', async () => {
      let deliverCount = 0;
      let lastDeliveredMarker = '';
      let resolveFirstFetch: ((val: any) => void) | null = null;
      let fetchCallCount = 0;

      const coordinator = new PollingCoordinator<any>({
        fetchFn: async (id: string, signal: AbortSignal) => {
          fetchCallCount++;
          if (fetchCallCount === 1) {
            // Primer request: queda suspendido hasta que el segundo termine
            return new Promise((resolve) => {
              resolveFirstFetch = () => resolve({ marker: 'first-stale' });
            });
          }
          // Segundo request: responde inmediatamente
          return { marker: 'second-fast' };
        },
        onData: (data) => {
          deliverCount++;
          lastDeliveredMarker = data.marker;
        },
        onConnectionChange: () => {},
        intervalMs: 5000,
        isHidden: () => false
      });

      // Iniciar el primer ciclo
      coordinator.start('test-target');
      await new Promise((r) => setTimeout(r, 50));
      expect(fetchCallCount).toBe(1);

      // Reiniciar o reconectar: cancela el ciclo previo y arranca uno nuevo
      coordinator.start('test-target');
      await new Promise((r) => setTimeout(r, 50));
      expect(fetchCallCount).toBe(2);

      // El segundo request entregó sus datos inmediatamente
      expect(lastDeliveredMarker).toBe('second-fast');
      expect(deliverCount).toBe(1);

      // Ahora resuelve el primer request (desfasado)
      if (resolveFirstFetch) (resolveFirstFetch as any)();
      await new Promise((r) => setTimeout(r, 50));

      // La respuesta tardía del primer fetch debe ser descartada sin alterar lastDeliveredMarker
      expect(lastDeliveredMarker).toBe('second-fast');
      expect(deliverCount).toBe(1);

      coordinator.destroy();
    });

    it('detiene el ciclo ante error de autenticación 401 sin bucles infinitos', async () => {
      let authErrorFired = false;
      let requestCount = 0;

      const coordinator = new PollingCoordinator<any>({
        fetchFn: async () => {
          requestCount++;
          const err: any = new Error('Unauthorized');
          err.statusCode = 401;
          throw err;
        },
        onData: () => {},
        onConnectionChange: () => {},
        onAuthError: () => {
          authErrorFired = true;
          coordinator.stop();
        },
        intervalMs: 100,
        maxBackoffMs: 500,
        isHidden: () => false
      });

      coordinator.start('auth-fail-target');
      await new Promise((r) => setTimeout(r, 350));

      expect(authErrorFired).toBe(true);
      // No debe haber hecho requests infinitos en bucle
      expect(requestCount).toBe(1);

      coordinator.destroy();
    });
  });

  describe('3. Detección deduplicada de llamados y avisos permanentes (S10)', () => {
    it('detecta nuevo llamado en salón y permite que el shell lo muestre en cualquier pestaña', async () => {
      // 1. Crear un llamado en Mesa 08
      const call = await CallService.createCall({
        sessionToken: session1.token,
        type: CallType.WAITER,
        paymentMethod: PaymentMethod.NOT_APPLICABLE,
        origin: CallOrigin.WEB_DIRECT,
        note: 'Llamado S10 desde tablet cliente'
      });

      // 2. Consultar workspace
      const wsRes = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurantId}/service-workspace`,
        headers: { authorization: `Bearer ${waiterToken}` }
      });

      expect(wsRes.statusCode).toBe(200);
      const ws = wsRes.json();
      expect(ws.summary.pendingCalls).toBeGreaterThanOrEqual(1);

      const callTask = ws.tasks.find((t: any) => t.targetId === call.id);
      expect(callTask).toBeDefined();
      expect(callTask.kind).toBe('CALL');
      expect(callTask.tableLabel).toBe('Mesa 08');

      // 3. Verificar que el banner permanente en App.tsx reacciona ante llamadas pendientes fuera de servicio
      expect(appSrc).toContain('activeTab !== \'service\'');
      expect(appSrc).toContain('unattendedCallsCount > 0');
      expect(appSrc).toContain('Abrir Atención →');
    });
  });
});

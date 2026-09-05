import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { prisma } from '../src/lib/prisma';
import { fsmService } from '../src/services/fsm.service';
import { SessionService } from '../src/services/session.service';
import { sessionRoutes } from '../src/routes/sessions.routes';
import { TableFSMState, SignalSource } from '@mesaya/shared';
import { randomUUID } from 'crypto';

describe('Etapa 12 — Ciclo de vida de QR estable y sesiones operativas', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let table1: any;
  let table2: any;
  let shift: any;

  beforeAll(async () => {
    restaurant = await prisma.restaurant.create({
      data: {
        name: 'Trattoria QR Test',
        slug: `qr-test-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b'
      }
    });

    table1 = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa 101',
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4,
        posX: 10,
        posY: 10,
        shape: 'RECT'
      }
    });

    table2 = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa 102',
        sector: 'TERRAZA',
        currentState: TableFSMState.AVAILABLE,
        capacity: 2,
        posX: 50,
        posY: 50,
        shape: 'ROUND'
      }
    });

    app = Fastify();
    await app.register(sessionRoutes);
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  describe('1. Consultas de QR desconocido y de mesa inactiva (Idempotencia y Cero Mutaciones)', () => {
    it('Consultar QR con restaurante desconocido devuelve 404 y NO crea restaurantes, mesas, turnos ni sesiones', async () => {
      const countsBefore = {
        restaurants: await prisma.restaurant.count(),
        tables: await prisma.table.count(),
        shifts: await prisma.shift.count(),
        sessions: await prisma.tableSession.count()
      };

      const res = await app.inject({
        method: 'GET',
        url: `/sessions/restaurante-inexistente-xyz/Mesa%201`
      });

      expect(res.statusCode).toBe(404);
      const data = res.json();
      expect(data.valid).toBe(false);

      const countsAfter = {
        restaurants: await prisma.restaurant.count(),
        tables: await prisma.table.count(),
        shifts: await prisma.shift.count(),
        sessions: await prisma.tableSession.count()
      };

      expect(countsAfter).toEqual(countsBefore);
    });

    it('Consultar QR con mesa desconocida en restaurante válido devuelve 404 y NO crea nada', async () => {
      const countsBefore = {
        restaurants: await prisma.restaurant.count(),
        tables: await prisma.table.count(),
        shifts: await prisma.shift.count(),
        sessions: await prisma.tableSession.count()
      };

      const res = await app.inject({
        method: 'GET',
        url: `/sessions/${restaurant.slug}/Mesa%20Fantasma%20999`
      });

      expect(res.statusCode).toBe(404);
      const data = res.json();
      expect(data.valid).toBe(false);

      const countsAfter = {
        restaurants: await prisma.restaurant.count(),
        tables: await prisma.table.count(),
        shifts: await prisma.shift.count(),
        sessions: await prisma.tableSession.count()
      };

      expect(countsAfter).toEqual(countsBefore);
    });

    it('Consultar QR de mesa existente sin sesión activa devuelve 200 con valid: false, isActive: false, sin token y sin alterar la base', async () => {
      const countsBefore = {
        restaurants: await prisma.restaurant.count(),
        tables: await prisma.table.count(),
        shifts: await prisma.shift.count(),
        sessions: await prisma.tableSession.count()
      };

      const res = await app.inject({
        method: 'GET',
        url: `/sessions/${restaurant.slug}/${encodeURIComponent(table1.label)}`
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(false);
      expect(data.isActive).toBe(false);
      expect(data.token).toBeUndefined();
      expect(data.table).toBeDefined();
      expect(data.table.id).toBe(table1.id);
      expect(data.restaurant).toBeDefined();
      expect(data.restaurant.slug).toBe(restaurant.slug);

      const countsAfter = {
        restaurants: await prisma.restaurant.count(),
        tables: await prisma.table.count(),
        shifts: await prisma.shift.count(),
        sessions: await prisma.tableSession.count()
      };

      expect(countsAfter).toEqual(countsBefore);
    });
  });

  describe('2. Atajos deshabilitados (demo-token / latest / null / undefined)', () => {
    it.each(['demo-token', 'latest', 'null', 'undefined'])(
      'GET /sessions/%s devuelve 404 y valid: false sin crear registros',
      async (fakeToken) => {
        const countsBefore = {
          shifts: await prisma.shift.count(),
          sessions: await prisma.tableSession.count()
        };

        const res = await app.inject({
          method: 'GET',
          url: `/sessions/${fakeToken}`
        });

        expect(res.statusCode).toBe(404);
        const data = res.json();
        expect(data.valid).toBe(false);

        const countsAfter = {
          shifts: await prisma.shift.count(),
          sessions: await prisma.tableSession.count()
        };

        expect(countsAfter).toEqual(countsBefore);
      }
    );
  });

  describe('3. Validación centralizada de sesión operativa y revocación', () => {
    let sessionToken1: string;

    beforeAll(async () => {
      // Abrir turno para el restaurante
      shift = await prisma.shift.create({
        data: {
          restaurantId: restaurant.id,
          openedAt: new Date()
        }
      });
    });

    it('Cuando la mesa es ocupada por el personal (FSM), se crea una sesión operativa activa', async () => {
      await fsmService.attemptTransition({
        tableId: table1.id,
        toState: TableFSMState.OCCUPIED_NO_ORDER,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Mozo sentó comensales'
      });

      // Consultar el QR estable ahora resuelve la sesión activa con token
      const res = await app.inject({
        method: 'GET',
        url: `/sessions/${restaurant.slug}/${encodeURIComponent(table1.label)}`
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(true);
      expect(data.isActive).toBe(true);
      expect(data.token).toBeDefined();
      expect(typeof data.token).toBe('string');
      expect(data.table.id).toBe(table1.id);

      sessionToken1 = data.token;

      // Validar vía GET /sessions/:token
      const tokenRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionToken1}`
      });
      expect(tokenRes.statusCode).toBe(200);
      const tokenData = tokenRes.json();
      expect(tokenData.valid).toBe(true);
      expect(tokenData.isActive).toBe(true);
      expect(tokenData.token).toBe(sessionToken1);
    });

    it('Al cambiar ocupación a TO_CLEAN o AVAILABLE, la sesión anterior es revocada inmediatamente', async () => {
      // Mesa avanza en el ciclo FSM hasta limpiarse
      await fsmService.attemptTransition({
        tableId: table1.id,
        toState: TableFSMState.TO_CLEAN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Comensales se retiraron'
      });

      // El token anterior ahora retorna isClosed: true y valid: false
      const checkRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionToken1}`
      });
      expect(checkRes.statusCode).toBe(200);
      const checkData = checkRes.json();
      expect(checkData.valid).toBe(false);
      expect(checkData.isClosed).toBe(true);

      // Pasar a AVAILABLE
      await fsmService.attemptTransition({
        tableId: table1.id,
        toState: TableFSMState.AVAILABLE,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Mesa desinfectada y lista'
      });

      // El QR físico vuelve a devolver estado inactivo sin token
      const qrRes = await app.inject({
        method: 'GET',
        url: `/sessions/${restaurant.slug}/${encodeURIComponent(table1.label)}`
      });
      expect(qrRes.statusCode).toBe(200);
      const qrData = qrRes.json();
      expect(qrData.valid).toBe(false);
      expect(qrData.isActive).toBe(false);
      expect(qrData.token).toBeUndefined();
    });

    it('Al reabrir la mesa para nuevos comensales, se emite un nuevo token y el token anterior NO vuelve a servir', async () => {
      // Reabrir mesa
      await fsmService.attemptTransition({
        tableId: table1.id,
        toState: TableFSMState.OCCUPIED_NO_ORDER,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Nueva familia se sentó en la mesa'
      });

      // El QR devuelve un NUEVO token de sesión
      const res = await app.inject({
        method: 'GET',
        url: `/sessions/${restaurant.slug}/${encodeURIComponent(table1.label)}`
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(true);
      expect(data.isActive).toBe(true);
      expect(data.token).toBeDefined();
      expect(data.token).not.toBe(sessionToken1);

      const sessionToken2 = data.token;

      // El token nuevo funciona correctamente
      const newRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionToken2}`
      });
      expect(newRes.statusCode).toBe(200);
      expect(newRes.json().valid).toBe(true);

      // CRÍTICO: El token de la ocupación anterior sigue inválido / cerrado
      const oldRes = await app.inject({
        method: 'GET',
        url: `/sessions/${sessionToken1}`
      });
      expect(oldRes.statusCode).toBe(200);
      const oldData = oldRes.json();
      expect(oldData.valid).toBe(false);
      expect(oldData.isClosed).toBe(true);
    });

    it('Sesión expirada devuelve valid: false e isExpired: true', async () => {
      const past = new Date(Date.now() - 3600000);
      const expiredSession = await prisma.tableSession.create({
        data: {
          tableId: table2.id,
          shiftId: shift.id,
          token: randomUUID(),
          expiresAt: past,
          createdAt: new Date(Date.now() - 7200000)
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: `/sessions/${expiredSession.token}`
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(false);
      expect(data.isExpired).toBe(true);
    });

    it('Cierre de turno del restaurante invalida todas las sesiones asociadas', async () => {
      // Cerrar el turno del restaurante
      await prisma.shift.update({
        where: { id: shift.id },
        data: { closedAt: new Date() }
      });

      // Consultar QR estable cuando el turno está cerrado: mesa inactiva
      const qrRes = await app.inject({
        method: 'GET',
        url: `/sessions/${restaurant.slug}/${encodeURIComponent(table1.label)}`
      });
      expect(qrRes.statusCode).toBe(200);
      const qrData = qrRes.json();
      expect(qrData.valid).toBe(false);
      expect(qrData.isActive).toBe(false);
      expect(qrData.token).toBeUndefined();
    });
  });

  describe('4. Protección de ruta legacy y conservación de sesiones ante fallo de turno', () => {
    let restAlpha: any;
    let restBeta: any;
    let tableAlpha: any;
    let tableBeta: any;
    let shiftAlpha: any;
    let tokenAlpha: string;
    let tokenBeta: string;

    beforeAll(async () => {
      // Crear dos restaurantes con mesas con la misma etiqueta para verificar aislamiento tenant
      restAlpha = await prisma.restaurant.create({
        data: {
          name: 'Restaurante Alpha',
          slug: `rest-alpha-${Date.now()}`,
          templateId: 'GOURMET_OBSIDIAN'
        }
      });

      restBeta = await prisma.restaurant.create({
        data: {
          name: 'Restaurante Beta',
          slug: `rest-beta-${Date.now()}`,
          templateId: 'COASTAL_BEACH'
        }
      });

      tableAlpha = await prisma.table.create({
        data: {
          restaurantId: restAlpha.id,
          label: 'Mesa Compartida 5',
          sector: 'SALON_PRINCIPAL'
        }
      });

      tableBeta = await prisma.table.create({
        data: {
          restaurantId: restBeta.id,
          label: 'Mesa Compartida 5',
          sector: 'TERRAZA'
        }
      });

      shiftAlpha = await prisma.shift.create({
        data: {
          restaurantId: restAlpha.id,
          openedAt: new Date()
        }
      });

      const shiftBeta = await prisma.shift.create({
        data: {
          restaurantId: restBeta.id,
          openedAt: new Date()
        }
      });

      tokenAlpha = randomUUID();
      tokenBeta = randomUUID();

      await prisma.tableSession.create({
        data: {
          tableId: tableAlpha.id,
          shiftId: shiftAlpha.id,
          token: tokenAlpha,
          expiresAt: new Date(Date.now() + 7200000)
        }
      });

      await prisma.tableSession.create({
        data: {
          tableId: tableBeta.id,
          shiftId: shiftBeta.id,
          token: tokenBeta,
          expiresAt: new Date(Date.now() + 7200000)
        }
      });
    });

    it('La ruta legacy GET /sessions/table/:label está bloqueada por defecto (403) y NO revela tokens activos de ningún restaurante', async () => {
      // Sin flag de test de rutas legacy
      delete process.env.ALLOW_LEGACY_DEMO_ROUTES;

      const res = await app.inject({
        method: 'GET',
        url: `/sessions/table/${encodeURIComponent('Mesa Compartida 5')}`
      });

      expect(res.statusCode).toBe(403);
      const data = res.json();
      expect(data.error).toBe('FORBIDDEN_LEGACY_ROUTE');
      expect(data.valid).toBe(false);
      expect(data.token).toBeUndefined();
      // Verificación estricta: la respuesta jamás revela tokenAlpha ni tokenBeta
      const rawText = res.body;
      expect(rawText.includes(tokenAlpha)).toBe(false);
      expect(rawText.includes(tokenBeta)).toBe(false);
    });

    it('Incluso si se habilita ALLOW_LEGACY_DEMO_ROUTES en tests, la ruta legacy jamás resuelve ni expone tokens operativos de sesión', async () => {
      process.env.ALLOW_LEGACY_DEMO_ROUTES = 'true';
      try {
        const res = await app.inject({
          method: 'GET',
          url: `/sessions/table/${encodeURIComponent('Mesa Compartida 5')}`
        });

        expect(res.statusCode).toBe(200);
        const data = res.json();
        expect(data.valid).toBe(false);
        expect(data.isActive).toBe(false);
        expect(data.token).toBeUndefined();
        // Cero revelación de credenciales operativas
        expect(res.body.includes(tokenAlpha)).toBe(false);
        expect(res.body.includes(tokenBeta)).toBe(false);
      } finally {
        delete process.env.ALLOW_LEGACY_DEMO_ROUTES;
      }
    });

    it('SessionService.createNewSessionForTable sin turno abierto falla con 400 y conserva 100% INTACTA una sesión preexistente', async () => {
      // Cerrar el turno de restAlpha
      await prisma.shift.update({
        where: { id: shiftAlpha.id },
        data: { closedAt: new Date() }
      });

      // tableAlpha ya tiene una sesión con tokenAlpha que tiene closedAt: null
      const sessionBefore = await prisma.tableSession.findUnique({
        where: { token: tokenAlpha }
      });
      expect(sessionBefore).toBeDefined();
      expect(sessionBefore?.closedAt).toBeNull();

      const sessionCountBefore = await prisma.tableSession.count({
        where: { tableId: tableAlpha.id }
      });

      // Intentar crear nueva sesión cuando el turno está cerrado debe lanzar error 400
      let errorThrown: any = null;
      try {
        await SessionService.createNewSessionForTable(tableAlpha.id);
      } catch (err: any) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect(errorThrown.statusCode).toBe(400);
      expect(errorThrown.message).toContain('No hay un turno de servicio abierto');

      // CRÍTICO: La sesión preexistente NO fue cerrada por el fallo
      const sessionAfter = await prisma.tableSession.findUnique({
        where: { token: tokenAlpha }
      });
      expect(sessionAfter?.closedAt).toBeNull();

      // Ninguna sesión nueva fue creada ni eliminada
      const sessionCountAfter = await prisma.tableSession.count({
        where: { tableId: tableAlpha.id }
      });
      expect(sessionCountAfter).toBe(sessionCountBefore);
    });
  });
});

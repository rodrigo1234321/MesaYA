import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallType, PaymentMethod, CallStatus, TableFSMState, SignalSource } from '@mesaya/shared';
import { FSMService } from '../src/services/fsm.service';
import { randomUUID } from 'crypto';

describe('Etapa 13 — Validación de llamados, feedback y lecturas privadas', () => {
  let app: FastifyInstance;

  // Tenant A: Trattoria Alpha
  let restA: any;
  let shiftA: any;
  let tableA1: any;
  let sessionA1: any;
  let staffA: any;
  let tokenStaffA: string;

  // Tenant B: Trattoria Beta
  let restB: any;
  let shiftB: any;
  let tableB1: any;
  let sessionB1: any;
  let staffB: any;
  let tokenStaffB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // 1. Crear Restaurante A
    restA = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Alpha (Tenant A)',
        slug: `rest-alpha-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#3b82f6',
        latitude: -38.005,
        longitude: -57.545,
        radiusMeters: 200
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
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
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

    staffA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Alpha',
        pinHash: await bcrypt.hash('1111', 10),
        role: 'WAITER'
      }
    });

    // 2. Crear Restaurante B
    restB = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Beta (Tenant B)',
        slug: `rest-beta-${Date.now()}`,
        templateId: 'COASTAL_BEACH',
        themeColor: '#10b981',
        latitude: -38.010,
        longitude: -57.550,
        radiusMeters: 200
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
        sector: 'TERRAZA',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
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

    staffB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo Beta',
        pinHash: await bcrypt.hash('2222', 10),
        role: 'WAITER'
      }
    });

    // Login staff para obtener JWTs
    const loginResA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '1111' }
    });
    expect(loginResA.statusCode).toBe(200);
    tokenStaffA = loginResA.json().token;

    const loginResB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '2222' }
    });
    expect(loginResB.statusCode).toBe(200);
    tokenStaffB = loginResB.json().token;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  // ─────────────────────────────────────────────────────────────
  // 1. VALIDACIÓN DE SESIÓN ACTIVA PARA ACCIONES DE INVITADO (POST /v1/calls)
  // ─────────────────────────────────────────────────────────────
  describe('1. Validación de sesión activa para creación de llamados', () => {
    it('Rechaza llamado con sessionToken inexistente o inválido (404)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: randomUUID(),
          type: CallType.WAITER
        }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('no encontrada');
    });

    it('Rechaza llamado cuando la sesión ya fue cerrada (closedAt !== null) (410)', async () => {
      const closedSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
          closedAt: new Date(Date.now() - 60000)
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: closedSession.token,
          type: CallType.WAITER
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_CLOSED');
    });

    it('Rechaza llamado cuando la sesión ha expirado (now > expiresAt) (410)', async () => {
      const expiredSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() - 3600000)
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: expiredSession.token,
          type: CallType.WAITER
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_EXPIRED');
    });

    it('Rechaza llamado si el turno del restaurante está cerrado (410)', async () => {
      const restClosedShift = await prisma.restaurant.create({
        data: { name: 'Restaurante Turno Cerrado', slug: `closed-shift-${Date.now()}` }
      });
      const closedShift = await prisma.shift.create({
        data: { restaurantId: restClosedShift.id, closedAt: new Date() }
      });
      const tableClosed = await prisma.table.create({
        data: { restaurantId: restClosedShift.id, label: 'Mesa C1' }
      });
      const sessionWithClosedShift = await prisma.tableSession.create({
        data: {
          tableId: tableClosed.id,
          shiftId: closedShift.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000)
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionWithClosedShift.token,
          type: CallType.WAITER
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SHIFT_CLOSED');
    });

    it('Permite llamado legítimo con sesión activa (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionA1.token,
          type: CallType.WAITER,
          note: 'Por favor traer hielo'
        }
      });
      expect(res.statusCode).toBe(201);
      const call = res.json();
      expect(call.id).toBeDefined();
      expect(call.status).toBe(CallStatus.PENDING);
      expect(call.type).toBe(CallType.WAITER);
    });

    it('Rechaza llamado duplicado concurrente sobre la misma mesa (429)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionA1.token,
          type: CallType.WAITER
        }
      });
      expect(res.statusCode).toBe(429);
      expect(res.json().code).toBe('ACTIVE_CALL_LIMIT');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 2. VALIDACIÓN DE ENUMS, TAMAÑOS Y CAMPOS REQUERIDOS
  // ─────────────────────────────────────────────────────────────
  describe('2. Validación de enums, tamaños y parámetros', () => {
    let freshSession: any;

    beforeAll(async () => {
      const tableA2 = await prisma.table.create({
        data: { restaurantId: restA.id, label: 'Mesa A-2' }
      });
      freshSession = await prisma.tableSession.create({
        data: {
          tableId: tableA2.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000)
        }
      });
    });

    it('Rechaza tipo de llamado no reconocido en el enum (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: freshSession.token,
          type: 'SUPER_URGENTE_INVALIDO'
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBeDefined();
    });

    it('Rechaza pedido de cuenta (BILL) sin seleccionar medio de pago (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: freshSession.token,
          type: CallType.BILL,
          paymentMethod: PaymentMethod.NOT_APPLICABLE
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('PAYMENT_METHOD_REQUIRED');
    });

    it('Rechaza medio de pago inexistente en el enum (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: freshSession.token,
          type: CallType.BILL,
          paymentMethod: 'ORO_EN_POLVO'
        }
      });
      expect(res.statusCode).toBe(400);
    });

    it('Rechaza nota de comensal que exceda 500 caracteres (400)', async () => {
      const longNote = 'A'.repeat(501);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: freshSession.token,
          type: CallType.WAITER,
          note: longNote
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('500 caracteres');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 3. CANCELACIÓN DE LLAMADOS POR EL COMENSAL
  // ─────────────────────────────────────────────────────────────
  describe('3. Cancelación de llamados y propiedad de sesión', () => {
    let callToCancel: any;

    beforeAll(async () => {
      // Obtener el llamado activo creado en la sección 1 para sessionA1
      callToCancel = await prisma.callRequest.findFirst({
        where: { tableSessionId: sessionA1.id, status: CallStatus.PENDING }
      });
      expect(callToCancel).toBeDefined();
    });

    it('Imposibilita cancelar el llamado usando el token de OTRA sesión (404)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/calls/${callToCancel.id}/cancel`,
        payload: { sessionToken: sessionB1.token } // Token de tenant B!
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('Llamado no encontrado para esta sesión');

      // Comprobar que el llamado sigue en PENDING intacto
      const check = await prisma.callRequest.findUnique({ where: { id: callToCancel.id } });
      expect(check?.status).toBe(CallStatus.PENDING);
    });

    it('Permite cancelar legítimamente el llamado con su sessionToken propietario (200)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/calls/${callToCancel.id}/cancel`,
        payload: { sessionToken: sessionA1.token }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      const check = await prisma.callRequest.findUnique({ where: { id: callToCancel.id } });
      expect(check?.status).toBe(CallStatus.CANCELLED);
    });

    it('Cancelar un llamado ya cancelado responde de forma idempotente (200)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/calls/${callToCancel.id}/cancel`,
        payload: { sessionToken: sessionA1.token }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain('ya había sido cancelado');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 4. AISLAMIENTO TENANT Y ROL EN LECTURAS Y GESTIÓN DE STAFF
  // ─────────────────────────────────────────────────────────────
  describe('4. Aislamiento tenant y rol de staff en llamadas', () => {
    let callBeta: any;

    beforeAll(async () => {
      // Crear un llamado en Tenant B
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionB1.token,
          type: CallType.WAITER,
          note: 'Mesa B solicitando atención'
        }
      });
      expect(res.statusCode).toBe(201);
      callBeta = res.json();
    });

    it('GET /v1/calls sin JWT de staff devuelve 401 Unauthorized', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restA.id}`
      });
      expect(res.statusCode).toBe(401);
    });

    it('Staff de Restaurante A NO puede leer llamados de Restaurante B (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restB.id}`,
        headers: { Authorization: `Bearer ${tokenStaffA}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('otro restaurante');
    });

    it('Staff de Restaurante B lee únicamente los llamados de su restaurante (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/calls?restaurantId=${restB.id}`,
        headers: { Authorization: `Bearer ${tokenStaffB}` }
      });
      expect(res.statusCode).toBe(200);
      const calls = res.json();
      expect(Array.isArray(calls)).toBe(true);
      expect(calls.some((c: any) => c.id === callBeta.id)).toBe(true);
    });

    it('Staff de Restaurante A NO puede modificar o atender llamados de Restaurante B (403 Forbidden)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${callBeta.id}`,
        headers: { Authorization: `Bearer ${tokenStaffA}` },
        payload: { status: CallStatus.IN_PROGRESS }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('otro restaurante');

      // Verificar que el estado del llamado en DB no cambió
      const check = await prisma.callRequest.findUnique({ where: { id: callBeta.id } });
      expect(check?.status).toBe(CallStatus.PENDING);
    });

    it('Staff de Restaurante B atiende su propio llamado (200) e ignora actor inyectado en body', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${callBeta.id}`,
        headers: { Authorization: `Bearer ${tokenStaffB}` },
        payload: {
          status: CallStatus.IN_PROGRESS,
          staffUserId: 'hacker-impostor-id' // Atacante intenta falsear el actor
        }
      });
      expect(res.statusCode).toBe(200);
      const updated = res.json();
      expect(updated.status).toBe(CallStatus.IN_PROGRESS);

      // El llamado no contiene datos personales ni credenciales
      expect(updated.staffUserId).toBeUndefined();
    });

    it('No se puede resucitar un llamado cancelado o resuelto (409 Conflict)', async () => {
      // Resolver primero
      const resolveRes = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${callBeta.id}`,
        headers: { Authorization: `Bearer ${tokenStaffB}` },
        payload: { status: CallStatus.RESOLVED }
      });
      expect(resolveRes.statusCode).toBe(200);

      // Intentar volver a IN_PROGRESS
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/calls/${callBeta.id}`,
        headers: { Authorization: `Bearer ${tokenStaffB}` },
        payload: { status: CallStatus.IN_PROGRESS }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('CALL_ALREADY_RESOLVED');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 5. FEEDBACK PRIVADO, DEDUPLICACIÓN Y TOKENS VENCIDOS
  // ─────────────────────────────────────────────────────────────
  describe('5. Feedback privado y protección contra duplicados y sesiones cerradas', () => {
    it('Rechaza feedback sobre sesión inexistente (404) y NUNCA devuelve éxito', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: randomUUID(),
          rating: 5,
          comment: 'Todo excelente'
        }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('SESSION_NOT_FOUND');
    });

    it('Rechaza feedback sobre sesión cerrada recientemente (hace segundos) con 410 SESSION_CLOSED y cero filas creadas', async () => {
      const closedRecentSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
          closedAt: new Date(Date.now() - 5000) // Cerrada hace 5 segundos
        }
      });

      const countBefore = await prisma.feedback.count({
        where: { tableSessionId: closedRecentSession.id }
      });
      expect(countBefore).toBe(0);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: closedRecentSession.token,
          rating: 5,
          comment: 'Intento de feedback tras cierre inmediato'
        }
      });
      expect(res.statusCode).toBe(410);
      const data = res.json();
      expect(data.code).toBe('SESSION_CLOSED');

      const countAfter = await prisma.feedback.count({
        where: { tableSessionId: closedRecentSession.id }
      });
      expect(countAfter).toBe(0); // Cero filas nuevas de feedback
    });

    it('Rechaza feedback sobre sesión con token expirado con 410 SESSION_EXPIRED y cero filas creadas', async () => {
      const expiredSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() - 60000), // Expiró hace 1 minuto
          closedAt: null
        }
      });

      const countBefore = await prisma.feedback.count({
        where: { tableSessionId: expiredSession.id }
      });
      expect(countBefore).toBe(0);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: expiredSession.token,
          rating: 4,
          comment: 'Intento de feedback con sesión expirada'
        }
      });
      expect(res.statusCode).toBe(410);
      const data = res.json();
      expect(data.code).toBe('SESSION_EXPIRED');

      const countAfter = await prisma.feedback.count({
        where: { tableSessionId: expiredSession.id }
      });
      expect(countAfter).toBe(0);
    });

    it('Rechaza feedback con sesión cerrada antigua o token viejo (410)', async () => {
      const closedOldSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
          closedAt: new Date(Date.now() - 2 * 3600000) // Cerrada hace 2 horas
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: closedOldSession.token,
          rating: 4
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_CLOSED');
    });

    it('Rechaza feedback con token viejo cuando la mesa ya fue reocupada por nuevos comensales (410)', async () => {
      const tableOld = await prisma.table.create({
        data: { restaurantId: restA.id, label: 'Mesa Reocupada' }
      });

      // Sesión 1 (cliente anterior)
      const pastSession = await prisma.tableSession.create({
        data: {
          tableId: tableOld.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
          closedAt: new Date(),
          createdAt: new Date(Date.now() - 60000)
        }
      });

      // Sesión 2 (nuevos comensales ocupan la mesa)
      await prisma.tableSession.create({
        data: {
          tableId: tableOld.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000),
          createdAt: new Date()
        }
      });

      // Cliente anterior intenta dejar feedback con su token viejo
      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: pastSession.token,
          rating: 5
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_CLOSED');
    });

    it('Rechaza calificaciones no válidas (números menores a 1, mayores a 5 o no enteros) (400)', async () => {
      for (const invalidRating of [0, 6, 3.5, -1]) {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/feedback',
          payload: {
            sessionToken: sessionA1.token,
            rating: invalidRating
          }
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('INVALID_RATING');
      }
    });

    it('Rechaza comentario que exceda 1000 caracteres (400)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: sessionA1.token,
          rating: 5,
          comment: 'B'.repeat(1001)
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('COMMENT_TOO_LONG');
    });

    it('Acepta feedback válido con sesión activa y minimiza datos personales (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: sessionA1.token,
          rating: 5,
          comment: 'Excelente comida y atención de Mozo Alpha'
        }
      });
      expect(res.statusCode).toBe(201);
      const fb = res.json();
      expect(fb.id).toBeDefined();
      expect(fb.rating).toBe(5);
      expect(fb.comment).toBe('Excelente comida y atención de Mozo Alpha');
      // No debe exponer token ni datos del comensal
      expect(fb.sessionToken).toBeUndefined();
      expect(fb.tableSessionId).toBeUndefined();
    });

    it('Reintento normal NO duplica feedback y devuelve 409 Conflict', async () => {
      const countBefore = await prisma.feedback.count({
        where: { tableSession: { token: sessionA1.token } }
      });
      expect(countBefore).toBe(1);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: sessionA1.token,
          rating: 5,
          comment: 'Excelente comida y atención de Mozo Alpha (reintento)'
        }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('FEEDBACK_ALREADY_EXISTS');

      const countAfter = await prisma.feedback.count({
        where: { tableSession: { token: sessionA1.token } }
      });
      expect(countAfter).toBe(1); // Exactamente 1 fila, cero duplicación
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 6. GEOLOCALIZACIÓN: TELEMETRÍA CONTEXTUAL NO AUTORIZANTE
  // ─────────────────────────────────────────────────────────────
  describe('6. Geofence como señal no autorizante y funcionamiento sin GPS', () => {
    let sessionGPS: any;

    beforeAll(async () => {
      const tableGPS = await prisma.table.create({
        data: { restaurantId: restA.id, label: 'Mesa GPS' }
      });
      sessionGPS = await prisma.tableSession.create({
        data: {
          tableId: tableGPS.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 3600000)
        }
      });
    });

    it('Preserva funcionamiento sin permiso GPS (coordenadas omitidas) (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionGPS.token,
          type: CallType.WAITER
          // Sin latitude ni longitude
        }
      });
      expect(res.statusCode).toBe(201);
      const call = res.json();
      expect(call.id).toBeDefined();

      // Cancelar para siguientes tests
      await app.inject({
        method: 'POST',
        url: `/v1/calls/${call.id}/cancel`,
        payload: { sessionToken: sessionGPS.token }
      });
    });

    it('Permite llamado con coordenadas GPS dentro del radio del restaurante (201)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionGPS.token,
          type: CallType.WAITER,
          latitude: -38.0051,
          longitude: -57.5451
        }
      });
      expect(res.statusCode).toBe(201);

      // Cancelar para siguiente test
      const call = res.json();
      await app.inject({
        method: 'POST',
        url: `/v1/calls/${call.id}/cancel`,
        payload: { sessionToken: sessionGPS.token }
      });
    });

    it('Rechaza con 403 GEOFENCE_EXCEEDED cuando el GPS reporta distancia remota excesiva (> 2 km)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionGPS.token,
          type: CallType.WAITER,
          latitude: -34.6037, // Buenos Aires (~400km de Mar del Plata)
          longitude: -58.3816
        }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('GEOFENCE_EXCEEDED');
    });

    it('Coordenadas GPS legítimas NUNCA autorizan una sesión vencida (410)', async () => {
      const expiredSession = await prisma.tableSession.create({
        data: {
          tableId: sessionGPS.tableId,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() - 3600000)
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: expiredSession.token,
          type: CallType.WAITER,
          latitude: -38.005,
          longitude: -57.545
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_EXPIRED');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // 7. REVOCACIÓN INMEDIATA POR TRANSICIÓN FSM A TO_CLEAN Y AVAILABLE
  // ─────────────────────────────────────────────────────────────
  describe('7. Revocación inmediata por transición FSM a TO_CLEAN y comprobación de QR', () => {
    let tableFsmTest: any;
    let sessionFsmTest: any;
    let fsmService: FSMService;

    beforeAll(async () => {
      fsmService = new FSMService();
      tableFsmTest = await prisma.table.create({
        data: {
          restaurantId: restA.id,
          label: `Mesa FSM Clean ${Date.now()}`,
          sector: 'SALON',
          currentState: TableFSMState.OCCUPIED_NO_ORDER
        }
      });

      sessionFsmTest = await prisma.tableSession.create({
        data: {
          tableId: tableFsmTest.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 4 * 3600000)
        }
      });
    });

    it('Transicionar a TO_CLEAN revoca inmediatamente la TableSession activa con closedAt !== null', async () => {
      // 1. Verificar que la sesión está activa inicialmente
      const sessionBefore = await prisma.tableSession.findUnique({
        where: { token: sessionFsmTest.token }
      });
      expect(sessionBefore?.closedAt).toBeNull();

      // 2. Transicionar mesa a TO_CLEAN
      const transitionResult = await fsmService.attemptTransition({
        tableId: tableFsmTest.id,
        toState: TableFSMState.TO_CLEAN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Comensales se retiraron'
      });
      expect(transitionResult.success).toBe(true);

      // 3. Verificar que closedAt fue persistido de inmediato en la base de datos
      const sessionAfter = await prisma.tableSession.findUnique({
        where: { token: sessionFsmTest.token }
      });
      expect(sessionAfter?.closedAt).not.toBeNull();
    });

    it('Después de TO_CLEAN, POST /v1/calls con el token anterior responde 410 y no crea filas en base de datos', async () => {
      const countCallsBefore = await prisma.callRequest.count({
        where: { tableSessionId: sessionFsmTest.id }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionFsmTest.token,
          type: CallType.WAITER,
          note: 'Intento de llamado post-cierre'
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_CLOSED');

      const countCallsAfter = await prisma.callRequest.count({
        where: { tableSessionId: sessionFsmTest.id }
      });
      expect(countCallsAfter).toBe(countCallsBefore);
    });

    it('Después de TO_CLEAN, POST /v1/feedback con el token anterior responde 410 y no crea filas en base de datos', async () => {
      const countFbBefore = await prisma.feedback.count({
        where: { tableSessionId: sessionFsmTest.id }
      });
      expect(countFbBefore).toBe(0);

      const res = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: sessionFsmTest.token,
          rating: 5,
          comment: 'Intento de feedback tras pasar a TO_CLEAN'
        }
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_CLOSED');

      const countFbAfter = await prisma.feedback.count({
        where: { tableSessionId: sessionFsmTest.id }
      });
      expect(countFbAfter).toBe(0);
    });

    it('Después de TO_CLEAN, la consulta canónica de QR físico responde estado inactivo sin token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${restA.slug}/${encodeURIComponent(tableFsmTest.label)}`
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.valid).toBe(false);
      expect(data.isActive).toBe(false);
      expect(data.token).toBeUndefined();
    });

    it('Transición posterior a AVAILABLE es idempotente: closedAt permanece cerrado y QR inactivo', async () => {
      const sessionBefore = await prisma.tableSession.findUnique({
        where: { token: sessionFsmTest.token }
      });
      const closedAtInitial = sessionBefore?.closedAt;

      const transitionResult = await fsmService.attemptTransition({
        tableId: tableFsmTest.id,
        toState: TableFSMState.AVAILABLE,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Mesa sanitizada'
      });
      expect(transitionResult.success).toBe(true);

      const sessionAfter = await prisma.tableSession.findUnique({
        where: { token: sessionFsmTest.token }
      });
      expect(sessionAfter?.closedAt).toEqual(closedAtInitial);

      // Reintentar llamado sigue dando 410
      const resCall = await app.inject({
        method: 'POST',
        url: '/v1/calls',
        payload: {
          sessionToken: sessionFsmTest.token,
          type: CallType.WAITER
        }
      });
      expect(resCall.statusCode).toBe(410);
      expect(resCall.json().code).toBe('SESSION_CLOSED');

      // Reintentar feedback sigue dando 410
      const resFb = await app.inject({
        method: 'POST',
        url: '/v1/feedback',
        payload: {
          sessionToken: sessionFsmTest.token,
          rating: 4
        }
      });
      expect(resFb.statusCode).toBe(410);
      expect(resFb.json().code).toBe('SESSION_CLOSED');

      // QR sigue inactivo
      const resQr = await app.inject({
        method: 'GET',
        url: `/v1/sessions/${restA.slug}/${encodeURIComponent(tableFsmTest.label)}`
      });
      expect(resQr.statusCode).toBe(200);
      const qrData = resQr.json();
      expect(qrData.valid).toBe(false);
      expect(qrData.isActive).toBe(false);
      expect(qrData.token).toBeUndefined();
    });
  });
});

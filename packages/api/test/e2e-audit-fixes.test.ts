import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// Mocks
const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  findRestaurant: vi.fn(),
  findTable: vi.fn(),
  closeTableSession: vi.fn(),
  hasUnpaidBalance: vi.fn(),
  findCalls: vi.fn(),
  findShift: vi.fn(),
  countCalls: vi.fn(),
  findFeedbacks: vi.fn(),
  validateOrder: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) },
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findRestaurant(...args),
      findUnique: (...args: unknown[]) => mocks.findRestaurant(...args)
    },
    table: {
      findUnique: (...args: unknown[]) => mocks.findTable(...args),
      findFirst: (...args: unknown[]) => mocks.findTable(...args)
    },
    shift: {
      findFirst: (...args: unknown[]) => mocks.findShift(...args)
    },
    callRequest: {
      findMany: (...args: unknown[]) => mocks.findCalls(...args),
      count: (...args: unknown[]) => mocks.countCalls(...args)
    },
    feedback: {
      findMany: (...args: unknown[]) => mocks.findFeedbacks(...args)
    }
  }
}));

vi.mock('../src/services/order.service', () => ({
  OrderService: {
    hasUnpaidBalance: (...args: unknown[]) => mocks.hasUnpaidBalance(...args),
    validateOrder: (...args: unknown[]) => mocks.validateOrder(...args)
  }
}));

vi.mock('../src/services/session.service', () => ({
  SessionService: {
    closeTableSession: (...args: unknown[]) => mocks.closeTableSession(...args)
  }
}));

import { tableRoutes } from '../src/routes/tables.routes';
import { MetricsService } from '../src/services/metrics.service';

const SECRET = 'jwt-secret-for-audit-fixes-verification-test-long-enough';

async function createApp() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });

  // Add the custom content type parser identical to index.ts
  const ALLOWED_EMPTY_BODY_ROUTES = [
    '/close-session',
    '/validate',
    '/call'
  ];

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const bodyStr = typeof body === 'string' ? body : (body ? (body as Buffer).toString('utf-8') : '');
    if (!bodyStr || bodyStr.trim() === '') {
      const isAllowedEmpty = ALLOWED_EMPTY_BODY_ROUTES.some(route => req.url.includes(route));
      if (isAllowedEmpty) {
        return done(null, {});
      }
      const err: any = new Error("Body cannot be empty when content-type is set to 'application/json'");
      err.statusCode = 400;
      err.code = 'FST_ERR_CTP_EMPTY_JSON_BODY';
      return done(err, undefined);
    }

    try {
      const json = JSON.parse(bodyStr);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  });

  await app.register(tableRoutes);
  await app.ready();
  return app;
}

describe('Audit Fixes Verification', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
  });

  describe('Bug 1: Empty JSON body parser', () => {
    it('accepts empty JSON body on allowlisted routes (/close-session)', async () => {
      const app = await createApp();
      const waiterToken = app.jwt.sign({ sub: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });

      mocks.findStaff.mockResolvedValue({ id: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });
      mocks.findTable.mockResolvedValue({ id: 'table-1', label: 'Mesa 1', restaurantId: 'rest-1' });
      mocks.closeTableSession.mockResolvedValue({ success: true, message: 'Sesión finalizada con éxito' });

      const res = await app.inject({
        method: 'POST',
        url: '/tables/table-1/close-session',
        headers: {
          authorization: `Bearer ${waiterToken}`,
          'content-type': 'application/json'
        },
        body: '' // Empty body
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true, message: 'Sesión finalizada con éxito' });
    });

    it('rejects empty JSON body on non-allowlisted routes with 400 FST_ERR_CTP_EMPTY_JSON_BODY', async () => {
      const app = Fastify();
      const ALLOWED_EMPTY_BODY_ROUTES = ['/close-session', '/validate', '/call'];
      app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
        const bodyStr = typeof body === 'string' ? body : (body ? (body as Buffer).toString('utf-8') : '');
        if (!bodyStr || bodyStr.trim() === '') {
          const isAllowedEmpty = ALLOWED_EMPTY_BODY_ROUTES.some(route => req.url.includes(route));
          if (isAllowedEmpty) {
            return done(null, {});
          }
          const err: any = new Error("Body cannot be empty when content-type is set to 'application/json'");
          err.statusCode = 400;
          err.code = 'FST_ERR_CTP_EMPTY_JSON_BODY';
          return done(err, undefined);
        }
        try {
          done(null, JSON.parse(bodyStr));
        } catch (err: any) {
          err.statusCode = 400;
          done(err, undefined);
        }
      });

      app.post('/test-route', async (req, reply) => {
        return reply.send({ ok: true });
      });
      await app.ready();

      const res = await app.inject({
        method: 'POST',
        url: '/test-route',
        headers: {
          'content-type': 'application/json'
        },
        body: ''
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.code).toBe('FST_ERR_CTP_EMPTY_JSON_BODY');
    });
  });

  describe('Bug 2: Table close permissions & unpaid balance', () => {
    it('allows WAITER to close a table with 0 balance', async () => {
      const app = await createApp();
      const waiterToken = app.jwt.sign({ sub: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });

      mocks.findStaff.mockResolvedValue({ id: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });
      mocks.findTable.mockResolvedValue({ id: 'table-1', label: 'Mesa 1', restaurantId: 'rest-1' });
      mocks.closeTableSession.mockResolvedValue({ success: true, message: 'Sesión finalizada con éxito' });

      const res = await app.inject({
        method: 'POST',
        url: '/tables/table-1/close-session',
        headers: {
          authorization: `Bearer ${waiterToken}`,
          'content-type': 'application/json'
        },
        payload: {}
      });

      expect(res.statusCode).toBe(200);
      expect(mocks.closeTableSession).toHaveBeenCalledWith('table-1', { force: false });
    });

    it('rejects WAITER trying to force-close with 403 FORBIDDEN_FORCE_CLOSE', async () => {
      const app = await createApp();
      const waiterToken = app.jwt.sign({ sub: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });

      mocks.findStaff.mockResolvedValue({ id: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });
      mocks.findTable.mockResolvedValue({ id: 'table-1', label: 'Mesa 1', restaurantId: 'rest-1' });

      const res = await app.inject({
        method: 'POST',
        url: '/tables/table-1/close-session',
        headers: {
          authorization: `Bearer ${waiterToken}`,
          'content-type': 'application/json'
        },
        payload: { force: true }
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('FORBIDDEN_FORCE_CLOSE');
      expect(mocks.closeTableSession).not.toHaveBeenCalled();
    });

    it('allows MANAGER to force-close a table', async () => {
      const app = await createApp();
      const managerToken = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'rest-1' });

      mocks.findStaff.mockResolvedValue({ id: 'manager-1', role: 'MANAGER', restaurantId: 'rest-1' });
      mocks.findTable.mockResolvedValue({ id: 'table-1', label: 'Mesa 1', restaurantId: 'rest-1' });
      mocks.closeTableSession.mockResolvedValue({ success: true, message: 'Sesión finalizada con éxito' });

      const res = await app.inject({
        method: 'POST',
        url: '/tables/table-1/close-session',
        headers: {
          authorization: `Bearer ${managerToken}`,
          'content-type': 'application/json'
        },
        payload: { force: true }
      });

      expect(res.statusCode).toBe(200);
      expect(mocks.closeTableSession).toHaveBeenCalledWith('table-1', { force: true });
    });

    it('returns error when SessionService rejects closure due to unpaid balance', async () => {
      const app = await createApp();
      const waiterToken = app.jwt.sign({ sub: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });

      mocks.findStaff.mockResolvedValue({ id: 'waiter-1', role: 'WAITER', restaurantId: 'rest-1' });
      mocks.findTable.mockResolvedValue({ id: 'table-1', label: 'Mesa 1', restaurantId: 'rest-1' });

      const unpaidError: any = new Error('La mesa tiene órdenes activas con saldo pendiente de pago ($15.000). Cobrá las comandas antes de cerrar.');
      unpaidError.statusCode = 400;
      unpaidError.code = 'TABLE_HAS_UNPAID_BALANCE';
      mocks.closeTableSession.mockRejectedValue(unpaidError);

      const res = await app.inject({
        method: 'POST',
        url: '/tables/table-1/close-session',
        headers: {
          authorization: `Bearer ${waiterToken}`,
          'content-type': 'application/json'
        },
        payload: {}
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TABLE_HAS_UNPAID_BALANCE');
    });
  });

  describe('Bug 3: Metrics calculation with fallback resolvedAt', () => {
    it('correctly calculates average response time using resolvedAt when acknowledgedAt is null', async () => {
      const now = new Date();
      const shiftStart = new Date(now.getTime() - 3600000); // 1 hour ago
      const createdAt = new Date(now.getTime() - 60000); // 60s ago
      const resolvedAt = new Date(now.getTime() - 30000); // 30s after created

      mocks.findShift.mockResolvedValue({
        id: 'shift-1',
        restaurantId: 'rest-1',
        openedAt: shiftStart,
        closedAt: null
      });

      // 1 call with status RESOLVED, acknowledgedAt null, resolvedAt present (diff = 30s)
      mocks.findCalls.mockResolvedValueOnce([
        {
          id: 'call-1',
          type: 'BILL',
          paymentMethod: 'CASH',
          status: 'RESOLVED',
          createdAt,
          acknowledgedAt: null,
          resolvedAt
        }
      ]);

      // Calls by type and payment counts
      mocks.findCalls.mockResolvedValueOnce([]); // for counts
      mocks.countCalls.mockResolvedValue(0);
      mocks.findFeedbacks.mockResolvedValue([]);

      const metrics = await MetricsService.getMetrics('rest-1');

      // (30000 ms / 1000) = 30 seconds
      expect(metrics.avgResponseTimeSeconds).toBe(30);
    });
  });
});

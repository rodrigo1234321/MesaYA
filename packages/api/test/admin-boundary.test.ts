import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

const mocks = vi.hoisted(() => ({ findStaff: vi.fn(), getPublic: vi.fn(), getAdmin: vi.fn(), update: vi.fn(), audit: vi.fn(), metrics: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ prisma: { staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) } } }));
vi.mock('../src/services/config.service', () => ({ ConfigService: {
  getPublicConfig: (...args: unknown[]) => mocks.getPublic(...args), getAdminConfig: (...args: unknown[]) => mocks.getAdmin(...args),
  updateConfigTransacted: (...args: unknown[]) => mocks.update(...args), getAuditLogs: (...args: unknown[]) => mocks.audit(...args)
} }));
vi.mock('../src/services/metrics.service', () => ({ MetricsService: { getMetrics: (...args: unknown[]) => mocks.metrics(...args) } }));

import { configRoutes } from '../src/routes/config.routes';
import { metricsRoutes } from '../src/routes/metrics.routes';

const SECRET = 'jwt-secret-for-admin-boundary-tests-which-is-long-enough';
const identity = (id: string) => ({ id, name: id, role: id.startsWith('manager') ? 'MANAGER' : 'WAITER', restaurantId: id.endsWith('-a') ? 'restaurant-a' : 'restaurant-b', assignedSector: null });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findStaff.mockImplementation(({ where }: any) => Promise.resolve(identity(where.id)));
});

async function appWithRoutes() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.register(configRoutes);
  await app.register(metricsRoutes);
  return app;
}

describe('Etapa 08 — límites admin de configuración y métricas', () => {
  it('anónimo y mozo no leen configuración administrativa', async () => {
    const app = await appWithRoutes();
    try {
      expect((await app.inject({ method: 'GET', url: '/admin/restaurants/restaurant-a/config' })).statusCode).toBe(401);
      const waiter = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      expect((await app.inject({ method: 'GET', url: '/admin/restaurants/restaurant-a/config', headers: { authorization: `Bearer ${waiter}` } })).statusCode).toBe(403);
      expect(mocks.getAdmin).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('manager B no obtiene configuración ni métricas de A', async () => {
    const app = await appWithRoutes();
    try {
      const managerB = app.jwt.sign({ sub: 'manager-b', role: 'MANAGER', restaurantId: 'restaurant-b' });
      expect((await app.inject({ method: 'GET', url: '/admin/restaurants/restaurant-a/config', headers: { authorization: `Bearer ${managerB}` } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: '/metrics?restaurantId=restaurant-a', headers: { authorization: `Bearer ${managerB}` } })).statusCode).toBe(404);
      expect(mocks.getAdmin).not.toHaveBeenCalled();
      expect(mocks.metrics).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('manager A usa el tenant canónico y el DTO público no filtra secretos', async () => {
    mocks.getAdmin.mockResolvedValue({ restaurantId: 'restaurant-a', enableRewards: false });
    mocks.metrics.mockResolvedValue({ totalOrders: 1 });
    mocks.getPublic.mockResolvedValue({ allowOrdering: true, enableUpsell: false, paymentMode: 'WAITER_ONLY' });
    const app = await appWithRoutes();
    try {
      const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });
      expect((await app.inject({ method: 'GET', url: '/admin/restaurants/restaurant-a/config', headers: { authorization: `Bearer ${managerA}` } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'GET', url: '/metrics', headers: { authorization: `Bearer ${managerA}` } })).statusCode).toBe(200);
      expect(mocks.metrics).toHaveBeenCalledWith('restaurant-a');
      const publicResponse = await app.inject({ method: 'GET', url: '/restaurants/local/config' });
      expect(publicResponse.statusCode).toBe(200);
      expect(publicResponse.json()).not.toHaveProperty('token');
      expect(publicResponse.json()).not.toHaveProperty('pinHash');
      expect(publicResponse.json()).not.toHaveProperty('encryptionSecret');
    } finally { await app.close(); }
  });
});

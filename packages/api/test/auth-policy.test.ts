import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

const findUnique = vi.fn();
vi.mock('../src/lib/prisma', () => ({ prisma: { staffUser: { findUnique: (...args: unknown[]) => findUnique(...args) } } }));

import { requireRestaurantAccess, verifyManagerRole, verifyStaffToken } from '../src/middlewares/auth.middleware';

const SECRET = 'jwt-secret-for-auth-policy-tests-which-is-long-enough';

async function createApp() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  let protectedHandlerReached = false;
  app.get('/tenant/:restaurantId', {
    preHandler: [verifyStaffToken, requireRestaurantAccess((request) => (request.params as { restaurantId?: string }).restaurantId)]
  }, async () => {
    protectedHandlerReached = true;
    return { ok: true };
  });
  app.post('/manager', { preHandler: [verifyManagerRole] }, async () => ({ ok: true }));
  return { app, wasHandlerReached: () => protectedHandlerReached };
}

beforeEach(() => findUnique.mockReset());

describe('Etapa 06 — política de autorización', () => {
  it('un token válido de A no accede al tenant B y el handler no continúa', async () => {
    findUnique.mockResolvedValue({ id: 'staff-a', name: 'Mozo A', role: 'WAITER', restaurantId: 'restaurant-a', assignedSector: null });
    const { app, wasHandlerReached } = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'staff-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      const response = await app.inject({ method: 'GET', url: '/tenant/restaurant-b', headers: { authorization: `Bearer ${token}` } });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toMatchObject({ error: 'NOT_FOUND' });
      expect(wasHandlerReached()).toBe(false);
    } finally { await app.close(); }
  });

  it('credencial inválida o vencida recibe 401 y no continúa', async () => {
    const { app, wasHandlerReached } = await createApp();
    try {
      const invalid = await app.inject({ method: 'GET', url: '/tenant/restaurant-a', headers: { authorization: 'Bearer invalido' } });
      expect(invalid.statusCode).toBe(401);
      expect(wasHandlerReached()).toBe(false);

      const expired = app.jwt.sign({ sub: 'staff-a', role: 'WAITER', restaurantId: 'restaurant-a', exp: Math.floor(Date.now() / 1000) - 1 });
      const expiredResponse = await app.inject({ method: 'GET', url: '/tenant/restaurant-a', headers: { authorization: `Bearer ${expired}` } });
      expect(expiredResponse.statusCode).toBe(401);
      expect(wasHandlerReached()).toBe(false);
    } finally { await app.close(); }
  });

  it('identidad ausente o movida de tenant se rechaza aunque el JWT sea válido', async () => {
    const { app, wasHandlerReached } = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'staff-a', role: 'MANAGER', restaurantId: 'restaurant-a' });
      findUnique.mockResolvedValue(null);
      const missing = await app.inject({ method: 'GET', url: '/tenant/restaurant-a', headers: { authorization: `Bearer ${token}` } });
      expect(missing.statusCode).toBe(401);

      findUnique.mockResolvedValue({ id: 'staff-a', name: 'Mozo A', role: 'WAITER', restaurantId: 'restaurant-b', assignedSector: null });
      const moved = await app.inject({ method: 'GET', url: '/tenant/restaurant-a', headers: { authorization: `Bearer ${token}` } });
      expect(moved.statusCode).toBe(401);
      expect(wasHandlerReached()).toBe(false);
    } finally { await app.close(); }
  });

  it('el rol vigente en DB prevalece sobre el rol presentado por el JWT', async () => {
    findUnique.mockResolvedValue({ id: 'staff-a', name: 'Mozo A', role: 'WAITER', restaurantId: 'restaurant-a', assignedSector: null });
    const { app } = await createApp();
    try {
      const forgedRole = app.jwt.sign({ sub: 'staff-a', role: 'MANAGER', restaurantId: 'restaurant-a' });
      const response = await app.inject({ method: 'POST', url: '/manager', headers: { authorization: `Bearer ${forgedRole}` } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'FORBIDDEN' });
    } finally { await app.close(); }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  findRestaurant: vi.fn(),
  findTable: vi.fn(),
  findTables: vi.fn(),
  createTable: vi.fn(),
  deleteTable: vi.fn(),
  findShift: vi.fn(),
  openShift: vi.fn(),
  closeShift: vi.fn(),
  getCurrentShift: vi.fn(),
  closeTableSession: vi.fn(),
  createNewSessionForTable: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) },
    restaurant: { findFirst: (...args: unknown[]) => mocks.findRestaurant(...args) },
    table: {
      findMany: (...args: unknown[]) => mocks.findTables(...args),
      findUnique: (...args: unknown[]) => mocks.findTable(...args),
      create: (...args: unknown[]) => mocks.createTable(...args),
      delete: (...args: unknown[]) => mocks.deleteTable(...args)
    },
    shift: {
      findFirst: (...args: unknown[]) => mocks.findShift(...args)
    }
  }
}));

vi.mock('../src/services/shift.service', () => ({
  ShiftService: {
    openShift: (...args: unknown[]) => mocks.openShift(...args),
    closeShift: (...args: unknown[]) => mocks.closeShift(...args),
    getCurrentShift: (...args: unknown[]) => mocks.getCurrentShift(...args)
  }
}));

vi.mock('../src/services/session.service', () => ({
  SessionService: {
    closeTableSession: (...args: unknown[]) => mocks.closeTableSession(...args),
    createNewSessionForTable: (...args: unknown[]) => mocks.createNewSessionForTable(...args)
  }
}));

import { tableRoutes } from '../src/routes/tables.routes';
import { shiftRoutes } from '../src/routes/shifts.routes';

const SECRET = 'jwt-secret-for-tables-shifts-access-tests-which-is-long-enough';
const restaurant = (id: string) => ({ id, name: id, slug: id, themeColor: '#000', logoUrl: null, coverImageUrl: null, whatsappPhone: null });
const staff = (id: string) => ({ id, name: id, role: id.startsWith('manager') ? 'MANAGER' : 'WAITER', restaurantId: id.endsWith('-a') ? 'restaurant-a' : 'restaurant-b', assignedSector: null });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findStaff.mockImplementation(({ where }: any) => Promise.resolve(staff(where.id)));
  mocks.findRestaurant.mockImplementation(({ where }: any) => {
    const identifier = where.OR?.[0]?.id || where.OR?.[1]?.slug;
    return Promise.resolve(restaurant(identifier));
  });
});

async function createApp() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.register(tableRoutes);
  await app.register(shiftRoutes);
  return app;
}

describe('Etapa 10 — protección de mesas y apertura/cierre de turnos', () => {
  it('listado de mesas exige auth de staff y oculta activeToken', async () => {
    mocks.findTables.mockResolvedValue([
      { id: 't1', label: 'Mesa 1', sector: 'SALON_PRINCIPAL', isOutdoor: false, sessions: [{ token: 'secret-guest-token', expiresAt: '2026-09-04T00:00:00Z' }] }
    ]);
    const app = await createApp();
    try {
      const anon = await app.inject({ method: 'GET', url: '/restaurants/restaurant-a/tables' });
      expect(anon.statusCode).toBe(401);

      const waiterB = app.jwt.sign({ sub: 'waiter-b', role: 'WAITER', restaurantId: 'restaurant-b' });
      const forbiddenB = await app.inject({ method: 'GET', url: '/restaurants/restaurant-a/tables', headers: { authorization: `Bearer ${waiterB}` } });
      expect(forbiddenB.statusCode).toBe(404);

      const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      const okA = await app.inject({ method: 'GET', url: '/restaurants/restaurant-a/tables', headers: { authorization: `Bearer ${waiterA}` } });
      expect(okA.statusCode).toBe(200);
      const json = okA.json();
      expect(json).toHaveLength(1);
      expect(json[0].activeToken).toBeNull();
      expect(json[0]).not.toHaveProperty('token');
    } finally {
      await app.close();
    }
  });

  it('crear, borrar y gestionar sesiones de mesas requiere manager del tenant', async () => {
    mocks.findTable.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, restaurantId: 'restaurant-a', label: 'Mesa 1' }));
    mocks.createTable.mockResolvedValue({ id: 't2', label: 'Mesa 2', sector: 'SALON_PRINCIPAL', isOutdoor: false });
    mocks.closeTableSession.mockResolvedValue({ success: true, message: 'closed' });
    mocks.createNewSessionForTable.mockResolvedValue('new-guest-token-123');
    mocks.deleteTable.mockResolvedValue({ success: true });

    const app = await createApp();
    try {
      const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      const managerB = app.jwt.sign({ sub: 'manager-b', role: 'MANAGER', restaurantId: 'restaurant-b' });
      const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });

      // Waiter rejected on table creation (403) and forced close (403)
      expect((await app.inject({ method: 'POST', url: '/restaurants/restaurant-a/tables', headers: { authorization: `Bearer ${waiterA}` }, payload: { label: 'Mesa 2' } })).statusCode).toBe(403);
      expect((await app.inject({ method: 'POST', url: '/tables/t1/close-session', headers: { authorization: `Bearer ${waiterA}` }, payload: { force: true } })).statusCode).toBe(403);
      // Waiter accepted on regular close-session (200)
      expect((await app.inject({ method: 'POST', url: '/tables/t1/close-session', headers: { authorization: `Bearer ${waiterA}` }, payload: {} })).statusCode).toBe(200);

      // Manager B rejected (404)
      expect((await app.inject({ method: 'POST', url: '/restaurants/restaurant-a/tables', headers: { authorization: `Bearer ${managerB}` }, payload: { label: 'Mesa 2' } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/tables/t1/close-session', headers: { authorization: `Bearer ${managerB}` } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/tables/t1/new-session', headers: { authorization: `Bearer ${managerB}` } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'DELETE', url: '/tables/t1', headers: { authorization: `Bearer ${managerB}` } })).statusCode).toBe(404);

      // Manager A accepted (201/200)
      expect((await app.inject({ method: 'POST', url: '/restaurants/restaurant-a/tables', headers: { authorization: `Bearer ${managerA}` }, payload: { label: 'Mesa 2' } })).statusCode).toBe(201);
      expect((await app.inject({ method: 'POST', url: '/tables/t1/close-session', headers: { authorization: `Bearer ${managerA}` } })).statusCode).toBe(200);
      const newSessionRes = await app.inject({ method: 'POST', url: '/tables/t1/new-session', headers: { authorization: `Bearer ${managerA}` } });
      expect(newSessionRes.statusCode).toBe(200);
      expect(newSessionRes.json()).toEqual({ success: true, token: 'new-guest-token-123' });
      expect((await app.inject({ method: 'DELETE', url: '/tables/t1', headers: { authorization: `Bearer ${managerA}` } })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('apertura y cierre de turno requiere manager del tenant y omite array de tokens en respuesta', async () => {
    mocks.openShift.mockResolvedValue({ shift: { id: 's1', openedAt: new Date().toISOString() }, sessionsCount: 5, sessions: [{ token: 'secret' }] });
    mocks.findShift.mockImplementation(({ where }: any) => Promise.resolve({ id: where.id, restaurantId: where.restaurantId }));
    mocks.closeShift.mockResolvedValue({ id: 's1', closedAt: new Date().toISOString() });

    const app = await createApp();
    try {
      const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      const managerB = app.jwt.sign({ sub: 'manager-b', role: 'MANAGER', restaurantId: 'restaurant-b' });
      const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });

      // Waiter rejected
      expect((await app.inject({ method: 'POST', url: '/shifts/open', headers: { authorization: `Bearer ${waiterA}` }, payload: { restaurantId: 'restaurant-a' } })).statusCode).toBe(403);
      // Manager B rejected
      expect((await app.inject({ method: 'POST', url: '/shifts/open', headers: { authorization: `Bearer ${managerB}` }, payload: { restaurantId: 'restaurant-a' } })).statusCode).toBe(404);
      expect((await app.inject({ method: 'POST', url: '/shifts/s1/close', headers: { authorization: `Bearer ${managerB}` }, payload: { restaurantId: 'restaurant-a' } })).statusCode).toBe(404);

      // Manager A accepted
      const openRes = await app.inject({ method: 'POST', url: '/shifts/open', headers: { authorization: `Bearer ${managerA}` }, payload: { restaurantId: 'restaurant-a' } });
      expect(openRes.statusCode).toBe(201);
      expect(openRes.json()).toEqual({ shift: expect.any(Object), sessionsCount: 5 });
      expect(openRes.json()).not.toHaveProperty('sessions');

      const closeRes = await app.inject({ method: 'POST', url: '/shifts/s1/close', headers: { authorization: `Bearer ${managerA}` }, payload: { restaurantId: 'restaurant-a' } });
      expect(closeRes.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('GET /shifts/current exige auth staff de tenant y no devuelve tokens de sesión', async () => {
    mocks.getCurrentShift.mockResolvedValue({
      id: 's1',
      openedAt: new Date().toISOString(),
      closedAt: null,
      sessions: [{ id: 'ses1', tableId: 't1', expiresAt: '2026-09-04T00:00:00Z', table: { id: 't1', label: 'Mesa 1' } }]
    });

    const app = await createApp();
    try {
      const anon = await app.inject({ method: 'GET', url: '/shifts/current?restaurantId=restaurant-a' });
      expect(anon.statusCode).toBe(401);

      const waiterB = app.jwt.sign({ sub: 'waiter-b', role: 'WAITER', restaurantId: 'restaurant-b' });
      expect((await app.inject({ method: 'GET', url: '/shifts/current?restaurantId=restaurant-a', headers: { authorization: `Bearer ${waiterB}` } })).statusCode).toBe(404);

      const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      const currentRes = await app.inject({ method: 'GET', url: '/shifts/current?restaurantId=restaurant-a', headers: { authorization: `Bearer ${waiterA}` } });
      expect(currentRes.statusCode).toBe(200);
      const json = currentRes.json();
      expect(json.sessions[0]).not.toHaveProperty('token');
    } finally {
      await app.close();
    }
  });
});

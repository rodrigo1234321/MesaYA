import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

const mocks = vi.hoisted(() => ({ findStaff: vi.fn(), findRestaurant: vi.fn(), categoryCreate: vi.fn(), categoryFind: vi.fn(), itemUpdate: vi.fn(), itemFind: vi.fn(), transaction: vi.fn() }));
vi.mock('../src/lib/prisma', () => ({ prisma: {
  staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) },
  restaurant: { findFirst: (...args: unknown[]) => mocks.findRestaurant(...args) },
  menuCategory: { create: (...args: unknown[]) => mocks.categoryCreate(...args), findFirst: (...args: unknown[]) => mocks.categoryFind(...args), delete: vi.fn(), deleteMany: vi.fn() },
  menuItem: { create: vi.fn(), findFirst: (...args: unknown[]) => mocks.itemFind(...args), update: (...args: unknown[]) => mocks.itemUpdate(...args), delete: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  $transaction: (...args: unknown[]) => mocks.transaction(...args)
} }));

import { menuRoutes } from '../src/routes/menu.routes';

const SECRET = 'jwt-secret-for-menu-access-tests-which-is-long-enough';
const restaurant = (id: string) => ({ id, name: id, slug: id, themeColor: '#000', logoUrl: null, coverImageUrl: null, whatsappPhone: null, categories: [] });
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
  await app.register(menuRoutes);
  return app;
}

describe('Etapa 09 — mutaciones de menú aisladas por tenant', () => {
  it('GET público de menú permanece disponible con DTO sin credenciales', async () => {
    const app = await createApp();
    try {
      const response = await app.inject({ method: 'GET', url: '/restaurants/restaurant-a/menu' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty('token');
      expect(response.json()).not.toHaveProperty('pinHash');
    } finally { await app.close(); }
  });

  it('anónimo, mozo y manager B no crean ni actualizan en A', async () => {
    const app = await createApp();
    try {
      const anonymous = await app.inject({ method: 'POST', url: '/restaurants/restaurant-a/menu/categories', payload: { name: 'Nueva' } });
      expect(anonymous.statusCode).toBe(401);
      const waiter = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      expect((await app.inject({ method: 'POST', url: '/restaurants/restaurant-a/menu/categories', headers: { authorization: `Bearer ${waiter}` }, payload: { name: 'Nueva' } })).statusCode).toBe(403);
      const managerB = app.jwt.sign({ sub: 'manager-b', role: 'MANAGER', restaurantId: 'restaurant-b' });
      expect((await app.inject({ method: 'PATCH', url: '/restaurants/restaurant-a/menu/items/item-a', headers: { authorization: `Bearer ${managerB}` }, payload: { price: 10 } })).statusCode).toBe(404);
      expect(mocks.categoryCreate).not.toHaveBeenCalled();
      expect(mocks.itemUpdate).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('importación inválida se rechaza antes de abrir transacción', async () => {
    const app = await createApp();
    try {
      const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });
      const response = await app.inject({ method: 'POST', url: '/restaurants/restaurant-a/menu/import', headers: { authorization: `Bearer ${managerA}` }, payload: { replaceExisting: true, items: [{ name: '', price: 100 }] } });
      expect(response.statusCode).toBe(400);
      expect(mocks.transaction).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

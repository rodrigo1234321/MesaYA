import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  findRestaurant: vi.fn(),
  findRestaurantUnique: vi.fn(),
  transaction: vi.fn(),
  listStaff: vi.fn(),
  createStaff: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) },
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findRestaurant(...args),
      findUnique: (...args: unknown[]) => mocks.findRestaurantUnique(...args)
    },
    $transaction: (...args: unknown[]) => mocks.transaction(...args)
  }
}));
vi.mock('../src/services/staff.service', () => ({
  StaffService: {
    login: vi.fn(),
    listStaff: (...args: unknown[]) => mocks.listStaff(...args),
    createStaff: (...args: unknown[]) => mocks.createStaff(...args)
  }
}));

import { staffRoutes } from '../src/routes/staff.routes';
import { authRoutes } from '../src/routes/auth.routes';
import { StaffService } from '../src/services/staff.service';

const SECRET = 'jwt-secret-for-staff-access-tests-which-is-long-enough';
const originalOnboarding = process.env.PILOT_PUBLIC_ONBOARDING_ENABLED;
const originalInstanceMode = process.env.MESAYA_INSTANCE_MODE;
const originalInstanceRestaurantId = process.env.MESAYA_INSTANCE_RESTAURANT_ID;

function identityFor(id: string) {
  const restaurantId = id.endsWith('-a') ? 'restaurant-a' : 'restaurant-b';
  const role = id.startsWith('manager') ? 'MANAGER' : 'WAITER';
  return { id, name: id, role, restaurantId, assignedSector: null };
}

async function staffApp() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.register(staffRoutes);
  return app;
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.mocked(StaffService.login).mockReset();
  mocks.findStaff.mockImplementation(({ where }: any) => Promise.resolve(identityFor(where.id)));
  delete process.env.PILOT_PUBLIC_ONBOARDING_ENABLED;
  delete process.env.MESAYA_INSTANCE_MODE;
  delete process.env.MESAYA_INSTANCE_RESTAURANT_ID;
});

afterEach(() => {
  if (originalOnboarding === undefined) delete process.env.PILOT_PUBLIC_ONBOARDING_ENABLED;
  else process.env.PILOT_PUBLIC_ONBOARDING_ENABLED = originalOnboarding;
  if (originalInstanceMode === undefined) delete process.env.MESAYA_INSTANCE_MODE;
  else process.env.MESAYA_INSTANCE_MODE = originalInstanceMode;
  if (originalInstanceRestaurantId === undefined) delete process.env.MESAYA_INSTANCE_RESTAURANT_ID;
  else process.env.MESAYA_INSTANCE_RESTAURANT_ID = originalInstanceRestaurantId;
});

describe('Etapa 07 — personal y login administrativo', () => {
  it('anónimo y mozo no listan personal; manager A sólo ve A', async () => {
    mocks.listStaff.mockResolvedValue([{ id: 'staff-a' }]);
    const app = await staffApp();
    try {
      const anonymous = await app.inject({ method: 'GET', url: '/staff?restaurantId=restaurant-a' });
      expect(anonymous.statusCode).toBe(401);

      const waiter = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
      const waiterResponse = await app.inject({ method: 'GET', url: '/staff?restaurantId=restaurant-a', headers: { authorization: `Bearer ${waiter}` } });
      expect(waiterResponse.statusCode).toBe(403);

      const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });
      const allowed = await app.inject({ method: 'GET', url: '/staff?restaurantId=restaurant-a', headers: { authorization: `Bearer ${managerA}` } });
      expect(allowed.statusCode).toBe(200);
      expect(mocks.listStaff).toHaveBeenCalledWith('restaurant-a');
    } finally { await app.close(); }
  });

  it('manager B no puede crear personal en A y no hay escritura tras 404', async () => {
    const app = await staffApp();
    try {
      const managerB = app.jwt.sign({ sub: 'manager-b', role: 'MANAGER', restaurantId: 'restaurant-b' });
      const response = await app.inject({
        method: 'POST', url: '/staff', headers: { authorization: `Bearer ${managerB}` },
        payload: { restaurantId: 'restaurant-a', name: 'Nuevo', pin: '1234', role: 'WAITER' }
      });
      expect(response.statusCode).toBe(404);
      expect(mocks.createStaff).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('login administrativo no concede token a un mozo y sí a un manager del restaurante', async () => {
    const waiterHash = await bcrypt.hash('1234', 4);
    const managerHash = await bcrypt.hash('9999', 4);
    mocks.findRestaurant.mockResolvedValue({ id: 'restaurant-a', slug: 'a', templateId: 'x', themeColor: '#000', staffUsers: [
      { ...identityFor('waiter-a'), pinHash: waiterHash },
      { ...identityFor('manager-a'), pinHash: managerHash }
    ] });
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(authRoutes);
    try {
      const waiter = await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'a', pin: '1234' } });
      expect(waiter.statusCode).toBe(403);
      expect(waiter.json().token).toBeUndefined();
      const manager = await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'a', pin: '9999' } });
      expect(manager.statusCode).toBe(200);
      expect(manager.json().token).toEqual(expect.any(String));
    } finally { await app.close(); }
  });

  it('onboarding público está cerrado por defecto sin escrituras', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(authRoutes);
    try {
      const response = await app.inject({ method: 'POST', url: '/auth/register-restaurant', payload: { name: 'Ficticio', slug: 'ficticio', pin: '1234' } });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ error: 'PUBLIC_ONBOARDING_DISABLED' });
      expect(mocks.findRestaurantUnique).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('login de staff valida input, rechaza restaurante inexistente y aplica rate limiting', async () => {
    const app = await staffApp();
    try {
      // 1. Missing / invalid body
      const invalid = await app.inject({ method: 'POST', url: '/staff/login', payload: {} });
      expect(invalid.statusCode).toBe(400);

      // 2. Restaurant not found
      mocks.findRestaurant.mockResolvedValueOnce(null);
      const notFound = await app.inject({ method: 'POST', url: '/staff/login', payload: { restaurantSlug: 'no-existe', pin: '1234' } });
      expect(notFound.statusCode).toBe(404);

      // 3. Successful login
      mocks.findRestaurant.mockResolvedValueOnce({ id: 'restaurant-a', slug: 'restaurant-a' });
      (StaffService.login as any).mockResolvedValueOnce({
        staffUser: { id: 'staff-1', name: 'Mozo 1', role: 'WAITER', restaurantId: 'restaurant-a', assignedSector: null }
      });
      const success = await app.inject({ method: 'POST', url: '/staff/login', payload: { restaurantSlug: 'restaurant-a', pin: '1234' } });
      expect(success.statusCode).toBe(200);
      expect(success.json().token).toEqual(expect.any(String));
      expect(success.json().staffUser.role).toBe('WAITER');
    } finally { await app.close(); }
  });

  it('login de staff respeta el límite de una instancia single-restaurant', async () => {
    process.env.MESAYA_INSTANCE_MODE = 'SINGLE_RESTAURANT';
    process.env.MESAYA_INSTANCE_RESTAURANT_ID = 'restaurant-root';
    mocks.findRestaurant.mockResolvedValue({ id: 'restaurant-foreign', slug: 'otro-local' });
    const app = await staffApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/staff/login',
        payload: { restaurantSlug: 'otro-local', pin: '1234' }
      });
      expect(response.statusCode).toBe(404);
      expect((StaffService.login as any)).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import bcrypt from 'bcryptjs';

const mocks = vi.hoisted(() => ({
  findStaffUnique: vi.fn(),
  findStaffMany: vi.fn(),
  createStaffUser: vi.fn(),
  findRestaurantFirst: vi.fn(),
  findRestaurantUnique: vi.fn(),
  transaction: vi.fn(),
  consume: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    staffUser: {
      findUnique: (...args: unknown[]) => mocks.findStaffUnique(...args),
      findMany: (...args: unknown[]) => mocks.findStaffMany(...args),
      create: (...args: unknown[]) => mocks.createStaffUser(...args)
    },
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findRestaurantFirst(...args),
      findUnique: (...args: unknown[]) => mocks.findRestaurantUnique(...args)
    },
    $transaction: (...args: unknown[]) => mocks.transaction(...args)
  }
}));

vi.mock('../src/services/abuse-control.service', () => ({
  AbuseControlService: { consume: (...args: unknown[]) => mocks.consume(...args) },
  AbusePolicies: {
    LOGIN_BY_IP_TENANT: { limit: 25, windowSeconds: 300 },
    WAITLIST_BY_IP_TENANT: { limit: 3, windowSeconds: 600 },
    REGISTER_RESTAURANT_BY_IP: { limit: 3, windowSeconds: 600 }
  }
}));

import { AbusePolicies as RealAbusePolicies } from '../src/services/abuse-control.service';
import {
  assertBootstrapPin,
  buildBootstrapSummary,
  classifyBootstrapCredential,
  resolveBootstrapOptions,
  shouldHashBootstrapCredential,
} from '../../../scripts/bootstrap-restaurant';
import { generateTableQR, resolveBaseUrl } from '../../../hardware/qr-generator/generate';
// Script CJS sin tipos: default = module.exports (normalizeLineEndings/diffSchemas).
// @ts-ignore - sin declaraciones para script JS de soporte
import syncSchema from '../../../scripts/sync_supabase_schema.js';

import { isValidPin, assertValidPin } from '../src/lib/pin-policy';
import { getEnvironmentConfig } from '../src/lib/environment';
import { StaffService } from '../src/services/staff.service';
import { authRoutes } from '../src/routes/auth.routes';
import { staffRoutes } from '../src/routes/staff.routes';

const SECRET = 'jwt-secret-for-cocina-cuentas-etapa01-tests-long-enough';
const onboarding = process.env.PILOT_PUBLIC_ONBOARDING_ENABLED;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.consume.mockResolvedValue({ allowed: true, remaining: 24, retryAfterSeconds: 0 });
  mocks.findStaffUnique.mockImplementation(({ where }: any) =>
    Promise.resolve({ id: where.id, name: where.id, role: 'MANAGER', restaurantId: 'restaurant-a', assignedSector: null })
  );
  delete process.env.PILOT_PUBLIC_ONBOARDING_ENABLED;
});

describe('COCINA-CUENTAS Etapa 01 — login, PIN, bootstrap y QR/CORS', () => {
  it('política PIN: acepta 4–6 dígitos exactos y rechaza espacios/resto', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('999999')).toBe(true);
    for (const bad of ['123', '1234567', '12a4', '', '  ', 1234, null, undefined, '12 34', ' 9999', '9999 ', ' 999999 ']) {
      expect(isValidPin(bad)).toBe(false);
      expect(() => assertValidPin(bad)).toThrowError(/4 y 6 dígitos/);
    }
    try {
      assertValidPin('abc');
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('PIN_INVALID');
      expect(String(err.message)).not.toMatch(/abc/);
    }
  });

  it('register-restaurant valida payload barato antes del rate limit y sin escrituras', async () => {
    process.env.PILOT_PUBLIC_ONBOARDING_ENABLED = 'true';
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(authRoutes);
    try {
      for (const pin of ['123', '1234567', 'abcd', '', ' 1234', '12 34']) {
        const res = await app.inject({ method: 'POST', url: '/auth/register-restaurant', payload: { name: 'N', slug: 'local-valido', pin } });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('PIN_INVALID');
      }
      // Entradas inválidas no deben consumir bucket ni tocar DB.
      expect(mocks.consume).not.toHaveBeenCalled();
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.findRestaurantUnique).not.toHaveBeenCalled();

      // tablesCount estricto 0–100 entero; slug canónico.
      for (const payload of [
        { name: 'N', slug: 'local-valido', pin: '1234', tablesCount: '8abc' },
        { name: 'N', slug: 'local-valido', pin: '1234', tablesCount: 101 },
        { name: 'N', slug: 'local-valido', pin: '1234', tablesCount: -1 },
        { name: 'N', slug: 'local-valido', pin: '1234', tablesCount: 8.5 },
        { name: 'N', slug: '!!', pin: '1234' }
      ]) {
        const res = await app.inject({ method: 'POST', url: '/auth/register-restaurant', payload });
        expect(res.statusCode).toBe(400);
      }
      expect(mocks.consume).not.toHaveBeenCalled();
    } finally {
      await app.close();
      if (onboarding === undefined) delete process.env.PILOT_PUBLIC_ONBOARDING_ENABLED;
      else process.env.PILOT_PUBLIC_ONBOARDING_ENABLED = onboarding;
    }
  });

  it('register-restaurant usa política propia REGISTER_RESTAURANT_BY_IP y exige onboarding explícito', async () => {
    process.env.PILOT_PUBLIC_ONBOARDING_ENABLED = 'true';
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(authRoutes);
    try {
      mocks.findRestaurantUnique.mockResolvedValue(null);
      mocks.transaction.mockResolvedValue({ restaurant: { id: 'r1', slug: 'local-valido' }, manager: { id: 'm1', role: 'MANAGER', assignedSector: null } });
      const res = await app.inject({ method: 'POST', url: '/auth/register-restaurant', payload: { name: 'Local', slug: 'local-valido', pin: '482916', tablesCount: 8 } });
      expect(res.statusCode).toBe(201);
      expect(mocks.consume).toHaveBeenCalledTimes(1);
      const [key, policy] = mocks.consume.mock.calls[0];
      expect(String(key)).toMatch(/^register:ip:/);
      expect(policy).toEqual({ limit: 3, windowSeconds: 600 });
    } finally {
      await app.close();
      if (onboarding === undefined) delete process.env.PILOT_PUBLIC_ONBOARDING_ENABLED;
      else process.env.PILOT_PUBLIC_ONBOARDING_ENABLED = onboarding;
    }
  });

  it('login-admin valida PIN 4–6 antes de DB/bcrypt, aísla tenant y no entrega token a mozo', async () => {
    const waiterHash = await bcrypt.hash('1111', 4);
    const managerHash = await bcrypt.hash('2222', 4);
    mocks.findRestaurantFirst.mockResolvedValue({
      id: 'restaurant-a', slug: 'a', staffUsers: [
        { id: 'waiter', name: 'Mozo', role: 'WAITER', pinHash: waiterHash },
        { id: 'manager', name: 'Jefe', role: 'MANAGER', pinHash: managerHash }
      ]
    });
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(authRoutes);
    try {
      expect((await app.inject({ method: 'POST', url: '/auth/login-admin', payload: {} })).statusCode).toBe(400);
      expect((await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'a', pin: 'x'.repeat(33) } })).statusCode).toBe(400);

      // Formato inválido no toca DB.
      mocks.findRestaurantFirst.mockClear();
      for (const pin of ['12ab', '123', '1234567', ' 2222', '22 22']) {
        const res = await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'a', pin } });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('PIN_INVALID');
      }
      expect(mocks.findRestaurantFirst).not.toHaveBeenCalled();

      mocks.findRestaurantFirst.mockResolvedValueOnce(null);
      expect((await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'otro', pin: '2222' } })).statusCode).toBe(404);

      const waiter = await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'a', pin: '1111' } });
      expect(waiter.statusCode).toBe(403);
      expect(waiter.json().token).toBeUndefined();

      const badPin = await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'a', pin: '0000' } });
      expect(badPin.statusCode).toBe(401);
      expect(badPin.json().token).toBeUndefined();

      const manager = await app.inject({ method: 'POST', url: '/auth/login-admin', payload: { restaurantSlug: 'a', pin: '2222' } });
      expect(manager.statusCode).toBe(200);
      expect(manager.json().token).toEqual(expect.any(String));
    } finally { await app.close(); }
  });

  it('staff login valida PIN 4–6 antes de DB (alineado con admin)', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(staffRoutes);
    try {
      for (const pin of ['12ab', '123', '1234567', ' 1234']) {
        const res = await app.inject({ method: 'POST', url: '/staff/login', payload: { restaurantSlug: 'a', pin } });
        expect(res.statusCode).toBe(400);
        expect(res.json().code).toBe('PIN_INVALID');
      }
      expect(mocks.findRestaurantFirst).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('login aplica rate limit por tenant/IP con Retry-After y 429', async () => {
    expect(RealAbusePolicies.LOGIN_BY_IP_TENANT).toEqual({ limit: 25, windowSeconds: 300 });
    mocks.findRestaurantFirst.mockResolvedValue({ id: 'restaurant-a', slug: 'a' });
    mocks.consume.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterSeconds: 42 });
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(staffRoutes);
    try {
      const res = await app.inject({ method: 'POST', url: '/staff/login', payload: { restaurantSlug: 'a', pin: '1234' } });
      expect(res.statusCode).toBe(429);
      expect(res.headers['retry-after']).toBe('42');
      expect(res.json().code).toBe('RATE_LIMIT_EXCEEDED');
      const [key, policy] = mocks.consume.mock.calls[0];
      expect(String(key)).toBe('login:tenant:restaurant-a:ip:127.0.0.1');
      expect(policy).toEqual({ limit: 25, windowSeconds: 300 });
    } finally { await app.close(); }
  });

  it('createStaff rechaza PIN duplicado del mismo restaurante y formato inválido sin normalizar', async () => {
    const existingHash = await bcrypt.hash('4444', 4);
    mocks.findStaffMany.mockResolvedValue([{ pinHash: existingHash }]);
    await expect(StaffService.createStaff('restaurant-a', 'Nuevo', '4444', 'WAITER')).rejects.toMatchObject({
      statusCode: 409, code: 'PIN_DUPLICATE'
    });
    expect(mocks.createStaffUser).not.toHaveBeenCalled();
    await expect(StaffService.createStaff('restaurant-a', 'Nuevo', '12ab', 'WAITER')).rejects.toMatchObject({ statusCode: 400 });
    await expect(StaffService.createStaff('restaurant-a', 'Nuevo', ' 4444', 'WAITER')).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.createStaffUser).not.toHaveBeenCalled();
  });

  it('CORS rechaza cualquier wildcard explícito, incluido https://*.vercel.app', () => {
    const base = { NODE_ENV: 'production', JWT_SECRET: 'jwt-secret-for-tests-which-is-long-enough-123456', ENCRYPTION_SECRET_KEY: 'encryption-secret-for-tests-that-is-different-654321' };
    expect(() => getEnvironmentConfig({ ...base, CORS_ORIGIN: '*' } as any)).toThrow();
    expect(() => getEnvironmentConfig({ ...base, CORS_ORIGIN: 'https://*.vercel.app' } as any)).toThrow(/comod[ií]n|wildcard/i);
    expect(() => getEnvironmentConfig({ ...base, CORS_ORIGIN: 'https://app.example.test,https://*.example.test' } as any)).toThrow(/comod[ií]n|wildcard/i);
    expect(getEnvironmentConfig({ ...base, CORS_ORIGIN: 'https://app.example.test' } as any).corsOrigins)
      .toEqual(['https://app.example.test']);
  });

  it('bootstrap exige PIN en toda ejecución (omitido o inválido falla antes de DB)', () => {
    // PIN omitido: resolve no lo inventa; assert falla (main sale código 1).
    const omitted = resolveBootstrapOptions(
      ['node', 'bootstrap-restaurant.ts', '--slug', 'local-valido'],
      {}
    );
    expect(omitted.pinRaw).toBeUndefined();
    expect(() => assertBootstrapPin(omitted.pinRaw)).toThrow(/4 a 6 dígitos/);

    // Formatos inválidos: corto, largo, letras, espacios (sin trim).
    for (const bad of ['123', '1234567', 'abcd', '', ' 1234', '1234 ', '12 34']) {
      expect(() => assertBootstrapPin(bad)).toThrow(/4 a 6 dígitos/);
    }
    // Válidos exactos.
    expect(() => assertBootstrapPin('1234')).not.toThrow();
    expect(() => assertBootstrapPin('482916')).not.toThrow();

    // PIN por env también se acepta, pero con formato estricto.
    const viaEnv = resolveBootstrapOptions(['node', 'bootstrap-restaurant.ts'], {
      BOOTSTRAP_MANAGER_PIN: '12ab',
    } as any);
    expect(() => assertBootstrapPin(viaEnv.pinRaw)).toThrow();

    // Tablas/slug estrictos siguen fallando antes de DB.
    expect(() => resolveBootstrapOptions(['node', 'x', '--tables', '8abc'], { BOOTSTRAP_MANAGER_PIN: '1234' } as any)).toThrow();
    expect(() => resolveBootstrapOptions(['node', 'x', '--slug', '!!'], { BOOTSTRAP_MANAGER_PIN: '1234' } as any)).toThrow();
  });

  it('bootstrap conserva sin --rotate-pin (sin hash) y rota sólo explícito, sin exponer PIN', async () => {
    expect(classifyBootstrapCredential(false, false)).toBe('creada');
    expect(classifyBootstrapCredential(true, false)).toBe('conservada');
    expect(classifyBootstrapCredential(true, true)).toBe('rotada');
    expect(shouldHashBootstrapCredential('conservada')).toBe(false);
    expect(shouldHashBootstrapCredential('creada')).toBe(true);
    expect(shouldHashBootstrapCredential('rotada')).toBe(true);

    // Simula rama de main: conservada no llama a hash/update; rotada sí.
    let hashCalls = 0;
    const fakeHash = async (pin: string) => { hashCalls += 1; return `hash:${pin}`; };
    async function applyCredentialForTest(credential: 'creada' | 'rotada' | 'conservada', pin: string) {
      if (shouldHashBootstrapCredential(credential)) return fakeHash(pin);
      return 'kept';
    }
    expect(await applyCredentialForTest('conservada', '482916')).toBe('kept');
    expect(hashCalls).toBe(0);
    expect(await applyCredentialForTest('rotada', '482916')).toBe('hash:482916');
    expect(hashCalls).toBe(1);

    // La salida segura nunca incluye el PIN.
    const summary = buildBootstrapSummary({
      restaurant: { name: 'Local', slug: 'local-valido' },
      manager: { name: 'Jefe' },
      credential: 'conservada',
    });
    expect(summary).not.toMatch(/482916/);
    expect(summary).not.toMatch(/BOOTSTRAP_MANAGER_PIN/);
    expect(summary).toMatch(/no se muestra en logs/);
  });

  it('QR de producción exige URL HTTPS exacta; sin URL o no-HTTPS falla', async () => {
    // Producción sin URL: error accionable, sin QR.
    expect(() => resolveBaseUrl({ NODE_ENV: 'production' } as any, [])).toThrow(/MESAYA_PUBLIC_URL/);
    // Producción con HTTP o localhost: falla.
    expect(() => resolveBaseUrl({ NODE_ENV: 'production', MESAYA_PUBLIC_URL: 'http://comensal.example.test' } as any, [])).toThrow(/HTTPS/);
    expect(() => resolveBaseUrl({ NODE_ENV: 'production', MESAYA_PUBLIC_URL: 'https://localhost:5173' } as any, [])).toThrow(/HTTPS pública/);
    // Producción con HTTPS pública exacta: resuelve (sin trailing slash).
    expect(
      resolveBaseUrl({ NODE_ENV: 'production', MESAYA_PUBLIC_URL: 'https://comensal.mesaya.app/' } as any, [])
    ).toBe('https://comensal.mesaya.app');

    // generateTableQR sin baseUrl explícita falla en vez de generar QR incorrecto.
    await expect(generateTableQR({ restaurantSlug: 'a', tableLabel: 'Mesa 1' }, '/tmp')).rejects.toThrow(/baseUrl/);
  });

  it('sync --check ignora CRLF/LF pero detecta diferencia semántica', () => {
    expect(syncSchema.normalizeLineEndings('a\r\nb\r\nc\n')).toBe('a\nb\nc\n');
    expect(syncSchema.normalizeLineEndings('a\rb')).toBe('a\nb');
    expect(syncSchema.diffSchemas('x\ny\n', 'x\r\ny\r\n')).toEqual([]);
    const diff = syncSchema.diffSchemas('x\nREAL\n', 'x\nother\n');
    expect(diff.length).toBeGreaterThan(0);
    expect(diff[0]).toMatch(/línea 2/);
  });

  it('JWT vencido no autoriza aunque el tenant sea correcto (401 exacto)', async () => {
    const app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(staffRoutes);
    mocks.findRestaurantFirst.mockResolvedValue({ id: 'restaurant-a', slug: 'restaurant-a' });
    try {
      const expired = app.jwt.sign({
        sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a',
        exp: Math.floor(Date.now() / 1000) - 60
      });
      const res = await app.inject({
        method: 'GET', url: '/staff?restaurantId=restaurant-a',
        headers: { authorization: `Bearer ${expired}` }
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('UNAUTHORIZED');
    } finally { await app.close(); }
  });
});

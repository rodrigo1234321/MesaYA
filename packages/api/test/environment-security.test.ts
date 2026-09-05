import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../src/lib/crypto';
import { getEnvironmentConfig, STAFF_JWT_EXPIRES_IN } from '../src/lib/environment';
import { buildApp } from '../src/index';

const ENV_KEYS = ['NODE_ENV', 'JWT_SECRET', 'ENCRYPTION_SECRET_KEY', 'CORS_ORIGIN'] as const;
let saved: Record<string, string | undefined> = {};

const secureEnv = (overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
  NODE_ENV: 'production',
  JWT_SECRET: 'jwt-secret-for-tests-which-is-long-enough-123456',
  ENCRYPTION_SECRET_KEY: 'encryption-secret-for-tests-that-is-different-654321',
  CORS_ORIGIN: 'https://app.example.test',
  ...overrides
});

beforeEach(() => {
  saved = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('Etapa 05 — entorno, JWT y CORS', () => {
  it('producción rechaza secretos ausentes, conocidos, cortos o iguales antes de iniciar', () => {
    expect(() => getEnvironmentConfig(secureEnv({ JWT_SECRET: undefined }))).toThrow(/JWT_SECRET/);
    expect(() => getEnvironmentConfig(secureEnv({ JWT_SECRET: 'mesaya_jwt_secret_dev_key' }))).toThrow(/JWT_SECRET/);
    expect(() => getEnvironmentConfig(secureEnv({ ENCRYPTION_SECRET_KEY: 'corta' }))).toThrow(/ENCRYPTION_SECRET_KEY/);
    expect(() => getEnvironmentConfig(secureEnv({ ENCRYPTION_SECRET_KEY: 'jwt-secret-for-tests-which-is-long-enough-123456' }))).toThrow(/distintos/);
  });

  it('producción exige CORS explícito y no permite wildcard ni localhost', () => {
    expect(() => getEnvironmentConfig(secureEnv({ CORS_ORIGIN: '*' }))).toThrow(/explícita/);
    expect(() => getEnvironmentConfig(secureEnv({ CORS_ORIGIN: 'http://localhost:5173' }))).toThrow(/localhost/);
    expect(getEnvironmentConfig(secureEnv({ CORS_ORIGIN: 'https://app.example.test,https://admin.example.test' })).corsOrigins)
      .toEqual(['https://app.example.test', 'https://admin.example.test']);
  });

  it('cifrado usa una clave separada del JWT y no hereda cambios de JWT', () => {
    Object.assign(process.env, secureEnv());
    const encrypted = CryptoService.encrypt('dato ficticio');
    process.env.JWT_SECRET = 'otro-jwt-distinto-y-lo-suficientemente-largo-987654';
    expect(CryptoService.decrypt(encrypted)).toBe('dato ficticio');
  });

  it('JWT de staff usa expiración explícita de doce horas y rechaza uno vencido', async () => {
    Object.assign(process.env, secureEnv({ NODE_ENV: 'test', CORS_ORIGIN: 'https://allowed.example.test' }));
    const app = await buildApp();
    try {
      const token = app.jwt.sign({ sub: 'staff-ficticio' }, { expiresIn: STAFF_JWT_EXPIRES_IN });
      const decoded = app.jwt.decode(token) as { iat: number; exp: number };
      expect(decoded.exp - decoded.iat).toBe(12 * 60 * 60);
      expect(app.jwt.verify(token)).toMatchObject({ sub: 'staff-ficticio' });

      const expired = app.jwt.sign({ sub: 'staff-ficticio', exp: Math.floor(Date.now() / 1000) - 1 });
      expect(() => app.jwt.verify(expired)).toThrow();
    } finally {
      await app.close();
    }
  });

  it('origen autorizado recibe CORS y uno no autorizado no recibe permiso', async () => {
    Object.assign(process.env, secureEnv({ NODE_ENV: 'test', CORS_ORIGIN: 'https://allowed.example.test' }));
    const app = await buildApp();
    try {
      const allowed = await app.inject({ method: 'OPTIONS', url: '/v1/health', headers: { origin: 'https://allowed.example.test', 'access-control-request-method': 'GET' } });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example.test');

      const denied = await app.inject({ method: 'OPTIONS', url: '/v1/health', headers: { origin: 'https://denied.example.test', 'access-control-request-method': 'GET' } });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

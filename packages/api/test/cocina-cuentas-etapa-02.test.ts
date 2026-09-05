import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findRestaurantFirst: vi.fn(),
  findRestaurantUnique: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    // Sin modelo rateLimitBucket a propósito: AbuseControlService real hace
    // bypass y los gates no dependen de almacenamiento global.
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findRestaurantFirst(...args),
      findUnique: (...args: unknown[]) => mocks.findRestaurantUnique(...args),
    },
  },
}));

import {
  getRateLimitIp,
  isVercelRuntime,
  parseVercelForwardedFor,
} from '../src/lib/rate-limit-ip';

const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ['CORS_ORIGIN', 'VERCEL']) savedEnv[key] = process.env[key];
  process.env.CORS_ORIGIN = 'https://app.example.test';
  delete process.env.VERCEL;
  mocks.queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  mocks.findRestaurantFirst.mockResolvedValue(null);
  mocks.findRestaurantUnique.mockResolvedValue(null);
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('COCINA-CUENTAS Etapa 02 — contrato IP/proxy y dependencias', () => {
  it('fuera de Vercel ignora x-forwarded-for, x-real-ip y x-vercel-forwarded-for', () => {
    const req: any = {
      ip: '10.0.0.7',
      headers: {
        'x-forwarded-for': '9.9.9.9',
        'x-real-ip': '8.8.8.8',
        'x-vercel-forwarded-for': '7.7.7.7',
      },
    };
    expect(isVercelRuntime({} as any)).toBe(false);
    expect(getRateLimitIp(req, {} as any)).toBe('10.0.0.7');
    // Ni host ni proto alteran la clave: el helper sólo lee IP observada.
    expect(getRateLimitIp({ ...req, headers: { ...req.headers, host: 'evil.test', 'x-forwarded-proto': 'https' } }, {} as any)).toBe(
      '10.0.0.7',
    );
  });

  it('en Vercel usa x-vercel-forwarded-for con parseo estricto y fallback seguro', () => {
    const vercel = { VERCEL: '1' } as any;
    expect(isVercelRuntime(vercel)).toBe(true);
    expect(parseVercelForwardedFor('203.0.113.9')).toBe('203.0.113.9');
    // Lista: sólo el primer token; espacios tolerados.
    expect(parseVercelForwardedFor(' 203.0.113.9 , 70.41.3.18')).toBe('203.0.113.9');
    // IPv6 literal también vale.
    expect(parseVercelForwardedFor('2001:db8::1')).toBe('2001:db8::1');
    // Hostname, puerto, vacío o basura → inválido → fallback.
    for (const bad of ['evil.example.test', '203.0.113.9:443', '', '   ', '999.999.999.999', 'not-an-ip']) {
      expect(parseVercelForwardedFor(bad)).toBeUndefined();
    }
    expect(getRateLimitIp({ ip: '10.0.0.7', headers: { 'x-vercel-forwarded-for': '203.0.113.9' } }, vercel)).toBe(
      '203.0.113.9',
    );
    // Cabeceras clásicas siguen ignoradas incluso en Vercel.
    expect(
      getRateLimitIp(
        { ip: '10.0.0.7', headers: { 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8' } },
        vercel,
      ),
    ).toBe('10.0.0.7');
    // Cabecera inválida → fallback al socket/Fastify, nunca vacío.
    expect(
      getRateLimitIp({ ip: '10.0.0.7', headers: { 'x-vercel-forwarded-for': 'evil.example.test' } }, vercel),
    ).toBe('10.0.0.7');
    expect(getRateLimitIp({ headers: {} }, vercel)).toBe('unknown');
  });

  it('package.json fija fastify/jwt/cors a versiones sin avisos conocidos', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));
    expect(pkg.dependencies.fastify).toBe('5.12.3');
    expect(pkg.dependencies['@fastify/jwt']).toBe('10.2.2');
    expect(pkg.dependencies['@fastify/cors']).toBe('11.3.0');
  });

  it('buildApp desactiva trustProxy explícito y no confía todos los reenvíos', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'index.ts'), 'utf8');
    expect(src).toMatch(/trustProxy:\s*false/);
    expect(src).not.toMatch(/trustProxy:\s*true/);
  });

  it('vercel.json no agrega headers CORS contradictorios', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'vercel.json'), 'utf8');
    const vercel = JSON.parse(raw);
    expect(JSON.stringify(vercel)).not.toMatch(/access-control-allow-origin/i);
    expect(vercel.headers).toBeUndefined();
  });
});

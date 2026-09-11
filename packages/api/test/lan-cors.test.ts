import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getEnvironmentConfig } from '../src/lib/environment';
import { buildApp } from '../src/index';

const LAN_IP = '192.168.1.50';
const LAN_CORS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  `http://${LAN_IP}:5173`,
  `http://${LAN_IP}:5174`,
  `http://${LAN_IP}:5175`
].join(',');

const ENV_KEYS = ['NODE_ENV', 'CORS_ORIGIN'] as const;
let saved: Record<string, string | undefined> = {};

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

describe('CORS LAN arranque dev (sin wildcard)', () => {
  it('lista explícita incluye LAN 5173/5174/5175 y localhost', () => {
    const config = getEnvironmentConfig({ NODE_ENV: 'test', CORS_ORIGIN: LAN_CORS } as NodeJS.ProcessEnv);
    expect(config.corsOrigins).toContain(`http://${LAN_IP}:5173`);
    expect(config.corsOrigins).toContain(`http://${LAN_IP}:5174`);
    expect(config.corsOrigins).toContain(`http://${LAN_IP}:5175`);
    expect(config.corsOrigins).toContain('http://localhost:5173');
    expect(config.corsOrigins).not.toContain('*');
    // No toca process.env: prueba pura sin reinicio del servidor LAN.
    expect(process.env.CORS_ORIGIN).toBe(saved.CORS_ORIGIN);
  });

  it('acepta los tres orígenes LAN y rechaza uno externo', async () => {
    Object.assign(process.env, { NODE_ENV: 'test', CORS_ORIGIN: LAN_CORS });
    const app = await buildApp();
    try {
      for (const port of [5173, 5174, 5175]) {
        const origin = `http://${LAN_IP}:${port}`;
        const res = await app.inject({ method: 'OPTIONS', url: '/v1/health', headers: { origin, 'access-control-request-method': 'GET' } });
        expect(res.headers['access-control-allow-origin']).toBe(origin);
      }
      const denied = await app.inject({ method: 'OPTIONS', url: '/v1/health', headers: { origin: 'https://evil.example.test', 'access-control-request-method': 'GET' } });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

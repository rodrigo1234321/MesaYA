import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findRestaurantFirst: vi.fn(),
  findRestaurantUnique: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    $queryRaw: (...args: unknown[]) => mocks.queryRaw(...args),
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findRestaurantFirst(...args),
      findUnique: (...args: unknown[]) => mocks.findRestaurantUnique(...args),
    },
  },
}));

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

describe('COCINA-CUENTAS Etapa 02 (C07) — handler serverless real sobre HTTP de Node', () => {
  let handler: (req: any, res: any) => Promise<void> | void;
  let server: http.Server;
  let port: number;
  let listenersBefore: number;
  // Última invocación del handler: permite verificar que `await handler`
  // sólo se resuelve cuando la respuesta del servidor ya terminó.
  let lastRes: http.ServerResponse | null = null;
  let lastDone: Promise<void> | null = null;
  // Base de listeners de `res` capturada antes de agregar listeners del
  // test: el handler no debe dejar listeners adicionales respecto de ella.
  let lastBase: { finish: number; close: number; error: number } | null = null;
  let lastTestCleanup: (() => void) | null = null;

  async function rawRequest(
    method: string,
    urlPath: string,
    opts: { headers?: Record<string, string>; body?: string } = {},
  ): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          method,
          path: urlPath,
          headers: { connection: 'close', ...(opts.headers ?? {}) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c) => chunks.push(Buffer.from(c)));
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode ?? 0,
              headers: res.headers as Record<string, string | string[] | undefined>,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', reject);
        },
      );
      req.on('error', reject);
      if (opts.body !== undefined) req.write(opts.body);
      req.end();
    });
  }

  async function settledRequest(
    method: string,
    urlPath: string,
    opts: { headers?: Record<string, string>; body?: string } = {},
  ) {
    lastRes = null;
    lastDone = null;
    lastBase = null;
    lastTestCleanup = null;
    const res = await rawRequest(method, urlPath, opts);
    // El handler debe haber terminado su ciclo HTTP al responder.
    expect(lastDone).not.toBeNull();
    await lastDone;
    // Limpieza explícita del listener temporal del test antes de verificar.
    try {
      lastTestCleanup?.();
    } finally {
      lastTestCleanup = null;
    }
    // Al `await handler` la respuesta ya terminó y el handler no dejó
    // listeners adicionales respecto de la base capturada al entrar.
    expect(lastBase).not.toBeNull();
    expect(lastRes?.writableEnded).toBe(true);
    expect(lastRes?.listenerCount('finish')).toBe(lastBase?.finish);
    expect(lastRes?.listenerCount('close')).toBe(lastBase?.close);
    expect(lastRes?.listenerCount('error')).toBe(lastBase?.error);
    return res;
  }

  beforeAll(async () => {
    const entryUrl = pathToFileURL(path.resolve(__dirname, '..', '..', '..', 'api', 'index.ts')).href;
    const mod = (await import(entryUrl)) as { default: unknown };
    expect(typeof mod.default).toBe('function');
    handler = mod.default as (req: any, res: any) => Promise<void>;
    listenersBefore = process.listenerCount('unhandledRejection');
    // Servidor HTTP REAL de Node (no app.inject): el handler serverless
    // atiende sockets verdaderos; se hace `await` del handler para probar
    // que la promesa espera el fin real de la respuesta.
    server = http.createServer((req, res) => {
      // Capturar la base ANTES de agregar listeners del test.
      const base = {
        finish: res.listenerCount('finish'),
        close: res.listenerCount('close'),
        error: res.listenerCount('error'),
      };
      lastBase = base;
      lastRes = res as http.ServerResponse;
      // Listener temporal del test (observación); se remueve en
      // `settledRequest` antes de verificar la base.
      const onTestObserveFinish = () => {};
      res.on('finish', onTestObserveFinish);
      lastTestCleanup = () => {
        res.removeListener('finish', onTestObserveFinish);
      };
      lastDone = Promise.resolve(handler(req, res));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const addr = server.address();
    expect(addr).toBeTypeOf('object');
    port = (addr as import('node:net').AddressInfo).port;
  }, 30000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
    expect(server.listening).toBe(false);
    expect(process.listenerCount('unhandledRejection')).toBe(listenersBefore);
  });

  it('GET /health responde ok y el await del handler llega con respuesta terminada', async () => {
    const res = await settledRequest('GET', '/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"ok"');
  });

  it('GET /v1/health responde ok y el await del handler llega con respuesta terminada', async () => {
    const res = await settledRequest('GET', '/v1/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('"status":"ok"');
  });

  it('POST /v1/auth/login-admin con JSON inválido responde 400 y termina', async () => {
    const res = await settledRequest('POST', '/v1/auth/login-admin', {
      headers: { 'content-type': 'application/json', 'content-length': String('{no-json'.length) },
      body: '{no-json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('POST /v1/auth/login-admin estructural válido sin restaurante responde 404 (no cuelga)', async () => {
    mocks.findRestaurantFirst.mockResolvedValueOnce(null);
    const payload = JSON.stringify({ restaurantSlug: 'inexistente', pin: '1234' });
    const res = await settledRequest('POST', '/v1/auth/login-admin', {
      headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
      body: payload,
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /v1/auth/login-admin estructural válido con PIN errado responde 401 sin token', async () => {
    const pinHash = await bcrypt.hash('2222', 4);
    mocks.findRestaurantFirst.mockResolvedValueOnce({
      id: 'restaurant-a',
      slug: 'a',
      staffUsers: [{ id: 'manager', name: 'Jefe', role: 'MANAGER', pinHash }],
    });
    const payload = JSON.stringify({ restaurantSlug: 'a', pin: '0000' });
    const res = await settledRequest('POST', '/v1/auth/login-admin', {
      headers: { 'content-type': 'application/json', 'content-length': String(payload.length) },
      body: payload,
    });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('token');
  });

  it('OPTIONS CORS: origen permitido recibe allow-origin; denegado no', async () => {
    const allowed = await settledRequest('OPTIONS', '/v1/auth/login-admin', {
      headers: {
        origin: 'https://app.example.test',
        'access-control-request-method': 'POST',
      },
    });
    expect([200, 204]).toContain(allowed.statusCode);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.test');

    const denied = await settledRequest('OPTIONS', '/v1/auth/login-admin', {
      headers: {
        origin: 'https://evil.example.test',
        'access-control-request-method': 'POST',
      },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

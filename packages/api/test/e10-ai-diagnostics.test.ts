import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  restaurantFindUnique: vi.fn(),
  staffFind: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findFirst(...args),
      findUnique: (...args: unknown[]) => mocks.restaurantFindUnique(...args)
    },
    staffUser: {
      findUnique: (...args: unknown[]) => mocks.staffFind(...args)
    }
  }
}));

import { AIService } from '../src/services/ai.service';
import { menuRoutes } from '../src/routes/menu.routes';
import { AiDiagnosticCategory } from '@mesaya/shared';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ENV_KEYS = [
  'ENABLE_AI_FEATURES',
  'AI_FEATURE_ENABLED',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_FALLBACK_MODEL',
  'AI_TIMEOUT_MS'
] as const;

let savedEnv: Record<string, string | undefined> = {};

function clearAiKeys() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function geminiPingResponse(text = 'pong') {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }]
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '100' }
    }
  );
}

function geminiErrorResponse(status: number, errorBody: Record<string, unknown>) {
  return new Response(JSON.stringify(errorBody), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  clearAiKeys();
  fetchMock.mockReset();
  mocks.findFirst.mockReset();
  mocks.restaurantFindUnique.mockReset();
  mocks.staffFind.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    else delete process.env[k];
  }
});

describe('E10 — Diagnóstico seguro de API key, proveedor, modelo y cuota', () => {
  describe('1. Estado deshabilitado y clave faltante (sin llamadas al proveedor)', () => {
    it('sin flag ENABLE_AI_FEATURES: diagnóstico sin probe devuelve enabled=false y probe=null', async () => {
      process.env.GOOGLE_API_KEY = 'AIzaSySecretGoogleKey';

      const diag = await AIService.getDiagnostics({ probe: false });

      expect(diag.enabled).toBe(false);
      expect(diag.keyConfigured).toBe(true);
      expect(diag.keySource).toBe('GOOGLE_API_KEY');
      expect(diag.probe).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sin flag ENABLE_AI_FEATURES: probe explícito devuelve DISABLED sin llamar a fetch', async () => {
      process.env.GOOGLE_API_KEY = 'AIzaSySecretGoogleKey';

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.enabled).toBe(false);
      expect(diag.probe).not.toBeNull();
      expect(diag.probe?.category).toBe(AiDiagnosticCategory.DISABLED);
      expect(diag.probe?.attemptedModel).toBeNull();
      expect(diag.probe?.httpStatus).toBeNull();
      expect(diag.probe?.retryable).toBe(false);
      expect(typeof diag.probe?.checkedAt).toBe('string');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('con flag pero sin claves: probe explícito devuelve MISSING_KEY sin llamar a fetch', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.enabled).toBe(true);
      expect(diag.keyConfigured).toBe(false);
      expect(diag.keySource).toBe('none');
      expect(diag.probe?.category).toBe(AiDiagnosticCategory.MISSING_KEY);
      expect(diag.probe?.attemptedModel).toBeNull();
      expect(diag.probe?.httpStatus).toBeNull();
      expect(diag.probe?.retryable).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('2. Precedencia de claves oficiales y modelos estables vigentes', () => {
    it('preferencia oficial: GOOGLE_API_KEY tiene precedencia si ambas están presentes', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'AIzaSyPrimaryGoogleKey';
      process.env.GEMINI_API_KEY = 'AIzaSySecondaryGeminiKey';

      fetchMock.mockResolvedValue(geminiPingResponse());

      const meta = AIService.getKeyMetadata();
      expect(meta.source).toBe('GOOGLE_API_KEY');
      expect(meta.configured).toBe(true);

      const diag = await AIService.getDiagnostics({ probe: true });
      expect(diag.keySource).toBe('GOOGLE_API_KEY');
      expect(diag.keyConfigured).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('AIzaSyPrimaryGoogleKey');
    });

    it('soporta GEMINI_API_KEY cuando GOOGLE_API_KEY no está configurada', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GEMINI_API_KEY = 'AIzaSyOnlyGeminiKey';

      fetchMock.mockResolvedValue(geminiPingResponse());

      const meta = AIService.getKeyMetadata();
      expect(meta.source).toBe('GEMINI_API_KEY');
      expect(meta.configured).toBe(true);

      const diag = await AIService.getDiagnostics({ probe: true });
      expect(diag.keySource).toBe('GEMINI_API_KEY');
      expect(fetchMock.mock.calls[0][1].headers['x-goog-api-key']).toBe('AIzaSyOnlyGeminiKey');
    });

    it('no expone métodos públicos que devuelvan claves de API en crudo y getKeyMetadata retorna sólo metadatos seguros', () => {
      expect((AIService as any).getKeyInfo).toBeUndefined();
      const meta = AIService.getKeyMetadata();
      expect(meta).toHaveProperty('configured');
      expect(meta).toHaveProperty('source');
      expect((meta as any).apiKey).toBeUndefined();
      expect((meta as any).key).toBeUndefined();
    });

    it('modelos vigentes al 2026-09-21: por defecto gemini-3.8-flash (primario) y gemini-3.5-flash-lite (fallback)', async () => {
      const diag = await AIService.getDiagnostics({ probe: false });

      expect(diag.primaryModel).toBe('gemini-3.8-flash');
      expect(diag.fallbackModel).toBe('gemini-3.5-flash-lite');
      expect(diag.usingDefaults).toBe(true);
      expect(diag.fallbackLocalAvailable).toBe(true);
    });

    it('modelos configurables por variables de entorno desactivan usingDefaults', async () => {
      process.env.GEMINI_MODEL = 'gemini-custom-flash';
      process.env.GEMINI_FALLBACK_MODEL = 'gemini-custom-lite';

      const diag = await AIService.getDiagnostics({ probe: false });

      expect(diag.primaryModel).toBe('gemini-custom-flash');
      expect(diag.fallbackModel).toBe('gemini-custom-lite');
      expect(diag.usingDefaults).toBe(false);
    });
  });

  describe('3. Clasificación segura de errores del proveedor (probe)', () => {
    beforeEach(() => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'AIzaSyValidFormatKey';
    });

    it('probe exitoso: devuelve READY con status 200 y retryable=false', async () => {
      fetchMock.mockResolvedValue(geminiPingResponse('pong'));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.READY);
      expect(diag.probe?.attemptedModel).toBe('gemini-3.8-flash');
      expect(diag.probe?.httpStatus).toBe(200);
      expect(diag.probe?.retryable).toBe(false);
    });

    it('HTTP 401: clasifica como INVALID_KEY, retryable=false', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(401, {
        error: { code: 401, status: 'UNAUTHENTICATED', message: 'API key not valid. Please pass a valid API key.' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.INVALID_KEY);
      expect(diag.probe?.httpStatus).toBe(401);
      expect(diag.probe?.retryable).toBe(false);
    });

    it('HTTP 403: clasifica como PERMISSION_DENIED, retryable=false', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(403, {
        error: { code: 403, status: 'PERMISSION_DENIED', message: 'User location is not supported or API disabled.' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.PERMISSION_DENIED);
      expect(diag.probe?.httpStatus).toBe(403);
      expect(diag.probe?.retryable).toBe(false);
    });

    it('HTTP 404: modelo obsoleto o inexistente clasifica como MODEL_NOT_FOUND', async () => {
      process.env.GEMINI_MODEL = 'gemini-1.5-flash';
      fetchMock.mockResolvedValue(geminiErrorResponse(404, {
        error: { code: 404, status: 'NOT_FOUND', message: 'models/gemini-1.5-flash is not found or retired.' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.MODEL_NOT_FOUND);
      expect(diag.probe?.attemptedModel).toBe('gemini-1.5-flash');
      expect(diag.probe?.httpStatus).toBe(404);
      expect(diag.probe?.retryable).toBe(false);
    });

    it('HTTP 400 con FAILED_PRECONDITION: clasifica como BILLING_DISABLED', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(400, {
        error: { code: 400, status: 'FAILED_PRECONDITION', message: 'Billing account not enabled.' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.BILLING_DISABLED);
      expect(diag.probe?.httpStatus).toBe(400);
      expect(diag.probe?.retryable).toBe(false);
    });

    it('HTTP 400 con INVALID_ARGUMENT: clasifica como INVALID_REQUEST', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(400, {
        error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Request payload invalid.' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.INVALID_REQUEST);
      expect(diag.probe?.httpStatus).toBe(400);
      expect(diag.probe?.retryable).toBe(false);
    });

    it('HTTP 429 con RESOURCE_EXHAUSTED / QUOTA_EXCEEDED: clasifica como QUOTA_EXHAUSTED, retryable=false', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(429, {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          details: [{ reason: 'QUOTA_EXCEEDED' }]
        }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.QUOTA_EXHAUSTED);
      expect(diag.probe?.httpStatus).toBe(429);
      expect(diag.probe?.retryable).toBe(false);
    });

    it('HTTP 429 con RATE_LIMIT_EXCEEDED: clasifica como RATE_LIMITED, retryable=true', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(429, {
        error: {
          code: 429,
          status: 'RESOURCE_EXHAUSTED',
          details: [{ reason: 'RATE_LIMIT_EXCEEDED' }]
        }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.RATE_LIMITED);
      expect(diag.probe?.httpStatus).toBe(429);
      expect(diag.probe?.retryable).toBe(true);
    });

    it('HTTP 503: proveedor no disponible clasifica como PROVIDER_UNAVAILABLE, retryable=true', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(503, {
        error: { code: 503, status: 'UNAVAILABLE', message: 'The model is overloaded. Please try again later.' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.PROVIDER_UNAVAILABLE);
      expect(diag.probe?.httpStatus).toBe(503);
      expect(diag.probe?.retryable).toBe(true);
    });

    it('timeout / abort: clasifica como TIMEOUT con httpStatus=null y retryable=true', async () => {
      process.env.AI_TIMEOUT_MS = '40';
      fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => {
        return new Promise((_, reject) => {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.TIMEOUT);
      expect(diag.probe?.httpStatus).toBeNull();
      expect(diag.probe?.retryable).toBe(true);
    });

    it('HTTP 429 sin motivo explícito o con motivo desconocido NO asume cuota agotada y clasifica como RATE_LIMITED (retryable=true)', async () => {
      // Caso 1: status RESOURCE_EXHAUSTED pero sin campo reason
      fetchMock.mockResolvedValueOnce(geminiErrorResponse(429, {
        error: { code: 429, status: 'RESOURCE_EXHAUSTED' }
      }));

      const diag1 = await AIService.getDiagnostics({ probe: true });
      expect(diag1.probe?.category).toBe(AiDiagnosticCategory.RATE_LIMITED);
      expect(diag1.probe?.httpStatus).toBe(429);
      expect(diag1.probe?.retryable).toBe(true);

      // Caso 2: motivo desconocido fuera de la lista blanca
      fetchMock.mockResolvedValueOnce(geminiErrorResponse(429, {
        error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ reason: 'CONCURRENT_REQUESTS_EXCEEDED' }] }
      }));

      const diag2 = await AIService.getDiagnostics({ probe: true });
      expect(diag2.probe?.category).toBe(AiDiagnosticCategory.RATE_LIMITED);
      expect(diag2.probe?.httpStatus).toBe(429);
      expect(diag2.probe?.retryable).toBe(true);

      // Caso 3: cuerpo vacío o sin estructura error
      fetchMock.mockResolvedValueOnce(geminiErrorResponse(429, {}));

      const diag3 = await AIService.getDiagnostics({ probe: true });
      expect(diag3.probe?.category).toBe(AiDiagnosticCategory.RATE_LIMITED);
      expect(diag3.probe?.httpStatus).toBe(429);
      expect(diag3.probe?.retryable).toBe(true);
    });

    it('cuerpo de error sobredimensionado (> 8KB): aborta lectura, clasifica de forma segura sin fugar cuerpo crudo y cancela el stream', async () => {
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      const chunkSize = 1024;
      let sent = 0;
      const totalBytes = 16 * 1024;
      const stream = new ReadableStream({
        pull(controller) {
          if (sent >= totalBytes) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(chunkSize).fill(120));
          sent += chunkSize;
        },
        cancel() {
          cancelSpy();
        }
      });

      fetchMock.mockResolvedValue(new Response(stream, {
        status: 429,
        headers: { 'content-type': 'application/json' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      // Un 429 cuyo cuerpo excedió el límite no debe asumir cuota; mapea a RATE_LIMITED de forma segura
      expect(diag.probe?.category).toBe(AiDiagnosticCategory.RATE_LIMITED);
      expect(diag.probe?.httpStatus).toBe(429);
      expect(diag.probe?.retryable).toBe(true);
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('probe exitoso con cuerpo sobredimensionado (> 256KB): aborta lectura, clasifica como INVALID_RESPONSE y cancela el stream', async () => {
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      const chunkSize = 64 * 1024;
      let sent = 0;
      const totalBytes = 1024 * 1024;
      const stream = new ReadableStream({
        pull(controller) {
          if (sent >= totalBytes) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(chunkSize).fill(65));
          sent += chunkSize;
        },
        cancel() {
          cancelSpy();
        }
      });

      fetchMock.mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.INVALID_RESPONSE);
      expect(diag.probe?.httpStatus).toBe(200);
      expect(diag.probe?.retryable).toBe(false);
      expect(cancelSpy).toHaveBeenCalled();
    });

    it('respuesta 200 con JSON inválido o malformado: clasifica como INVALID_RESPONSE', async () => {
      fetchMock.mockResolvedValue(new Response('<html><body>502 Bad Gateway Nginx</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });

      expect(diag.probe?.category).toBe(AiDiagnosticCategory.INVALID_RESPONSE);
      expect(diag.probe?.httpStatus).toBe(200);
      expect(diag.probe?.retryable).toBe(false);
    });
  });

  describe('4. Aislamiento de reintentos y contención de fugas de datos', () => {
    beforeEach(() => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'AIzaSyValidFormatKey';
      process.env.GEMINI_MODEL = 'gemini-primary';
      process.env.GEMINI_FALLBACK_MODEL = 'gemini-fallback';
    });

    it('errores no-retryables (401, 403, 400, 429 cuota) NO reintentan el modelo fallback', async () => {
      fetchMock.mockResolvedValue(geminiErrorResponse(401, {
        error: { code: 401, status: 'UNAUTHENTICATED' }
      }));

      const res = await AIService.generateMenu({ prompt: 'concepto gourmet' });

      // Se intentó sólo el primer modelo; no multiplica consultas ni reintenta la misma clave inválida
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toContain('gemini-primary');
      expect(res.degraded).toBe(true);
      expect(res.poweredBy).toBe('local-fallback');
    });

    it('MODEL_NOT_FOUND (404) sí prueba el modelo fallback configurado', async () => {
      fetchMock
        .mockResolvedValueOnce(geminiErrorResponse(404, { error: { status: 'NOT_FOUND' } }))
        .mockResolvedValueOnce(geminiPingResponse(JSON.stringify({
          suggestedTemplateId: 'GOURMET_OBSIDIAN',
          themeColor: '#f59e0b',
          categories: [{
            name: 'Entradas',
            icon: '🍽️',
            items: [{ name: 'Plato A', price: 5000, tags: [], isFeatured: true }]
          }]
        })));

      const res = await AIService.generateMenu({ prompt: 'concepto gourmet' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain('gemini-primary');
      expect(fetchMock.mock.calls[1][0]).toContain('gemini-fallback');
      expect(res.degraded).toBe(false);
      expect(res.poweredBy).toBe('gemini');
    });

    it('jamás expone credenciales ni cuerpos de error crudos en la respuesta o en los logs', async () => {
      const sensitiveLeak = 'CRITICAL_SECRET_LEAK_AIzaSyFakeKeyEchoedByProvider';
      const consoleWarnSpy = vi.spyOn(console, 'warn');
      const consoleErrorSpy = vi.spyOn(console, 'error');

      fetchMock.mockResolvedValue(geminiErrorResponse(401, {
        error: {
          code: 401,
          status: 'UNAUTHENTICATED',
          message: `API key not valid. Full key was: ${sensitiveLeak}`,
          details: [{ rawEcho: sensitiveLeak }]
        }
      }));

      const diag = await AIService.getDiagnostics({ probe: true });
      const diagJson = JSON.stringify(diag);

      // Ni en el DTO de diagnóstico
      expect(diagJson).not.toContain(sensitiveLeak);
      expect(diagJson).not.toContain('API key not valid');

      // Ni en ningún console.warn / console.error
      for (const call of consoleWarnSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(sensitiveLeak);
      }
      for (const call of consoleErrorSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(sensitiveLeak);
      }

      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('generación de menú con cuerpo de éxito sobredimensionado (> 256KB): cancela stream y degrada de forma segura', async () => {
      const cancelSpy = vi.fn().mockResolvedValue(undefined);
      const chunkSize = 64 * 1024;
      let sent = 0;
      const totalBytes = 1024 * 1024;
      const stream = new ReadableStream({
        pull(controller) {
          if (sent >= totalBytes) {
            controller.close();
            return;
          }
          controller.enqueue(new Uint8Array(chunkSize).fill(65));
          sent += chunkSize;
        },
        cancel() {
          cancelSpy();
        }
      });

      fetchMock.mockResolvedValue(new Response(stream, {
        status: 200,
        headers: { 'content-type': 'application/json' }
      }));

      const res = await AIService.generateMenu({ prompt: 'concepto gourmet' });

      expect(res.degraded).toBe(true);
      expect(res.poweredBy).toBe('local-fallback');
      expect(cancelSpy).toHaveBeenCalled();
    });
  });

  describe('5. Ruta HTTP GET /v1/restaurants/:slugOrId/ai/diagnostics', () => {
    let app: any;

    beforeEach(async () => {
      app = Fastify();
      await app.register(jwt, { secret: 'jwt-secret-for-ai-diagnostics-testing-at-least-32-chars' });
      await app.register(menuRoutes, { prefix: '/v1' });
      await app.ready();
    });

    afterEach(async () => {
      await app.close();
    });

    it('rechaza llamada anónima con 401 UNAUTHORIZED', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/restaurants/rest-ficticio/ai/diagnostics'
      });

      expect(res.statusCode).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rechaza rol no-manager (WAITER) con 403 FORBIDDEN', async () => {
      mocks.staffFind.mockResolvedValue({ id: 'waiter-1', role: 'WAITER', restaurantId: 'rest-ficticio' });
      const waiterToken = app.jwt.sign({ sub: 'waiter-1', role: 'WAITER', restaurantId: 'rest-ficticio' });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/restaurants/rest-ficticio/ai/diagnostics',
        headers: { authorization: `Bearer ${waiterToken}` }
      });

      expect(res.statusCode).toBe(403);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rechaza manager de otro tenant con 404 NOT_FOUND', async () => {
      mocks.findFirst.mockResolvedValue({ id: 'rest-distinto', slug: 'rest-distinto' });
      mocks.staffFind.mockResolvedValue({ id: 'manager-2', role: 'MANAGER', restaurantId: 'rest-otro' });
      const foreignManagerToken = app.jwt.sign({ sub: 'manager-2', role: 'MANAGER', restaurantId: 'rest-otro' });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/restaurants/rest-distinto/ai/diagnostics',
        headers: { authorization: `Bearer ${foreignManagerToken}` }
      });

      expect(res.statusCode).toBe(404);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('permite a manager autorizado consultar diagnóstico sin probe (sin llamar a fetch)', async () => {
      mocks.findFirst.mockResolvedValue({ id: 'rest-ficticio', slug: 'rest-ficticio' });
      mocks.staffFind.mockResolvedValue({ id: 'manager-1', role: 'MANAGER', restaurantId: 'rest-ficticio' });
      const managerToken = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'rest-ficticio' });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/restaurants/rest-ficticio/ai/diagnostics?probe=false',
        headers: { authorization: `Bearer ${managerToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.provider).toBe('gemini');
      expect(body.probe).toBeNull();
      expect(body.fallbackLocalAvailable).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('permite a manager autorizado ejecutar probe explícito con ?probe=true', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'AIzaSyValidFormatKey';
      fetchMock.mockResolvedValue(geminiPingResponse('pong'));

      mocks.findFirst.mockResolvedValue({ id: 'rest-ficticio', slug: 'rest-ficticio' });
      mocks.staffFind.mockResolvedValue({ id: 'manager-1', role: 'MANAGER', restaurantId: 'rest-ficticio' });
      const managerToken = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'rest-ficticio' });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/restaurants/rest-ficticio/ai/diagnostics?probe=true',
        headers: { authorization: `Bearer ${managerToken}` }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.probe).not.toBeNull();
      expect(body.probe.category).toBe(AiDiagnosticCategory.READY);
      expect(body.probe.httpStatus).toBe(200);
      expect(body.probe.attemptedModel).toBe('gemini-3.8-flash');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

// Contención IA etapa 04: fixtures ficticias y mocks. Sin .env ni DB real.
// Cubre: clave sólo Notion (fetch no llamado), sin clave, respuesta inválida,
// catálogo sin coincidencias, catálogo con tags (sin promesa de seguridad),
// IDs desconocidos de Gemini y autoApply=true sin mutaciones.

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  restaurantUpdate: vi.fn(),
  categoryDeleteMany: vi.fn(),
  categoryCreate: vi.fn(),
  itemCreate: vi.fn(),
  tx: vi.fn(),
  staffFind: vi.fn(),
  sessionFindUnique: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findFirst(...args),
      update: (...args: unknown[]) => mocks.restaurantUpdate(...args)
    },
    menuCategory: {
      deleteMany: (...args: unknown[]) => mocks.categoryDeleteMany(...args),
      create: (...args: unknown[]) => mocks.categoryCreate(...args)
    },
    menuItem: {
      create: (...args: unknown[]) => mocks.itemCreate(...args)
    },
    staffUser: {
      findUnique: (...args: unknown[]) => mocks.staffFind(...args)
    },
    tableSession: {
      findUnique: (...args: unknown[]) => mocks.sessionFindUnique(...args)
    },
    $transaction: (...args: unknown[]) => mocks.tx(...args)
  }
}));

import { AIService } from '../src/services/ai.service';
import { menuRoutes, SommelierQuotaManager } from '../src/routes/menu.routes';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const ENV_KEYS = [
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'NOTION_API_KEY',
  'NOTION_TOKEN',
  'ENABLE_AI_FEATURES',
  'AI_FEATURE_ENABLED',
  'GEMINI_MODEL',
  'GEMINI_FALLBACK_MODEL',
  'AI_TIMEOUT_MS'
] as const;
let savedEnv: Record<string, string | undefined> = {};

function clearAiKeys() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function itemRow(id: string, name: string, tags: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    name,
    description: `Descripción ficticia de ${name}`,
    price: 1000,
    imageUrl: null,
    isAvailable: true,
    isFeatured: false,
    categoryId: 'cat-ficticia',
    orderIndex: 0,
    tags: JSON.stringify(tags),
    ...extra
  };
}

function fakeRestaurant(rows: ReturnType<typeof itemRow>[]) {
  return {
    id: 'rest-ficticio',
    name: 'Rest Ficticio',
    categories: [{ id: 'cat-ficticia', items: rows }]
  };
}

function geminiJsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    text: async () => '',
    json: async () => ({
      candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }]
    })
  };
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  clearAiKeys();
  fetchMock.mockReset();
  SommelierQuotaManager.reset();
  for (const m of [
    mocks.findFirst,
    mocks.restaurantUpdate,
    mocks.categoryDeleteMany,
    mocks.categoryCreate,
    mocks.itemCreate,
    mocks.tx,
    mocks.staffFind,
    mocks.sessionFindUnique
  ]) {
    m.mockReset();
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    else delete process.env[k];
  }
});

describe('Etapa 04 — Contención IA', () => {
  it('clave sólo Notion no se usa como fallback: fetch no llamado y degradado explícito', async () => {
    process.env.NOTION_API_KEY = 'ntn_ficticia';
    process.env.NOTION_TOKEN = 'ntn_ficticia_2';

    const res = await AIService.generateMenu({ prompt: 'concepto ficticio' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.degraded).toBe(true);
    expect(res.categories).toEqual([]);
    expect(res.applied).toBe(false);
    expect(res.reviewNote).toMatch(/revisi.+humana/i);
  });

  it('sin clave: degradado explícito sin llamar a fetch', async () => {
    const res = await AIService.generateMenu({ prompt: 'concepto ficticio' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.degraded).toBe(true);
    expect(res.applied).toBe(false);
    expect(res.categories).toEqual([]);
  });

  it('respuesta inválida del proveedor: degradado explícito sin categorías inventadas', async () => {
    process.env.ENABLE_AI_FEATURES = 'true';
    process.env.GEMINI_API_KEY = 'g-ficticia';
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
      json: async () => ({
        candidates: [{ content: { parts: [{ text: 'esto no es un json válido ###' }] } }]
      })
    });

    const res = await AIService.generateMenu({ prompt: 'concepto ficticio' });

    expect(fetchMock).toHaveBeenCalled();
    expect(res.degraded).toBe(true);
    expect(res.applied).toBe(false);
    expect(res.categories).toEqual([]);
  });

  it('respuesta válida: preview con applied=false pendiente de revisión humana', async () => {
    process.env.ENABLE_AI_FEATURES = 'true';
    process.env.GEMINI_API_KEY = 'g-ficticia';
    fetchMock.mockResolvedValue(
      geminiJsonResponse({
        suggestedTemplateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        categories: [
          {
            name: 'Ficticia',
            icon: '🍽️',
            items: [{ name: 'Plato Ficticio', description: 'x', price: 1000, tags: [], isFeatured: false }]
          }
        ]
      })
    );

    const res = await AIService.generateMenu({ prompt: 'concepto ficticio', autoApply: true });

    expect(res.degraded).toBe(false);
    expect(res.applied).toBe(false);
    expect(res.categories.length).toBe(1);
    expect(res.reviewNote).toMatch(/revisi.+humana/i);
  });

  it('catálogo sin coincidencias dietarias: abstención sin platos arbitrarios y deriva al personal', async () => {
    process.env.GEMINI_API_KEY = 'g-ficticia';
    mocks.findFirst.mockResolvedValue(
      fakeRestaurant([itemRow('m1', 'Bife de Chorizo Ficticio', []), itemRow('p1', 'Spaghetti Ficticios', [])])
    );

    const res = await AIService.askSommelier('rest-ficticio', 'soy celiaco, que puedo comer sin tacc?');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(res.recommendedDishIds).toEqual([]);
    expect(res.suggestedDishes).toEqual([]);
    expect(res.answer).toMatch(/personal/i);
    expect(res.answer).toMatch(/no garantizan/i);
    expect(res.answer).not.toMatch(/100\s?%|trazabilidad/i);
  });

  it('consulta de alergia: abstención completa con derivación al personal', async () => {
    mocks.findFirst.mockResolvedValue(
      fakeRestaurant([itemRow('g1', 'Ensalada Ficticia', ['GLUTEN_FREE'])])
    );

    const res = await AIService.askSommelier('rest-ficticio', 'tengo alergia severa a frutos secos, que me recomiendan?');

    expect(res.recommendedDishIds).toEqual([]);
    expect(res.suggestedDishes).toEqual([]);
    expect(res.answer).toMatch(/personal/i);
  });

  it('catálogo con tags: sugiere sólo coincidencias y sin promesa de seguridad', async () => {
    mocks.findFirst.mockResolvedValue(
      fakeRestaurant([
        itemRow('g1', 'Ensalada Verde Ficticia', ['GLUTEN_FREE']),
        itemRow('m1', 'Bife de Chorizo Ficticio', [])
      ])
    );

    const res = await AIService.askSommelier('rest-ficticio', 'busco opciones sin tacc');

    expect(res.recommendedDishIds).toEqual(['g1']);
    expect(res.suggestedDishes.map((d) => d.id)).toEqual(['g1']);
    expect(res.answer).not.toMatch(/100\s?%|trazabilidad/i);
    expect(res.answer).toMatch(/etiquetas no garantizan|personal/i);
  });

  it('diferencia vegano de vegetariano: vegan estricto no devuelve sólo-vegetariano', async () => {
    mocks.findFirst.mockResolvedValue(
      fakeRestaurant([
        itemRow('v1', 'Tarta de Verduras Ficticia', ['VEGETARIAN']),
        itemRow('vg1', 'Bowl Vegano Ficticio', ['VEGAN'])
      ])
    );

    const vegan = await AIService.askSommelier('rest-ficticio', 'quiero algo vegan');
    expect(vegan.recommendedDishIds).toEqual(['vg1']);

    const vegetariano = await AIService.askSommelier('rest-ficticio', 'quiero algo vegetariano');
    expect(vegetariano.recommendedDishIds).toContain('v1');
  });

  it('IDs desconocidos de Gemini se descartan: nunca se sugieren platos inexistentes', async () => {
    process.env.ENABLE_AI_FEATURES = 'true';
    process.env.GEMINI_API_KEY = 'g-ficticia';
    process.env.GEMINI_MODEL = 'gemini-1.5-flash';
    process.env.GEMINI_FALLBACK_MODEL = 'gemini-1.5-flash';
    mocks.findFirst.mockResolvedValue(
      fakeRestaurant([
        itemRow('p1', 'Spaghetti Ficticios', [], { isFeatured: true }),
        itemRow('p2', 'Ravioles Ficticios', [], { isFeatured: true })
      ])
    );
    fetchMock.mockResolvedValue(
      geminiJsonResponse({
        answer: 'Te recomiendo estas opciones ficticias.',
        recommendedDishIds: ['p1', 'id-desconocido-1'],
        suggestedPairing: 'Agua'
      })
    );

    const res = await AIService.askSommelier('rest-ficticio', 'quiero pasta');

    expect(res.recommendedDishIds).not.toContain('id-desconocido-1');
    expect(res.recommendedDishIds).not.toContain('id-desconocido-2');
    expect(res.recommendedDishIds).not.toContain('p1');
    expect(res.poweredBy).toBe('heuristic-engine');
    for (const d of res.suggestedDishes) {
      expect(['p1', 'p2']).toContain(d.id);
    }
  });

  it('autoApply=true en la ruta jamás escribe ni borra menú: sólo preview', async () => {
    mocks.findFirst.mockResolvedValue({ id: 'rest-ficticio', name: 'Rest Ficticio' });
    mocks.staffFind.mockResolvedValue({ id: 'manager-ficticio', name: 'Manager Ficticio', role: 'MANAGER', restaurantId: 'rest-ficticio', assignedSector: null });
    const app = Fastify();
    await app.register(jwt, { secret: 'jwt-secret-for-ai-containment-tests-which-is-long-enough' });
    await app.register(menuRoutes, { prefix: '/v1' });
    await app.ready();

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/restaurants/rest-ficticio/menu/ai-generate',
        headers: { authorization: `Bearer ${app.jwt.sign({ sub: 'manager-ficticio', role: 'MANAGER', restaurantId: 'rest-ficticio' })}` },
        payload: { prompt: 'concepto ficticio', autoApply: true }
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.applied).toBe(false);
      expect(mocks.tx).not.toHaveBeenCalled();
      expect(mocks.restaurantUpdate).not.toHaveBeenCalled();
      expect(mocks.categoryDeleteMany).not.toHaveBeenCalled();
      expect(mocks.categoryCreate).not.toHaveBeenCalled();
      expect(mocks.itemCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  describe('Etapa 20 — Acotar generación IA, validación de runtime y cuotas', () => {
    it('por defecto (ENABLE_AI_FEATURES !== true): jamás llama al proveedor externo aunque exista API key', async () => {
      process.env.GEMINI_API_KEY = 'g-key-valida';
      delete process.env.ENABLE_AI_FEATURES;
      delete process.env.AI_FEATURE_ENABLED;

      const res = await AIService.generateMenu({ prompt: 'concepto gourmet' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.degraded).toBe(true);
      expect(res.applied).toBe(false);
      expect(res.categories).toEqual([]);
      expect(res.reviewNote).toMatch(/deshabilitada/i);
    });

    it('valida inputs de generación con schema Zod: rechaza prompt vacío o menor a 3 caracteres', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GEMINI_API_KEY = 'g-key-valida';

      const res = await AIService.generateMenu({ prompt: 'ab' });

      expect(fetchMock).not.toHaveBeenCalled();
      expect(res.degraded).toBe(true);
      expect(res.reviewNote).toMatch(/inválida/i);
    });

    it('timeout AbortController en LLM cancela la llamada y devuelve degradado limpio sin mutación', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GEMINI_API_KEY = 'g-key-valida';
      process.env.AI_TIMEOUT_MS = '50';

      fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => {
        return new Promise((_, reject) => {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const res = await AIService.generateMenu({ prompt: 'concepto gourmet de mariscos' });

      expect(res.degraded).toBe(true);
      expect(res.applied).toBe(false);
      expect(res.categories).toEqual([]);
      expect(mocks.tx).not.toHaveBeenCalled();
    });

    it('timeout permanece vigente si el proveedor entrega headers pero cuelga el cuerpo', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GEMINI_API_KEY = 'g-key-valida';
      process.env.AI_TIMEOUT_MS = '50';
      const cancel = vi.fn().mockResolvedValue(undefined);
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { get: () => null },
        body: { getReader: () => ({ read: () => new Promise(() => undefined), cancel }) }
      });

      const started = Date.now();
      const res = await AIService.generateMenu({ prompt: 'concepto gourmet de mariscos' });

      expect(Date.now() - started).toBeLessThan(500);
      expect(res.degraded).toBe(true);
      expect(res.applied).toBe(false);
      expect(cancel).toHaveBeenCalled();
    });

    it('usa modelos reales configurables y acota reintentos a MAX_AI_ATTEMPTS (2)', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GEMINI_API_KEY = 'g-key-valida';
      process.env.GEMINI_MODEL = 'gemini-1.5-flash';
      process.env.GEMINI_FALLBACK_MODEL = 'gemini-1.5-pro';

      fetchMock.mockResolvedValue({
        ok: false,
        status: 503,
        text: async () => 'Service Unavailable'
      });

      const res = await AIService.generateMenu({ prompt: 'concepto hamburguesas smash' });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[0][0]).toContain('gemini-1.5-flash');
      expect(fetchMock.mock.calls[1][0]).toContain('gemini-1.5-pro');
      expect(res.degraded).toBe(true);
    });

    it('valida la respuesta del LLM con Zod y sanitiza URLs de imágenes de platos', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GEMINI_API_KEY = 'g-key-valida';

      fetchMock.mockResolvedValue(
        geminiJsonResponse({
          suggestedTemplateId: 'NEON_BURGER',
          themeColor: '#a3e635',
          categories: [
            {
              name: 'Burgers',
              icon: '🍔',
              items: [
                {
                  name: 'Smash Doble',
                  description: 'Carne madurada y cheddar',
                  price: 8500,
                  imageUrl: 'https://images.unsplash.com/photo-123',
                  tags: ['POPULAR'],
                  isFeatured: true
                },
                {
                  name: 'Burger Insegura',
                  description: 'Con url externa no permitida',
                  price: 9000,
                  imageUrl: 'https://evil.attacker.com/malicious.png',
                  tags: [],
                  isFeatured: false
                }
              ]
            }
          ]
        })
      );

      const res = await AIService.generateMenu({ prompt: 'hamburguesería moderna' });

      expect(res.degraded).toBe(false);
      expect(res.categories[0].items[0].imageUrl).toBe('https://images.unsplash.com/photo-123');
      // La imagen con host fuera de allowlist se sanitiza a null
      expect(res.categories[0].items[1].imageUrl).toBeNull();
    });

    it('sommelier IA: rechaza consulta sin sessionToken con 400', async () => {
      const app = Fastify();
      await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-chars-long' });
      await app.register(menuRoutes, { prefix: '/v1' });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/restaurants/rest-ficticio/ai-sommelier',
          payload: { query: 'recomiéndame un plato' }
        });

        expect(res.statusCode).toBe(400);
        expect(res.json().error).toMatch(/inválida/i);
      } finally {
        await app.close();
      }
    });

    it('sommelier IA: rechaza sesión inexistente con 401', async () => {
      mocks.sessionFindUnique.mockResolvedValue(null);

      const app = Fastify();
      await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-chars-long' });
      await app.register(menuRoutes, { prefix: '/v1' });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/restaurants/rest-ficticio/ai-sommelier',
          payload: { query: 'recomiéndame un vino', sessionToken: 'token-invalido' }
        });

        expect(res.statusCode).toBe(401);
        expect(res.json().error).toMatch(/no encontrada/i);
      } finally {
        await app.close();
      }
    });

    it('sommelier IA: rechaza sesión cerrada con 410', async () => {
      mocks.sessionFindUnique.mockResolvedValue({
        id: 'session-1',
        token: 'token-cerrado',
        closedAt: new Date(Date.now() - 60000),
        expiresAt: new Date(Date.now() + 3600000),
        table: { restaurantId: 'rest-ficticio', restaurant: { id: 'rest-ficticio', slug: 'rest-ficticio' } },
        shift: { restaurantId: 'rest-ficticio', closedAt: null }
      });

      const app = Fastify();
      await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-chars-long' });
      await app.register(menuRoutes, { prefix: '/v1' });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/restaurants/rest-ficticio/ai-sommelier',
          payload: { query: 'recomiéndame algo', sessionToken: 'token-cerrado' }
        });

        expect(res.statusCode).toBe(410);
        expect(res.json().error).toMatch(/finalizado/i);
      } finally {
        await app.close();
      }
    });

    it('sommelier IA: rechaza sesión sin turno y no consume proveedor ni cuota', async () => {
      mocks.sessionFindUnique.mockResolvedValue({
        id: 'session-no-shift',
        token: 'token-sin-turno',
        closedAt: null,
        expiresAt: new Date(Date.now() + 3600000),
        table: { restaurantId: 'rest-ficticio', restaurant: { id: 'rest-ficticio', slug: 'rest-ficticio' } },
        shift: null
      });
      const app = Fastify();
      await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-chars-long' });
      await app.register(menuRoutes, { prefix: '/v1' });
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/restaurants/rest-ficticio/ai-sommelier',
          payload: { query: 'recomiéndame algo', sessionToken: 'token-sin-turno' }
        });
        expect(res.statusCode).toBe(410);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(SommelierQuotaManager.getRemainingQueries('token-sin-turno')).toBe(10);
      } finally {
        await app.close();
      }
    });

    it('sommelier IA: rechaza sesión de otro restaurante con 403', async () => {
      mocks.sessionFindUnique.mockResolvedValue({
        id: 'session-1',
        token: 'token-otro',
        closedAt: null,
        expiresAt: new Date(Date.now() + 3600000),
        table: { restaurantId: 'rest-distinto', restaurant: { id: 'rest-distinto', slug: 'rest-distinto' } },
        shift: { restaurantId: 'rest-distinto', closedAt: null }
      });

      const app = Fastify();
      await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-chars-long' });
      await app.register(menuRoutes, { prefix: '/v1' });
      await app.ready();

      try {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/restaurants/rest-ficticio/ai-sommelier',
          payload: { query: 'recomiéndame algo', sessionToken: 'token-otro' }
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().error).toMatch(/no pertenece/i);
      } finally {
        await app.close();
      }
    });

    it('sommelier IA: rechaza turno de otro restaurante aunque la mesa sea del tenant solicitado', async () => {
      mocks.sessionFindUnique.mockResolvedValue({
        id: 'session-foreign-shift',
        token: 'token-turno-ajeno',
        closedAt: null,
        expiresAt: new Date(Date.now() + 3600000),
        table: { restaurantId: 'rest-ficticio', restaurant: { id: 'rest-ficticio', slug: 'rest-ficticio' } },
        shift: { restaurantId: 'rest-otro', closedAt: null }
      });
      const app = Fastify();
      await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-chars-long' });
      await app.register(menuRoutes, { prefix: '/v1' });
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/v1/restaurants/rest-ficticio/ai-sommelier',
          payload: { query: 'recomiéndame algo', sessionToken: 'token-turno-ajeno' }
        });
        expect(res.statusCode).toBe(403);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(SommelierQuotaManager.getRemainingQueries('token-turno-ajeno')).toBe(10);
      } finally {
        await app.close();
      }
    });

    it('sommelier IA: aplica cuota máxima de 10 consultas por sesión de mesa y responde 429 al exceder', async () => {
      mocks.sessionFindUnique.mockResolvedValue({
        id: 'session-1',
        token: 'token-valido',
        closedAt: null,
        expiresAt: new Date(Date.now() + 3600000),
        table: { restaurantId: 'rest-ficticio', restaurant: { id: 'rest-ficticio', slug: 'rest-ficticio' } },
        shift: { restaurantId: 'rest-ficticio', closedAt: null }
      });
      mocks.findFirst.mockResolvedValue(
        fakeRestaurant([itemRow('d1', 'Plato Especial', ['CHEF_PICK'])])
      );

      const app = Fastify();
      await app.register(jwt, { secret: 'test-secret-at-least-thirty-two-chars-long' });
      await app.register(menuRoutes, { prefix: '/v1' });
      await app.ready();

      try {
        // Ejecutar 10 consultas permitidas
        for (let i = 0; i < 10; i++) {
          const okRes = await app.inject({
            method: 'POST',
            url: '/v1/restaurants/rest-ficticio/ai-sommelier',
            payload: { query: `consulta ${i + 1}`, sessionToken: 'token-valido' }
          });
          expect(okRes.statusCode).toBe(200);
          expect(okRes.json().remainingQueries).toBe(9 - i);
        }

        // La consulta 11 debe ser rechazada con 429
        const blockedRes = await app.inject({
          method: 'POST',
          url: '/v1/restaurants/rest-ficticio/ai-sommelier',
          payload: { query: 'consulta 11 excedida', sessionToken: 'token-valido' }
        });

        expect(blockedRes.statusCode).toBe(429);
        expect(blockedRes.json().code).toBe('QUOTA_EXCEEDED');
      } finally {
        await app.close();
      }
    });
  });
});

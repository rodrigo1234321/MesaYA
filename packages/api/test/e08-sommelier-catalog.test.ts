import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Suite focal E08 — Sommelier IA & Guía de Carta sobre Catálogo Activo
 *
 * Valida de forma hermética y determinística (sin llamadas reales a Gemini ni secretos):
 * 1) Consulta de cerveza/bebida: devuelve sólo IDs de items activos correspondientes.
 * 2) Consulta para compartir/pareja: devuelve sólo platos marcados por catálogo.
 * 3) Presupuesto: ningún precio excede el límite y se conserva el precio persistido.
 * 4) Item no disponible: nunca se sugiere aunque aparezca en la fixture.
 * 5) Alergia: abstención completa, sin IDs, sin maridaje y con derivación al personal.
 * 6) Fuera de tema y consulta ambigua: abstención completa sin fallback a destacados.
 * 7) Sin clave / bandera apagada: fallback local operativo y poweredBy correcto.
 * 8) Proveedor inválido / timeout / IDs Gemini inválidos o inconsistentes: fallback seguro.
 * 9) Integridad: IDs y precios de suggestedDishes pertenecen al catálogo activo.
 */

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  restaurantFindUnique: vi.fn(),
  tableSessionFindUnique: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findFirst(...args),
      findUnique: (...args: unknown[]) => mocks.restaurantFindUnique(...args)
    },
    tableSession: {
      findUnique: (...args: unknown[]) => mocks.tableSessionFindUnique(...args)
    }
  }
}));

import { AIService } from '../src/services/ai.service';
import { MenuItemDTO } from '@mesaya/shared';

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

interface FixtureItem {
  id: string;
  name: string;
  description?: string;
  price: number;
  tags?: string[];
  isAvailable?: boolean;
  isFeatured?: boolean;
  categoryId?: string;
  orderIndex?: number;
}

interface FixtureCategory {
  id: string;
  name: string;
  orderIndex?: number;
  items: FixtureItem[];
}

function buildRestaurantFixture(categories: FixtureCategory[], restaurantId = 'rest-fauno-01') {
  return {
    id: restaurantId,
    slug: restaurantId,
    name: 'Fauno Bar & Restaurant',
    categories: categories.map((cat, catIdx) => ({
      id: cat.id,
      name: cat.name,
      orderIndex: cat.orderIndex ?? catIdx,
      restaurantId,
      items: cat.items.map((item, itemIdx) => ({
        id: item.id,
        name: item.name,
        description: item.description ?? `Descripción de ${item.name}`,
        price: item.price,
        imageUrl: null,
        isAvailable: item.isAvailable ?? true,
        isFeatured: item.isFeatured ?? false,
        categoryId: cat.id,
        orderIndex: item.orderIndex ?? itemIdx,
        tags: JSON.stringify(item.tags ?? [])
      }))
    }))
  };
}

function geminiSommelierPayload(payload: { answer: string; recommendedDishIds: string[]; suggestedPairing?: string }) {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(payload) }]
          },
          finishReason: 'STOP'
        }
      ]
    }),
    {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }
  );
}

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  clearAiKeys();
  fetchMock.mockReset();
  mocks.findFirst.mockReset();
  mocks.restaurantFindUnique.mockReset();
  mocks.tableSessionFindUnique.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    else delete process.env[k];
  }
});

describe('E08 — Sommelier IA & Guía de Carta sobre Catálogo Activo', () => {

  // ---------------------------------------------------------------------------
  // 1. Consulta de cerveza / bebida
  // ---------------------------------------------------------------------------
  describe('1. Consulta de cerveza o bebidas', () => {
    it('devuelve sólo IDs de items activos cuyo nombre, categoría, descripción o tags correspondan a cerveza', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-cervezas',
          name: 'Cervezas Artesanales',
          items: [
            { id: 'beer-ipa', name: 'IPA Marplatense', description: 'Lupulada y aromática', price: 3500, tags: ['BEER', 'ARTESANAL'] },
            { id: 'beer-golden', name: 'Golden Ale', description: 'Cerveza rubia tirada suave', price: 3000, tags: ['CERVEZA'] }
          ]
        },
        {
          id: 'cat-carnes',
          name: 'Parrilla al Quebracho',
          items: [
            { id: 'meat-bife', name: 'Ojo de Bife', description: 'Corte de 400g a las brasas', price: 16000, isFeatured: true },
            { id: 'meat-asado', name: 'Asado de Tira', description: 'Carne de novillo especial', price: 15000 }
          ]
        },
        {
          id: 'cat-pastas',
          name: 'Pastas Caseras',
          items: [
            { id: 'pasta-sorrentinos', name: 'Sorrentinos de Jamón y Queso', description: 'Con salsa fileto', price: 11000 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'qué cervezas artesanales tienen tiradas?');

      expect(res.recommendedDishIds.length).toBeGreaterThan(0);
      expect(res.recommendedDishIds.length).toBeLessThanOrEqual(3);
      for (const id of res.recommendedDishIds) {
        expect(['beer-ipa', 'beer-golden']).toContain(id);
      }
      expect(res.recommendedDishIds).not.toContain('meat-bife');
      expect(res.recommendedDishIds).not.toContain('pasta-sorrentinos');
      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.suggestedDishes.every((d) => ['beer-ipa', 'beer-golden'].includes(d.id))).toBe(true);
    });

    it('devuelve bebidas o cócteles si el cliente pide tragos o bebidas, excluyendo platos de comida', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-tragos',
          name: 'Coctelería y Bebidas',
          items: [
            { id: 'drink-vermut', name: 'Vermut Rosso con Soda', description: 'Aperitivo clásico con rodaja de naranja', price: 2900, tags: ['APERITIVO', 'TRAGO'] },
            { id: 'drink-limonada', name: 'Limonada con Menta', description: 'Bebida fresca artesanal', price: 2200, tags: ['BEBIDA'] }
          ]
        },
        {
          id: 'cat-cocina',
          name: 'Platos Fuertes',
          items: [
            { id: 'food-milanesa', name: 'Milanesa Napolitana', description: 'Con papas fritas', price: 13000, isFeatured: true }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'recomiéndame una bebida o trago fresco');

      expect(res.recommendedDishIds.length).toBeGreaterThan(0);
      for (const id of res.recommendedDishIds) {
        expect(['drink-vermut', 'drink-limonada']).toContain(id);
      }
      expect(res.recommendedDishIds).not.toContain('food-milanesa');
    });

    it('se abstiene limpiamente si se pide cerveza pero el catálogo no tiene ninguna disponible', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-carnes',
          name: 'Carnes',
          items: [
            { id: 'meat-bife', name: 'Bife de Lomo', price: 18000 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'tienen alguna cerveza artesanal?');

      expect(res.recommendedDishIds).toEqual([]);
      expect(res.suggestedDishes).toEqual([]);
      expect(res.answer).toMatch(/No encontré opciones de cerveza o bebidas disponibles/i);
      expect(res.answer).toMatch(/personal de salón/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Consulta para compartir / pareja
  // ---------------------------------------------------------------------------
  describe('2. Consulta para compartir o en pareja', () => {
    it('devuelve sólo platos marcados por catálogo como compartibles o para dos', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-tapeo',
          name: 'Tablas y Picadas',
          items: [
            { id: 'share-tabla', name: 'Tabla de Mar Especial', description: 'Ideal para compartir entre dos personas con rabas y langostinos', price: 24000, tags: ['SHARING', 'TAPEOS'] },
            { id: 'share-picada', name: 'Picada Criolla', description: 'Quesos y fiambres para 2 comensales', price: 19000, tags: ['PARA_COMPARTIR'] }
          ]
        },
        {
          id: 'cat-individuales',
          name: 'Platos Individuales',
          items: [
            { id: 'indiv-bife', name: 'Bife Angosto Individual', description: 'Porción personal 300g', price: 14000, isFeatured: true },
            { id: 'indiv-pollo', name: 'Suprema Grillada', description: 'Plato individual', price: 11000 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'algo rico para compartir en pareja');

      expect(res.recommendedDishIds.length).toBeGreaterThan(0);
      for (const id of res.recommendedDishIds) {
        expect(['share-tabla', 'share-picada']).toContain(id);
      }
      expect(res.recommendedDishIds).not.toContain('indiv-bife');
      expect(res.recommendedDishIds).not.toContain('indiv-pollo');
      expect(res.answer).toMatch(/compartir|pareja/i);
    });

    it('se abstiene sin sugerir platos individuales si no existen opciones para compartir', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-individuales',
          name: 'Platos Individuales',
          items: [
            { id: 'indiv-1', name: 'Hamburguesa Simple', description: 'Individual 180g', price: 8000, isFeatured: true }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'buscamos una tabla para compartir entre dos');

      expect(res.recommendedDishIds).toEqual([]);
      expect(res.suggestedDishes).toEqual([]);
      expect(res.answer).toMatch(/No encontré opciones específicas para compartir/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Presupuesto
  // ---------------------------------------------------------------------------
  describe('3. Restricción de presupuesto', () => {
    it('ningún plato sugerido excede el límite y el DTO conserva el precio persistido', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-platos',
          name: 'Carta General',
          items: [
            { id: 'item-accesible-1', name: 'Empanadas de Carne Cortada a Cuchillo', price: 4200, isFeatured: true },
            { id: 'item-accesible-2', name: 'Sándwich de Bondiola', price: 8900 },
            { id: 'item-caro', name: 'Ojo de Bife Madurado', price: 18500, isFeatured: true }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'sugerime algo para almorzar hasta $10.000');

      expect(res.recommendedDishIds.length).toBeGreaterThan(0);
      expect(res.recommendedDishIds).not.toContain('item-caro');
      expect(res.constraints?.budgetMax).toBe(10000);

      // Verificación estricta de precios en DTO sugerido
      for (const dish of res.suggestedDishes) {
        expect(dish.price).toBeLessThanOrEqual(10000);
        if (dish.id === 'item-accesible-1') expect(dish.price).toBe(4200);
        if (dish.id === 'item-accesible-2') expect(dish.price).toBe(8900);
      }
    });

    it('se abstiene si ningún plato activo está dentro del presupuesto fijado', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-platos',
          name: 'Carta General',
          items: [
            { id: 'item-caro-1', name: 'Pasta Gourmet', price: 12000 },
            { id: 'item-caro-2', name: 'Pesca del Día', price: 16000 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'plato con presupuesto hasta $5.000');

      expect(res.recommendedDishIds).toEqual([]);
      expect(res.suggestedDishes).toEqual([]);
      expect(res.answer).toMatch(/presupuesto/i);
      expect(res.answer).toMatch(/5\.000/);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Item no disponible
  // ---------------------------------------------------------------------------
  describe('4. Exclusión de items no disponibles', () => {
    it('no sugiere platos pausados o sin stock aunque estén en la estructura de la base de datos', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-pastas',
          name: 'Pastas',
          items: [
            { id: 'pasta-disponible', name: 'Fettuccine Caseros', price: 10500, isAvailable: true },
            { id: 'pasta-agotada', name: 'Ravioles de Salmón Agotados', price: 14000, isAvailable: false }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'qué pastas tienen disponibles hoy?');

      expect(res.recommendedDishIds).toContain('pasta-disponible');
      expect(res.recommendedDishIds).not.toContain('pasta-agotada');
      expect(res.suggestedDishes.every((d) => d.isAvailable === true)).toBe(true);
    });

    it('descarta sugerencia de Gemini si intenta recomendar un ID no disponible', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GEMINI_API_KEY = 'valid-test-key';

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-carnes',
          name: 'Carnes',
          items: [
            { id: 'bife-activo', name: 'Bife de Chorizo', price: 15000, isAvailable: true },
            { id: 'asado-pausado', name: 'Asado Especial Pausado', price: 17000, isAvailable: false }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      // Gemini simula recomendar el plato agotado junto al activo
      fetchMock.mockResolvedValue(
        geminiSommelierPayload({
          answer: 'Te recomiendo el asado especial y el bife.',
          recommendedDishIds: ['asado-pausado', 'bife-activo'],
          suggestedPairing: 'Copa de Malbec'
        })
      );

      const res = await AIService.askSommelier('rest-fauno-01', 'qué cortes de carne recomiendan?');

      // Al incluir un ID no activo, la respuesta de Gemini se descarta y cae en fallback local
      expect(res.recommendedDishIds).not.toContain('asado-pausado');
      expect(res.recommendedDishIds).toContain('bife-activo');
      expect(res.poweredBy).toBe('heuristic-engine');
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Alergia
  // ---------------------------------------------------------------------------
  describe('5. Seguridad y abstención ante alergias', () => {
    it('se abstiene por completo sin IDs, sin maridaje y con derivación expresa al personal', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-platos',
          name: 'Carta Completa',
          items: [
            { id: 'dish-1', name: 'Ensalada César', price: 7500, tags: ['GLUTEN_FREE'] },
            { id: 'dish-2', name: 'Bife a la Plancha', price: 14000, tags: ['GLUTEN_FREE'] }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const queries = [
        'Tengo alergia grave al maní y frutos secos, qué puedo pedir?',
        'Soy alérgica a los mariscos, es seguro comer acá?',
        'Tengo intolerancia con riesgo de shock anafiláctico'
      ];

      for (const query of queries) {
        const res = await AIService.askSommelier('rest-fauno-01', query);

        expect(res.recommendedDishIds).toEqual([]);
        expect(res.suggestedDishes).toEqual([]);
        expect(res.suggestedPairing).toBeUndefined();
        expect(res.answer).toMatch(/alergias o restricciones estrictas me abstengo de recomendar/i);
        expect(res.answer).toMatch(/personal de salón antes de pedir/i);
        expect(res.answer).toMatch(/no garantizan ausencia de alérgenos/i);
        expect(res.constraints?.pairing).toBe('abstained');
        expect(res.degraded).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Fuera de tema y consulta ambigua
  // ---------------------------------------------------------------------------
  describe('6. Fuera de tema y consultas ambiguas', () => {
    it('se abstiene completamente ante consultas fuera de tema sin recurrir a destacados', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-destacados',
          name: 'Especialidades de la Casa',
          items: [
            { id: 'chef-pick-1', name: 'Plato Insignia', price: 18000, isFeatured: true, tags: ['CHEF_PICK'] }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const offTopicQueries = [
        'quién ganó el partido de fútbol anoche?',
        'cuál es el pronóstico del clima en Mar del Plata?',
        'cómo programo un script en python para ordenar listas?',
        'cuánto cotiza el dólar hoy?'
      ];

      for (const query of offTopicQueries) {
        const res = await AIService.askSommelier('rest-fauno-01', query);

        expect(res.recommendedDishIds).toEqual([]);
        expect(res.suggestedDishes).toEqual([]);
        expect(res.suggestedPairing).toBeUndefined();
        expect(res.answer).toMatch(/Solo puedo responder consultas sobre nuestra carta y maridajes disponibles/i);
        expect(res.answer).toMatch(/personal de salón/i);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    });

    it('se abstiene completamente ante consultas ambiguas o sin sentido gastronómico', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-destacados',
          name: 'Especialidades',
          items: [
            { id: 'chef-pick-1', name: 'Plato Estrella', price: 15000, isFeatured: true }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const ambiguousQueries = [
        'contame un secreto del universo',
        'xyzzy 12345 foo bar'
      ];

      for (const query of ambiguousQueries) {
        const res = await AIService.askSommelier('rest-fauno-01', query);

        expect(res.recommendedDishIds).toEqual([]);
        expect(res.suggestedDishes).toEqual([]);
        expect(res.answer).toMatch(/Solo puedo responder consultas sobre nuestra carta/i);
        expect(fetchMock).not.toHaveBeenCalled();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Sin clave / bandera apagada
  // ---------------------------------------------------------------------------
  describe('7. Fallback local operativo sin clave o con bandera desactivada', () => {
    it('opera con motor heurístico local y poweredBy correcto cuando ENABLE_AI_FEATURES no está activo', async () => {
      delete process.env.ENABLE_AI_FEATURES;
      delete process.env.AI_FEATURE_ENABLED;
      process.env.GEMINI_API_KEY = 'some-key';

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-pastas',
          name: 'Pastas Artesanales',
          items: [
            { id: 'pasta-1', name: 'Ravioles de Ricotta', description: 'Masa casera al huevo', price: 9500 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'qué pastas caseras recomiendan?');

      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.recommendedDishIds).toEqual(['pasta-1']);
      expect(res.suggestedDishes[0].id).toBe('pasta-1');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('opera con motor heurístico local cuando la bandera está activa pero falta la clave de API', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-carnes',
          name: 'Carnes a la Leña',
          items: [
            { id: 'carne-1', name: 'Bife de Chorizo Madurado', description: 'Corte clásico jugoso', price: 16000 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'recomiéndame un buen bife de carne');

      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.recommendedDishIds).toEqual(['carne-1']);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 8. Proveedor inválido / timeout o IDs Gemini inválidos
  // ---------------------------------------------------------------------------
  describe('8. Degradación segura ante fallos del proveedor IA', () => {
    it('degrada a motor local si Gemini devuelve IDs inventados o inexistentes', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'test-key-google';

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-pastas',
          name: 'Pastas',
          items: [
            { id: 'pasta-real', name: 'Tallarines Caseros', price: 9000 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      fetchMock.mockResolvedValue(
        geminiSommelierPayload({
          answer: 'Te recomiendo este plato inventado.',
          recommendedDishIds: ['id-inexistente-gemini-hallucination'],
          suggestedPairing: 'Agua'
        })
      );

      const res = await AIService.askSommelier('rest-fauno-01', 'quiero comer pastas');

      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.recommendedDishIds).toEqual(['pasta-real']);
      expect(res.suggestedDishes[0].id).toBe('pasta-real');
    });

    it('degrada a motor local si Gemini devuelve una recomendación semánticamente inconsistente', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'test-key-google';

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-cervezas',
          name: 'Cervezas',
          items: [
            { id: 'beer-ipa', name: 'IPA Marplatense', price: 3500, tags: ['BEER'] }
          ]
        },
        {
          id: 'cat-postres',
          name: 'Postres',
          items: [
            { id: 'dessert-volcan', name: 'Volcán de Chocolate', price: 5000, tags: ['DESSERT'] }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      // Cliente pide cerveza pero Gemini sugiere postre
      fetchMock.mockResolvedValue(
        geminiSommelierPayload({
          answer: 'Te sugiero el volcán de chocolate.',
          recommendedDishIds: ['dessert-volcan'],
          suggestedPairing: 'Café'
        })
      );

      const res = await AIService.askSommelier('rest-fauno-01', 'qué cerveza me recomiendan?');

      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.recommendedDishIds).toEqual(['beer-ipa']);
    });

    it('degrada limpiamente ante timeout de red sin lanzar excepción al llamador', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'test-key-google';
      process.env.AI_TIMEOUT_MS = '50';

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-carnes',
          name: 'Carnes',
          items: [
            { id: 'meat-asado', name: 'Asado al Asador', price: 15500 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      fetchMock.mockImplementation((_url: string, options: { signal?: AbortSignal }) => {
        return new Promise((_, reject) => {
          options.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const res = await AIService.askSommelier('rest-fauno-01', 'recomiéndame un corte de asado');

      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.recommendedDishIds).toEqual(['meat-asado']);
      expect(res.suggestedDishes[0].name).toBe('Asado al Asador');
    });

    it('degrada limpiamente ante respuesta HTTP 503 del proveedor', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'test-key-google';

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-pescados',
          name: 'Pescados y Mariscos',
          items: [
            { id: 'fish-merluza', name: 'Filet de Merluza a la Romana', price: 11000 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      fetchMock.mockResolvedValue(
        new Response(JSON.stringify({ error: { code: 503, message: 'Unavailable', status: 'UNAVAILABLE' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
      );

      const res = await AIService.askSommelier('rest-fauno-01', 'pescados frescos del día');

      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.recommendedDishIds).toEqual(['fish-merluza']);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. Integridad del catálogo
  // ---------------------------------------------------------------------------
  describe('9. Integridad del catálogo y texto fundamentado', () => {
    it('todos los IDs y precios de suggestedDishes pertenecen al catálogo activo con precios persistidos', async () => {
      process.env.ENABLE_AI_FEATURES = 'true';
      process.env.GOOGLE_API_KEY = 'test-key-google';

      const fixture = buildRestaurantFixture([
        {
          id: 'cat-pastas',
          name: 'Pastas Artesanales',
          items: [
            { id: 'pasta-gnocci', name: 'Ñoquis Caseros de Papa', price: 8900, description: 'Con salsa cuatro quesos' },
            { id: 'pasta-lasagna', name: 'Lasaña Tradicional', price: 11500, description: 'Rellena de carne y espinaca' }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      fetchMock.mockResolvedValue(
        geminiSommelierPayload({
          answer: 'Nuestras pastas caseras son elaboradas diariamente con ingredientes frescos.',
          recommendedDishIds: ['pasta-gnocci', 'pasta-lasagna'],
          suggestedPairing: 'Copa de Chianti'
        })
      );

      const res = await AIService.askSommelier('rest-fauno-01', 'qué pastas nos recomendás para cenar?');

      expect(res.poweredBy).toBe('gemini');
      expect(res.recommendedDishIds).toEqual(['pasta-gnocci', 'pasta-lasagna']);

      // Integridad de los DTOs devueltos
      const dishGnocci = res.suggestedDishes.find((d) => d.id === 'pasta-gnocci');
      const dishLasagna = res.suggestedDishes.find((d) => d.id === 'pasta-lasagna');

      expect(dishGnocci).toBeDefined();
      expect(dishGnocci?.price).toBe(8900);
      expect(dishGnocci?.categoryName).toBe('Pastas Artesanales');
      expect(dishGnocci?.isAvailable).toBe(true);

      expect(dishLasagna).toBeDefined();
      expect(dishLasagna?.price).toBe(11500);
      expect(dishLasagna?.categoryName).toBe('Pastas Artesanales');
      expect(dishLasagna?.isAvailable).toBe(true);
    });

    it('en fallback local el texto fundamenta las sugerencias con los nombres exactos de los platos del catálogo', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-postres',
          name: 'Postres Artesanales',
          items: [
            { id: 'postre-flan', name: 'Flan Casero Mixto', price: 4500 },
            { id: 'postre-tiramisu', name: 'Tiramisú Tradicional', price: 5800 }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'qué postres dulces tienen para cerrar?');

      expect(res.poweredBy).toBe('heuristic-engine');
      expect(res.answer).toContain('Flan Casero Mixto');
      expect(res.answer).toContain('Tiramisú Tradicional');
      // No debe contener nombres inventados
      expect(res.answer).not.toMatch(/crème brûlée|marquise/i);
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Regresión de límites de palabra (apa/papas, ipa/principales, tomar/mar)
  // ---------------------------------------------------------------------------
  describe('10. Regresión léxica: límites de palabra para estilos de cerveza y verbos', () => {
    it('platos con "papas fritas" o "principales" no son clasificados erróneamente como cerveza por la subcadena "apa" o "ipa"', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-principales',
          name: 'Platos Principales',
          items: [
            { id: 'dish-lomo', name: 'Lomo con Papas Fritas', description: 'Plato principal con papas rústicas crocantes', price: 15000, tags: ['CARNE'] }
          ]
        },
        {
          id: 'cat-bebidas',
          name: 'Bebidas',
          items: [
            { id: 'beer-real', name: 'Cerveza Rubia Tirada', description: 'Cerveza artesanal de barril', price: 3200, tags: ['BEER'] }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      // Una consulta de cerveza debe devolver la cerveza real, jamás el lomo con papas
      const resCerveza = await AIService.askSommelier('rest-fauno-01', 'qué cerveza me recomiendan?');
      expect(resCerveza.recommendedDishIds).toEqual(['beer-real']);
      expect(resCerveza.recommendedDishIds).not.toContain('dish-lomo');

      // Y si se busca una cerveza estilo APA específicamente, sólo coincide si hay cerveza APA, no papas
      const resApa = await AIService.askSommelier('rest-fauno-01', 'tienen cerveza apa?');
      expect(resApa.recommendedDishIds).not.toContain('dish-lomo');
    });

    it('la consulta "qué tienen para tomar?" clasifica como bebidas y no como pescados de mar', async () => {
      const fixture = buildRestaurantFixture([
        {
          id: 'cat-pescados',
          name: 'Pescados de Mar',
          items: [
            { id: 'fish-salmon', name: 'Salmón del Mar', price: 19000, tags: ['PESCADO'] }
          ]
        },
        {
          id: 'cat-bebidas',
          name: 'Bebidas de la Barra',
          items: [
            { id: 'drink-agua', name: 'Agua Mineral con Gas', price: 1800, tags: ['BEBIDA'] },
            { id: 'drink-cerveza', name: 'Cerveza Golden', price: 3000, tags: ['CERVEZA'] }
          ]
        }
      ]);

      mocks.findFirst.mockResolvedValue(fixture);

      const res = await AIService.askSommelier('rest-fauno-01', 'qué tienen para tomar?');

      expect(res.recommendedDishIds.length).toBeGreaterThan(0);
      for (const id of res.recommendedDishIds) {
        expect(['drink-agua', 'drink-cerveza']).toContain(id);
      }
      expect(res.recommendedDishIds).not.toContain('fish-salmon');
    });
  });

});

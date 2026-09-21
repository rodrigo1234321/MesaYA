import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  findRestaurant: vi.fn(),
  categoryFindMany: vi.fn(),
  categoryCreate: vi.fn(),
  categoryUpdate: vi.fn(),
  categoryDelete: vi.fn(),
  categoryDeleteMany: vi.fn(),
  itemFindMany: vi.fn(),
  itemCreate: vi.fn(),
  itemUpdate: vi.fn(),
  itemDelete: vi.fn(),
  itemDeleteMany: vi.fn(),
  restaurantUpdate: vi.fn(),
  transaction: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) },
    restaurant: {
      findFirst: (...args: unknown[]) => mocks.findRestaurant(...args),
      update: (...args: unknown[]) => mocks.restaurantUpdate(...args)
    },
    menuCategory: {
      findMany: (...args: unknown[]) => mocks.categoryFindMany(...args),
      create: (...args: unknown[]) => mocks.categoryCreate(...args),
      update: (...args: unknown[]) => mocks.categoryUpdate(...args),
      delete: (...args: unknown[]) => mocks.categoryDelete(...args),
      deleteMany: (...args: unknown[]) => mocks.categoryDeleteMany(...args)
    },
    menuItem: {
      findMany: (...args: unknown[]) => mocks.itemFindMany(...args),
      create: (...args: unknown[]) => mocks.itemCreate(...args),
      update: (...args: unknown[]) => mocks.itemUpdate(...args),
      delete: (...args: unknown[]) => mocks.itemDelete(...args),
      deleteMany: (...args: unknown[]) => mocks.itemDeleteMany(...args)
    },
    $transaction: (fn: any) => mocks.transaction(fn)
  }
}));

import { menuRoutes } from '../src/routes/menu.routes';

const SECRET = 'jwt-secret-for-menu-import-tests-which-is-long-enough';
const restaurant = (id: string) => ({
  id,
  name: id,
  slug: id,
  themeColor: '#000',
  logoUrl: null,
  coverImageUrl: null,
  whatsappPhone: null,
  categories: []
});
const staff = (id: string) => ({
  id,
  name: id,
  role: 'MANAGER',
  restaurantId: 'restaurant-fauno',
  assignedSector: null
});

async function createApp() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.register(menuRoutes);
  return app;
}

describe('E01 — Importación de Menú Idempotente, No Destructiva y con dryRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findStaff.mockImplementation(({ where }: any) => Promise.resolve(staff(where.id)));
    mocks.findRestaurant.mockImplementation(({ where }: any) => {
      const identifier = where.OR?.[0]?.id || where.OR?.[1]?.slug;
      return Promise.resolve(restaurant(identifier));
    });
    // Default transaction executes callback with prisma mock
    mocks.transaction.mockImplementation(async (callback: any) => {
      const txMock = {
        menuCategory: {
          findMany: mocks.categoryFindMany,
          create: mocks.categoryCreate,
          update: mocks.categoryUpdate,
          delete: mocks.categoryDelete,
          deleteMany: mocks.categoryDeleteMany
        },
        menuItem: {
          findMany: mocks.itemFindMany,
          create: mocks.itemCreate,
          update: mocks.itemUpdate,
          delete: mocks.itemDelete,
          deleteMany: mocks.itemDeleteMany
        },
        restaurant: {
          update: mocks.restaurantUpdate
        }
      };
      return callback(txMock);
    });
  });

  it('1. Crea categorías y platos nuevos en catálogo vacío sin borrar nada', async () => {
    mocks.categoryFindMany.mockResolvedValue([]);
    mocks.categoryCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: `cat-${data.name}`, ...data, items: [] }));
    mocks.itemCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: `item-${data.name}`, ...data }));

    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      const payload = {
        replaceExisting: true,
        items: [
          { category: 'Cervezas', categoryIcon: '🍺', name: 'Jammin IPA', price: 5200, tags: ['CHEF_PICK'] },
          { category: 'Cervezas', categoryIcon: '🍺', name: 'Golden Ale', price: 4800, tags: [] },
          { category: 'Entradas', categoryIcon: '🥟', name: 'Empanada Criolla', price: 2100, tags: [] }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.dryRun).toBe(false);
      expect(json.summary.categoriesCreated).toBe(2);
      expect(json.summary.itemsCreated).toBe(3);
      expect(json.summary.itemsUpdated).toBe(0);
      expect(json.summary.itemsDeactivated).toBe(0);

      // Invariante E01: CERO llamadas a delete o deleteMany
      expect(mocks.categoryDelete).not.toHaveBeenCalled();
      expect(mocks.categoryDeleteMany).not.toHaveBeenCalled();
      expect(mocks.itemDelete).not.toHaveBeenCalled();
      expect(mocks.itemDeleteMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('2. Idempotencia: re-importar el mismo catálogo no duplica ni cambia IDs', async () => {
    // Simula base de datos que ya contiene los platos importados
    const existingDb = [
      {
        id: 'cat-cervezas-uuid',
        restaurantId: 'restaurant-fauno',
        name: 'Cervezas',
        icon: '🍺',
        orderIndex: 0,
        items: [
          {
            id: 'item-jammin-uuid',
            categoryId: 'cat-cervezas-uuid',
            name: 'Jammin IPA',
            price: 5200,
            priceMinor: 520000,
            isAvailable: true,
            isFeatured: true,
            tags: JSON.stringify(['CHEF_PICK']),
            imageUrl: null,
            orderIndex: 0
          }
        ]
      }
    ];

    mocks.categoryFindMany.mockResolvedValue(existingDb);
    mocks.categoryUpdate.mockResolvedValue({});
    mocks.itemUpdate.mockResolvedValue({});

    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      const payload = {
        replaceExisting: true,
        items: [
          { category: 'Cervezas', categoryIcon: '🍺', name: 'Jammin IPA', price: 5500, tags: ['CHEF_PICK'] }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.summary.categoriesCreated).toBe(0);
      expect(json.summary.categoriesUpdated).toBe(1);
      expect(json.summary.itemsCreated).toBe(0);
      expect(json.summary.itemsUpdated).toBe(1);
      expect(json.summary.itemsDeactivated).toBe(0);

      // CERO creaciones y CERO eliminaciones
      expect(mocks.categoryCreate).not.toHaveBeenCalled();
      expect(mocks.itemCreate).not.toHaveBeenCalled();
      expect(mocks.categoryDeleteMany).not.toHaveBeenCalled();
      expect(mocks.itemDeleteMany).not.toHaveBeenCalled();

      // Se actualizó sobre el ID existente 'item-jammin-uuid'
      expect(mocks.itemUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-jammin-uuid' },
          data: expect.objectContaining({ price: 5500, priceMinor: 550000 })
        })
      );
    } finally {
      await app.close();
    }
  });

  it('3. Desactivación segura: platos ausentes con replaceExisting=true pasan a isAvailable: false sin delete', async () => {
    // Base con 2 platos: uno viene en el payload y otro no
    const existingDb = [
      {
        id: 'cat-cervezas-uuid',
        restaurantId: 'restaurant-fauno',
        name: 'Cervezas',
        icon: '🍺',
        orderIndex: 0,
        items: [
          {
            id: 'item-jammin-uuid',
            categoryId: 'cat-cervezas-uuid',
            name: 'Jammin IPA',
            price: 5200,
            priceMinor: 520000,
            isAvailable: true,
            isFeatured: true,
            tags: JSON.stringify(['CHEF_PICK']),
            imageUrl: null,
            orderIndex: 0
          },
          {
            id: 'item-antiguo-con-ordenes-uuid',
            categoryId: 'cat-cervezas-uuid',
            name: 'Cerveza Vieja Retirada',
            price: 4000,
            priceMinor: 400000,
            isAvailable: true,
            isFeatured: false,
            tags: '[]',
            imageUrl: null,
            orderIndex: 1
          }
        ]
      }
    ];

    mocks.categoryFindMany.mockResolvedValue(existingDb);
    mocks.categoryUpdate.mockResolvedValue({});
    mocks.itemUpdate.mockResolvedValue({});

    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      // Payload solo trae 'Jammin IPA'; 'Cerveza Vieja Retirada' queda ausente
      const payload = {
        replaceExisting: true,
        items: [
          { category: 'Cervezas', categoryIcon: '🍺', name: 'Jammin IPA', price: 5200, tags: ['CHEF_PICK'] }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.summary.itemsUpdated).toBe(1);
      expect(json.summary.itemsDeactivated).toBe(1);
      expect(json.warnings.length).toBe(1);
      expect(json.warnings[0]).toContain('Cerveza Vieja Retirada');

      // Invariante de seguridad E01: CERO hard-deletes
      expect(mocks.categoryDelete).not.toHaveBeenCalled();
      expect(mocks.categoryDeleteMany).not.toHaveBeenCalled();
      expect(mocks.itemDelete).not.toHaveBeenCalled();
      expect(mocks.itemDeleteMany).not.toHaveBeenCalled();

      // El plato ausente fue actualizado a isAvailable: false
      expect(mocks.itemUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-antiguo-con-ordenes-uuid' },
          data: { isAvailable: false }
        })
      );
    } finally {
      await app.close();
    }
  });

  it('4. dryRun: simula sin ejecutar escrituras en la base de datos', async () => {
    mocks.categoryFindMany.mockResolvedValue([]);

    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      const payload = {
        dryRun: true,
        replaceExisting: true,
        items: [
          { category: 'Tacos', categoryIcon: '🌮', name: 'Tacos de Carne', price: 9500 }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.dryRun).toBe(true);
      expect(json.summary.categoriesCreated).toBe(1);
      expect(json.summary.itemsCreated).toBe(1);

      // En dryRun no se llama a create ni update ni transaction
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.categoryCreate).not.toHaveBeenCalled();
      expect(mocks.itemCreate).not.toHaveBeenCalled();
      expect(mocks.categoryUpdate).not.toHaveBeenCalled();
      expect(mocks.itemUpdate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('5. Valida y rechaza duplicados dentro del mismo payload', async () => {
    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      const payload = {
        items: [
          { category: 'Papas', name: 'Papas Cheddar', price: 6000 },
          { category: 'Papas', name: 'Papas Cheddar', price: 6500 } // Duplicado
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toContain('duplicado');
      expect(mocks.transaction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('6. coming-soon se importa automáticamente como isAvailable: false', async () => {
    mocks.categoryFindMany.mockResolvedValue([]);
    mocks.categoryCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: 'cat-proximos', ...data }));
    mocks.itemCreate.mockImplementation(({ data }: any) => Promise.resolve({ id: 'item-proximo', ...data }));

    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      const payload = {
        items: [
          {
            category: 'Pizzas',
            name: 'Pizza Especial Proximamente',
            price: 8000,
            tags: ['COMING_SOON'],
            isAvailable: true // Aunque venga true, COMING_SOON debe forzar false
          }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(200);
      expect(mocks.itemCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Pizza Especial Proximamente',
            isAvailable: false
          })
        })
      );
    } finally {
      await app.close();
    }
  });

  it('7. Renombrar un plato conservando externalId preserva el MenuItem.id en base de datos', async () => {
    const existingDb = [
      {
        id: 'cat-burgers-uuid',
        restaurantId: 'restaurant-fauno',
        name: 'Hamburguesas',
        icon: '🍔',
        orderIndex: 0,
        items: [
          {
            id: 'item-burger-original-uuid',
            categoryId: 'cat-burgers-uuid',
            name: 'Burger Simple',
            price: 8000,
            priceMinor: 800000,
            isAvailable: true,
            isFeatured: false,
            tags: '[]',
            imageUrl: null,
            orderIndex: 0,
            catalogKey: 'restaurant-fauno:fauno-user:burger-clasica'
          }
        ]
      }
    ];

    mocks.categoryFindMany.mockResolvedValue(existingDb);
    mocks.categoryUpdate.mockResolvedValue({});
    mocks.itemUpdate.mockResolvedValue({});

    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      // Mismo externalId y source pero nombre cambiado a 'Burger Simple Deluxe'
      const payload = {
        replaceExisting: true,
        items: [
          {
            category: 'Hamburguesas',
            name: 'Burger Simple Deluxe',
            price: 9200,
            externalId: 'burger-clasica',
            source: 'fauno-user'
          }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.summary.itemsCreated).toBe(0);
      expect(json.summary.itemsUpdated).toBe(1);

      // CERO creaciones de ítem
      expect(mocks.itemCreate).not.toHaveBeenCalled();

      // Actualizó exactamente el ID existente preservando el UUID histórico
      expect(mocks.itemUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-burger-original-uuid' },
          data: expect.objectContaining({
            name: 'Burger Simple Deluxe',
            price: 9200,
            priceMinor: 920000
          })
        })
      );
    } finally {
      await app.close();
    }
  });

  it('8. Rechaza con 400 si el payload contiene externalIds duplicados', async () => {
    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      const payload = {
        items: [
          { category: 'Papas', name: 'Papas Fritas', price: 4000, externalId: 'same-ext-id' },
          { category: 'Papas', name: 'Papas Rusticas', price: 4500, externalId: 'same-ext-id' }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toContain('externalId duplicado');
      expect(mocks.transaction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('9. Backfill: plato histórico sin catalogKey se asocia con el externalId recibido', async () => {
    const existingDb = [
      {
        id: 'cat-entradas-uuid',
        restaurantId: 'restaurant-fauno',
        name: 'Entradas',
        icon: '🥟',
        orderIndex: 0,
        items: [
          {
            id: 'item-empanada-historica-uuid',
            categoryId: 'cat-entradas-uuid',
            name: 'Empanada Criolla',
            price: 2000,
            priceMinor: 200000,
            isAvailable: true,
            isFeatured: false,
            tags: '[]',
            imageUrl: null,
            orderIndex: 0,
            catalogKey: null // Sin catalogKey previo
          }
        ]
      }
    ];

    mocks.categoryFindMany.mockResolvedValue(existingDb);
    mocks.categoryUpdate.mockResolvedValue({});
    mocks.itemUpdate.mockResolvedValue({});

    const app = await createApp();
    try {
      const token = app.jwt.sign({ sub: 'manager-1', role: 'MANAGER', restaurantId: 'restaurant-fauno' });
      const payload = {
        replaceExisting: true,
        items: [
          {
            category: 'Entradas',
            name: 'Empanada Criolla',
            price: 2500,
            externalId: 'empanada-criolla',
            source: 'fauno-user'
          }
        ]
      };

      const res = await app.inject({
        method: 'POST',
        url: '/restaurants/restaurant-fauno/menu/import',
        headers: { authorization: `Bearer ${token}` },
        payload
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.summary.itemsUpdated).toBe(1);
      expect(json.warnings.some((w: string) => w.includes('catalogKey'))).toBe(true);

      // Debe actualizar y asociar la catalogKey calculada
      expect(mocks.itemUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'item-empanada-historica-uuid' },
          data: expect.objectContaining({
            catalogKey: 'restaurant-fauno:fauno-user:empanada-criolla'
          })
        })
      );
    } finally {
      await app.close();
    }
  });

  it('10. GET /restaurants/:slugOrId/menu conserva categorías con COMING_SOON pero excluye inactivas normales salvo includeEmpty=true (P2/P3)', async () => {
    const restaurantWithVariousCategories = {
      id: 'restaurant-fauno',
      name: 'Fauno Olavarría',
      slug: 'fauno-olavarria',
      themeColor: '#16c5df',
      logoUrl: null,
      coverImageUrl: null,
      whatsappPhone: null,
      categories: [
        {
          id: 'cat-activa',
          restaurantId: 'restaurant-fauno',
          name: 'Cervezas',
          icon: '🍺',
          orderIndex: 0,
          items: [
            {
              id: 'item-activa-1',
              categoryId: 'cat-activa',
              name: 'IPA',
              description: null,
              price: 4500,
              imageUrl: null,
              isAvailable: true,
              isFeatured: false,
              tags: '[]',
              orderIndex: 0
            }
          ]
        },
        {
          id: 'cat-coming-soon',
          restaurantId: 'restaurant-fauno',
          name: 'Próximos Lanzamientos',
          icon: '🚀',
          orderIndex: 1,
          items: [
            {
              id: 'item-cs-1',
              categoryId: 'cat-coming-soon',
              name: 'Vino de Autor en Crianza',
              description: 'Próximamente disponible',
              price: 18000,
              imageUrl: null,
              isAvailable: false, // No disponible para ordenar
              isFeatured: false,
              tags: JSON.stringify(['COMING_SOON']), // Pero visible como adelanto
              orderIndex: 0
            }
          ]
        },
        {
          id: 'cat-inactiva',
          restaurantId: 'restaurant-fauno',
          name: 'Edición Limitada Pasada',
          icon: '✨',
          orderIndex: 2,
          items: [
            {
              id: 'item-inactiva-1',
              categoryId: 'cat-inactiva',
              name: 'Plato Agotado Histórico',
              description: null,
              price: 9000,
              imageUrl: null,
              isAvailable: false, // Inactivo normal
              isFeatured: false,
              tags: '[]', // Sin COMING_SOON
              orderIndex: 0
            }
          ]
        }
      ]
    };

    mocks.findRestaurant.mockResolvedValue(restaurantWithVariousCategories);

    const app = await createApp();
    try {
      // 1. Consulta por defecto: conserva cat-activa y cat-coming-soon, pero omite cat-inactiva
      const resDefault = await app.inject({
        method: 'GET',
        url: '/restaurants/restaurant-fauno/menu'
      });
      expect(resDefault.statusCode).toBe(200);
      const jsonDefault = resDefault.json();
      expect(jsonDefault.categories.length).toBe(2);
      const categoryIdsDefault = jsonDefault.categories.map((c: any) => c.id);
      expect(categoryIdsDefault).toContain('cat-activa');
      expect(categoryIdsDefault).toContain('cat-coming-soon');
      expect(categoryIdsDefault).not.toContain('cat-inactiva');

      // 2. Consulta con includeEmpty=true: incluye todas las categorías (3)
      const resWithEmpty = await app.inject({
        method: 'GET',
        url: '/restaurants/restaurant-fauno/menu?includeEmpty=true'
      });
      expect(resWithEmpty.statusCode).toBe(200);
      const jsonWithEmpty = resWithEmpty.json();
      expect(jsonWithEmpty.categories.length).toBe(3);
      const categoryIdsWithEmpty = jsonWithEmpty.categories.map((c: any) => c.id);
      expect(categoryIdsWithEmpty).toContain('cat-activa');
      expect(categoryIdsWithEmpty).toContain('cat-coming-soon');
      expect(categoryIdsWithEmpty).toContain('cat-inactiva');
    } finally {
      await app.close();
    }
  });
});

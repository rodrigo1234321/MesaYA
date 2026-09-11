import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { SessionService } from '../src/services/session.service';
import { OrderService } from '../src/services/order.service';

const ENV_KEYS = ['MESAYA_INSTANCE_MODE', 'MESAYA_INSTANCE_RESTAURANT_ID'] as const;
const savedEnv = new Map<string, string | undefined>();

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
});

function singleRestaurantEnv(rootId: string) {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  process.env.MESAYA_INSTANCE_MODE = 'SINGLE_RESTAURANT';
  process.env.MESAYA_INSTANCE_RESTAURANT_ID = rootId;
}

describe('Etapa 05 — aislamiento de sesiones públicas por instancia', () => {
  it('un QR de otro restaurante devuelve 404 sin consultar la mesa', async () => {
    singleRestaurantEnv('restaurant-root');
    vi.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({
      id: 'restaurant-foreign',
      slug: 'otro-local'
    } as any);
    const tableLookup = vi.spyOn(prisma.table, 'findFirst');

    await expect(
      SessionService.getOrCreateActiveSessionBySlugAndTable('otro-local', 'Mesa 1')
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(tableLookup).not.toHaveBeenCalled();
  });

  it('un token perteneciente a otro restaurante no revela metadatos ni estado', async () => {
    singleRestaurantEnv('restaurant-root');
    vi.spyOn(prisma.tableSession, 'findUnique').mockResolvedValue({
      token: 'foreign-token',
      expiresAt: new Date(Date.now() + 60_000),
      closedAt: null,
      shift: { closedAt: null },
      table: {
        id: 'table-foreign',
        label: 'Mesa 1',
        sector: 'SALON_PRINCIPAL',
        isOutdoor: false,
        currentState: 'OCCUPIED_NO_ORDER',
        restaurant: {
          id: 'restaurant-foreign',
          name: 'Otro local',
          slug: 'otro-local'
        }
      },
      calls: []
    } as any);

    await expect(SessionService.validateToken('foreign-token')).resolves.toEqual(expect.objectContaining({
      valid: false,
      code: 'SESSION_NOT_FOUND',
      error: 'Sesión no encontrada o código QR no válido.'
    }));
  });

  it('un token de otro restaurante tampoco habilita lectura de carrito', async () => {
    singleRestaurantEnv('restaurant-root');
    vi.spyOn(prisma.tableSession, 'findUnique').mockResolvedValue({
      id: 'session-foreign',
      expiresAt: new Date(Date.now() + 60_000),
      closedAt: null,
      shift: { closedAt: null, restaurantId: 'restaurant-foreign' },
      table: {
        restaurantId: 'restaurant-foreign',
        currentState: 'OCCUPIED_NO_ORDER',
        restaurant: { moduleConfig: null }
      }
    } as any);

    await expect(OrderService.getActiveOrderForGuest('foreign-token')).rejects.toMatchObject({
      statusCode: 404,
      code: 'SESSION_NOT_FOUND'
    });
  });
});

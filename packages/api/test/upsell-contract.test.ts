import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  restaurantFindFirst: vi.fn(),
  sessionFindUnique: vi.fn(),
  menuItemFindFirst: vi.fn(),
  menuItemFindMany: vi.fn(),
  upsellCreate: vi.fn(),
  upsellFindUnique: vi.fn(),
  upsellFindMany: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    restaurant: { findFirst: (...args: unknown[]) => mocks.restaurantFindFirst(...args) },
    tableSession: { findUnique: (...args: unknown[]) => mocks.sessionFindUnique(...args) },
    menuItem: {
      findFirst: (...args: unknown[]) => mocks.menuItemFindFirst(...args),
      findMany: (...args: unknown[]) => mocks.menuItemFindMany(...args)
    },
    upsellEvent: {
      create: (...args: unknown[]) => mocks.upsellCreate(...args),
      findUnique: (...args: unknown[]) => mocks.upsellFindUnique(...args),
      findMany: (...args: unknown[]) => mocks.upsellFindMany(...args)
    }
  }
}));

import { UpsellService } from '../src/services/upsell.service';

const activeSession = {
  id: 'session-1',
  expiresAt: new Date(Date.now() + 60_000),
  closedAt: null,
  table: { restaurantId: 'restaurant-a' },
  shift: { closedAt: null }
};

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.restaurantFindFirst.mockResolvedValue({ id: 'restaurant-a', moduleConfig: { enableUpsell: true } });
  mocks.sessionFindUnique.mockResolvedValue(activeSession);
  mocks.menuItemFindFirst.mockResolvedValue({ id: 'suggestion-1' });
  mocks.menuItemFindMany.mockResolvedValue([]);
  mocks.upsellFindMany.mockResolvedValue([]);
  mocks.upsellCreate.mockResolvedValue({ id: 'event-1', eventType: 'IMPRESSION', suggestionItemId: 'suggestion-1', createdAt: new Date() });
});

describe('Etapa 12 — contrato de upsell', () => {
  it('registra impresión sólo con sesión activa, item del tenant e idempotencia', async () => {
    const result = await UpsellService.recordEvent({
      restaurantIdOrSlug: 'restaurant-a',
      sessionToken: 'token-a',
      eventType: 'IMPRESSION',
      suggestionItemId: 'suggestion-1',
      sourceItemId: 'source-1',
      idempotencyKey: 'guest-1-impression-1',
      experimentGroup: 'UPSELL'
    });

    expect(result.idempotentReplay).toBe(false);
    expect(mocks.upsellCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        restaurantId: 'restaurant-a',
        sessionHash: createHash('sha256').update('restaurant-a:token-a').digest('hex'),
        eventType: 'IMPRESSION',
        experimentGroup: 'UPSELL'
      })
    }));
  });

  it('reproduce reintento con la misma idempotencyKey sin duplicar evento', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'P2002' });
    mocks.upsellCreate.mockRejectedValueOnce(duplicate);
    mocks.upsellFindUnique.mockResolvedValue({
      id: 'event-1',
      restaurantId: 'restaurant-a',
      sessionHash: 'dd5009f2536c9c9a051763cf873810965e37383208befbf496ee0a31a9557709',
      eventType: 'ACCEPT',
      sourceItemId: null,
      suggestionItemId: 'suggestion-1',
      createdAt: new Date()
    });

    const result = await UpsellService.recordEvent({
      restaurantIdOrSlug: 'restaurant-a',
      sessionToken: 'token-a',
      eventType: 'ACCEPT',
      suggestionItemId: 'suggestion-1',
      idempotencyKey: 'guest-1-accept-1'
    });

    expect(result.idempotentReplay).toBe(true);
    expect(mocks.upsellFindUnique).toHaveBeenCalled();
  });

  it('rechaza sesión de otro tenant', async () => {
    mocks.sessionFindUnique.mockResolvedValue({ ...activeSession, table: { restaurantId: 'restaurant-b' } });
    await expect(UpsellService.recordEvent({
      restaurantIdOrSlug: 'restaurant-a',
      sessionToken: 'token-b',
      eventType: 'DISMISS',
      suggestionItemId: 'suggestion-1',
      idempotencyKey: 'guest-1-dismiss-1'
    })).rejects.toMatchObject({ statusCode: 404, code: 'SESSION_NOT_FOUND' });
    expect(mocks.upsellCreate).not.toHaveBeenCalled();
  });

  it('deriva la fuente del último ítem de la sesión, excluye lo ya agregado y conserva descartes por sesión', async () => {
    const older = new Date('2026-09-10T00:00:00.000Z');
    const latest = new Date('2026-09-10T00:02:00.000Z');
    mocks.sessionFindUnique.mockResolvedValue({
      ...activeSession,
      orders: [
        {
          status: 'CANCELLED',
          items: [{ id: 'cancelled-line', menuItemId: 'cancelled-item', createdAt: new Date('2026-09-10T00:03:00.000Z') }]
        },
        {
          status: 'IN_KITCHEN',
          items: [
            { id: 'old-line', menuItemId: 'old-item', createdAt: older },
            { id: 'last-line', menuItemId: 'source-item', createdAt: latest }
          ]
        },
        {
          status: 'DRAFT',
          items: [{ id: 'draft-line', menuItemId: 'draft-item', createdAt: new Date('2026-09-10T00:01:00.000Z') }]
        }
      ]
    });
    mocks.menuItemFindFirst.mockResolvedValue({ id: 'source-item', name: 'Gin tonic', categoryId: 'cat-drinks' });
    mocks.upsellFindMany.mockResolvedValue([{ suggestionItemId: 'dismissed-item' }]);
    mocks.menuItemFindMany.mockResolvedValue([
      { id: 'candidate-item', name: 'Papas', price: 500, category: { name: 'Guarniciones' } }
    ]);

    const result = await UpsellService.getSuggestions({ restaurantId: 'restaurant-a', sessionToken: 'token-a' });

    expect(result.sourceItem).toEqual({ id: 'source-item', name: 'Gin tonic' });
    expect(result.suggestions).toEqual([expect.objectContaining({ id: 'candidate-item' })]);
    expect(mocks.sessionFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        table: { select: { restaurantId: true } },
        orders: expect.objectContaining({ where: { status: { not: 'CANCELLED' } } })
      })
    }));
    expect(mocks.upsellFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        restaurantId: 'restaurant-a',
        sessionHash: createHash('sha256').update('restaurant-a:token-a').digest('hex'),
        eventType: 'DISMISS'
      })
    }));
    expect(mocks.menuItemFindMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 2,
      where: expect.objectContaining({
        id: expect.objectContaining({
          notIn: expect.arrayContaining(['old-item', 'source-item', 'draft-item', 'dismissed-item'])
        })
      })
    }));
  });

  it('falla cerrado si la consulta contextual de sugerencias tiene un error', async () => {
    mocks.sessionFindUnique.mockResolvedValue({
      ...activeSession,
      orders: [{ status: 'DRAFT', items: [{ id: 'line-1', menuItemId: 'source-item', createdAt: new Date() }] }]
    });
    mocks.menuItemFindFirst.mockResolvedValue({ id: 'source-item', name: 'Gin tonic', categoryId: 'cat-drinks' });
    mocks.menuItemFindMany.mockRejectedValue(new Error('upsell unavailable'));

    await expect(UpsellService.getSuggestions({ restaurantId: 'restaurant-a', sessionToken: 'token-a' }))
      .resolves.toEqual({ sourceItem: null, suggestions: [] });
  });

  it('no acepta como replay una clave global perteneciente a otra sesión o intención', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { code: 'P2002' });
    mocks.upsellCreate.mockRejectedValueOnce(duplicate);
    mocks.upsellFindUnique.mockResolvedValue({
      id: 'event-1',
      restaurantId: 'restaurant-b',
      sessionHash: 'other-session',
      eventType: 'DISMISS',
      sourceItemId: null,
      suggestionItemId: 'suggestion-1',
      createdAt: new Date()
    });

    await expect(UpsellService.recordEvent({
      restaurantIdOrSlug: 'restaurant-a',
      sessionToken: 'token-a',
      eventType: 'IMPRESSION',
      suggestionItemId: 'suggestion-1',
      idempotencyKey: 'reused-key'
    })).rejects.toMatchObject({ statusCode: 409, code: 'UPSELL_IDEMPOTENCY_CONFLICT' });
  });
});

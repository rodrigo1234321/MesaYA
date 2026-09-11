import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { UpsellService } from '../src/services/upsell.service';
import { TableFSMState } from '@mesaya/shared';

describe('E14 — sugerencias contextuales y descarte por sesión', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let shift: any;
  let sourceItem: any;
  let secondSourceItem: any;

  async function createSession(label: string) {
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `${label}-${randomUUID().slice(0, 6)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });
    return prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
  }

  async function add(sessionToken: string, itemId: string, guestSessionId: string) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken,
        guestSessionId,
        menuItemId: itemId,
        quantity: 1
      }
    });
    expect(response.statusCode).toBe(201);
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    restaurant = await prisma.restaurant.create({
      data: {
        name: 'E14 Upsell',
        slug: `e14-upsell-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#4f46e5',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false,
            reviewQuantityThreshold: 6,
            enableUpsell: true
          }
        }
      }
    });
    shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    const drinks = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'E14 bebidas', orderIndex: 0 } });
    const food = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'E14 cocina', orderIndex: 1 } });
    const dessert = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'E14 postres', orderIndex: 2 } });
    sourceItem = await prisma.menuItem.create({
      data: { categoryId: drinks.id, name: 'Gin E14', price: 1500, isAvailable: true, orderIndex: 0 }
    });
    secondSourceItem = await prisma.menuItem.create({
      data: { categoryId: drinks.id, name: 'Vermú E14', price: 1400, isAvailable: true, orderIndex: 1 }
    });
    await prisma.menuItem.create({
      data: { categoryId: food.id, name: 'Papas E14', price: 700, isAvailable: true, orderIndex: 0 }
    });
    await prisma.menuItem.create({
      data: { categoryId: dessert.id, name: 'Flan E14', price: 650, isAvailable: true, orderIndex: 0 }
    });
    await prisma.menuItem.create({
      data: { categoryId: dessert.id, name: 'Café E14', price: 500, isAvailable: true, orderIndex: 1 }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('usa el último ítem de la sesión, limita a dos y excluye ítems ya agregados', async () => {
    const session = await createSession('E14 normal');
    await add(session.token, sourceItem.id, 'guest-e14-a');
    await add(session.token, secondSourceItem.id, 'guest-e14-b');

    const result = await UpsellService.getSuggestions({
      restaurantId: restaurant.id,
      sessionToken: session.token
    });

    expect(result.sourceItem).toEqual({ id: secondSourceItem.id, name: secondSourceItem.name });
    expect(result.suggestions.length).toBeLessThanOrEqual(2);
    expect(result.suggestions.map((item) => item.id)).not.toContain(sourceItem.id);
    expect(result.suggestions.map((item) => item.id)).not.toContain(secondSourceItem.id);
    expect(result.suggestions.every((item) => item.categoryName !== 'E14 bebidas')).toBe(true);
  });

  it('persiste un descarte sólo para la sesión y no reaparece al recargar', async () => {
    const session = await createSession('E14 descarte');
    await add(session.token, sourceItem.id, 'guest-e14-dismiss');
    const first = await UpsellService.getSuggestions({ restaurantId: restaurant.id, sessionToken: session.token });
    expect(first.suggestions.length).toBeGreaterThan(0);
    const dismissedId = first.suggestions[0].id;

    const event = await UpsellService.recordEvent({
      restaurantIdOrSlug: restaurant.id,
      sessionToken: session.token,
      eventType: 'DISMISS',
      suggestionItemId: dismissedId,
      sourceItemId: first.sourceItem?.id,
      idempotencyKey: `e14-dismiss-${randomUUID()}`,
      experimentGroup: 'UPSELL'
    });
    expect(event.idempotentReplay).toBe(false);

    const afterDismiss = await UpsellService.getSuggestions({ restaurantId: restaurant.id, sessionToken: session.token });
    expect(afterDismiss.suggestions.map((item) => item.id)).not.toContain(dismissedId);

    const eventRow = await prisma.upsellEvent.findUniqueOrThrow({ where: { id: event.id } });
    expect(eventRow.sessionHash).toBe(
      (await import('node:crypto')).createHash('sha256').update(`${restaurant.id}:${session.token}`).digest('hex')
    );
  });
});

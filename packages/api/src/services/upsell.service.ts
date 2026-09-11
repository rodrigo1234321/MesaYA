import { createHash } from 'node:crypto';
import { prisma } from '../lib/prisma';
import { isRestaurantInConfiguredInstance } from '../lib/environment';

export type UpsellEventType = 'IMPRESSION' | 'ACCEPT' | 'DISMISS';

type UpsellSuggestion = {
  id: string;
  name: string;
  price: number;
  categoryName: string;
  pairingReason: string;
};

function emptySuggestions() {
  return { sourceItem: null, suggestions: [] as UpsellSuggestion[] };
}

function sessionHashFor(restaurantId: string, sessionToken: string): string {
  return createHash('sha256').update(`${restaurantId}:${sessionToken}`).digest('hex');
}

function itemTimestamp(item: any): number {
  const timestamp = new Date(item?.createdAt || 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isAfter(left: any, right: any): boolean {
  const leftTime = itemTimestamp(left);
  const rightTime = itemTimestamp(right);
  if (leftTime !== rightTime) return leftTime > rightTime;
  return String(left?.id || '').localeCompare(String(right?.id || '')) > 0;
}

function upsellError(statusCode: number, code: string, message: string): Error & { statusCode: number; code: string } {
  const error = new Error(message) as Error & { statusCode: number; code: string };
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

export class UpsellService {
  static async getSuggestions(params: {
    restaurantId: string;
    sessionToken?: string | null;
    lastItemId?: string | null;
  }): Promise<{ sourceItem: { id: string; name: string } | null; suggestions: UpsellSuggestion[] }> {
    const { restaurantId, sessionToken, lastItemId } = params;
    try {
      // La fuente se deriva del último OrderItem real de la sesión. El query
      // param sólo puede ser una pista de compatibilidad: nunca puede hacer
      // que el cliente elija arbitrariamente un plato de la carta.
      let sourceItem: { id: string; name: string; categoryId: string } | null = null;
      const excludeIds = new Set<string>();
      const dismissedIds = new Set<string>();
      if (sessionToken) {
        const session: any = await (prisma as any).tableSession.findUnique({
          where: { token: sessionToken },
          include: {
            table: { select: { restaurantId: true } },
            shift: { select: { closedAt: true } },
            orders: {
              where: { status: { not: 'CANCELLED' } },
              include: { items: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] } },
              orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
            }
          }
        });

        const inactive = session && (
          session.closedAt ||
          (session.expiresAt && new Date(session.expiresAt) <= new Date()) ||
          session.shift?.closedAt
        );
        if (!session || session.table?.restaurantId !== restaurantId || inactive) {
          return emptySuggestions();
        }

        const sessionItems: any[] = (session.orders || []).flatMap((order: any) => order.items || []);
        for (const item of sessionItems) {
          if (item?.menuItemId) excludeIds.add(item.menuItemId);
        }
        const last = sessionItems.filter((item) => item?.menuItemId).reduce(
          (current, item) => (!current || isAfter(item, current) ? item : current),
          null as any
        );
        if (!last) return emptySuggestions();

        const found: any = await (prisma as any).menuItem.findFirst({
          where: { id: last.menuItemId, category: { restaurantId } },
          select: { id: true, name: true, categoryId: true }
        });
        if (found) sourceItem = found;
        if (!sourceItem) return emptySuggestions();

        const dismissed: any[] = await (prisma as any).upsellEvent.findMany({
          where: { restaurantId, sessionHash: sessionHashFor(restaurantId, sessionToken), eventType: 'DISMISS' },
          select: { suggestionItemId: true }
        });
        for (const dismissal of dismissed) {
          if (dismissal?.suggestionItemId) dismissedIds.add(dismissal.suggestionItemId);
        }
      } else if (lastItemId) {
        // Compatibilidad para consumidores públicos sin sesión. Este camino no
        // puede persistir descartes ni reclamar contexto de una mesa.
        const found: any = await (prisma as any).menuItem.findFirst({
          where: { id: lastItemId, category: { restaurantId } },
          select: { id: true, name: true, categoryId: true }
        });
        if (found) sourceItem = found;
      } else {
        return emptySuggestions();
      }

      if (!sourceItem) return emptySuggestions();
      const notIn = new Set([...excludeIds, ...dismissedIds, sourceItem.id]);
      const candidates: any[] = await (prisma as any).menuItem.findMany({
        where: {
          category: { restaurantId, id: { not: sourceItem.categoryId } },
          isAvailable: true,
          ...(notIn.size ? { id: { notIn: [...notIn] } } : {})
        },
        include: { category: true },
        take: 2,
        orderBy: [{ isFeatured: 'desc' }, { orderIndex: 'asc' }, { id: 'asc' }]
      });
      return {
        sourceItem: { id: sourceItem.id, name: sourceItem.name },
        suggestions: candidates.slice(0, 2).map((item: any) => ({
          id: item.id,
          name: item.name,
          price: item.price,
          categoryName: item.category.name,
          pairingReason: `Maridaje sugerido: combina con ${sourceItem!.name}`
        }))
      };
    } catch {
      // Fallo cerrado: nunca bloquear agregar/enviar.
      return emptySuggestions();
    }
  }

  static async recordEvent(params: {
    restaurantIdOrSlug: string;
    sessionToken: string;
    eventType: UpsellEventType;
    suggestionItemId: string;
    sourceItemId?: string | null;
    idempotencyKey: string;
    experimentGroup?: 'UPSELL' | 'CONTROL' | 'UNASSIGNED';
  }) {
    const { restaurantIdOrSlug, sessionToken, eventType, suggestionItemId, sourceItemId, idempotencyKey } = params;
    if (!sessionToken || typeof sessionToken !== 'string') throw upsellError(400, 'SESSION_TOKEN_REQUIRED', 'sessionToken requerido');
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 160) {
      throw upsellError(400, 'IDEMPOTENCY_KEY_INVALID', 'idempotencyKey requerido y limitado a 160 caracteres');
    }
    if (!['IMPRESSION', 'ACCEPT', 'DISMISS'].includes(eventType)) {
      throw upsellError(400, 'UPSELL_EVENT_INVALID', 'eventType inválido');
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantIdOrSlug }, { slug: restaurantIdOrSlug }] },
      select: { id: true, moduleConfig: { select: { enableUpsell: true } } }
    });
    if (!restaurant || !isRestaurantInConfiguredInstance(restaurant.id)) throw upsellError(404, 'RESTAURANT_NOT_FOUND', 'Restaurante no encontrado');
    if (restaurant.moduleConfig?.enableUpsell === false) {
      throw upsellError(403, 'UPSELL_DISABLED', 'El upselling está deshabilitado en este restaurante');
    }

    const session = await prisma.tableSession.findUnique({
      where: { token: sessionToken },
      include: { table: true, shift: true }
    });
    if (!session || session.table.restaurantId !== restaurant.id) {
      throw upsellError(404, 'SESSION_NOT_FOUND', 'Sesión no encontrada');
    }
    if (session.closedAt || session.expiresAt <= new Date() || session.shift?.closedAt) {
      throw upsellError(410, 'SESSION_INACTIVE', 'La sesión de mesa ya no está activa');
    }

    const suggestion = await prisma.menuItem.findFirst({
      where: { id: suggestionItemId, isAvailable: true, category: { restaurantId: restaurant.id } },
      select: { id: true }
    });
    if (!suggestion) throw upsellError(404, 'SUGGESTION_NOT_FOUND', 'La sugerencia ya no está disponible');
    if (sourceItemId) {
      const source = await prisma.menuItem.findFirst({
        where: { id: sourceItemId, category: { restaurantId: restaurant.id } },
        select: { id: true }
      });
      if (!source) throw upsellError(404, 'SOURCE_ITEM_NOT_FOUND', 'El plato de origen no pertenece al restaurante');
    }

    // La persistencia de descartes se consulta con el hash compuesto por
    // restaurante + sesión. Mantener la misma función acá evita que un
    // descarte parezca guardado pero vuelva a aparecer al recargar el carrito.
    const sessionHash = sessionHashFor(restaurant.id, sessionToken);
    try {
      const created = await prisma.upsellEvent.create({
        data: {
          restaurantId: restaurant.id,
          sessionHash,
          idempotencyKey,
          eventType,
          experimentGroup: params.experimentGroup || 'UPSELL',
          sourceItemId: sourceItemId || null,
          suggestionItemId: suggestion.id
        },
        select: { id: true, eventType: true, suggestionItemId: true, createdAt: true }
      });
      return { ...created, idempotentReplay: false };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const existing = await prisma.upsellEvent.findUnique({
          where: { idempotencyKey },
          select: {
            id: true,
            restaurantId: true,
            sessionHash: true,
            eventType: true,
            sourceItemId: true,
            suggestionItemId: true,
            createdAt: true
          }
        });
        if (existing) {
          // La clave es globalmente única. No devolver como replay un evento
          // perteneciente a otra mesa/tenant o a otra intención.
          if (
            existing.restaurantId !== restaurant.id ||
            existing.sessionHash !== sessionHash ||
            existing.eventType !== eventType ||
            existing.sourceItemId !== (sourceItemId || null) ||
            existing.suggestionItemId !== suggestion.id
          ) {
            throw upsellError(409, 'UPSELL_IDEMPOTENCY_CONFLICT', 'La clave de upsell ya fue usada para otra sesión o evento');
          }
          return { ...existing, idempotentReplay: true };
        }
      }
      throw err;
    }
  }
}

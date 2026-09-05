import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma';
import { BatchMenuImportDTO, AiMenuGenerateInputSchema, AiSommelierInputSchema } from '@mesaya/shared';
import { requireManagedRestaurant } from '../middlewares/auth.middleware';
import { AbuseControlService, AbusePolicies } from '../services/abuse-control.service';

// Gestor en memoria de cuotas por sesión de mesa para Sommelier IA
// Evita bucles infinitos y costos no controlados. Máximo 10 consultas por sesión de mesa.
class SommelierQuotaManager {
  private static readonly MAX_QUERIES_PER_SESSION = 10;
  private static readonly sessionUsage = new Map<string, { count: number; lastUsed: number }>();

  static canQuery(sessionToken: string): boolean {
    this.cleanupOldSessions();
    const entry = this.sessionUsage.get(sessionToken);
    if (!entry) return true;
    return entry.count < this.MAX_QUERIES_PER_SESSION;
  }

  static recordQuery(sessionToken: string): number {
    this.cleanupOldSessions();
    const entry = this.sessionUsage.get(sessionToken) || { count: 0, lastUsed: Date.now() };
    entry.count += 1;
    entry.lastUsed = Date.now();
    this.sessionUsage.set(sessionToken, entry);
    return entry.count;
  }

  static getRemainingQueries(sessionToken: string): number {
    const entry = this.sessionUsage.get(sessionToken);
    const count = entry ? entry.count : 0;
    return Math.max(0, this.MAX_QUERIES_PER_SESSION - count);
  }

  private static cleanupOldSessions(): void {
    // Limpiar entradas que tengan más de 6 horas
    const now = Date.now();
    const maxAge = 6 * 60 * 60 * 1000;
    if (this.sessionUsage.size > 2000) {
      for (const [token, data] of this.sessionUsage.entries()) {
        if (now - data.lastUsed > maxAge) {
          this.sessionUsage.delete(token);
        }
      }
    }
  }

  // Helper para tests
  static reset(): void {
    this.sessionUsage.clear();
  }
}

export { SommelierQuotaManager };

export async function menuRoutes(fastify: FastifyInstance) {
  // 1. Obtener Menú completo del Restaurante (Público y para Admin)
  fastify.get('/restaurants/:slugOrId/menu', async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };

      const restaurant = await prisma.restaurant.findFirst({
        where: {
          OR: [{ id: slugOrId }, { slug: slugOrId }]
        },
        include: {
          categories: {
            orderBy: { orderIndex: 'asc' },
            include: {
              items: {
                orderBy: { orderIndex: 'asc' }
              }
            }
          }
        }
      });

      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }

      const formattedCategories = restaurant.categories.map((cat) => ({
        id: cat.id,
        restaurantId: cat.restaurantId,
        name: cat.name,
        icon: cat.icon || null,
        orderIndex: cat.orderIndex,
        items: cat.items.map((item) => {
          let parsedTags: string[] = [];
          try {
            parsedTags = item.tags ? JSON.parse(item.tags) : [];
          } catch (_) {
            parsedTags = [];
          }
          return {
            id: item.id,
            categoryId: item.categoryId,
            name: item.name,
            description: item.description || null,
            price: item.price,
            imageUrl: item.imageUrl || null,
            isAvailable: item.isAvailable,
            isFeatured: item.isFeatured,
            tags: parsedTags,
            orderIndex: item.orderIndex
          };
        })
      }));

      return reply.send({
        restaurant: {
          id: restaurant.id,
          name: restaurant.name,
          slug: restaurant.slug,
          logoUrl: restaurant.logoUrl || null,
          coverImageUrl: restaurant.coverImageUrl || null,
          themeColor: restaurant.themeColor || '#f59e0b',
          templateId: (restaurant as any).templateId || 'GOURMET_OBSIDIAN',
          customFont: (restaurant as any).customFont || 'plus-jakarta',
          whatsappPhone: restaurant.whatsappPhone || null
        },
        categories: formattedCategories
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // 1.1 Smart Upselling & Maridajes Sugeridos (Módulo 3)
  fastify.get('/restaurants/:slugOrId/upsell', async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };
      const { itemId } = request.query as { itemId?: string };

      const restaurant = await prisma.restaurant.findFirst({
        where: { OR: [{ id: slugOrId }, { slug: slugOrId }] },
        include: { moduleConfig: true }
      });

      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }

      const isUpsellEnabled = restaurant.moduleConfig?.enableUpsell ?? true;
      if (!isUpsellEnabled) {
        return reply.send({ enabled: false, suggestions: [] });
      }

      let sourceItem = null;
      if (itemId) {
        sourceItem = await prisma.menuItem.findUnique({
          where: { id: itemId },
          include: { category: true }
        });
      }

      const suggestions = await prisma.menuItem.findMany({
        where: {
          category: {
            restaurantId: restaurant.id,
            ...(sourceItem ? { id: { not: sourceItem.categoryId } } : {})
          },
          isAvailable: true,
          ...(sourceItem ? { id: { not: sourceItem.id } } : {})
        },
        include: { category: true },
        take: 3,
        orderBy: [{ isFeatured: 'desc' }, { orderIndex: 'asc' }]
      });

      const formatted = suggestions.map((item) => ({
        id: item.id,
        name: item.name,
        price: item.price,
        categoryName: item.category.name,
        pairingReason: sourceItem
          ? `Maridaje sugerido: Combina a la perfección con ${sourceItem.name}`
          : 'Sugerencia especial de la casa'
      }));

      return reply.send({
        enabled: true,
        sourceItem: sourceItem ? { id: sourceItem.id, name: sourceItem.name } : null,
        suggestions: formatted
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 2. Crear Categoría
  fastify.post('/restaurants/:slugOrId/menu/categories', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };
      const { name, icon, orderIndex } = request.body as {
        name: string;
        icon?: string;
        orderIndex?: number;
      };

      if (!name || !name.trim()) {
        return reply.status(400).send({ error: 'Nombre de categoría requerido' });
      }

      const category = await prisma.menuCategory.create({
        data: {
          restaurantId: request.managedRestaurantId!,
          name: name.trim(),
          icon: icon || '🍽️',
          orderIndex: orderIndex ?? 0
        }
      });

      return reply.status(201).send(category);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 3. Eliminar Categoría
  fastify.delete('/restaurants/:slugOrId/menu/categories/:categoryId', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { categoryId } = request.params as { slugOrId: string; categoryId: string };
      const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, restaurantId: request.managedRestaurantId! }, select: { id: true } });
      if (!category) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      await prisma.menuCategory.delete({ where: { id: categoryId } });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 4. Crear Plato Individual
  fastify.post('/restaurants/:slugOrId/menu/items', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { categoryId, name, description, price, imageUrl, isAvailable, isFeatured, tags, orderIndex } =
        request.body as {
          categoryId: string;
          name: string;
          description?: string;
          price: number;
          imageUrl?: string;
          isAvailable?: boolean;
          isFeatured?: boolean;
          tags?: string[];
          orderIndex?: number;
        };

      if (!categoryId || !name || price === undefined) {
        return reply.status(400).send({ error: 'categoryId, name y price son obligatorios' });
      }
      const category = await prisma.menuCategory.findFirst({ where: { id: categoryId, restaurantId: request.managedRestaurantId! }, select: { id: true } });
      if (!category) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });

      const item = await prisma.menuItem.create({
        data: {
          categoryId,
          name: name.trim(),
          description: description?.trim() || null,
          price: Number(price) || 0,
          imageUrl: imageUrl?.trim() || null,
          isAvailable: isAvailable !== false,
          isFeatured: Boolean(isFeatured),
          tags: JSON.stringify(tags || []),
          orderIndex: orderIndex ?? 0
        }
      });

      return reply.status(201).send({
        ...item,
        tags: tags || []
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 5. Actualizar Plato (Precio, Stock, Tags, etc.)
  fastify.patch('/restaurants/:slugOrId/menu/items/:itemId', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { itemId } = request.params as { slugOrId: string; itemId: string };
      const body = request.body as {
        name?: string;
        description?: string;
        price?: number;
        imageUrl?: string;
        isAvailable?: boolean;
        isFeatured?: boolean;
        tags?: string[];
        orderIndex?: number;
        categoryId?: string;
      };
      const existingItem = await prisma.menuItem.findFirst({ where: { id: itemId, category: { restaurantId: request.managedRestaurantId! } }, select: { id: true } });
      if (!existingItem) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      if (body.categoryId !== undefined) {
        const targetCategory = await prisma.menuCategory.findFirst({ where: { id: body.categoryId, restaurantId: request.managedRestaurantId! }, select: { id: true } });
        if (!targetCategory) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      }

      const updateData: any = {};
      if (body.name !== undefined) updateData.name = body.name.trim();
      if (body.description !== undefined) updateData.description = body.description.trim() || null;
      if (body.price !== undefined) updateData.price = Number(body.price);
      if (body.imageUrl !== undefined) updateData.imageUrl = body.imageUrl.trim() || null;
      if (body.isAvailable !== undefined) updateData.isAvailable = Boolean(body.isAvailable);
      if (body.isFeatured !== undefined) updateData.isFeatured = Boolean(body.isFeatured);
      if (body.tags !== undefined) updateData.tags = JSON.stringify(body.tags);
      if (body.orderIndex !== undefined) updateData.orderIndex = Number(body.orderIndex);
      if (body.categoryId !== undefined) updateData.categoryId = body.categoryId;

      const item = await prisma.menuItem.update({
        where: { id: itemId },
        data: updateData
      });

      let parsedTags: string[] = [];
      try {
        parsedTags = JSON.parse(item.tags);
      } catch (_) {}

      return reply.send({
        ...item,
        tags: parsedTags
      });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 6. Eliminar Plato
  fastify.delete('/restaurants/:slugOrId/menu/items/:itemId', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { itemId } = request.params as { slugOrId: string; itemId: string };
      const item = await prisma.menuItem.findFirst({ where: { id: itemId, category: { restaurantId: request.managedRestaurantId! } }, select: { id: true } });
      if (!item) return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
      await prisma.menuItem.delete({ where: { id: itemId } });
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 7. Importación Masiva desde Excel/CSV parseado
  fastify.post('/restaurants/:slugOrId/menu/import', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };
      const { items, replaceExisting } = request.body as BatchMenuImportDTO;

      if (!items || !Array.isArray(items) || items.length === 0 || items.length > 200) {
        return reply.status(400).send({ error: 'Se requiere una lista de platos en "items"' });
      }
      const validItems = items.every((item) =>
        typeof item.name === 'string' && item.name.trim().length > 0 && item.name.trim().length <= 120 &&
        (item.category === undefined || (typeof item.category === 'string' && item.category.trim().length <= 80)) &&
        Number.isFinite(Number(item.price)) && Number(item.price) >= 0 &&
        (!item.tags || (Array.isArray(item.tags) && item.tags.length <= 10 && item.tags.every((tag) => typeof tag === 'string' && tag.length <= 50)))
      );
      if (!validItems) {
        return reply.status(400).send({ error: 'La importación contiene campos inválidos o excede los límites permitidos' });
      }

      const result = await prisma.$transaction(async (tx) => {
        // Si replaceExisting es true, borramos categorías anteriores (y sus platos en cascada)
        if (replaceExisting) {
          await tx.menuCategory.deleteMany({
            where: { restaurantId: request.managedRestaurantId! }
          });
        }

        // Agrupar items por nombre de categoría
        const categoriesMap = new Map<string, { icon: string; items: typeof items }>();

        for (const item of items) {
          const categoryName = (item.category || 'Varios').trim();
          if (!categoriesMap.has(categoryName)) {
            categoriesMap.set(categoryName, {
              icon: item.categoryIcon || '🍽️',
              items: []
            });
          }
          categoriesMap.get(categoryName)!.items.push(item);
        }

        let catOrder = 0;
        let createdItemsCount = 0;

        for (const [categoryName, data] of categoriesMap.entries()) {
          // Buscar si existe o crear
          let category = await tx.menuCategory.findFirst({
            where: {
              restaurantId: request.managedRestaurantId!,
              name: categoryName
            }
          });

          if (!category) {
            category = await tx.menuCategory.create({
              data: {
                restaurantId: request.managedRestaurantId!,
                name: categoryName,
                icon: data.icon,
                orderIndex: catOrder++
              }
            });
          }

          // Insertar platos
          let itemOrder = 0;
          for (const rawItem of data.items) {
            if (!rawItem.name || !rawItem.name.trim()) continue;

            await tx.menuItem.create({
              data: {
                categoryId: category.id,
                name: rawItem.name.trim(),
                description: rawItem.description?.trim() || null,
                price: Number(rawItem.price) || 0,
                imageUrl: rawItem.imageUrl?.trim() || null,
                isAvailable: true,
                isFeatured: Boolean(rawItem.isFeatured),
                tags: JSON.stringify(rawItem.tags || []),
                orderIndex: itemOrder++
              }
            });
            createdItemsCount++;
          }
        }

        return {
          categoriesCount: categoriesMap.size,
          itemsCount: createdItemsCount
        };
      });

      return reply.send({
        success: true,
        message: `Se importaron ${result.itemsCount} platos en ${result.categoriesCount} categorías`,
        ...result
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // 8. Personalización de Marca (Theme Color, Logo, Cover)
  fastify.patch('/restaurants/:slugOrId/branding', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };
      const { themeColor, logoUrl, coverImageUrl, name, whatsappPhone } = request.body as {
        themeColor?: string;
        logoUrl?: string;
        coverImageUrl?: string;
        name?: string;
        whatsappPhone?: string;
      };

      const updated = await prisma.restaurant.update({
        where: { id: request.managedRestaurantId! },
        data: {
          ...(themeColor ? { themeColor } : {}),
          ...(logoUrl !== undefined ? { logoUrl } : {}),
          ...(coverImageUrl !== undefined ? { coverImageUrl } : {}),
          ...(name ? { name } : {}),
          ...(whatsappPhone !== undefined ? { whatsappPhone } : {})
        }
      });

      return reply.send(updated);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 9. Actualizar Template Visual y Tipografía
  fastify.patch('/restaurants/:slugOrId/template', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };
      const { templateId, customFont, themeColor } = request.body as {
        templateId?: string;
        customFont?: string;
        themeColor?: string;
      };

      const updated = await prisma.restaurant.update({
        where: { id: request.managedRestaurantId! },
        data: {
          ...(templateId ? { templateId } : {}),
          ...(customFont ? { customFont } : {}),
          ...(themeColor ? { themeColor } : {})
        }
      });

      return reply.send(updated);
    } catch (err: any) {
      return reply.status(500).send({ error: err.message });
    }
  });

  // 10. AI Chef Copilot: Generación Inteligente de Cartas Gastronómicas
  fastify.post('/restaurants/:slugOrId/menu/ai-generate', { preHandler: [requireManagedRestaurant((request) => (request.params as { slugOrId: string }).slugOrId)] }, async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };
      const bodyValidation = AiMenuGenerateInputSchema.safeParse(request.body);
      if (!bodyValidation.success) {
        return reply.status(400).send({
          error: 'Parámetros de generación inválidos',
          details: bodyValidation.error.issues.map((e: any) => e.message)
        });
      }

      const { prompt, concept, templateId, autoApply, gastronomyType } = bodyValidation.data;
      const finalPrompt = (prompt || concept || '').trim();

      const restaurant = await prisma.restaurant.findFirst({
        where: { OR: [{ id: slugOrId }, { slug: slugOrId }] }
      });

      if (!restaurant) {
        return reply.status(404).send({ error: 'Restaurante no encontrado' });
      }

      const aiDecision = await AbuseControlService.consume(
        `ai:tenant:${restaurant.id}`,
        AbusePolicies.AI_BY_TENANT
      );
      if (!aiDecision.allowed) {
        reply.header('Retry-After', String(aiDecision.retryAfterSeconds));
        return reply.status(429).send({ error: 'Se alcanzó el límite de consultas IA del restaurante.', code: 'RATE_LIMIT_EXCEEDED' });
      }

      const { AIService } = await import('../services/ai.service');
      const aiResult = await AIService.generateMenu({
        prompt: finalPrompt,
        concept,
        templateId: templateId as any,
        autoApply,
        gastronomyType
      });

      const template = aiResult.suggestedTemplateId || templateId || 'GOURMET_OBSIDIAN';
      const themeColor = aiResult.themeColor || '#f59e0b';
      const categories = aiResult.categories || [];

      // Contención etapa 04 y 20: autoApply NUNCA escribe ni borra menú. Toda
      // generación es vista previa pendiente de revisión humana por manager;
      // no se simula aprobación. El flag se ignora de forma segura.
      return reply.send({
        success: true,
        suggestedName: restaurant.name,
        suggestedTemplateId: template,
        suggestedThemeColor: themeColor,
        categories,
        applied: false,
        degraded: (aiResult as any).degraded ?? false,
        reviewNote: (aiResult as any).reviewNote || 'Vista previa pendiente de revisión humana; no se aplicó ni borró menú.'
      });
    } catch (err: any) {
      if (err?.statusCode === 429) {
        reply.header('Retry-After', String(err.retryAfterSeconds || 1));
        return reply.status(429).send({ error: err.message, code: err.code });
      }
      request.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });

  // 11. Sommelier IA & Recomendador en Vivo para Comensales en Mesa
  fastify.post('/restaurants/:slugOrId/ai-sommelier', async (request, reply) => {
    try {
      const { slugOrId } = request.params as { slugOrId: string };
      const bodyValidation = AiSommelierInputSchema.safeParse(request.body);
      if (!bodyValidation.success) {
        return reply.status(400).send({
          error: 'Consulta o sesión inválida',
          details: bodyValidation.error.issues.map((e: any) => e.message)
        });
      }

      const { query, sessionToken } = bodyValidation.data;

      // 1. Validar que la sesión de mesa exista y esté activa
      const session = await prisma.tableSession.findUnique({
        where: { token: sessionToken },
        include: {
          table: {
            include: {
              restaurant: true
            }
          },
          shift: true
        }
      });

      if (!session) {
        return reply.status(401).send({ error: 'Sesión de mesa no encontrada o inválida' });
      }

      // Una sesión operativa siempre debe estar vinculada a un turno abierto
      // del mismo restaurante que la mesa. No consumir cuota ni proveedor si
      // el turno fue eliminado, cerrado o pertenece a otro tenant.
      if (!session.shift) {
        return reply.status(410).send({ error: 'La sesión de mesa no tiene un turno operativo' });
      }
      if (session.shift.closedAt) {
        return reply.status(410).send({ error: 'El turno de la sesión ya fue cerrado' });
      }
      if (session.shift.restaurantId !== session.table.restaurantId) {
        return reply.status(403).send({ error: 'El turno no pertenece al restaurante de la mesa' });
      }

      // Validar si la sesión ya fue cerrada
      if (session.closedAt) {
        return reply.status(410).send({ error: 'La sesión de mesa ha finalizado' });
      }

      // Validar TTL de expiración
      if (new Date() > new Date(session.expiresAt)) {
        return reply.status(401).send({ error: 'La sesión de mesa ha expirado' });
      }

      // Validar tenant (el restaurante de la mesa debe coincidir con slugOrId)
      const rest = session.table.restaurant;
      if (rest.id !== slugOrId && rest.slug !== slugOrId) {
        return reply.status(403).send({ error: 'La sesión no pertenece al restaurante especificado' });
      }

      // 2. Cuota compartida por tenant (la autoridad entre procesos). La
      // cuota por sesión se conserva como límite de producto adicional.
      const aiDecision = await AbuseControlService.consume(
        `ai:tenant:${rest.id}`,
        AbusePolicies.AI_BY_TENANT
      );
      if (!aiDecision.allowed) {
        reply.header('Retry-After', String(aiDecision.retryAfterSeconds));
        return reply.status(429).send({
          error: 'Se alcanzó el límite de consultas IA del restaurante. Por favor consulta a nuestro personal de salón.',
          code: 'RATE_LIMIT_EXCEEDED',
          remainingQueries: 0
        });
      }

      // Cuota de producto por sesión (máximo 10 consultas por comensal)
      if (!SommelierQuotaManager.canQuery(sessionToken)) {
        return reply.status(429).send({
          error: 'Has alcanzado el límite de consultas al Sommelier para esta sesión de mesa. Por favor, consulta a nuestro personal de salón.',
          code: 'QUOTA_EXCEEDED',
          remainingQueries: 0
        });
      }

      SommelierQuotaManager.recordQuery(sessionToken);

      const { AIService } = await import('../services/ai.service');
      const result = await AIService.askSommelier(slugOrId, query.trim());
      return reply.send({
        ...result,
        remainingQueries: SommelierQuotaManager.getRemainingQueries(sessionToken)
      });
    } catch (err: any) {
      if (err?.statusCode === 429) {
        reply.header('Retry-After', String(err.retryAfterSeconds || 1));
        return reply.status(429).send({ error: err.message, code: err.code });
      }
      request.log.error(err);
      return reply.status(500).send({ error: err.message });
    }
  });
}

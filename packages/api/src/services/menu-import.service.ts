import { prisma } from '../lib/prisma';
import {
  BatchMenuImportDTO,
  BatchMenuImportResponseDTO,
  BatchMenuImportItem
} from '@mesaya/shared';

const MAX_PRICE_MINOR = 2_147_483_647;

export class MenuImportError extends Error {
  readonly statusCode: number = 400;
  readonly code: string = 'INVALID_MENU_IMPORT';

  constructor(message: string, code = 'INVALID_MENU_IMPORT', statusCode = 400) {
    super(message);
    this.name = 'MenuImportError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function buildCatalogKey(
  restaurantId: string,
  source: string | undefined,
  externalId: string | undefined
): string | null {
  if (!externalId || typeof externalId !== 'string' || !externalId.trim()) return null;
  const normExt = externalId.trim().toLowerCase();
  const normSource = (source && typeof source === 'string' && source.trim())
    ? source.trim().toLowerCase()
    : 'default';
  return `${restaurantId}:${normSource}:${normExt}`;
}

export class MenuImportService {
  /**
   * Sincroniza el catálogo gastronómico de un restaurante de forma idempotente,
   * no destructiva y con resolución canónica de identidad (E01).
   *
   * Jerarquía de resolución de identidad:
   * 1. catalogKey / externalId cuando existe: mapea inequívocamente al plato.
   *    Permite renombrar, cambiar descripción o precio preservando el mismo MenuItem.id.
   * 2. Fallback por categoría + nombre normalizados: para registros históricos
   *    sin catalogKey. Al hacer match, backfillea catalogKey con el nuevo externalId.
   * 3. Detección de conflictos antes de mutar: si externalId colisiona o apunta a
   *    otro ítem con diferente identidad, o dos ítems colisionan en el payload,
   *    se rechaza todo el lote con 400 antes de tocar la base de datos.
   * 4. CERO hard-deletes: con replaceExisting=true, los platos ausentes pasan a
   *    isAvailable: false. Jamás se borran categorías ni platos con historial.
   * 5. dryRun: simulación completa sin escrituras.
   */
  static async importMenu(
    restaurantId: string,
    dto: BatchMenuImportDTO,
    externalTx?: any
  ): Promise<BatchMenuImportResponseDTO> {
    if (!restaurantId || typeof restaurantId !== 'string') {
      throw new MenuImportError('ID de restaurante requerido');
    }

    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new MenuImportError('El cuerpo de importación debe ser un objeto válido');
    }
    if (dto.replaceExisting !== undefined && typeof dto.replaceExisting !== 'boolean') {
      throw new MenuImportError('replaceExisting debe ser booleano');
    }
    if (dto.dryRun !== undefined && typeof dto.dryRun !== 'boolean') {
      throw new MenuImportError('dryRun debe ser booleano');
    }

    const items = dto.items;
    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new MenuImportError('Se requiere una lista de platos en "items"');
    }
    if (items.length > 500) {
      throw new MenuImportError('La importación excede el límite máximo de 500 platos por lote');
    }

    // 1. Validación estricta del payload
    const seenExternalIds = new Set<string>();
    const seenCatNameKeys = new Set<string>();

    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      if (!item || typeof item !== 'object') {
        throw new MenuImportError(`El elemento en índice ${index} no es un objeto válido`);
      }

      const name = typeof item.name === 'string' ? item.name.trim() : '';
      if (!name || name.length > 120) {
        throw new MenuImportError(`El plato en índice ${index} debe tener un nombre válido (1 a 120 caracteres)`);
      }

      const categoryName = typeof item.category === 'string' && item.category.trim()
        ? item.category.trim()
        : 'Varios';
      if (categoryName.length > 80) {
        throw new MenuImportError(`La categoría "${categoryName}" excede el límite de 80 caracteres`);
      }

      const priceValue: unknown = item.price;
      const rawPrice = typeof priceValue === 'number'
        ? priceValue
        : (typeof priceValue === 'string' && priceValue.trim() ? Number(priceValue) : Number.NaN);
      const rawPriceMinor = Math.round(rawPrice * 100);
      if (!Number.isFinite(rawPrice) || rawPrice < 0 || !Number.isSafeInteger(rawPriceMinor) || rawPriceMinor > MAX_PRICE_MINOR) {
        throw new MenuImportError(`El precio debe ser válido y no exceder ${MAX_PRICE_MINOR} centavos`);
      }

      if (item.isAvailable !== undefined && typeof item.isAvailable !== 'boolean') {
        throw new MenuImportError(`isAvailable debe ser booleano para "${name}"`);
      }
      if (item.isFeatured !== undefined && typeof item.isFeatured !== 'boolean') {
        throw new MenuImportError(`isFeatured debe ser booleano para "${name}"`);
      }

      if (item.categoryIcon !== undefined && (typeof item.categoryIcon !== 'string' || item.categoryIcon.length > 10)) {
        throw new MenuImportError(`El icono de categoría para "${name}" excede los 10 caracteres`);
      }

      if (item.description !== undefined && item.description !== null && (typeof item.description !== 'string' || item.description.length > 1000)) {
        throw new MenuImportError(`La descripción del plato "${name}" excede los 1000 caracteres`);
      }

      if (item.externalId !== undefined && item.externalId !== null) {
        if (typeof item.externalId !== 'string' || !item.externalId.trim() || item.externalId.trim().length > 120) {
          throw new MenuImportError(`externalId inválido en plato "${name}": debe tener entre 1 y 120 caracteres`);
        }
        const normExt = item.externalId.trim().toLowerCase();
        if (seenExternalIds.has(normExt)) {
          throw new MenuImportError(`externalId duplicado en el payload: "${item.externalId}"`);
        }
        seenExternalIds.add(normExt);
      }

      if (item.source !== undefined && item.source !== null) {
        if (typeof item.source !== 'string' || item.source.trim().length > 80) {
          throw new MenuImportError(`source inválido en plato "${name}": máximo 80 caracteres`);
        }
      }

      if (item.tags !== undefined && item.tags !== null) {
        if (!Array.isArray(item.tags) || item.tags.length > 10) {
          throw new MenuImportError(`Las etiquetas del plato "${name}" deben ser un arreglo de hasta 10 elementos`);
        }
        for (const tag of item.tags) {
          if (typeof tag !== 'string' || tag.length === 0 || tag.length > 50) {
            throw new MenuImportError(`Etiqueta inválida en plato "${name}": debe ser texto no vacío de hasta 50 caracteres`);
          }
        }
      }

      // Detección de duplicados en la misma categoría si no tienen externalId diferenciado
      const catNameKey = `${categoryName.toLowerCase()}:::${name.toLowerCase()}`;
      if (seenCatNameKeys.has(catNameKey)) {
        throw new MenuImportError(`Ítem duplicado dentro de la misma categoría en el payload: "${categoryName} > ${name}"`);
      }
      seenCatNameKeys.add(catNameKey);
    }

    // 2. Agrupar ítems por categoría respetando orden de aparición
    interface CategoryGroup {
      name: string;
      icon: string;
      orderIndex: number;
      items: BatchMenuImportItem[];
    }
    const categoryGroups: CategoryGroup[] = [];
    const categoryMap = new Map<string, CategoryGroup>();

    for (const item of items) {
      const categoryName = (item.category || 'Varios').trim();
      const normCatName = categoryName.toLowerCase();

      let group = categoryMap.get(normCatName);
      if (!group) {
        group = {
          name: categoryName,
          icon: item.categoryIcon?.trim() || '🍽️',
          orderIndex: categoryGroups.length,
          items: []
        };
        categoryMap.set(normCatName, group);
        categoryGroups.push(group);
      }
      group.items.push(item);
    }

    const isDryRun = dto.dryRun === true;
    const replaceExisting = dto.replaceExisting === true;

    // 3. Función central de sincronización
    const runSync = async (tx: any): Promise<BatchMenuImportResponseDTO> => {
      // Cargar categorías e ítems existentes para resolución canónica
      const existingCategories = await tx.menuCategory.findMany({
        where: { restaurantId },
        include: { items: true },
        orderBy: { orderIndex: 'asc' }
      });

      const existingCatByName = new Map<string, typeof existingCategories[0]>();
      for (const cat of existingCategories) {
        existingCatByName.set(cat.name.trim().toLowerCase(), cat);
      }

      const allExistingItemsById = new Map<string, any>();
      const existingItemByCatalogKey = new Map<string, any>();
      const existingItemByCatAndName = new Map<string, any>();

      for (const cat of existingCategories) {
        for (const item of cat.items) {
          allExistingItemsById.set(item.id, item);
          if (item.catalogKey) {
            existingItemByCatalogKey.set(item.catalogKey.trim().toLowerCase(), item);
          }
          const catNameKey = `${cat.id}:::${item.name.trim().toLowerCase()}`;
          existingItemByCatAndName.set(catNameKey, item);
        }
      }

      // 3.1. Pre-resolución y verificación de conflictos antes de mutar
      const matchedDbItemIds = new Set<string>();
      interface ResolvedItem {
        rawItem: BatchMenuImportItem;
        categoryGroupName: string;
        targetCatalogKey: string | null;
        matchedExistingItem: any | null;
        isBackfill: boolean;
      }
      const resolvedItems: ResolvedItem[] = [];

      for (const group of categoryGroups) {
        const normCatName = group.name.toLowerCase();
        const existingCat = existingCatByName.get(normCatName);

        for (const rawItem of group.items) {
          const normName = rawItem.name.trim().toLowerCase();
          const targetCatalogKey = buildCatalogKey(restaurantId, rawItem.source, rawItem.externalId);
          let matchedExistingItem: any = null;
          let isBackfill = false;

          // Paso 1: Resolución por catalogKey (externalId)
          if (targetCatalogKey) {
            const keyMatch = existingItemByCatalogKey.get(targetCatalogKey.toLowerCase());
            if (keyMatch) {
              matchedExistingItem = keyMatch;
            }
          }

          // Paso 2: Fallback por categoría + nombre para filas históricas sin catalogKey
          if (!matchedExistingItem && existingCat) {
            const catNameKey = `${existingCat.id}:::${normName}`;
            const nameMatch = existingItemByCatAndName.get(catNameKey);
            if (nameMatch) {
              if (nameMatch.catalogKey && targetCatalogKey && nameMatch.catalogKey.toLowerCase() !== targetCatalogKey.toLowerCase()) {
                // Conflicto de identidad: el plato en DB ya está atado a otra catalogKey distinta
                throw new MenuImportError(
                  `Conflicto de identidad externa: el plato "${rawItem.name}" en categoría "${group.name}" ya está vinculado a otra clave canónica`,
                  'CATALOG_KEY_CONFLICT',
                  400
                );
              }
              matchedExistingItem = nameMatch;
              if (!nameMatch.catalogKey && targetCatalogKey) {
                isBackfill = true;
              }
            }
          }

          if (matchedExistingItem) {
            if (matchedDbItemIds.has(matchedExistingItem.id)) {
              throw new MenuImportError(
                `Conflicto en lote: múltiples platos del payload mapean al mismo ítem existente en base de datos (ID: ${matchedExistingItem.id})`,
                'AMBIGUOUS_ITEM_MATCH',
                400
              );
            }
            matchedDbItemIds.add(matchedExistingItem.id);
          }

          resolvedItems.push({
            rawItem,
            categoryGroupName: group.name,
            targetCatalogKey,
            matchedExistingItem,
            isBackfill
          });
        }
      }

      // 3.2. Ejecución de mutaciones (o proyección para dryRun)
      let categoriesCreated = 0;
      let categoriesUpdated = 0;
      let itemsCreated = 0;
      let itemsUpdated = 0;
      let itemsDeactivated = 0;
      const warnings: string[] = [];

      // Mapear o crear categorías
      const finalCategoryMap = new Map<string, { id: string; name: string }>();

      for (const group of categoryGroups) {
        const normCatName = group.name.toLowerCase();
        let existingCat = existingCatByName.get(normCatName);

        if (existingCat) {
          categoriesUpdated++;
          finalCategoryMap.set(normCatName, { id: existingCat.id, name: existingCat.name });
          if (!isDryRun) {
            if (existingCat.icon !== group.icon || existingCat.orderIndex !== group.orderIndex) {
              await tx.menuCategory.update({
                where: { id: existingCat.id },
                data: {
                  icon: group.icon,
                  orderIndex: group.orderIndex
                }
              });
            }
          }
        } else {
          categoriesCreated++;
          if (!isDryRun) {
            const newCat = await tx.menuCategory.create({
              data: {
                restaurantId,
                name: group.name,
                icon: group.icon,
                orderIndex: group.orderIndex
              }
            });
            finalCategoryMap.set(normCatName, { id: newCat.id, name: newCat.name });
            existingCatByName.set(normCatName, { ...newCat, items: [] });
          } else {
            finalCategoryMap.set(normCatName, { id: `simulated-cat-${categoriesCreated}`, name: group.name });
          }
        }
      }

      // Crear o actualizar ítems
      const orderCountersByCat = new Map<string, number>();

      for (const resolved of resolvedItems) {
        const { rawItem, categoryGroupName, targetCatalogKey, matchedExistingItem, isBackfill } = resolved;
        const normCatName = categoryGroupName.toLowerCase();
        const catInfo = finalCategoryMap.get(normCatName)!;
        const currentOrder = orderCountersByCat.get(catInfo.id) || 0;
        orderCountersByCat.set(catInfo.id, currentOrder + 1);

        const price = Number(rawItem.price) || 0;
        const priceMinor = Math.round(price * 100);
        const isComingSoon = rawItem.tags?.includes('COMING_SOON') ?? false;
        const isAvailable = isComingSoon ? false : (rawItem.isAvailable !== false);
        const isFeatured = Boolean(rawItem.isFeatured);
        const tagsJson = JSON.stringify(rawItem.tags || []);
        const description = rawItem.description?.trim() || null;
        const imageUrl = rawItem.imageUrl?.trim() || null;

        if (matchedExistingItem) {
          itemsUpdated++;
          if (isBackfill && targetCatalogKey) {
            warnings.push(`Plato "${rawItem.name}" sin clave canónica previa: asociada catalogKey "${targetCatalogKey}".`);
          }
          if (!isDryRun) {
            const updatePayload: any = {
              categoryId: catInfo.id, // Si cambió de categoría, se reubica conservando ID
              name: rawItem.name.trim(),
              description,
              price,
              priceMinor,
              imageUrl: imageUrl ?? matchedExistingItem.imageUrl,
              isAvailable,
              isFeatured,
              tags: tagsJson,
              orderIndex: currentOrder
            };
            if (targetCatalogKey && (!matchedExistingItem.catalogKey || matchedExistingItem.catalogKey !== targetCatalogKey)) {
              updatePayload.catalogKey = targetCatalogKey;
            }

            await tx.menuItem.update({
              where: { id: matchedExistingItem.id },
              data: updatePayload
            });
          }
        } else {
          itemsCreated++;
          if (!isDryRun) {
            await tx.menuItem.create({
              data: {
                categoryId: catInfo.id,
                name: rawItem.name.trim(),
                description,
                price,
                priceMinor,
                imageUrl,
                isAvailable,
                isFeatured,
                tags: tagsJson,
                orderIndex: currentOrder,
                catalogKey: targetCatalogKey || null
              }
            });
          }
        }
      }

      // 4. Si replaceExisting es true, desactivar lógicamente ausentes (CERO hard-delete)
      if (replaceExisting) {
        for (const [existingId, item] of allExistingItemsById.entries()) {
          if (!matchedDbItemIds.has(existingId)) {
            if (item.isAvailable) {
              itemsDeactivated++;
              warnings.push(`Plato "${item.name}" (ID: ${item.id}) no figura en la nueva carta; desactivado lógicamente.`);
              if (!isDryRun) {
                await tx.menuItem.update({
                  where: { id: existingId },
                  data: { isAvailable: false }
                });
              }
            }
          }
        }
      }

      // 5. Template visual si fue provisto
      if (dto.templateId && !isDryRun) {
        await tx.restaurant.update({
          where: { id: restaurantId },
          data: { templateId: dto.templateId }
        });
      }

      const totalItemsCount = isDryRun
        ? items.length
        : (itemsCreated + itemsUpdated);

      const message = isDryRun
        ? `Simulación de catálogo: ${itemsCreated} para crear, ${itemsUpdated} para actualizar, ${itemsDeactivated} para desactivar en ${categoryGroups.length} categorías`
        : `Se sincronizó el catálogo: ${itemsCreated} creados, ${itemsUpdated} actualizados, ${itemsDeactivated} desactivados en ${categoryGroups.length} categorías`;

      return {
        success: true,
        dryRun: isDryRun,
        message,
        categoriesCount: categoryGroups.length,
        itemsCount: totalItemsCount,
        summary: {
          categoriesCreated,
          categoriesUpdated,
          itemsCreated,
          itemsUpdated,
          itemsDeactivated
        },
        warnings
      };
    };

    if (externalTx) {
      return runSync(externalTx);
    }

    if (isDryRun) {
      return runSync(prisma);
    }

    return prisma.$transaction(async (tx) => {
      return runSync(tx);
    });
  }
}

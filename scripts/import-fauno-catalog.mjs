#!/usr/bin/env node

/**
 * MesaYA - Importador Reproducible de Catálogo Fauno Olavarría (E01)
 *
 * Transforma el catálogo canónico (apps/client-web/public/demo/fauno-olavarria/catalog.json
 * o data/fauno/catalog.json) en un payload BatchMenuImportDTO validado,
 * garantizando la conciliación de las 26 categorías y 144 ítems.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultCatalogPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
const orderReviewRequiredKeys = new Set([
  'papas__papas-al-verdeo',
  'tacos__tacos-veggie',
  'tacos__tacos-pollo-carne',
  'sin-alcohol__frozzen-fruit',
  'lo-de-siempre__vermu-con-soda',
  'caipis-y-mojitos__caiporoska-sernova',
  'caipis-y-mojitos__caipiroska-absolut',
  'caipis-y-mojitos__mojito-clasico',
  'frozzens__daikiri-frozen',
  'medidas__vodka-sernova',
  'medidas__malibu',
  'medidas__tequila-jose-cuervo',
  'medidas__vodka-absolut',
  'botellas__sernova-clasico-saborizado-6-speed'
]);

export function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Convierte el catálogo JSON de Fauno a BatchMenuImportDTO.
 * @param {object} catalog - Catálogo parseado
 * @param {object} [options] - Opciones (replaceExisting, dryRun, templateId)
 * @returns {object} BatchMenuImportDTO compatible
 */
export function buildFaunoBatchMenuImportDTO(catalog, options = {}) {
  if (!catalog || !Array.isArray(catalog.categories)) {
    throw new Error('El catálogo provisto no contiene categorías válidas.');
  }

  const items = [];
  const seenKeys = new Set();
  const seenExternalIds = new Set();

  for (const category of catalog.categories) {
    const categoryName = category.name.trim();
    const categoryIcon = category.icon?.trim() || '🍽️';

    for (const item of (category.items || [])) {
      const name = item.name.trim();
      const dupKey = `${categoryName.toLowerCase()}:::${name.toLowerCase()}`;
      if (seenKeys.has(dupKey)) {
        throw new Error(`Ítem duplicado detectado en catálogo Fauno: "${categoryName} > ${name}"`);
      }
      seenKeys.add(dupKey);

      const itemKey = `${slugify(categoryName)}__${slugify(name)}`;
      const isComingSoon = Array.isArray(item.tags) && item.tags.includes('COMING_SOON');
      const orderReviewRequired = orderReviewRequiredKeys.has(itemKey);
      const tags = Array.isArray(item.tags) ? [...item.tags] : [];
      if (orderReviewRequired && !tags.includes('ORDER_REVIEW_REQUIRED')) tags.push('ORDER_REVIEW_REQUIRED');
      if (itemKey === 'papas__papas-al-verdeo' && !tags.includes('PRICE_FROM')) tags.push('PRICE_FROM');
      const isAvailable = isComingSoon || orderReviewRequired ? false : (item.isAvailable !== false);
      const rawExtId = item.externalId && String(item.externalId).trim();
      const externalId = rawExtId || `${slugify(categoryName)}__${slugify(name)}`;
      const price = Number(item.price);
      const expectedPriceMinor = Math.round(price * 100);
      if (!Number.isFinite(price) || price <= 0) {
        throw new Error(`Precio inválido para "${categoryName} > ${name}".`);
      }
      if (item.priceMinor !== undefined && (!Number.isSafeInteger(item.priceMinor) || item.priceMinor !== expectedPriceMinor)) {
        throw new Error(`priceMinor no coincide con price en ARS para "${categoryName} > ${name}".`);
      }

      if (seenExternalIds.has(externalId.toLowerCase())) {
        throw new Error(`externalId duplicado detectado en catálogo Fauno: "${externalId}" ("${categoryName} > ${name}")`);
      }
      seenExternalIds.add(externalId.toLowerCase());

      items.push({
        externalId,
        category: categoryName,
        categoryIcon,
        name,
        description: item.description?.trim() || undefined,
        price,
        tags,
        isFeatured: Boolean(item.isFeatured),
        isAvailable,
        imageUrl: item.imageUrl?.trim() || undefined,
        source: item.source || 'fauno-user-catalog-2026-09-20'
      });
    }
  }

  return {
    replaceExisting: options.replaceExisting !== false,
    dryRun: Boolean(options.dryRun),
    templateId: options.templateId || catalog.restaurant?.templateId || 'FAUNO_NIGHT',
    items
  };
}

/**
 * Simulación pura del algoritmo de sincronización segura (E01).
 * Idéntico a MenuImportService, para pruebas unitarias determinísticas.
 */
export function simulateMenuSync(existingDbCategories, dto, { restaurantId = 'restaurant-fauno' } = {}) {
  const isDryRun = Boolean(dto.dryRun);
  const replaceExisting = Boolean(dto.replaceExisting);
  const items = dto.items || [];

  const groups = new Map();
  for (const item of items) {
    const catName = (item.category || 'Varios').trim();
    const norm = catName.toLowerCase();
    if (!groups.has(norm)) {
      groups.set(norm, {
        name: catName,
        icon: item.categoryIcon?.trim() || '🍽️',
        items: []
      });
    }
    groups.get(norm).items.push(item);
  }

  const db = existingDbCategories.map((cat) => ({
    ...cat,
    items: (cat.items || []).map((it) => ({ ...it }))
  }));

  const existingCatMap = new Map(db.map((c) => [c.name.trim().toLowerCase(), c]));
  const allExistingItems = new Map();
  const existingItemByCatalogKey = new Map();
  const existingItemByCatAndName = new Map();

  for (const cat of db) {
    for (const it of cat.items) {
      allExistingItems.set(it.id, it);
      if (it.catalogKey) {
        existingItemByCatalogKey.set(it.catalogKey.toLowerCase(), it);
      }
      existingItemByCatAndName.set(`${cat.name.trim().toLowerCase()}:::${it.name.trim().toLowerCase()}`, it);
    }
  }

  let categoriesCreated = 0;
  let categoriesUpdated = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;
  let itemsDeactivated = 0;
  const warnings = [];
  const matchedItemIds = new Set();

  for (const [normCat, group] of groups.entries()) {
    let cat = existingCatMap.get(normCat);
    if (cat) {
      categoriesUpdated++;
      if (!isDryRun) {
        cat.icon = group.icon;
      }
    } else {
      categoriesCreated++;
      cat = {
        id: `cat-${categoriesCreated}`,
        name: group.name,
        icon: group.icon,
        items: []
      };
      existingCatMap.set(normCat, cat);
      if (!isDryRun) {
        db.push(cat);
      }
    }

    for (const rawItem of group.items) {
      const normName = rawItem.name.trim().toLowerCase();
      const targetCatalogKey = rawItem.externalId
        ? `${restaurantId}:${(rawItem.source || 'default').toLowerCase()}:${rawItem.externalId.toLowerCase()}`
        : null;

      let existing = null;
      if (targetCatalogKey) {
        existing = existingItemByCatalogKey.get(targetCatalogKey);
      }
      if (!existing) {
        const nameMatch = existingItemByCatAndName.get(`${normCat}:::${normName}`);
        if (nameMatch) {
          if (nameMatch.catalogKey && targetCatalogKey && nameMatch.catalogKey.toLowerCase() !== targetCatalogKey.toLowerCase()) {
            throw new Error(`Conflicto de identidad: el plato "${rawItem.name}" ya tiene otra catalogKey`);
          }
          existing = nameMatch;
        }
      }

      const isComingSoon = rawItem.tags?.includes('COMING_SOON') ?? false;
      const isOrderReviewRequired = rawItem.tags?.includes('ORDER_REVIEW_REQUIRED') ?? false;
      const isAvailable = isComingSoon || isOrderReviewRequired ? false : (rawItem.isAvailable !== false);

      if (existing) {
        itemsUpdated++;
        matchedItemIds.add(existing.id);
        if (!isDryRun) {
          existing.name = rawItem.name.trim();
          existing.price = rawItem.price;
          existing.priceMinor = Math.round(rawItem.price * 100);
          existing.isAvailable = isAvailable;
          existing.tags = JSON.stringify(rawItem.tags || []);
          if (targetCatalogKey) {
            existing.catalogKey = targetCatalogKey;
          }
        }
      } else {
        itemsCreated++;
        const newId = `item-new-${itemsCreated}`;
        matchedItemIds.add(newId);
        if (!isDryRun) {
          cat.items.push({
            id: newId,
            name: rawItem.name.trim(),
            price: rawItem.price,
            priceMinor: Math.round(rawItem.price * 100),
            isAvailable,
            tags: JSON.stringify(rawItem.tags || []),
            catalogKey: targetCatalogKey || undefined
          });
        }
      }
    }
  }

  if (replaceExisting) {
    for (const [id, item] of allExistingItems.entries()) {
      if (!matchedItemIds.has(id)) {
        if (item.isAvailable) {
          itemsDeactivated++;
          warnings.push(`Plato "${item.name}" (ID: ${item.id}) desactivado.`);
          if (!isDryRun) {
            item.isAvailable = false;
          }
        }
      }
    }
  }

  return {
    success: true,
    dryRun: isDryRun,
    categoriesCount: groups.size,
    itemsCount: itemsCreated + itemsUpdated,
    summary: {
      categoriesCreated,
      categoriesUpdated,
      itemsCreated,
      itemsUpdated,
      itemsDeactivated
    },
    warnings,
    newDbState: db
  };
}

// Ejecución como script CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const catalogArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
  const catalogPath = catalogArg ? path.resolve(catalogArg) : defaultCatalogPath;
  const isDryRun = process.argv.includes('--dry-run');
  const replaceExisting = !process.argv.includes('--no-replace');
  const emitJson = process.argv.includes('--json');

  if (!fs.existsSync(catalogPath)) {
    console.error(`❌ Catálogo no encontrado: ${catalogPath}`);
    process.exit(1);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const dto = buildFaunoBatchMenuImportDTO(catalog, {
    dryRun: isDryRun,
    replaceExisting
  });

  if (emitJson) {
    console.log(JSON.stringify(dto, null, 2));
  } else {
    console.log(JSON.stringify({
      status: 'OK',
      sourceCatalog: catalogPath,
      restaurant: catalog.restaurant?.name,
      categoriesCount: catalog.categories.length,
      itemsCount: dto.items.length,
      dryRun: dto.dryRun,
      replaceExisting: dto.replaceExisting,
      templateId: dto.templateId
    }, null, 2));
  }
}

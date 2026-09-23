import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('E01-1: Catálogo Fauno canónico contiene 26 categorías y 144 ítems válidos', () => {
  const catalogPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
  assert.ok(fs.existsSync(catalogPath), 'El catálogo canónico debe existir');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

  assert.equal(catalog.categories.length, 26, 'Debe haber exactamente 26 categorías');
  const totalItems = catalog.categories.reduce((acc, cat) => acc + cat.items.length, 0);
  assert.equal(totalItems, 144, 'Debe haber exactamente 144 ítems');

  // Verificar que cada ítem tiene precio positivo y nombre válido
  for (const cat of catalog.categories) {
    for (const item of cat.items) {
      assert.ok(item.name && item.name.trim().length > 0);
      assert.ok(Number.isFinite(item.price) && item.price > 0);
    }
  }

  const items = catalog.categories.flatMap((c) => c.items);
  const comingSoon = items.filter((item) => item.tags.includes('COMING_SOON'));
  assert.equal(comingSoon.length, 2, 'Debe haber exactamente 2 ítems próximamente');
  assert.ok(comingSoon.every((item) => item.isAvailable === false));
});

test('E01-1a: Elecciones y precio desde quedan visibles y no pedibles hasta revisión', async () => {
  const catalogPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const items = catalog.categories.flatMap((category) => category.items.map((item) => ({ ...item, category: category.name })));
  const reviewItems = items.filter((item) => item.tags.includes('ORDER_REVIEW_REQUIRED'));
  const reviewKeys = new Set(reviewItems.map((item) => `${item.category}:::${item.name}`));
  const expectedReviewKeys = [
    'Papas:::Papas al verdeo',
    'Tacos:::Tacos Veggie',
    'Tacos:::Tacos pollo/carne',
    'Sin alcohol:::Frozzen Fruit',
    'Lo de siempre:::Vermu con soda',
    'Caipis y Mojitos:::Caiporoska Sernova',
    'Caipis y Mojitos:::Caipiroska Absolut',
    'Caipis y Mojitos:::Mojito Clásico',
    'Frozzens:::Daikiri Frozen',
    'Medidas:::Vodka Sernova',
    'Medidas:::Malibú',
    'Medidas:::Tequila Jose Cuervo',
    'Medidas:::Vodka Absolut',
    'Botellas:::Sernova (clasico, saborizado) + 6 speed'
  ];

  assert.equal(reviewItems.length, 14);
  assert.deepEqual([...reviewKeys].sort(), [...expectedReviewKeys].sort());
  assert.ok(reviewItems.every((item) => item.isAvailable === false));
  assert.ok(reviewItems.every((item) => item.price > 0 && item.description));
  assert.ok(reviewKeys.has('Papas:::Papas al verdeo'));
  const papasAlVerdeo = reviewItems.find((item) => item.name === 'Papas al verdeo');
  assert.equal(papasAlVerdeo.price, 14400);
  assert.ok(papasAlVerdeo.tags.includes('PRICE_FROM'));

  const { buildFaunoBatchMenuImportDTO } = await import('./import-fauno-catalog.mjs');
  const dto = buildFaunoBatchMenuImportDTO(catalog);
  const reviewPayloadItems = dto.items.filter((item) => item.tags.includes('ORDER_REVIEW_REQUIRED'));
  assert.equal(reviewPayloadItems.length, 14);
  assert.ok(reviewPayloadItems.every((item) => item.isAvailable === false));
  assert.ok(dto.items.find((item) => item.name === 'Papas al verdeo').tags.includes('PRICE_FROM'));
});

test('E01-1b: El importador rechaza priceMinor que no coincide con el precio en ARS', async () => {
  const { buildFaunoBatchMenuImportDTO } = await import('./import-fauno-catalog.mjs');
  const catalog = {
    categories: [{ name: 'Entradas', items: [{ name: 'Tequeños', price: 12200, priceMinor: 1220001 }] }]
  };

  assert.throws(
    () => buildFaunoBatchMenuImportDTO(catalog),
    /priceMinor no coincide con price en ARS/
  );
});
test('E01-2: buildFaunoBatchMenuImportDTO genera un payload reproducible e idempotente', async () => {
  const { buildFaunoBatchMenuImportDTO } = await import('./import-fauno-catalog.mjs');
  const catalogPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

  const dto1 = buildFaunoBatchMenuImportDTO(catalog, { replaceExisting: true, dryRun: false });
  const dto2 = buildFaunoBatchMenuImportDTO(catalog, { replaceExisting: true, dryRun: false });

  assert.equal(dto1.items.length, 144);
  assert.equal(dto1.replaceExisting, true);
  assert.equal(dto1.dryRun, false);

  // Idempotencia exacta: dto1 deepEqual dto2
  assert.deepEqual(dto1, dto2);

  // Comprobar que no hay duplicados dentro del payload
  const keys = new Set(dto1.items.map((i) => `${i.category.toLowerCase()}:::${i.name.toLowerCase()}`));
  assert.equal(keys.size, 144, 'Las 144 combinaciones (categoría, nombre) deben ser únicas');

  // Comprobar que todos tienen externalId único y determinístico
  const extKeys = new Set(dto1.items.map((i) => i.externalId.toLowerCase()));
  assert.equal(extKeys.size, 144, 'Los 144 externalIds deben ser únicos');
});

test('E01-3: Cliente web eliminó STATIC_CATALOG_BY_RESTAURANT del flujo de sesión', () => {
  const appJsPath = path.join(root, 'apps', 'client-web', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  // 1. STATIC_CATALOG_BY_RESTAURANT no debe existir
  assert.ok(!appJs.includes('STATIC_CATALOG_BY_RESTAURANT'), 'STATIC_CATALOG_BY_RESTAURANT debe ser eliminado de app.js');

  // 2. loadDynamicMenu debe llamar al endpoint /restaurants/:slugOrId/menu sin interceptar estáticamente
  const loadDynamicMatch = /async\s+function\s+loadDynamicMenu\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(appJs);
  assert.ok(loadDynamicMatch, 'loadDynamicMenu debe estar definida');
  assert.ok(loadDynamicMatch[1].includes('/restaurants/'), 'loadDynamicMenu debe consultar /restaurants/:slug/menu');
  assert.ok(!loadDynamicMatch[1].includes('staticCatalogUrl'), 'loadDynamicMenu no debe tener branch de staticCatalogUrl');

  // 3. Helper de detección de IDs sintéticos
  assert.ok(appJs.includes('function isSyntheticItemId'), 'isSyntheticItemId debe estar definida');
  assert.ok(appJs.includes('fauno-item-'), 'isSyntheticItemId debe detectar prefijo fauno-item-');

  // 4. Bloqueo en openDishDetailSheet y addDishToCart
  assert.ok(appJs.includes('isSyntheticItemId(item?.id)'), 'openDishDetailSheet y addDishToCart deben verificar isSyntheticItemId');
});

test('E01-4: Cliente web preserva modo carta pública explícito sin sesión (initPublicMenuOnly)', () => {
  const appJsPath = path.join(root, 'apps', 'client-web', 'app.js');
  const appJs = fs.readFileSync(appJsPath, 'utf8');

  assert.ok(appJs.includes('async function initPublicMenuOnly'), 'initPublicMenuOnly debe existir para demostraciones públicas sin sesión');
  assert.ok(appJs.includes('tableParams.menuSlug && !overrideToken'), 'Solo se activa si hay menuSlug y no hay overrideToken');
});

test('E01-5: Schema Prisma protege integridad histórica de OrderItem sin cascade delete', () => {
  const schemaPath = path.join(root, 'packages', 'api', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  // OrderItem.menuItem relation NO debe tener onDelete: Cascade
  const orderItemRelation = /model\s+OrderItem\s*\{[\s\S]*?menuItem\s+MenuItem\s+@relation\(([^)]*)\)/.exec(schema);
  assert.ok(orderItemRelation, 'OrderItem debe tener relación menuItem MenuItem');
  assert.ok(!orderItemRelation[1].includes('Cascade'), 'OrderItem.menuItem no debe tener onDelete: Cascade');
});

test('E01-6: Sommelier e IA excluyen isAvailable=false de sus recomendaciones', () => {
  const aiServicePath = path.join(root, 'packages', 'api', 'src', 'services', 'ai.service.ts');
  const aiService = fs.readFileSync(aiServicePath, 'utf8');

  assert.ok(aiService.includes('where: { isAvailable: true }'), 'ai.service.ts debe filtrar items where: { isAvailable: true }');
});

test('E01-7: Fila virtual / preOrder valida contra MenuItem existente e isAvailable=true', () => {
  const waitlistServicePath = path.join(root, 'packages', 'api', 'src', 'services', 'waitlist.service.ts');
  const waitlistService = fs.readFileSync(waitlistServicePath, 'utf8');

  assert.ok(waitlistService.includes('isAvailable: true'), 'waitlist.service.ts debe validar disponibilidad de platos');
  assert.ok(waitlistService.includes('PREORDER_ITEM_UNAVAILABLE'), 'waitlist.service.ts debe lanzar PREORDER_ITEM_UNAVAILABLE');
});

test('E01-8: Sincronización segura de Fauno en DB vacía crea exactamente 26 categorías y 144 ítems', async () => {
  const { buildFaunoBatchMenuImportDTO, simulateMenuSync } = await import('./import-fauno-catalog.mjs');
  const catalogPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const dto = buildFaunoBatchMenuImportDTO(catalog, { replaceExisting: true });

  const result = simulateMenuSync([], dto);
  assert.equal(result.success, true);
  assert.equal(result.dryRun, false);
  assert.equal(result.summary.categoriesCreated, 26);
  assert.equal(result.summary.categoriesUpdated, 0);
  assert.equal(result.summary.itemsCreated, 144);
  assert.equal(result.summary.itemsUpdated, 0);
  assert.equal(result.summary.itemsDeactivated, 0);

  const totalInDb = result.newDbState.reduce((acc, cat) => acc + cat.items.length, 0);
  assert.equal(totalInDb, 144);
});

test('E01-9: Idempotencia estricta: re-importar el catálogo Fauno produce 0 creaciones y preserva IDs', async () => {
  const { buildFaunoBatchMenuImportDTO, simulateMenuSync } = await import('./import-fauno-catalog.mjs');
  const catalogPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const dto = buildFaunoBatchMenuImportDTO(catalog, { replaceExisting: true });

  // Primera corrida: estado inicial
  const firstRun = simulateMenuSync([], dto);
  const firstDbState = firstRun.newDbState;

  // Registrar IDs generados en la primera corrida
  const firstCatIds = firstDbState.map((c) => c.id);
  const firstItemIds = firstDbState.flatMap((c) => c.items.map((i) => i.id));

  // Segunda corrida: mismo payload sobre el estado existente
  const secondRun = simulateMenuSync(firstDbState, dto);
  assert.equal(secondRun.success, true);
  assert.equal(secondRun.summary.categoriesCreated, 0, 'No debe crear categorías nuevas');
  assert.equal(secondRun.summary.categoriesUpdated, 26, 'Debe actualizar las 26 existentes');
  assert.equal(secondRun.summary.itemsCreated, 0, 'No debe crear ítems nuevos');
  assert.equal(secondRun.summary.itemsUpdated, 144, 'Debe actualizar los 144 existentes');
  assert.equal(secondRun.summary.itemsDeactivated, 0, 'No debe desactivar ninguno');

  // Verificar preservación exacta de IDs
  const secondCatIds = secondRun.newDbState.map((c) => c.id);
  const secondItemIds = secondRun.newDbState.flatMap((c) => c.items.map((i) => i.id));
  assert.deepEqual(firstCatIds, secondCatIds, 'Los IDs de categoría deben preservarse idénticos');
  assert.deepEqual(firstItemIds, secondItemIds, 'Los IDs de platos deben preservarse idénticos');
});

test('E01-9a: La simulación separa catalogKey al importar Fauno en una instalación nueva', async () => {
  const { buildFaunoBatchMenuImportDTO, simulateMenuSync } = await import('./import-fauno-catalog.mjs');
  const catalogPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const dto = buildFaunoBatchMenuImportDTO(catalog, { replaceExisting: true });
  const destination = 'fauno-olavarria-staging-20260923';

  const firstRun = simulateMenuSync([], dto, { restaurantId: destination });
  assert.equal(firstRun.summary.categoriesCreated, 26);
  assert.equal(firstRun.summary.itemsCreated, 144);

  const importedItems = firstRun.newDbState.flatMap((category) => category.items);
  assert.ok(importedItems.every((item) => item.catalogKey.startsWith(`${destination}:fauno-user-catalog-2026-09-20:`)));

  const secondRun = simulateMenuSync(firstRun.newDbState, dto, { restaurantId: destination });
  assert.equal(secondRun.summary.itemsCreated, 0);
  assert.equal(secondRun.summary.itemsUpdated, 144);
  assert.equal(secondRun.summary.itemsDeactivated, 0);
});

test('E01-9b: El CLI acepta --dry-run sin exigir una ruta de catálogo', () => {
  const importerPath = path.join(root, 'scripts', 'import-fauno-catalog.mjs');
  const output = execFileSync(process.execPath, [importerPath, '--dry-run'], { encoding: 'utf8' });
  const result = JSON.parse(output);

  assert.equal(result.status, 'OK');
  assert.equal(result.dryRun, true);
  assert.equal(result.categoriesCount, 26);
  assert.equal(result.itemsCount, 144);
});

test('E01-10: Desactivación segura (no hard-delete): ítem ausente pasa a isAvailable: false y conserva registro', async () => {
  const { simulateMenuSync } = await import('./import-fauno-catalog.mjs');

  const initialDb = [
    {
      id: 'cat-pastas',
      name: 'Pastas',
      icon: '🍝',
      items: [
        { id: 'item-sorrentinos', name: 'Sorrentinos', price: 14000, isAvailable: true },
        { id: 'item-historico-con-pedidos', name: 'Plato Retirado Con Ventas', price: 10000, isAvailable: true }
      ]
    }
  ];

  // Nuevo payload sólo trae 'Sorrentinos'; 'Plato Retirado Con Ventas' no viene
  const dto = {
    replaceExisting: true,
    dryRun: false,
    items: [
      { category: 'Pastas', name: 'Sorrentinos', price: 15000, isAvailable: true }
    ]
  };

  const result = simulateMenuSync(initialDb, dto);
  assert.equal(result.summary.itemsUpdated, 1);
  assert.equal(result.summary.itemsDeactivated, 1);

  // El plato histórico sigue existiendo en DB (CERO hard-delete) pero con isAvailable = false
  const pastasCat = result.newDbState.find((c) => c.id === 'cat-pastas');
  assert.equal(pastasCat.items.length, 2, 'El plato histórico no debe eliminarse de la categoría');
  const retired = pastasCat.items.find((i) => i.id === 'item-historico-con-pedidos');
  assert.equal(retired.isAvailable, false, 'El plato ausente debe desactivarse lógicamente');
});

test('E01-11: dryRun simula la sincronización sin mutar el estado de la base de datos', async () => {
  const { simulateMenuSync } = await import('./import-fauno-catalog.mjs');

  const initialDb = [
    {
      id: 'cat-cervezas',
      name: 'Cervezas',
      icon: '🍺',
      items: [{ id: 'item-ipa', name: 'IPA', price: 4000, isAvailable: true }]
    }
  ];

  const dto = {
    replaceExisting: true,
    dryRun: true,
    items: [
      { category: 'Cervezas', name: 'IPA', price: 5000 },
      { category: 'Cervezas', name: 'Stout', price: 5200 }
    ]
  };

  const result = simulateMenuSync(initialDb, dto);
  assert.equal(result.dryRun, true);
  assert.equal(result.summary.itemsCreated, 1);
  assert.equal(result.summary.itemsUpdated, 1);

  // En dryRun, initialDb no debe haber sido mutado
  assert.equal(initialDb[0].items.length, 1);
  assert.equal(initialDb[0].items[0].price, 4000);
});

test('E01-12: Renombrar un plato conservando externalId preserva MenuItem.id en base de datos', async () => {
  const { simulateMenuSync } = await import('./import-fauno-catalog.mjs');

  const initialDb = [
    {
      id: 'cat-hamburguesas',
      name: 'Hamburguesas',
      icon: '🍔',
      items: [
        {
          id: 'item-burger-original-uuid',
          name: 'Burger Clásica',
          price: 9000,
          isAvailable: true,
          catalogKey: 'restaurant-fauno:fauno-user-catalog-2026-09-20:hamburguesas__burger-clasica'
        }
      ]
    }
  ];

  // Renombramos el plato de "Burger Clásica" a "Burger Clásica Premium" pero manteniendo el mismo externalId
  const dto = {
    replaceExisting: true,
    dryRun: false,
    items: [
      {
        category: 'Hamburguesas',
        name: 'Burger Clásica Premium',
        price: 9800,
        externalId: 'hamburguesas__burger-clasica',
        source: 'fauno-user-catalog-2026-09-20'
      }
    ]
  };

  const result = simulateMenuSync(initialDb, dto);
  assert.equal(result.summary.itemsCreated, 0, 'No debe crear un nuevo plato');
  assert.equal(result.summary.itemsUpdated, 1, 'Debe actualizar el plato existente');
  assert.equal(result.summary.itemsDeactivated, 0);

  const cat = result.newDbState.find((c) => c.id === 'cat-hamburguesas');
  assert.equal(cat.items.length, 1);
  const item = cat.items[0];
  assert.equal(item.id, 'item-burger-original-uuid', 'El ID del MenuItem debe preservarse idéntico');
  assert.equal(item.name, 'Burger Clásica Premium', 'El nombre del plato debe actualizarse');
  assert.equal(item.price, 9800);
});

test('E01-13: Detección y rechazo de duplicados de externalId en payload', async () => {
  const { buildFaunoBatchMenuImportDTO } = await import('./import-fauno-catalog.mjs');

  const badCatalog = {
    categories: [
      {
        name: 'Entradas',
        items: [
          { name: 'Empanada 1', price: 1000, externalId: 'dup-ext-id' },
          { name: 'Empanada 2', price: 1200, externalId: 'dup-ext-id' }
        ]
      }
    ]
  };

  assert.throws(
    () => buildFaunoBatchMenuImportDTO(badCatalog),
    /externalId duplicado detectado/
  );
});

test('E01-14: Migración PostgreSQL de catalogKey es idempotente y no destructiva', () => {
  const migrationPath = path.join(
    root,
    'packages',
    'api',
    'prisma',
    'migrations-postgres',
    '20260921000000_e01_menu_item_catalog_key',
    'migration.sql'
  );
  assert.ok(fs.existsSync(migrationPath), 'El archivo de migración SQL debe existir');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.ok(sql.includes('ALTER TABLE "MenuItem" ADD COLUMN IF NOT EXISTS "catalogKey" TEXT;'));
  assert.ok(sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS "MenuItem_catalogKey_key" ON "MenuItem"("catalogKey");'));
  assert.ok(!sql.toLowerCase().includes('drop table'));
  assert.ok(!sql.toLowerCase().includes('drop column'));
});

test('E01-15: Ruta GET /menu excluye categorías vacías o inactivas por defecto pero preserva COMING_SOON (P2/P3)', () => {
  const menuRoutesPath = path.join(root, 'packages', 'api', 'src', 'routes', 'menu.routes.ts');
  const content = fs.readFileSync(menuRoutesPath, 'utf8');

  assert.ok(content.includes('includeEmpty'), 'menu.routes.ts debe soportar query param includeEmpty');
  assert.ok(content.includes('item.tags.includes(\'COMING_SOON\')'), 'menu.routes.ts debe preservar categorías con platos COMING_SOON');

  // Validación lógica del predicado de filtrado
  const filterPredicate = (cat) =>
    cat.items.some((item) => item.isAvailable || (Array.isArray(item.tags) && item.tags.includes('COMING_SOON')));

  const catActiva = { name: 'Cervezas', items: [{ isAvailable: true, tags: [] }] };
  const catComingSoon = { name: 'Adelantos', items: [{ isAvailable: false, tags: ['COMING_SOON'] }] };
  const catInactiva = { name: 'Agotados', items: [{ isAvailable: false, tags: [] }] };
  const catVacia = { name: 'Vacia', items: [] };

  assert.equal(filterPredicate(catActiva), true, 'Categoría con ítem disponible debe conservarse');
  assert.equal(filterPredicate(catComingSoon), true, 'Categoría con ítem COMING_SOON debe conservarse');
  assert.equal(filterPredicate(catInactiva), false, 'Categoría con sólo ítems inactivos normales debe ocultarse');
  assert.equal(filterPredicate(catVacia), false, 'Categoría vacía debe ocultarse');
});

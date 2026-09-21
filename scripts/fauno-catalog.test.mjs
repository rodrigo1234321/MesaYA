import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'data', 'fauno', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

test('Fauno catalog has the expected public identity and source scope', () => {
  assert.equal(catalog.restaurant.name, 'Fauno Olavarría');
  assert.equal(catalog.restaurant.slug, 'fauno-olavarria');
  assert.equal(catalog.restaurant.templateId, 'FAUNO_NIGHT');
  assert.equal(catalog.restaurant.logoUrl, '/assets/branding/fauno-olavarria-logo.png');
  assert.equal(catalog.categories.length, 26);
  assert.equal(catalog.categories.reduce((total, category) => total + category.items.length, 0), 144);
});
test('Fauno catalog has valid prices, unique item ids and no footer artifact', () => {
  const items = catalog.categories.flatMap((category) => category.items.map((item) => ({ ...item, category: category.name })));
  assert.equal(new Set(items.map((item) => `${item.category}:${item.name}`)).size, items.length);
  assert.ok(items.every((item) => Number.isFinite(item.price) && item.price > 0));
  assert.ok(items.every((item) => item.name !== 'Pedido'));
});

test('coming-soon products remain visible but unavailable for ordering', () => {
  const items = catalog.categories.flatMap((category) => category.items);
  const unavailable = items.filter((item) => item.tags.includes('COMING_SOON'));
  assert.equal(unavailable.length, 2);
  assert.ok(unavailable.every((item) => item.isAvailable === false));
});

test('buildFaunoBatchMenuImportDTO produces a valid, reproducible import payload', async () => {
  const { buildFaunoBatchMenuImportDTO } = await import('./import-fauno-catalog.mjs');
  const dto = buildFaunoBatchMenuImportDTO(catalog, { dryRun: true, replaceExisting: true });

  assert.equal(dto.dryRun, true);
  assert.equal(dto.replaceExisting, true);
  assert.equal(dto.templateId, 'FAUNO_NIGHT');
  assert.equal(dto.items.length, 144);

  // Validate every item
  for (const item of dto.items) {
    assert.ok(typeof item.category === 'string' && item.category.length > 0 && item.category.length <= 80);
    assert.ok(typeof item.name === 'string' && item.name.length > 0 && item.name.length <= 120);
    assert.ok(Number.isFinite(item.price) && item.price > 0);
    assert.ok(Array.isArray(item.tags) && item.tags.length <= 10);
    assert.ok(typeof item.isAvailable === 'boolean');
    assert.equal(item.source, 'fauno-user-catalog-2026-09-20');
    assert.ok(typeof item.externalId === 'string' && item.externalId.length > 0 && item.externalId.length <= 120);
  }

  // Idempotency: generating DTO twice yields identical results
  const dto2 = buildFaunoBatchMenuImportDTO(catalog, { dryRun: true, replaceExisting: true });
  assert.deepEqual(dto, dto2);

  // Uniqueness of category + name in payload
  const keys = new Set(dto.items.map((i) => `${i.category.toLowerCase()}:::${i.name.toLowerCase()}`));
  assert.equal(keys.size, 144);

  // Uniqueness of externalId across all 144 items
  const extIds = new Set(dto.items.map((i) => i.externalId.toLowerCase()));
  assert.equal(extIds.size, 144, 'Todos los 144 ítems deben poseer un externalId único y determinístico');
});

test('public demo catalog is identical to data catalog', () => {
  const demoPath = path.join(root, 'apps', 'client-web', 'public', 'demo', 'fauno-olavarria', 'catalog.json');
  assert.ok(fs.existsSync(demoPath), 'El catálogo público de demo debe existir');
  const demoCatalog = JSON.parse(fs.readFileSync(demoPath, 'utf8'));

  assert.equal(demoCatalog.categories.length, catalog.categories.length);
  const demoItemCount = demoCatalog.categories.reduce((total, cat) => total + cat.items.length, 0);
  assert.equal(demoItemCount, 144);
  assert.equal(demoCatalog.restaurant.slug, 'fauno-olavarria');
});

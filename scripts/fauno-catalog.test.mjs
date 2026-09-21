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

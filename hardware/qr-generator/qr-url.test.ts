import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCanonicalTableUrl } from './qr-url';

test('construye una URL estable para QR y NFC sin token de sesión', () => {
  assert.equal(
    buildCanonicalTableUrl({
      baseUrl: 'https://local.example.com/',
      restaurantSlug: 'mi-local',
      tableLabel: 'Mesa 4'
    }),
    'https://local.example.com/r/mi-local/mesa/Mesa%204'
  );
});

test('codifica slug y etiqueta y elimina barras finales del dominio', () => {
  assert.equal(
    buildCanonicalTableUrl({
      baseUrl: 'https://local.example.com///',
      restaurantSlug: 'café-centro',
      tableLabel: 'Terraza / 1'
    }),
    'https://local.example.com/r/caf%C3%A9-centro/mesa/Terraza%20%2F%201'
  );
});

test('rechaza valores faltantes para no generar QR apuntando a un local histórico', () => {
  assert.throws(() => buildCanonicalTableUrl({ baseUrl: '', restaurantSlug: 'local', tableLabel: 'Mesa 1' }), /baseUrl/);
  assert.throws(() => buildCanonicalTableUrl({ baseUrl: 'https://local.example', restaurantSlug: '', tableLabel: 'Mesa 1' }), /restaurantSlug/);
  assert.throws(() => buildCanonicalTableUrl({ baseUrl: 'https://local.example', restaurantSlug: 'local', tableLabel: ' ' }), /tableLabel/);
});

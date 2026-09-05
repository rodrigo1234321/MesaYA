import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(__dirname, '..', '..', '..');

/**
 * Etapa 27 — Gate de matriz de rutas.
 * Toda ruta nueva o con auth cambiada sin clasificar en
 * `scripts/route-matrix.json` hace fallar este test y bloquea el pipeline.
 */
describe('Etapa 27 — Gate de matriz de rutas', () => {
  it('todas las rutas están clasificadas y sin deriva', () => {
    const res = spawnSync(process.execPath, ['scripts/check-route-matrix.mjs'], {
      cwd: projectRoot,
      encoding: 'utf8'
    });
    if (res.stdout) console.log(res.stdout);
    if (res.status !== 0 && res.stderr) console.error(res.stderr);
    expect(res.status).toBe(0);
  });
});

#!/usr/bin/env node

/**
 * MesaYA — Gate de matriz de rutas (Etapa 27).
 *
 * Detecta rutas nuevas sin clasificación de auth: analiza estáticamente
 * `packages/api/src/routes/*.routes.ts` y el entrypoint
 * `packages/api/src/index.ts` (sólo /health) con la API del compilador
 * TypeScript (robusto ante genéricos multilínea como `fastify.get<{...}>(...)`),
 * deriva la clasificación desde `preHandler`/`onRequest` y la compara contra
 * el manifiesto revisado `scripts/route-matrix.json`.
 *
 * - Ruta en código ausente del manifiesto → FAIL (nueva sin clasificar).
 * - Entrada del manifiesto sin ruta en código → FAIL (manifiesto obsoleto).
 * - Clasificación distinta → FAIL (cambio de auth sin revisión).
 * - `node scripts/check-route-matrix.mjs --dump` imprime la matriz
 *   descubierta para actualizar el manifiesto de forma deliberada.
 *
 * Cableado de prefijos (duplica `packages/api/src/index.ts` sin ejecutarlo):
 * todo módulo vive bajo `/v1`, excepto `stream.routes.ts` que además se
 * monta en raíz (`/stream` y `/v1/stream`).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routesDir = path.join(projectRoot, 'packages', 'api', 'src', 'routes');
const entrypointFile = path.join(projectRoot, 'packages', 'api', 'src', 'index.ts');
const manifestPath = path.join(projectRoot, 'scripts', 'route-matrix.json');

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
// Identificadores que registran rutas: `fastify` en los módulos de rutas,
// `app` en el entrypoint (sólo /health y /v1/health, ya con ruta absoluta).
const ROUTE_RECEIVERS = new Set(['fastify', 'app']);

function hookNamesFromOptions(optionsNode, sourceFile) {
  const names = [];
  if (!optionsNode || !ts.isObjectLiteralExpression(optionsNode)) return names;
  for (const prop of optionsNode.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const key = prop.name.getText(sourceFile);
    if (key !== 'preHandler' && key !== 'onRequest') continue;
    if (!ts.isArrayLiteralExpression(prop.initializer)) continue;
    for (const el of prop.initializer.elements) {
      if (ts.isIdentifier(el)) names.push(el.text);
      else if (ts.isCallExpression(el) && ts.isIdentifier(el.expression)) names.push(el.expression.text);
    }
  }
  return names;
}

function classify(hookNames) {
  if (hookNames.includes('verifyManagerRole') || hookNames.includes('requireManagedRestaurant')) return 'MANAGER';
  if (hookNames.includes('verifyStaffToken') || hookNames.includes('requireRestaurantAccess')) return 'STAFF';
  return 'ANON';
}

function discoverRoutes() {
  const found = new Map();
  const sources = fs
    .readdirSync(routesDir)
    .filter((f) => f.endsWith('.routes.ts'))
    .sort()
    .map((f) => ({ file: f, full: path.join(routesDir, f) }));
  sources.push({ file: 'index.ts', full: entrypointFile });

  for (const { file, full } of sources) {
    const source = ts.createSourceFile(file, fs.readFileSync(full, 'utf8'), ts.ScriptTarget.Latest, true);

    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        ROUTE_RECEIVERS.has(node.expression.expression.text) &&
        METHODS.has(node.expression.name.text.toLowerCase()) &&
        node.arguments.length > 0 &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const method = node.expression.name.text.toUpperCase();
        const routePath = node.arguments[0].text;
        const hooks = hookNamesFromOptions(node.arguments[1], source);
        const auth = classify(hooks);
        // Prefijos: duplica el cableado de buildApp sin ejecutarlo.
        const prefixes = file === 'stream.routes.ts' ? ['', '/v1'] : file === 'index.ts' ? [''] : ['/v1'];
        for (const prefix of prefixes) {
          const key = `${method} ${prefix}${routePath}`;
          const prev = found.get(key);
          if (prev && prev.auth !== auth) {
            throw new Error(`Registro duplicado con auth contradictoria: ${key} (${prev.auth} vs ${auth})`);
          }
          found.set(key, { file, auth });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

function main() {
  const discovered = discoverRoutes();
  if (process.argv.includes('--dump')) {
    const rows = [...discovered.entries()]
      .map(([key, info]) => {
        const [method, routePath] = key.split(' ');
        return { method, path: routePath, auth: info.auth };
      })
      .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
    console.log(JSON.stringify(rows, null, 2));
    console.log(`\nRutas descubiertas: ${rows.length}`);
    return;
  }

  if (!fs.existsSync(manifestPath)) {
    console.error(`Falta el manifiesto revisado: ${manifestPath}`);
    process.exit(2);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const expected = new Map(manifest.map((e) => [`${e.method} ${e.path}`, e.auth]));

  const failures = [];
  for (const [key, info] of discovered) {
    if (!expected.has(key)) {
      failures.push(`SIN CLASIFICAR: ${key} (auth detectada: ${info.auth}, en ${info.file}) — agregarla a scripts/route-matrix.json tras revisión`);
    } else if (expected.get(key) !== info.auth) {
      failures.push(`CAMBIO DE AUTH: ${key} (manifiesto: ${expected.get(key)}, código: ${info.auth}) — revisar y actualizar el manifiesto`);
    }
  }
  for (const key of expected.keys()) {
    if (!discovered.has(key)) {
      failures.push(`OBSOLETA: ${key} está en el manifiesto pero ya no existe en el código — quitarla`);
    }
  }

  if (failures.length > 0) {
    console.error(`Matriz de rutas: ${failures.length} problema(s).\n`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`Matriz de rutas OK: ${discovered.size} rutas clasificadas, sin novedades ni deriva.`);
}

main();

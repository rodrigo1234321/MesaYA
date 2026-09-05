#!/usr/bin/env node

/**
 * MesaYA — Build productivo PostgreSQL explícito (Etapa 27).
 *
 * Genera el cliente Prisma desde `schema.supabase.prisma` (provider
 * postgresql) y compila `@mesaya/shared` + `@mesaya/api` contra ese cliente.
 * Sólo cubre el backend serverless: los frontends no dependen del provider.
 *
 * NO restaura el cliente SQLite: en CI/Vercel el entorno es desechable. En
 * una máquina local, al terminar hay que regenerar el cliente de desarrollo
 * con `node scripts/prisma-generate.mjs sqlite` antes de correr gates
 * locales (el runner aislado y `scripts/build.mjs` asumen SQLite).
 *
 * Vercel ejecuta automáticamente `npm run vercel-build` (ver package.json),
 * que delega en este script.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(script, args, cwd = projectRoot) {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd,
    stdio: 'inherit',
    windowsHide: true
  });
  if (res.status !== 0) {
    console.error(`Fallo: ${script} ${args.join(' ')} (exit ${res.status})`);
    process.exit(res.status ?? 1);
  }
}

function mustExist(label, file) {
  if (!fs.existsSync(file)) {
    console.error(`Artefacto faltante tras el build PG: ${label} (${file})`);
    process.exit(1);
  }
  console.log(`Artefacto OK: ${label}`);
}

const generateScript = path.join(projectRoot, 'scripts', 'prisma-generate.mjs');
const tsc = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!fs.existsSync(tsc)) {
  console.error(`CLI local no disponible: ${tsc}`);
  process.exit(1);
}

console.log('Build productivo PG: cliente Prisma desde schema.supabase.prisma (postgresql).');
run(generateScript, ['postgres']);

console.log('Compilando @mesaya/shared...');
run(tsc, [], path.join(projectRoot, 'packages', 'shared'));

console.log('Compilando @mesaya/api contra el cliente PG...');
run(tsc, [], path.join(projectRoot, 'packages', 'api'));

mustExist('@mesaya/shared dist', path.join(projectRoot, 'packages', 'shared', 'dist', 'index.js'));
mustExist('@mesaya/api dist', path.join(projectRoot, 'packages', 'api', 'dist', 'index.js'));

console.log('Build productivo PG exitoso. La correctitud del cliente contra');
console.log('PostgreSQL real se verifica con scripts/test-postgres.mjs (smoke + suites).');

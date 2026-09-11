#!/usr/bin/env node

/**
 * Prepare a clean clone for local development without touching any remote
 * provider. It creates a local env only when one is missing, generates the
 * SQLite Prisma client, pushes the canonical schema to a local file and seeds
 * demo data only when that file is empty.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'packages', 'api');
const prismaDir = path.join(apiDir, 'prisma');
const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
const tsxCli = path.join(root, 'scripts', 'run-tsx.mjs');
const schema = path.join(prismaDir, 'schema.prisma');

function fail(message) {
  console.error(`setup:local: ${message}`);
  process.exit(1);
}

function getFlag(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function toFileUrl(filePath) {
  const normalized = path.resolve(filePath).replaceAll('\\', '/');
  return `file:${normalized}`;
}

const requestedDb = getFlag('--db');
const dbPath = requestedDb ? path.resolve(process.cwd(), requestedDb) : path.join(prismaDir, 'dev.db');
const databaseUrl = toFileUrl(dbPath);

// Prisma's SQLite schema engine is deterministic when the target file exists;
// creating an empty file also makes the first setup work on Windows hosts
// where the engine otherwise reports an unhelpful blank error.
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, '');

if (!fs.existsSync(path.join(root, 'node_modules'))) {
  fail('faltan dependencias; ejecutá primero npm ci.');
}
for (const required of [prismaCli, tsxCli, schema]) {
  if (!fs.existsSync(required)) fail(`artefacto local faltante: ${required}`);
}

const localEnv = [
  '# Generado por npm run setup:local. No subir este archivo.',
  `DATABASE_URL="file:./dev.db"`,
  'PORT=3000',
  'HOST="0.0.0.0"',
  'NODE_ENV="development"',
  'JWT_SECRET="mesaya_local_jwt_secret_change_for_deployment_2026"',
  'ENCRYPTION_SECRET_KEY="mesaya_local_encryption_secret_change_2026"',
  'CORS_ORIGIN="http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3000"',
  'VITE_API_URL="http://localhost:3000/v1"',
  'MESAYA_INSTANCE_MODE="MULTI_TENANT"',
  ''
].join('\n');

function ensureEnv(file) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, localEnv, 'utf8');
    console.log(`✅ entorno local creado: ${path.relative(root, file)}`);
  }
}

// Prisma resolves .env beside the API schema; the API runtime also reads the
// repository root. Never overwrite an existing operator-managed env file.
ensureEnv(path.join(root, '.env'));
ensureEnv(path.join(apiDir, '.env'));

const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'development',
  MESAYA_LOCAL_SEED: 'true',
  RUST_LOG: 'info'
};

function run(label, command, args, cwd = root) {
  console.log(`▶ ${label}`);
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd,
    env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    fail(`${label} falló (${result.error?.message || `exit ${result.status}`}).`);
  }
}

run('generar cliente Prisma SQLite', path.join(root, 'scripts', 'prisma-generate.mjs'), ['sqlite']);
run('crear/actualizar esquema SQLite local', prismaCli, ['db', 'push', '--schema', schema, '--skip-generate']);
run('cargar demo sólo si la base está vacía', tsxCli, [path.join(root, 'scripts', 'seed-local.ts')], apiDir);

console.log('\n✅ Base local lista.');
console.log(`   DB: ${path.relative(root, dbPath) || dbPath}`);
console.log('   Mozo: PIN 1234');
console.log('   Encargado: PIN 9999');
console.log('   Comensal: http://localhost:5173/?r=trattoria-del-puerto&m=Mesa%201');

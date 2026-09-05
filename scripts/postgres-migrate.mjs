#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaSource = path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.supabase.prisma');
const migrationsSource = path.join(projectRoot, 'packages', 'api', 'prisma', 'migrations-postgres');
const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const action = process.argv[2] || 'deploy';

if (action !== 'deploy') {
  console.error('Uso: node scripts/postgres-migrate.mjs deploy');
  process.exit(2);
}

const databaseUrl = process.env.MESAYA_PG_DATABASE_URL;
const directUrl = process.env.MESAYA_PG_DIRECT_URL;
if (!databaseUrl || !directUrl) {
  console.error('Se requieren MESAYA_PG_DATABASE_URL y MESAYA_PG_DIRECT_URL explícitas; no se usa DATABASE_URL/DIRECT_URL como fallback.');
  process.exit(2);
}
if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl) || !/^postgres(?:ql)?:\/\//i.test(directUrl)) {
  console.error('Las URLs PostgreSQL explícitas tienen sintaxis inválida.');
  process.exit(2);
}
if (!fs.existsSync(schemaSource) || !fs.existsSync(migrationsSource)) {
  console.error('Faltan schema.supabase.prisma o migrations-postgres; no se ejecuta migrate deploy.');
  process.exit(2);
}

const runtimeDir = path.join(projectRoot, '.tmp', `postgres-migrate-${randomUUID()}`);
const runtimeSchema = path.join(runtimeDir, 'schema.prisma');
const runtimeMigrations = path.join(runtimeDir, 'migrations');
fs.mkdirSync(runtimeDir, { recursive: true });
fs.copyFileSync(schemaSource, runtimeSchema);
fs.cpSync(migrationsSource, runtimeMigrations, { recursive: true });

let exitCode = 1;
try {
  const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy', `--schema=${runtimeSchema}`], {
    cwd: projectRoot,
    env: { ...process.env, DATABASE_URL: databaseUrl, DIRECT_URL: directUrl },
    stdio: 'inherit',
    windowsHide: true
  });
  exitCode = result.status ?? 1;
} finally {
  fs.rmSync(runtimeDir, { recursive: true, force: true });
}
process.exit(exitCode);

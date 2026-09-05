#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.supabase.prisma');
const migrationsRoot = path.join(projectRoot, 'packages', 'api', 'prisma', 'migrations-postgres');
const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
const migrationName = process.argv[2] || 'init';
const safeName = migrationName.replace(/[^a-z0-9_-]/gi, '_');
const hasHistory = fs.existsSync(migrationsRoot) && fs.readdirSync(migrationsRoot).length > 0;
const migrationDirName = /^\d{14}_[a-z0-9_-]+$/i.test(safeName)
  ? safeName
  : `${hasHistory ? '20260904210000' : '20260904201500'}_${safeName}`;
const migrationDir = path.join(migrationsRoot, migrationDirName);

if (!fs.existsSync(schemaPath)) throw new Error(`Schema PostgreSQL inexistente: ${schemaPath}`);
if (fs.existsSync(migrationDir)) throw new Error(`No se sobrescribe una migración existente: ${migrationDir}`);

const sourceArgs = hasHistory
  ? [`--from-migrations=${migrationsRoot}`, `--shadow-database-url=${process.env.MESAYA_PG_SHADOW_DATABASE_URL || ''}`]
  : ['--from-empty'];

if (hasHistory && !process.env.MESAYA_PG_SHADOW_DATABASE_URL) {
  throw new Error('La generación incremental requiere MESAYA_PG_SHADOW_DATABASE_URL explícita; no se usa ninguna URL normal como fallback.');
}

const result = spawnSync(process.execPath, [
  prismaCli,
  'migrate',
  'diff',
  ...sourceArgs,
  `--to-schema-datamodel=${schemaPath}`,
  '--script'
], { cwd: projectRoot, encoding: 'utf8', env: { ...process.env }, windowsHide: true });

if (result.error || result.status !== 0) {
  throw result.error || new Error(`prisma migrate diff terminó con código ${result.status}: ${result.stderr}`);
}
if (!result.stdout.trim()) throw new Error('prisma migrate diff no produjo SQL');

fs.mkdirSync(migrationDir, { recursive: true });
fs.writeFileSync(path.join(migrationDir, 'migration.sql'), result.stdout, 'utf8');
console.log(`✅ Migración PostgreSQL inicial creada en ${path.relative(projectRoot, migrationDir)} (${result.stdout.length} caracteres).`);

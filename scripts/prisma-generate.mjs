#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..');
const targets = {
  sqlite: {
    schema: path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.prisma'),
    provider: 'sqlite'
  },
  postgres: {
    schema: path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.supabase.prisma'),
    provider: 'postgresql'
  }
};

const targetName = process.argv[2];
const target = targets[targetName];
if (!target) {
  console.error('Uso: node scripts/prisma-generate.mjs <sqlite|postgres>');
  process.exit(2);
}

const schemaPath = path.resolve(target.schema);
const relativeSchema = path.relative(projectRoot, schemaPath);
if (relativeSchema.startsWith('..') || path.isAbsolute(relativeSchema) || !fs.existsSync(schemaPath)) {
  console.error(`Destino de schema inválido: ${schemaPath}`);
  process.exit(2);
}

const schema = fs.readFileSync(schemaPath, 'utf8');
const provider = schema.match(/datasource\s+db\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/i)?.[1];
if (provider !== target.provider) {
  console.error(`Provider inesperado para ${targetName}: ${provider || 'ausente'} (esperado ${target.provider})`);
  process.exit(2);
}

const lockPath = path.join(projectRoot, '.tmp', 'prisma-generate.lock');
fs.mkdirSync(path.dirname(lockPath), { recursive: true });
let lockFd;
try {
  lockFd = fs.openSync(lockPath, 'wx');
  fs.writeFileSync(lockFd, JSON.stringify({ target: targetName, pid: process.pid, startedAt: new Date().toISOString() }));
} catch {
  console.error('Ya hay otra generación Prisma en curso; no se ejecutan clientes en paralelo.');
  process.exit(2);
}

let exitCode = 1;
try {
  const prismaCli = path.join(projectRoot, 'node_modules', 'prisma', 'build', 'index.js');
  const result = spawnSync(process.execPath, [prismaCli, 'generate', `--schema=${schemaPath}`], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true
  });
  exitCode = result.status ?? 1;
} finally {
  if (lockFd !== undefined) fs.closeSync(lockFd);
  try { fs.unlinkSync(lockPath); } catch {}
}
process.exit(exitCode);

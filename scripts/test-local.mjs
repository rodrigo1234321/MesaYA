#!/usr/bin/env node

/**
 * Deterministic local test entry point for a clean clone.
 *
 * The full Vitest suite uses real Prisma calls and therefore must never point
 * at the developer's demo database. This runner creates one disposable SQLite
 * file, applies the canonical schema, runs the suites in a single worker and
 * removes only the sandbox it owns.
 *
 * Stop `npm run dev:clean` before running it: the API and the Vitest worker
 * share Prisma's SQLite engine on Windows, and concurrent engine startups can
 * make otherwise healthy hooks exceed their test timeout.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'packages', 'api');
const qaRoot = path.join(root, '.tmp', 'test-local');
const sandbox = path.join(qaRoot, randomUUID());
const dbFile = path.join(sandbox, 'test.db');
const ownerFile = path.join(sandbox, '.runner-owner.json');
const prismaCli = path.join(root, 'node_modules', 'prisma', 'build', 'index.js');
const vitestCli = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
const tsxCli = path.join(root, 'scripts', 'run-tsx.mjs');
const schema = path.join(apiDir, 'prisma', 'schema.prisma');
const localSeed = path.join(root, 'scripts', 'seed-local.ts');

function fail(message) {
  console.error(`test:local: ${message}`);
  process.exitCode = 1;
}

function run(label, command, args, env) {
  console.log(`▶ ${label}`);
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: apiDir,
    env,
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error || result.status !== 0) {
    fail(`${label} falló (${result.error?.message || `exit ${result.status}`}).`);
    return false;
  }
  return true;
}

fs.mkdirSync(sandbox, { recursive: true });
fs.writeFileSync(dbFile, '');
fs.writeFileSync(ownerFile, JSON.stringify({ runner: 'test-local', sandbox, dbFile, pid: process.pid }), 'utf8');

const databaseUrl = `file:${dbFile.replaceAll('\\', '/')}`;
const env = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  RUST_LOG: 'info'
};
let exitCode = 1;

try {
  if (!fs.existsSync(prismaCli) || !fs.existsSync(vitestCli) || !fs.existsSync(tsxCli) || !fs.existsSync(schema) || !fs.existsSync(localSeed)) {
    fail('faltan dependencias o schema; ejecutá npm ci y npm run setup:local.');
  } else if (run('crear esquema SQLite efímero', prismaCli, ['db', 'push', '--schema', schema, '--skip-generate'], env)) {
    const seedEnv = { ...env, NODE_ENV: 'development', MESAYA_LOCAL_SEED: 'true' };
    if (run('cargar fixtures demo en SQLite efímera', tsxCli, [localSeed], seedEnv)) {
      // A full single-worker run has already paid the Prisma/TypeScript cold
      // start cost before some suites call buildApp. The default Vitest hook
      // timeout (10s) is too short on Windows/Node 24; 60s still catches a
      // genuine hang without making the local gate unbounded.
      const vitestArgs = ['run', '--pool=forks', '--maxWorkers=1', '--hookTimeout=60000', ...process.argv.slice(2)];
      if (run('ejecutar suites Vitest en un worker', vitestCli, vitestArgs, env)) {
        exitCode = 0;
      }
    }
  }
} finally {
  try {
    const resolvedQa = path.resolve(qaRoot);
    const resolvedSandbox = path.resolve(sandbox);
    const relative = path.relative(resolvedQa, resolvedSandbox);
    if (!relative.startsWith('..') && !path.isAbsolute(relative) && fs.existsSync(ownerFile)) {
      fs.rmSync(resolvedSandbox, { recursive: true, force: true });
    }
  } catch (error) {
    console.warn(`test:local: no se pudo limpiar el sandbox efímero: ${error.message}`);
    exitCode = 1;
  }
}

process.exit(exitCode);

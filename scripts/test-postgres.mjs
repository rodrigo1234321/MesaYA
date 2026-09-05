#!/usr/bin/env node

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vitestCli = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
const generateScript = path.join(projectRoot, 'scripts', 'prisma-generate.mjs');
const migrateScript = path.join(projectRoot, 'scripts', 'postgres-migrate.mjs');
const testPath = process.argv[2] || 'packages/api/test/guest-orders-validation.test.ts';
const databaseUrl = process.env.MESAYA_PG_DATABASE_URL;
const directUrl = process.env.MESAYA_PG_DIRECT_URL;

if (!databaseUrl || !directUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl) || !/^postgres(?:ql)?:\/\//i.test(directUrl)) {
  console.error('Runner PG detenido: requiere MESAYA_PG_DATABASE_URL y MESAYA_PG_DIRECT_URL PostgreSQL explícitas.');
  process.exit(2);
}

const pgEnv = {
  ...process.env,
  NODE_ENV: 'test',
  DATABASE_URL: databaseUrl,
  DIRECT_URL: directUrl
};
let exitCode = 1;
try {
  const migration = spawnSync(process.execPath, [migrateScript, 'deploy'], { cwd: projectRoot, env: pgEnv, stdio: 'inherit', windowsHide: true });
  if (migration.status !== 0) {
    exitCode = migration.status ?? 1;
  } else {
    const generation = spawnSync(process.execPath, [generateScript, 'postgres'], { cwd: projectRoot, env: pgEnv, stdio: 'inherit', windowsHide: true });
    if (generation.status !== 0) {
      exitCode = generation.status ?? 1;
    } else {
      const tests = spawnSync(process.execPath, [vitestCli, 'run', testPath, '--maxWorkers=1', '--no-file-parallelism', '--maxConcurrency=1'], {
        cwd: projectRoot,
        env: pgEnv,
        stdio: 'inherit',
        windowsHide: true
      });
      exitCode = tests.status ?? 1;
    }
  }
} finally {
  const restore = spawnSync(process.execPath, [generateScript, 'sqlite'], { cwd: projectRoot, env: process.env, stdio: 'inherit', windowsHide: true });
  if (restore.status !== 0 && exitCode === 0) exitCode = restore.status ?? 1;
}
process.exit(exitCode);

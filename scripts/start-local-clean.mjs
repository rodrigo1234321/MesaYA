#!/usr/bin/env node

/**
 * Prepare (without touching remote providers) and start the complete local
 * MesaYA stack against the isolated demo database.
 *
 * Re-running this command is safe: setup-local preserves an existing SQLite
 * file and only seeds it when it is empty. Delete .tmp/live-local.db yourself
 * when you intentionally want to reset the demo data.
 */

import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, '.tmp', 'live-local.db');
const setupScript = path.join(root, 'scripts', 'setup-local.mjs');
const startScript = path.join(root, 'scripts', 'start_dev_ip.js');
const databaseUrl = `file:${dbPath.replaceAll('\\', '/')}`;

const setup = spawnSync(process.execPath, [setupScript, '--db', dbPath], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'development',
    MESAYA_INSTANCE_MODE: 'MULTI_TENANT'
  },
  stdio: 'inherit',
  windowsHide: true
});

if (setup.error) {
  console.error(`dev:clean: no se pudo preparar la base local: ${setup.error.message}`);
  process.exit(1);
}
if (setup.status !== 0) {
  process.exit(setup.status ?? 1);
}

process.env.DATABASE_URL = databaseUrl;
process.env.NODE_ENV = 'development';
process.env.MESAYA_INSTANCE_MODE = 'MULTI_TENANT';

console.log('\n🔒 Entorno aislado: .tmp/live-local.db');
console.log('🚀 Iniciando API, cliente, panel de mozos y administración...\n');
await import(pathToFileURL(startScript).href);

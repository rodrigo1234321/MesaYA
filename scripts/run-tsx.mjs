#!/usr/bin/env node

/**
 * Ejecuta la versión local de tsx sin depender de os.userInfo() en Windows.
 * Algunas instalaciones de Node 24 devuelven ENOMEM desde uv_os_get_passwd;
 * tsx sólo usa ese dato para nombrar su directorio temporal. Definir un euid
 * estable evita esa llamada sin cambiar permisos, guards ni la base de datos.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const preload = path.join(root, 'scripts', 'tsx-preload.cjs');

if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => 0
  });
}

const existingNodeOptions = process.env.NODE_OPTIONS?.trim() || '';
const preloadOption = `--require=${preload}`;
if (!existingNodeOptions.includes(preloadOption)) {
  process.env.NODE_OPTIONS = `${existingNodeOptions} ${preloadOption}`.trim();
}

process.argv.splice(1, 1, tsxCli);
await import(pathToFileURL(tsxCli).href);

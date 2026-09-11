#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstanceManifest } from './instance-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const production = process.argv.includes('--production');
const fileArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'));
const file = fileArgument || path.join(root, 'deploy', 'instance.example.json');

try {
  const result = readInstanceManifest(file, { production });
  if (!result.ok) {
    console.error(`Manifiesto inválido: ${file}`);
    result.errors.forEach((error) => console.error(`  - ${error}`));
    process.exit(1);
  }
  console.log(`Manifiesto válido: ${result.manifest.instanceKey}`);
  console.log(`Restaurante: ${result.manifest.restaurant.name} (${result.manifest.restaurant.slug})`);
  console.log(`Release declarada: ${result.manifest.deployment.release}`);
  console.log('Secretos: no incluidos en el manifiesto.');
} catch (error) {
  console.error(`No se pudo leer el manifiesto: ${error.message}`);
  process.exit(1);
}

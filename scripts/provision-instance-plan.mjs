#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readInstanceManifest } from './instance-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const production = args.includes('--production');
const manifestArg = args.find((value) => !value.startsWith('--'));
const manifestPath = manifestArg ? path.resolve(process.cwd(), manifestArg) : path.join(root, 'deploy', 'instance.example.json');

const result = readInstanceManifest(manifestPath, { production });
if (!result.ok) {
  console.error(`Manifiesto inválido: ${manifestPath}`);
  result.errors.forEach((error) => console.error(`  - ${error}`));
  process.exit(1);
}

const { manifest } = result;
const originList = ['client', 'staff', 'admin'].map((key) => manifest.domains[key]).join(',');
// `digitalPayment` sólo controla una opción informativa en la release base;
// una dependencia de proveedor aparece únicamente si se solicita split real.
const needsMercadoPago = manifest.modules.splitBill;
const needsWhatsApp = manifest.modules.whatsappFallback;
const plan = {
  mode: 'PLAN_ONLY',
  instanceKey: manifest.instanceKey,
  restaurant: manifest.restaurant,
  release: manifest.deployment.release,
  schema: manifest.deployment.schema,
  customization: manifest.customization,
  vercelProjects: manifest.deployment.vercelProjects,
  requiredSecretBindings: [
    'DATABASE_URL',
    'DIRECT_URL',
    'JWT_SECRET',
    'ENCRYPTION_SECRET_KEY',
    `CORS_ORIGIN=${originList}`,
    `MESAYA_INSTANCE_MODE=SINGLE_RESTAURANT`,
    `MESAYA_INSTANCE_RESTAURANT_ID=<id creado durante bootstrap>`
  ],
  externalDependencies: {
    supabase: 'proyecto aislado por instancia; migraciones y backup fuera de Git',
    mercadoPago: needsMercadoPago
      ? 'sandbox requerido para split real: vendedor/comprador, credenciales cifradas, firma de webhook y Preview accesible'
      : 'no requerido; la opción informativa no realiza cobros',
    whatsapp: needsWhatsApp
      ? 'proveedor y número autorizados; consentimiento y deduplicación antes de activar'
      : 'no requerido por la configuración declarada'
  },
  steps: [
    'Preflight de revisión, Node, npm y manifiesto sin secretos',
    'Crear un proyecto Supabase vacío para esta instancia y registrar sus IDs fuera de Git',
    'Cargar DATABASE_URL/DIRECT_URL en el entorno seguro del proyecto',
    'Ejecutar prisma migrate deploy contra la conexión directa',
    'Crear el restaurante raíz y el manager temporal mediante bootstrap idempotente',
    'Crear cuatro proyectos Vercel desde la misma revisión: api, client, staff y admin',
    'Cargar variables por proyecto sin imprimir valores',
    ...(needsMercadoPago ? ['Cargar credenciales sandbox de Mercado Pago en el vault y ejecutar el gate de webhooks antes de habilitar la capability'] : []),
    ...(needsWhatsApp ? ['Configurar proveedor WhatsApp y callback verificado; probar fallback sin duplicar llamados'] : []),
    'Publicar la misma release y ejecutar health/config/menu/QR smoke checks',
    'Rotar el PIN inicial, registrar backup y guardar inventario de versión sin secretos'
  ],
  externalActionsRequired: true,
  remoteMutationPerformed: false
};

console.log(JSON.stringify(plan, null, 2));

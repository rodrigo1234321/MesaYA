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
// `digitalPayment` sólo controla una preferencia informativa en la release base;
// `splitBill` (E05) se liquida presencialmente por staff vía settle/settle-and-close.
// La release actual no integra ningún proveedor de cobro en línea, por lo que
// Mercado Pago nunca es una dependencia del plan (sin sandbox, credenciales ni webhooks).
const splitPresencial = manifest.modules.splitBill === true;
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
    mercadoPago: 'no requerido; la release actual no integra cobro en línea (split presencial E05 por staff; digitalPayment informativo)',
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
    ...(splitPresencial ? ['Verificar división presencial de cuenta (E05) vía settle/settle-and-close de staff, sin proveedor externo de cobro'] : []),
    ...(needsWhatsApp ? ['Configurar proveedor WhatsApp y callback verificado; probar fallback sin duplicar llamados'] : []),
    'Publicar la misma release y ejecutar health/config/menu/QR smoke checks',
    'Rotar el PIN inicial, registrar backup y guardar inventario de versión sin secretos'
  ],
  externalActionsRequired: true,
  remoteMutationPerformed: false
};

console.log(JSON.stringify(plan, null, 2));

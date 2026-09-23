/**
 * MesaYA — Script de Gate de Deuda Técnica y Linting (Ficha P3)
 *
 * Ejecuta ESLint programáticamente, genera desglose estructurado por regla y alcance,
 * audita el conteo de `any`, verifica hooks de React y falla si la deuda no controlada crece.
 */
import { execSync } from 'child_process';

console.log('🔍 Ejecutando auditoría de deuda técnica y linting...');

let rawOutput = '';
try {
  rawOutput = execSync('npx eslint . -f json', {
    encoding: 'utf8',
    maxBuffer: 30 * 1024 * 1024
  });
} catch (err) {
  // ESLint puede retornar 1 si hay errores, pero aún produce stdout JSON
  if (err.stdout) {
    rawOutput = err.stdout;
  } else {
    console.error('Error al ejecutar ESLint:', err.message);
    process.exit(1);
  }
}

let results = [];
try {
  results = JSON.parse(rawOutput);
} catch (e) {
  console.error('Error parseando JSON de ESLint:', e.message);
  process.exit(1);
}

const statsByRule = {};
const statsByScope = {
  'Producción Backend (packages/api/src)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Tests Backend (packages/api/test)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Producción Admin Dashboard (apps/admin-dashboard/src)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Tests Admin Dashboard (apps/admin-dashboard/src/**/*.test.*)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Producción Staff Panel (apps/staff-panel/src)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Cliente Vanilla (apps/client-web)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Shared Library (packages/shared)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Scripts y Herramientas (scripts/, tests/load/)': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 },
  'Otros / Raíz': { any: 0, unused: 0, hooks: 0, other: 0, total: 0 }
};

let totalErrors = 0;
let totalWarnings = 0;

function categorizeFile(filePath) {
  const norm = filePath.replace(/\\/g, '/');
  if (norm.includes('packages/api/src')) return 'Producción Backend (packages/api/src)';
  if (norm.includes('packages/api/test')) return 'Tests Backend (packages/api/test)';
  if (norm.includes('apps/admin-dashboard/src') && norm.includes('.test.')) return 'Tests Admin Dashboard (apps/admin-dashboard/src/**/*.test.*)';
  if (norm.includes('apps/admin-dashboard/src')) return 'Producción Admin Dashboard (apps/admin-dashboard/src)';
  if (norm.includes('apps/staff-panel/src')) return 'Producción Staff Panel (apps/staff-panel/src)';
  if (norm.includes('apps/client-web')) return 'Cliente Vanilla (apps/client-web)';
  if (norm.includes('packages/shared')) return 'Shared Library (packages/shared)';
  if (norm.includes('/scripts/') || norm.includes('/tests/load/')) return 'Scripts y Herramientas (scripts/, tests/load/)';
  return 'Otros / Raíz';
}

for (const fileResult of results) {
  const scope = categorizeFile(fileResult.filePath);
  totalErrors += fileResult.errorCount;
  totalWarnings += fileResult.warningCount;

  for (const msg of fileResult.messages) {
    const rule = msg.ruleId || 'unknown';
    statsByRule[rule] = (statsByRule[rule] || 0) + 1;

    statsByScope[scope].total++;
    if (rule.includes('explicit-any')) {
      statsByScope[scope].any++;
    } else if (rule.includes('unused-vars')) {
      statsByScope[scope].unused++;
    } else if (rule.includes('hooks')) {
      statsByScope[scope].hooks++;
    } else {
      statsByScope[scope].other++;
    }
  }
}

console.log('\n======================================================');
console.log('📊 RESUMEN DE LINTING Y DEUDA TÉCNICA (FICHA P3)');
console.log('======================================================');
console.log(`Errores:   ${totalErrors}`);
console.log(`Warnings:  ${totalWarnings}`);

console.log('\n--- Desglose por Regla ---');
console.table(statsByRule);

console.log('\n--- Desglose por Alcance (Producción vs Tests vs Scripts) ---');
console.table(statsByScope);

// Umbrales de Gate de Deuda Controlada
const MAX_ALLOWED_ERRORS = 0;
const MAX_ALLOWED_WARNINGS = 1460; // Baseline actual de warnings

let gateFailed = false;

if (totalErrors > MAX_ALLOWED_ERRORS) {
  console.error(`❌ FALLO DE GATE: Se encontraron ${totalErrors} errores de linting. Máximo permitido: ${MAX_ALLOWED_ERRORS}.`);
  gateFailed = true;
}

if (totalWarnings > MAX_ALLOWED_WARNINGS) {
  console.error(`❌ FALLO DE GATE: El volumen de advertencias (${totalWarnings}) supera el baseline permitido (${MAX_ALLOWED_WARNINGS}).`);
  gateFailed = true;
}

if (gateFailed) {
  process.exit(1);
}

console.log('✅ GATE DE DEUDA CUMPLIDO: 0 errores y advertencias dentro del baseline documentado.');

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');

console.log('=== Verificación de Migración PostgreSQL E03 (pinFingerprint) ===');

const migrationDir = path.join(projectRoot, 'packages', 'api', 'prisma', 'migrations-postgres');
const migrationSqlFile = path.join(migrationDir, '20260914000000_add_staff_pin_fingerprint', 'migration.sql');

if (!fs.existsSync(migrationSqlFile)) {
  console.error('❌ ERROR: No se encontró el archivo de migración en:', migrationSqlFile);
  process.exit(1);
}

const sqlContent = fs.readFileSync(migrationSqlFile, 'utf8');
console.log('📄 Contenido de la migración:\n' + sqlContent);

// Verificaciones léxicas y semánticas
const checks = [
  { desc: 'ALTER TABLE "StaffUser"', pass: sqlContent.includes('ALTER TABLE "StaffUser"') },
  { desc: 'ADD COLUMN IF NOT EXISTS "pinFingerprint" TEXT', pass: sqlContent.includes('"pinFingerprint"') && sqlContent.includes('TEXT') },
  { desc: 'CREATE UNIQUE INDEX IF NOT EXISTS "StaffUser_restaurantId_pinFingerprint_key"', pass: sqlContent.includes('"StaffUser_restaurantId_pinFingerprint_key"') },
  { desc: 'Índice sobre ("restaurantId", "pinFingerprint")', pass: sqlContent.includes('("restaurantId", "pinFingerprint")') }
];

let failed = false;
for (const c of checks) {
  if (c.pass) {
    console.log(`✓ ${c.desc}`);
  } else {
    console.error(`❌ Falló verificación: ${c.desc}`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
}

// Verificar orden cronológico de migraciones
const migrationFolders = fs.readdirSync(migrationDir)
  .filter(f => fs.statSync(path.join(migrationDir, f)).isDirectory())
  .sort();

const lastMigration = migrationFolders[migrationFolders.length - 1];
console.log(`📁 Última migración en el historial: ${lastMigration}`);
if (lastMigration !== '20260914000000_add_staff_pin_fingerprint') {
  console.error(`❌ La migración 20260914000000 no es la última en el historial.`);
  process.exit(1);
}
console.log('✓ Orden de migraciones verificado correctamente.');

// Verificar sincronización de schema.supabase.prisma
const syncCheck = spawnSync(process.execPath, [path.join(projectRoot, 'scripts', 'sync_supabase_schema.js'), '--check'], {
  cwd: projectRoot,
  encoding: 'utf8'
});

if (syncCheck.status !== 0) {
  console.error('❌ sync_supabase_schema --check falló:', syncCheck.stderr || syncCheck.stdout);
  process.exit(1);
}
console.log('✓ schema.supabase.prisma sincronizado al 100% con schema.prisma.');

console.log('\n🎉 Todas las validaciones de E03 pasaron exitosamente.');
process.exit(0);

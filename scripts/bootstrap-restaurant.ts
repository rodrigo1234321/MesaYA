#!/usr/bin/env node

/**
 * MesaYA - Script Seguro e Idempotente de Bootstrap para Producción / Staging
 *
 * Permite crear el primer restaurante y su usuario administrador (MANAGER)
 * en una base de datos limpia (PostgreSQL / Supabase / SQLite) sin ejecutar
 * el seed de fixtures demo y sin abrir turnos automáticamente.
 *
 * Uso:
 *   npx tsx scripts/bootstrap-restaurant.ts \
 *     --name "Trattoria del Puerto" \
 *     --slug "trattoria-del-puerto" \
 *     --manager "Gerente Principal" \
 *     --pin "<PIN-de-4-a-6-digitos>" \
 *     --tables 8
 *
 * Rotación explícita (reemplaza la credencial existente):
 *   npx tsx scripts/bootstrap-restaurant.ts --slug "mi-restaurant" \
 *     --pin "<NUEVO-PIN>" --rotate-pin
 * C02: TODA ejecución exige --pin o BOOTSTRAP_MANAGER_PIN con 4–6 dígitos
 * exactos (sin espacios, sin default, sin trim). Sin PIN válido sale con
 * código 1 aunque restaurante/manager ya existan. Si ya existe y no hay
 * --rotate-pin, se valida el formato del PIN provisto pero NO se calcula
 * bcrypt ni se sobrescribe pinHash (credencial conservada). Con
 * --rotate-pin se rota (bcrypt + update). El PIN nunca se imprime en logs.
 *
 * O mediante variables de entorno:
 *   BOOTSTRAP_RESTAURANT_NAME="Mi Restaurant" \
 *   BOOTSTRAP_RESTAURANT_SLUG="mi-restaurant" \
 *   BOOTSTRAP_MANAGER_PIN="8492" \
 *   npx tsx scripts/bootstrap-restaurant.ts
 */

export const BOOTSTRAP_PIN_PATTERN = /^\d{4,6}$/;
export type BootstrapCredential = 'creada' | 'rotada' | 'conservada';

export function getArgFrom(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < argv.length) {
    return argv[idx + 1];
  }
  return undefined;
}

export function parseTablesCountStrict(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  // Estricto: sólo dígitos (parseInt('8abc') no debe aceptar).
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error('--tables/BOOTSTRAP_TABLES_COUNT debe ser un entero entre 0 y 100.');
  }
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < 0 || n > 100) {
    throw new Error('--tables/BOOTSTRAP_TABLES_COUNT debe ser un entero entre 0 y 100.');
  }
  return n;
}

export function toCanonicalSlug(rawSlug: string): string {
  const slug = rawSlug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 100) {
    throw new Error('slug canónico inválido (a-z, 0-9 y guiones, 3–100 caracteres).');
  }
  return slug;
}

/** C02: PIN obligatorio en toda ejecución; formato exacto sin trim ni default. */
export function assertBootstrapPin(pinRaw: string | undefined): asserts pinRaw is string {
  if (pinRaw === undefined || !BOOTSTRAP_PIN_PATTERN.test(pinRaw)) {
    throw new Error('BOOTSTRAP_MANAGER_PIN o --pin debe tener 4 a 6 dígitos exactos (sin espacios ni default).');
  }
}

export interface BootstrapOptions {
  name: string;
  slug: string;
  managerName: string;
  pinRaw: string | undefined;
  rotateRequested: boolean;
  tablesCount: number;
  templateId: string;
  themeColor: string;
}

export function resolveBootstrapOptions(argv: string[] = process.argv, env: NodeJS.ProcessEnv = process.env): BootstrapOptions {
  const name = getArgFrom(argv, '--name') || env.BOOTSTRAP_RESTAURANT_NAME || 'Trattoria del Puerto';
  const rawSlug = getArgFrom(argv, '--slug') || env.BOOTSTRAP_RESTAURANT_SLUG || 'trattoria-del-puerto';
  const managerName = getArgFrom(argv, '--manager') || env.BOOTSTRAP_MANAGER_NAME || 'Encargado';
  const pinRaw = getArgFrom(argv, '--pin') || env.BOOTSTRAP_MANAGER_PIN;
  const rotateRequested =
    argv.includes('--rotate-pin') || env.BOOTSTRAP_ROTATE_PIN === 'true';
  const tablesCount = parseTablesCountStrict(
    getArgFrom(argv, '--tables') || env.BOOTSTRAP_TABLES_COUNT,
    8
  );
  const templateId = getArgFrom(argv, '--template') || 'GOURMET_OBSIDIAN';
  const themeColor = getArgFrom(argv, '--color') || '#f59e0b';
  const slug = toCanonicalSlug(rawSlug);
  if (!name.trim() || name.trim().length > 120 || !managerName.trim() || managerName.trim().length > 120) {
    throw new Error('nombre de restaurante y encargado requeridos (máx. 120).');
  }
  return { name, slug, managerName, pinRaw, rotateRequested, tablesCount, templateId, themeColor };
}

/** Decide credencial sin efectos: 'creada' si no hay manager, 'rotada' si hay rotación, 'conservada' en otro caso. */
export function classifyBootstrapCredential(managerExists: boolean, rotateRequested: boolean): BootstrapCredential {
  if (!managerExists) return 'creada';
  if (rotateRequested) return 'rotada';
  return 'conservada';
}

/** bcrypt/hash sólo al crear o rotar; conservar nunca hashea ni sobrescribe. */
export function shouldHashBootstrapCredential(credential: BootstrapCredential): boolean {
  return credential !== 'conservada';
}

/** Mensaje final seguro: nunca incluye el PIN. */
export function buildBootstrapSummary(result: { restaurant: { name: string; slug: string }; manager: { name: string }; credential: BootstrapCredential }): string {
  const lines = [
    '=============================================================',
    '🎉 Bootstrap completado con éxito.',
    `🏠 Restaurante: ${result.restaurant.name}`,
    `🔗 Slug:        ${result.restaurant.slug}`,
    `👤 Manager:     ${result.manager.name}`,
    '🔑 PIN:         (configurado de forma segura; no se muestra en logs)',
    `🔁 Credencial:  ${result.credential}${result.credential === 'conservada' ? ' (rotar con --rotate-pin)' : ''}`,
    '📌 Turno:       CERRADO (abrir desde el Admin Dashboard)',
    '=============================================================',
  ];
  return lines.join('\n');
}

function getArg(flag: string): string | undefined {
  return getArgFrom(process.argv, flag);
}

function parseTablesCount(raw: string | undefined, fallback: number): number {
  try {
    return parseTablesCountStrict(raw, fallback);
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
    throw err;
  }
}

function canonicalSlug(rawSlug: string): string {
  try {
    return toCanonicalSlug(rawSlug);
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
    throw err;
  }
}

async function main() {
  let options: BootstrapOptions;
  try {
    options = resolveBootstrapOptions(process.argv, process.env);
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
    throw err;
  }
  const { name, slug, managerName, pinRaw, rotateRequested, tablesCount, templateId, themeColor } = options;

  // C02: PIN exigido en TODA ejecución, incluso si ya existe. Sin PIN válido
  // se sale con código 1 antes de cualquier DB. Si se conserva, sólo se
  // valida formato (sin bcrypt/hash); bcrypt únicamente al crear o rotar.
  try {
    assertBootstrapPin(pinRaw);
  } catch (err: any) {
    console.error(`❌ Error: ${err.message}`);
    process.exit(1);
  }
  const pin = pinRaw as string;

  console.log(`🚀 Iniciando Bootstrap de Restaurante: "${name}" (${slug})...`);

  // Importación diferida para permitir importar este módulo en tests sin
  // efectos (sin conexión DB ni bcrypt al importar).
  const { PrismaClient } = await import('@prisma/client');
  const { default: bcrypt } = await import('bcryptjs');
  const prisma = new PrismaClient();

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      // 1. Buscar o crear el Restaurante (Idempotente)
      let restaurant = await tx.restaurant.findUnique({
        where: { slug }
      });

      let isNew = false;
      if (!restaurant) {
        restaurant = await tx.restaurant.create({
          data: {
            name: name.trim(),
            slug,
            templateId,
            themeColor,
            coverImageUrl: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80'
          }
        });
        isNew = true;
        console.log(`✅ Restaurante creado: ${restaurant.name} (ID: ${restaurant.id})`);
      } else {
        console.log(`ℹ️ El restaurante con slug "${slug}" ya existe (ID: ${restaurant.id}). Verificando personal...`);
      }

      // 2. Buscar o crear el Manager (sin hash previo si se conserva)
      let manager = await tx.staffUser.findFirst({
        where: {
          restaurantId: restaurant.id,
          role: 'MANAGER'
        }
      });

      let credential = classifyBootstrapCredential(!!manager, rotateRequested);
      if (!manager) {
        // Crear exige PIN ya validado arriba; bcrypt sólo aquí.
        const pinHash = await bcrypt.hash(pin, 10);
        manager = await tx.staffUser.create({
          data: {
            restaurantId: restaurant.id,
            name: managerName.trim(),
            role: 'MANAGER',
            pinHash,
            assignedSector: null
          }
        });
        credential = 'creada';
        console.log(`✅ Encargado administrativo creado: ${manager.name} (Rol: MANAGER)`);
      } else if (rotateRequested) {
        // Rotación explícita: bcrypt sólo aquí.
        const pinHash = await bcrypt.hash(pin, 10);
        manager = await tx.staffUser.update({
          where: { id: manager.id },
          data: { pinHash }
        });
        credential = 'rotada';
        console.log(`ℹ️ PIN del encargado "${manager.name}" rotado explícitamente.`);
      } else {
        // Conservada: PIN provisto ya validado en formato, sin bcrypt/hash/update.
        console.log(`ℹ️ Encargado "${manager.name}" ya existe: credencial conservada (usar --rotate-pin para rotar).`);
      }

      // 3. Crear Mesas si es un restaurante nuevo
      if (isNew && tablesCount > 0) {
        for (let i = 1; i <= tablesCount; i++) {
          await tx.table.create({
            data: {
              restaurantId: restaurant.id,
              label: `Mesa ${i}`,
              sector: i <= Math.ceil(tablesCount / 2) ? 'SALON_PRINCIPAL' : 'TERRAZA'
            }
          });
        }
        console.log(`✅ ${tablesCount} mesas iniciales configuradas.`);
      }

      return { restaurant, manager, isNew, credential };
    });

    console.log('');
    console.log(buildBootstrapSummary(result));
    console.log('');
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun =
  typeof process.argv[1] === 'string' && /bootstrap-restaurant(\.[jt]s)?$/.test(process.argv[1]);
if (isDirectRun && !process.env.VITEST_WORKER_ID) {
  main().catch((e) => {
    console.error('❌ Error fatal en bootstrap:', (e as Error)?.message || e);
    process.exit(1);
  });
}

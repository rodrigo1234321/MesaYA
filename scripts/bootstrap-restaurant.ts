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
 *     --pin "9999" \
 *     --tables 8
 * 
 * O mediante variables de entorno:
 *   BOOTSTRAP_RESTAURANT_NAME="Mi Restaurant" \
 *   BOOTSTRAP_RESTAURANT_SLUG="mi-restaurant" \
 *   BOOTSTRAP_MANAGER_PIN="8492" \
 *   npx tsx scripts/bootstrap-restaurant.ts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { isValidPinFormat } from '@mesaya/shared';

const prisma = new PrismaClient();

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const shouldRotatePin = process.argv.includes('--rotate-pin');

async function main() {
  const name = getArg('--name') || process.env.BOOTSTRAP_RESTAURANT_NAME || 'Trattoria del Puerto';
  const rawSlug = getArg('--slug') || process.env.BOOTSTRAP_RESTAURANT_SLUG || 'trattoria-del-puerto';
  const managerName = getArg('--manager') || process.env.BOOTSTRAP_MANAGER_NAME || 'Encargado';
  const rawPin = getArg('--pin') || process.env.BOOTSTRAP_MANAGER_PIN;
  const tablesCount = parseInt(getArg('--tables') || process.env.BOOTSTRAP_TABLES_COUNT || '8', 10);
  const templateId = getArg('--template') || 'GOURMET_OBSIDIAN';
  const themeColor = getArg('--color') || '#f59e0b';

  const slug = rawSlug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-');

  if (!rawPin) {
    console.error('❌ Error de seguridad (P0-03): Debe suministrar un PIN para el Manager mediante --pin o BOOTSTRAP_MANAGER_PIN. Prohibido valor por defecto.');
    process.exit(1);
  }

  const pin = rawPin.trim();
  if (!isValidPinFormat(pin)) {
    console.error('❌ Error de validación: El PIN debe contener estrictamente entre 4 y 6 dígitos numéricos exclusivamente.');
    process.exit(1);
  }

  console.log(`🚀 Iniciando Bootstrap de Restaurante: "${name}" (${slug})...`);

  const pinHash = await bcrypt.hash(pin.trim(), 10);

  const result = await prisma.$transaction(async (tx) => {
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

    // 2. Buscar o crear el Manager
    let manager = await tx.staffUser.findFirst({
      where: {
        restaurantId: restaurant.id,
        role: 'MANAGER'
      }
    });

    if (!manager) {
      manager = await tx.staffUser.create({
        data: {
          restaurantId: restaurant.id,
          name: managerName.trim(),
          role: 'MANAGER',
          pinHash,
          assignedSector: null
        }
      });
      console.log(`✅ Encargado administrativo creado: ${manager.name} (Rol: MANAGER)`);
    } else {
      if (shouldRotatePin) {
        manager = await tx.staffUser.update({
          where: { id: manager.id },
          data: { pinHash }
        });
        console.log(`🔄 PIN del encargado "${manager.name}" rotado explícitamente (--rotate-pin).`);
      } else {
        console.log(`🔒 Encargado "${manager.name}" ya existe. PIN preservado sin cambios (use --rotate-pin para actualizarlo).`);
      }
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

    return { restaurant, manager, isNew };
  });

  console.log('\n=============================================================');
  console.log('🎉 Bootstrap completado con éxito.');
  console.log(`🏠 Restaurante: ${result.restaurant.name}`);
  console.log(`🔗 Slug:        ${result.restaurant.slug}`);
  console.log(`👤 Manager:     ${result.manager.name}`);
  console.log(`🔑 PIN:         [CONFIGURADO DE FORMA SEGURA - NO REGISTRADO EN LOGS]`);
  console.log('📌 Turno:       CERRADO (abrir desde el Admin Dashboard)');
  console.log('=============================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Error fatal en bootstrap:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

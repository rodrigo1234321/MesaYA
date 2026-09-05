import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

export function assertSafeSeedEnvironment(
  dbUrl: string = process.env.DATABASE_URL || '',
  sandboxDir: string = process.env.ISOLATED_SANDBOX_DIR || '',
  nodeEnv: string = process.env.NODE_ENV || ''
): void {
  // 1. Prohibido estrictamente en cualquier entorno que no sea 'test'
  // (Eliminada cualquier excepción de desarrollo tipo ALLOW_DEV_SEED)
  if (nodeEnv !== 'test') {
    throw new Error(`GUARD_VIOLATION: Seed destructivo estrictamente prohibido fuera de entorno test (NODE_ENV actual: '${nodeEnv || 'undefined'}')`);
  }

  // 2. Prohibido contra cualquier base de datos remota (Postgres, MySQL, Supabase, etc.)
  if (
    dbUrl.startsWith('postgresql:') ||
    dbUrl.startsWith('postgres:') ||
    dbUrl.includes('supabase.co') ||
    dbUrl.startsWith('mysql:') ||
    dbUrl.startsWith('sqlserver:')
  ) {
    throw new Error('GUARD_VIOLATION: Seed destructivo prohibido contra base de datos remota');
  }

  // 3. Exigir autorización explícita del runner de test
  if (process.env.ALLOW_TEST_SEED !== 'true') {
    throw new Error('GUARD_VIOLATION: Seed en tests requiere autorización explícita del runner (ALLOW_TEST_SEED=true)');
  }

  // 4. Exigir sandbox temporal definido
  if (!sandboxDir) {
    throw new Error('GUARD_VIOLATION: ISOLATED_SANDBOX_DIR no definido en entorno de test');
  }

  // 5. Validar formato SQLite local
  if (!dbUrl || !dbUrl.startsWith('file:')) {
    throw new Error(`GUARD_VIOLATION: DATABASE_URL debe ser SQLite local (file:...) en el sandbox, recibido: ${dbUrl}`);
  }

  let rawPath = dbUrl.replace(/^file:/, '').split('?')[0];
  if (process.platform === 'win32') {
    // Normalizar si MSYS o Git Bash agregaron slashes antes de la letra de unidad (ej: /C:/ o ///C:/)
    rawPath = rawPath.replace(/^\/+([A-Za-z]:)/, '$1');
  }
  const resolvedDbPath = path.resolve(rawPath);
  const resolvedSandboxDir = path.resolve(sandboxDir);

  // 6. Validar que la base de datos esté estrictamente confinada en el sandbox bajo .tmp/qa/
  const rel = path.relative(resolvedSandboxDir, resolvedDbPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`GUARD_VIOLATION: La base de datos (${resolvedDbPath}) está fuera del sandbox temporal (${resolvedSandboxDir})`);
  }

  const norm = resolvedDbPath.split(path.sep).join('/');
  if (!norm.includes('/.tmp/qa/')) {
    throw new Error(`GUARD_VIOLATION: La ruta de test debe residir estrictamente bajo .tmp/qa/ (${resolvedDbPath})`);
  }

  // 7. [P2] Validar en disco el marcador de propiedad del runner (.runner-owner.json)
  const markerPath = path.join(resolvedSandboxDir, '.runner-owner.json');
  if (!fs.existsSync(markerPath)) {
    throw new Error(`GUARD_VIOLATION: Marcador de runner (.runner-owner.json) no encontrado en sandbox: ${markerPath}`);
  }

  let markerData: any;
  try {
    markerData = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  } catch (err: any) {
    throw new Error(`GUARD_VIOLATION: Marcador .runner-owner.json malformado o ilegible: ${err.message}`);
  }

  if (markerData.runner !== 'test-isolated') {
    throw new Error(`GUARD_VIOLATION: Marcador de sandbox no emitido por runner autorizado (recibido: '${markerData.runner}')`);
  }

  if (!markerData.sandboxDir || path.resolve(markerData.sandboxDir) !== resolvedSandboxDir) {
    throw new Error(`GUARD_VIOLATION: Marcador sandboxDir no coincide con la ruta actual (${markerData.sandboxDir} vs ${resolvedSandboxDir})`);
  }

  if (!markerData.dbFile || typeof markerData.dbFile !== 'string') {
    throw new Error('GUARD_VIOLATION: Marcador .runner-owner.json no incluye el campo obligatorio dbFile');
  }

  if (path.resolve(markerData.dbFile) !== resolvedDbPath) {
    throw new Error(`GUARD_VIOLATION: Marcador dbFile no coincide con la base actual (${markerData.dbFile} vs ${resolvedDbPath})`);
  }
}

export async function seedDatabase(customPrisma?: PrismaClient) {
  assertSafeSeedEnvironment();
  const prisma = customPrisma ?? new PrismaClient();
  try {
    return await runSeedLogic(prisma);
  } finally {
    if (!customPrisma) {
      await prisma.$disconnect();
    }
  }
}

async function runSeedLogic(prisma: PrismaClient) {
  console.log('🌱 Sembrando datos para MesaYA (Restaurante Piloto en Mar del Plata)...');

  // 1. Limpiar datos previos
  await prisma.tableStateEvent.deleteMany();
  await prisma.occupancySession.deleteMany();
  await prisma.feedback.deleteMany();
  await prisma.callRequest.deleteMany();
  await prisma.orderItem.deleteMany();
  await prisma.splitBillSession.deleteMany();
  await prisma.paymentTransaction.deleteMany();
  await prisma.order.deleteMany();
  await prisma.tableSession.deleteMany();
  await prisma.shift.deleteMany();
  await prisma.staffUser.deleteMany();
  await prisma.table.deleteMany();
  await prisma.floorZone.deleteMany();
  await prisma.floorPlanLayout.deleteMany();
  await prisma.menuItem.deleteMany();
  await prisma.menuCategory.deleteMany();
  await prisma.subscription.deleteMany();
  await prisma.restaurant.deleteMany();

  // 2. Crear Restaurante Piloto: Trattoria del Puerto
  const restaurant = await prisma.restaurant.create({
    data: {
      name: 'Trattoria del Puerto',
      slug: 'trattoria-del-puerto',
      planTier: 'SALON_TABLET',
      timezone: 'America/Argentina/Buenos_Aires',
      whatsappPhone: '+5492235001122',
      themeColor: '#f59e0b',
      templateId: 'GOURMET_OBSIDIAN',
      customFont: 'plus-jakarta',
      coverImageUrl: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=1200&q=85',
      pdfMenuUrl: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=1200&q=85',
      subscription: {
        create: {
          planTier: 'SALON_TABLET',
          monthlyPriceArs: 35000,
          isHighSeason: true,
          status: 'ACTIVE',
          currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        }
      }
    }
  });

  // ─── RTMS: Crear Zonas y Layout Inicial ───
  const zoneSalon = await prisma.floorZone.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Salón Principal',
      color: '#3b82f6',
      orderIndex: 0,
      polygonPoints: JSON.stringify([
        { x: 40, y: 40 },
        { x: 760, y: 40 },
        { x: 760, y: 720 },
        { x: 40, y: 720 }
      ])
    }
  });

  const zoneTerraza = await prisma.floorZone.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Terraza',
      color: '#22c55e',
      orderIndex: 1,
      polygonPoints: JSON.stringify([
        { x: 800, y: 40 },
        { x: 1160, y: 40 },
        { x: 1160, y: 720 },
        { x: 800, y: 720 }
      ])
    }
  });

  await prisma.floorPlanLayout.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Principal',
      canvasWidth: 1200,
      canvasHeight: 800,
      gridSize: 20,
      isActive: true
    }
  });

  // 3. Crear Staff (Mozo con PIN 1234 y Encargado con PIN 9999)
  const pinMozo = await bcrypt.hash('1234', 10);
  const pinAdmin = await bcrypt.hash('9999', 10);

  const waiter = await prisma.staffUser.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Joaquín (Mozo)',
      pinHash: pinMozo,
      role: 'WAITER',
      assignedSector: 'SALON_PRINCIPAL'
    }
  });

  await prisma.staffUser.create({
    data: {
      restaurantId: restaurant.id,
      name: 'Rodrigo (Encargado)',
      pinHash: pinAdmin,
      role: 'MANAGER',
      assignedSector: null
    }
  });

  // 4. Crear 15 Mesas con Geometría Canvas 2D Realista (10 Salón, 5 Terraza)
  const tablesData = [
    // Salón Principal: Fila 1 (Booths contra la pared)
    { label: 'Mesa 1', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 80, posY: 80, width: 100, height: 70, rotation: 0, shape: 'BOOTH', capacity: 4, floorZoneId: zoneSalon.id },
    { label: 'Mesa 2', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 220, posY: 80, width: 100, height: 70, rotation: 0, shape: 'BOOTH', capacity: 4, floorZoneId: zoneSalon.id },
    { label: 'Mesa 3', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 360, posY: 80, width: 100, height: 70, rotation: 0, shape: 'BOOTH', capacity: 4, floorZoneId: zoneSalon.id },
    { label: 'Mesa 4', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 500, posY: 80, width: 100, height: 70, rotation: 0, shape: 'BOOTH', capacity: 4, floorZoneId: zoneSalon.id },
    
    // Salón Principal: Fila 2 (Mesas cuadradas de 2-4 personas)
    { label: 'Mesa 5', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 100, posY: 240, width: 80, height: 80, rotation: 0, shape: 'SQUARE', capacity: 2, floorZoneId: zoneSalon.id },
    { label: 'Mesa 6', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 260, posY: 240, width: 80, height: 80, rotation: 0, shape: 'SQUARE', capacity: 2, floorZoneId: zoneSalon.id },
    { label: 'Mesa 7', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 420, posY: 240, width: 90, height: 90, rotation: 0, shape: 'RECT', capacity: 4, floorZoneId: zoneSalon.id },
    { label: 'Mesa 8', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 580, posY: 240, width: 90, height: 90, rotation: 0, shape: 'RECT', capacity: 4, floorZoneId: zoneSalon.id },

    // Salón Principal: Fila 3 (Mesa grande familiar / eventos)
    { label: 'Mesa 9', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 120, posY: 420, width: 180, height: 90, rotation: 0, shape: 'RECT', capacity: 8, floorZoneId: zoneSalon.id },
    { label: 'Mesa 10', sector: 'SALON_PRINCIPAL', isOutdoor: false, posX: 400, posY: 420, width: 160, height: 90, rotation: 0, shape: 'RECT', capacity: 6, floorZoneId: zoneSalon.id },

    // Terraza: Mesas redondas y cuadradas al aire libre
    { label: 'Terraza 1', sector: 'TERRAZA', isOutdoor: true, posX: 840, posY: 100, width: 85, height: 85, rotation: 0, shape: 'ROUND', capacity: 4, floorZoneId: zoneTerraza.id },
    { label: 'Terraza 2', sector: 'TERRAZA', isOutdoor: true, posX: 1000, posY: 100, width: 85, height: 85, rotation: 0, shape: 'ROUND', capacity: 4, floorZoneId: zoneTerraza.id },
    { label: 'Terraza 3', sector: 'TERRAZA', isOutdoor: true, posX: 840, posY: 260, width: 85, height: 85, rotation: 0, shape: 'ROUND', capacity: 4, floorZoneId: zoneTerraza.id },
    { label: 'Terraza 4', sector: 'TERRAZA', isOutdoor: true, posX: 1000, posY: 260, width: 85, height: 85, rotation: 0, shape: 'ROUND', capacity: 4, floorZoneId: zoneTerraza.id },
    { label: 'Terraza 5', sector: 'TERRAZA', isOutdoor: true, posX: 920, posY: 420, width: 140, height: 80, rotation: 0, shape: 'RECT', capacity: 6, floorZoneId: zoneTerraza.id },

    // Segundo Piso / Planta Alta (Salón Exclusivo - Zona Inferior Izquierda)
    { label: 'Piso 2 - Mesa 1', sector: 'PLANTA_ALTA', isOutdoor: false, posX: 100, posY: 560, width: 90, height: 90, rotation: 0, shape: 'RECT', capacity: 4, floorZoneId: null },
    { label: 'Piso 2 - Mesa 2', sector: 'PLANTA_ALTA', isOutdoor: false, posX: 260, posY: 560, width: 90, height: 90, rotation: 0, shape: 'RECT', capacity: 4, floorZoneId: null },
    { label: 'Piso 2 - Mesa 3', sector: 'PLANTA_ALTA', isOutdoor: false, posX: 420, posY: 560, width: 90, height: 90, rotation: 0, shape: 'RECT', capacity: 4, floorZoneId: null },
    { label: 'Piso 2 - VIP Balcón', sector: 'PLANTA_ALTA', isOutdoor: false, posX: 240, posY: 680, width: 160, height: 80, rotation: 0, shape: 'RECT', capacity: 8, floorZoneId: null },

    // Barra de Cócteles (Zona Inferior Derecha)
    { label: 'Barra 1', sector: 'BARRA', isOutdoor: false, posX: 780, posY: 580, width: 60, height: 60, rotation: 0, shape: 'ROUND', capacity: 2, floorZoneId: null },
    { label: 'Barra 2', sector: 'BARRA', isOutdoor: false, posX: 870, posY: 580, width: 60, height: 60, rotation: 0, shape: 'ROUND', capacity: 2, floorZoneId: null },
    { label: 'Barra 3', sector: 'BARRA', isOutdoor: false, posX: 960, posY: 580, width: 60, height: 60, rotation: 0, shape: 'ROUND', capacity: 2, floorZoneId: null }
  ];

  const createdTables = [];
  for (const t of tablesData) {
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: t.label,
        sector: t.sector,
        isOutdoor: t.isOutdoor,
        posX: t.posX,
        posY: t.posY,
        width: t.width,
        height: t.height,
        rotation: t.rotation,
        shape: t.shape,
        capacity: t.capacity,
        floorZoneId: t.floorZoneId,
        currentState: 'AVAILABLE',
        stateChangedAt: new Date()
      }
    });
    createdTables.push(table);
  }

  // 5. Abrir turno inicial y generar sesiones con tokens UUID
  const now = new Date();
  const shift = await prisma.shift.create({
    data: {
      restaurantId: restaurant.id,
      openedAt: now
    }
  });

  const expiresAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  const demoTokens: Array<{ label: string; token: string; url: string }> = [];

  for (const table of createdTables) {
    const token = randomUUID();
    await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token,
        expiresAt,
        createdAt: now
      }
    });

    demoTokens.push({
      label: table.label,
      token,
      url: `http://localhost:5173/?token=${token}`
    });
  }

  // 6. Crear Categorías y Platos de Menú Iniciales
  const menuCategories = [
    {
      name: 'Pastas Artesanales & Pizzas',
      icon: '🍝',
      orderIndex: 0,
      items: [
        {
          name: 'Sorrentinos de Salmón & Ciboulette',
          description: 'Con crema de puerros y crocante de nuez',
          price: 14500,
          isFeatured: true,
          tags: JSON.stringify(['CHEF_PICK', 'POPULAR']),
          imageUrl: 'https://images.unsplash.com/photo-1551183053-bf91a1d81141?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Fettuccine Frutti di Mare',
          description: 'Langostinos, calamares y mejillones al vino blanco',
          price: 16200,
          isFeatured: true,
          tags: JSON.stringify(['POPULAR']),
          imageUrl: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Pizza Napolitana di Bufala',
          description: 'Masa madre, pomodoro italiano y albahaca fresca',
          price: 12800,
          isFeatured: false,
          tags: JSON.stringify(['VEGETARIAN']),
          imageUrl: 'https://images.unsplash.com/photo-1574071318508-1cdbab80d002?auto=format&fit=crop&w=600&q=80'
        }
      ]
    },
    {
      name: 'Carnes & Pescados Frescos',
      icon: '🥩',
      orderIndex: 1,
      items: [
        {
          name: 'Ojo de Bife a la Leña (400g)',
          description: 'Con papas rústicas al romero y manteca de chimichurri',
          price: 18900,
          isFeatured: true,
          tags: JSON.stringify(['CHEF_PICK', 'GLUTEN_FREE']),
          imageUrl: 'https://images.unsplash.com/photo-1558030006-450675393462?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Pesca del Día al Horno de Barro',
          description: 'Con vegetales glaseados y emulsión de limón confitado',
          price: 17500,
          isFeatured: false,
          tags: JSON.stringify(['GLUTEN_FREE']),
          imageUrl: 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=600&q=80'
        }
      ]
    },
    {
      name: 'Bebidas & Tragos de Autor',
      icon: '🍹',
      orderIndex: 2,
      items: [
        {
          name: 'Aperol Spritz Clásico',
          description: 'Prosecco, Aperol, golpe de soda y rodaja de naranja',
          price: 4500,
          isFeatured: false,
          tags: JSON.stringify(['POPULAR']),
          imageUrl: 'https://images.unsplash.com/photo-1560512823-829485b8bf24?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Gin Tonic de Frutos Rojos',
          description: 'Gin artesanal marplatense con tónica premium y bayas frescas',
          price: 4800,
          isFeatured: true,
          tags: JSON.stringify(['CHEF_PICK']),
          imageUrl: 'https://images.unsplash.com/photo-1527661591475-527312dd65f5?auto=format&fit=crop&w=600&q=80'
        }
      ]
    },
    {
      name: 'Postres Artesanales',
      icon: '🍰',
      orderIndex: 3,
      items: [
        {
          name: 'Tiramisú Tradicional de Mascarpone',
          description: 'Con café espresso y cacao amargo 70%',
          price: 5200,
          isFeatured: true,
          tags: JSON.stringify(['POPULAR']),
          imageUrl: 'https://images.unsplash.com/photo-1571877227200-a0d98ea607e9?auto=format&fit=crop&w=600&q=80'
        },
        {
          name: 'Volcán de Dulce de Leche',
          description: 'Con helado artesanal de crema americana',
          price: 5800,
          isFeatured: true,
          tags: JSON.stringify(['CHEF_PICK', 'GLUTEN_FREE']),
          imageUrl: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?auto=format&fit=crop&w=600&q=80'
        }
      ]
    }
  ];

  for (const catData of menuCategories) {
    const category = await prisma.menuCategory.create({
      data: {
        restaurantId: restaurant.id,
        name: catData.name,
        icon: catData.icon,
        orderIndex: catData.orderIndex
      }
    });

    for (let i = 0; i < catData.items.length; i++) {
      const itemData = catData.items[i];
      await prisma.menuItem.create({
        data: {
          categoryId: category.id,
          name: itemData.name,
          description: itemData.description,
          price: itemData.price,
          imageUrl: itemData.imageUrl,
          isAvailable: true,
          isFeatured: itemData.isFeatured,
          tags: itemData.tags,
          orderIndex: i
        }
      });
    }
  }

  console.log('✅ Seed completado con éxito!');
  console.log(`🏠 Restaurante: ${restaurant.name} (slug: ${restaurant.slug})`);
  console.log(`👤 Staff Mozo PIN: 1234 | Encargado PIN: 9999`);
  console.log(`📋 Mesas creadas (${createdTables.length} mesas). Ejemplos de URLs para comensales:`);
  demoTokens.slice(0, 4).forEach(t => {
    console.log(`   - ${t.label}: ${t.token} -> ${t.url}`);
  });
  console.log(`🍽️ Categorías de menú creadas: ${menuCategories.length}`);
}

export async function main() {
  return seedDatabase();
}

if (process.argv[1] && (process.argv[1].endsWith('seed.ts') || process.argv[1].endsWith('seed.js'))) {
  seedDatabase().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

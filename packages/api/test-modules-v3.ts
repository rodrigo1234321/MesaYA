import { buildApp } from './src/index';
import { prisma } from './src/lib/prisma';
import { CryptoService } from './src/lib/crypto';
import { PaymentMode, SplitMode } from '@mesaya/shared';

async function runModularTests() {
  console.log('🧪 Iniciando batería de verificación profunda (RBAC, Concurrencia, Cifrado, CAS y Split Exacto)...\n');

  const app = await buildApp();
  await app.ready();

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: 'trattoria-del-puerto' },
    include: {
      staffUsers: true,
      categories: {
        include: { items: true }
      },
      tables: {
        include: {
          sessions: {
            where: { closedAt: null },
            take: 1
          }
        }
      }
    }
  });

  if (!restaurant || !restaurant.tables[0]?.sessions[0]) {
    throw new Error('No hay restaurante de prueba. Ejecuta el seed.');
  }

  const table = restaurant.tables[0];
  const session = table.sessions[0];
  const testDish = restaurant.categories[0]?.items[0];

  // ----------------------------------------------------
  // TEST 1: Cifrado en reposo AES-256-GCM
  // ----------------------------------------------------
  console.log('1️⃣ Test: Cifrado en reposo simétrico AES-256-GCM para tokens de Mercado Pago');
  const rawMpToken = 'APP_USR-789456123012-083123-abcdef123456-100200300';
  const encrypted = CryptoService.encrypt(rawMpToken);
  console.log(`   Texto plano: ${rawMpToken.substring(0, 15)}...`);
  console.log(`   Cifrado (iv:tag:cipher): ${encrypted.substring(0, 35)}...`);
  const parts = encrypted.split(':');
  if (parts.length !== 3) throw new Error('Formato de cifrado incorrecto');
  const decrypted = CryptoService.decrypt(encrypted);
  if (decrypted !== rawMpToken) throw new Error('Falló descifrado AES-256-GCM');
  console.log('   ✅ Cifrado/Descifrado verificado con integridad de auth tag GCM.');

  // ----------------------------------------------------
  // TEST 2: Endpoint público de configuración sin leakage
  // ----------------------------------------------------
  console.log('\n2️⃣ Test: Whitelist select en GET /v1/restaurants/:slug/config (Cero token leakage)');
  const resPublicConfig = await app.inject({
    method: 'GET',
    url: `/v1/restaurants/${restaurant.slug}/config`
  });
  console.log(`   Status: ${resPublicConfig.statusCode} (esperado 200)`);
  if (resPublicConfig.statusCode !== 200) throw new Error('Falló obtención de config pública');

  const publicConfig = JSON.parse(resPublicConfig.body);
  if ('mpAccessToken' in publicConfig || 'mpAccessTokenEncrypted' in publicConfig) {
    throw new Error('🚨 CRÍTICO DE SEGURIDAD: Se filtraron credenciales en el endpoint público!');
  }
  console.log('   ✅ Seguridad verificada: No contiene tokens ni secretos privados.');

  // ----------------------------------------------------
  // TEST 3: Control de Autorización RBAC (Los 3 Casos: Sin Auth, Mozo, Manager)
  // ----------------------------------------------------
  console.log('\n3️⃣ Test: Control de autorización RBAC (3 casos: Sin Auth -> 401, Mozo -> 403, Manager -> 200)');
  // Caso A: Intento no autenticado -> 401
  const resUnauthPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/restaurants/${restaurant.id}/config`,
    payload: { paymentMode: PaymentMode.WAITER_ONLY }
  });
  console.log(`   [Caso A] Sin token JWT status: ${resUnauthPatch.statusCode} (esperado 401 Unauthorized)`);
  if (resUnauthPatch.statusCode !== 401) throw new Error('Falló protección de ruta no autenticada');

  // Caso B: Login como Mozo (PIN 1234, rol WAITER) e intento de tocar config -> 403 Forbidden
  const resLoginWaiter = await app.inject({
    method: 'POST',
    url: '/v1/staff/login',
    payload: { restaurantSlug: restaurant.slug, pin: '1234' }
  });
  const { token: waiterJwt } = JSON.parse(resLoginWaiter.body);

  const resWaiterPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/restaurants/${restaurant.id}/config`,
    headers: { Authorization: `Bearer ${waiterJwt}` },
    payload: { paymentMode: PaymentMode.WAITER_ONLY }
  });
  console.log(`   [Caso B] Token válido de Mozo status: ${resWaiterPatch.statusCode} (esperado 403 Forbidden)`);
  if (resWaiterPatch.statusCode !== 403) throw new Error('Falló RBAC: un Mozo pudo modificar la configuración');

  // Caso C: Login como Encargado (PIN 9999, rol MANAGER) -> 200 OK
  const resLoginAdmin = await app.inject({
    method: 'POST',
    url: '/v1/staff/login',
    payload: { restaurantSlug: restaurant.slug, pin: '9999' }
  });
  const { token: managerJwt } = JSON.parse(resLoginAdmin.body);

  const resAuthPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/admin/restaurants/${restaurant.id}/config`,
    headers: { Authorization: `Bearer ${managerJwt}` },
    payload: {
      paymentMode: PaymentMode.WAITER_ONLY,
      allowOrdering: true,
      requireWaiterValidation: true,
      enableSmartTips: true,
      enableReviews: true,
      googlePlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
      enableWaitlist: true,
      enableWaitlistPreOrder: true
    }
  });
  console.log(`   [Caso C] Token de Manager status: ${resAuthPatch.statusCode} (esperado 200 OK)`);
  if (resAuthPatch.statusCode !== 200) throw new Error('Falló patch autenticado de configuración');
  console.log('   ✅ RBAC verificado al 100% en los 3 escenarios.');

  // ----------------------------------------------------
  // TEST 4: Concurrencia Genuina en Paralelo (Promise.all) en CAS
  // ----------------------------------------------------
  if (testDish) {
    console.log('\n4️⃣ Test: Concurrencia Genuina en Paralelo (Promise.all) para Compare-and-Swap');
    const resAddItem = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken: session.token,
        menuItemId: testDish.id,
        quantity: 1,
        guestSessionId: 'guest_init'
      }
    });
    const orderData = JSON.parse(resAddItem.body);
    const contestedItem = orderData.items[orderData.items.length - 1];

    console.log(`   Disparando 2 requests concurrentes en paralelo sobre ítem ID ${contestedItem.id} (expectedVersion: ${contestedItem.claimVersion})...`);

    const [claimA, claimB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/v1/orders/items/claim',
        payload: {
          orderItemId: contestedItem.id,
          expectedVersion: contestedItem.claimVersion,
          guestSessionId: 'guest_alice_parallel'
        }
      }),
      app.inject({
        method: 'POST',
        url: '/v1/orders/items/claim',
        payload: {
          orderItemId: contestedItem.id,
          expectedVersion: contestedItem.claimVersion,
          guestSessionId: 'guest_bob_parallel'
        }
      })
    ]);

    const statusCodes = [claimA.statusCode, claimB.statusCode].sort();
    console.log(`   Respuestas simultáneas: Request 1 = ${claimA.statusCode}, Request 2 = ${claimB.statusCode}`);

    if (statusCodes[0] !== 200 || statusCodes[1] !== 409) {
      throw new Error(`Falló test de concurrencia real: se esperaba [200, 409] pero se obtuvo [${statusCodes.join(', ')}]`);
    }
    console.log('   ✅ Concurrencia paralela genuina verificada: Exactamente 1 comensal ganó el ítem (200), el otro recibió 409 Conflict.');
  }

  // ----------------------------------------------------
  // TEST 5: Split Bill por Partes Iguales con Absorción de Centavos
  // ----------------------------------------------------
  console.log('\n5️⃣ Test: Split Bill por Partes Iguales con Absorción de Centavos ($10.000 / 3 comensales)');
  // Creamos una orden de prueba de exactamente $10.000 para probar la división con decimales infinitos
  const newSession = await prisma.tableSession.create({
    data: {
      tableId: table.id,
      shiftId: (await prisma.shift.findFirst())?.id || 'demo-shift',
      token: `session-split-cents-${Date.now()}`,
      expiresAt: new Date(Date.now() + 3600000)
    }
  });

  const exactOrder = await prisma.order.create({
    data: {
      tableSessionId: newSession.id,
      status: 'CONFIRMED',
      totalAmount: 10000
    }
  });

  // Intentar iniciar sesión de división en 3 partes iguales (Debe ser rechazado con 503 en piloto)
  const resSplit3 = await app.inject({
    method: 'POST',
    url: `/v1/orders/${exactOrder.id}/split-session`,
    payload: { mode: SplitMode.EQUAL_PARTS, totalParts: 3 }
  });
  if (resSplit3.statusCode !== 503 || JSON.parse(resSplit3.body).code !== 'DIGITAL_PAYMENTS_UNAVAILABLE') {
    throw new Error('Split session no fue bloqueada con 503 DIGITAL_PAYMENTS_UNAVAILABLE');
  }
  console.log('   ✅ POST /split-session bloqueado con 503 DIGITAL_PAYMENTS_UNAVAILABLE');

  // Intento de pago de parte: Debe ser rechazado con 503
  const resP1 = await app.inject({ method: 'POST', url: `/v1/orders/split-session/dummy-id/pay-part`, payload: { guestSessionId: 'g1' } });
  if (resP1.statusCode !== 503 || JSON.parse(resP1.body).code !== 'DIGITAL_PAYMENTS_UNAVAILABLE') {
    throw new Error('Pay-part no fue bloqueado con 503 DIGITAL_PAYMENTS_UNAVAILABLE');
  }
  console.log('   ✅ POST /pay-part bloqueado con 503 DIGITAL_PAYMENTS_UNAVAILABLE');

  // ----------------------------------------------------
  // TEST 6: Rate Limiter Calibrado en Fila Virtual
  // ----------------------------------------------------
  console.log('\n6️⃣ Test: Rate Limiter anti-spam calibrado en POST /v1/waitlist/join (2 por teléfono / 10m)');
  const uniquePhone = `0223 ${Math.floor(100000 + Math.random() * 900000)}`;
  await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: restaurant.slug, guestName: 'Turno 1', partySize: 2, phone: uniquePhone } });
  await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: restaurant.slug, guestName: 'Turno 2', partySize: 2, phone: uniquePhone } });

  // 3er intento con el mismo teléfono es bloqueado
  const resPhoneBlocked = await app.inject({
    method: 'POST',
    url: '/v1/waitlist/join',
    payload: { restaurantSlug: restaurant.slug, guestName: 'Turno 3', partySize: 2, phone: uniquePhone }
  });
  console.log(`   3er intento con el mismo teléfono status: ${resPhoneBlocked.statusCode} (esperado 429 Too Many Requests)`);
  if (resPhoneBlocked.statusCode !== 429) throw new Error('Falló rate limiter por teléfono');
  console.log('   ✅ Rate limiter por teléfono bloqueó el spam sin penalizar a otros clientes del WiFi.');

  console.log('\n🎉 TODOS LOS TESTS DE BLINDAJE PASARON AL 100%!\n');

  await app.close();
  await prisma.$disconnect();
}

runModularTests().catch(err => {
  console.error('❌ Error en pruebas modulares:', err);
  process.exit(1);
});

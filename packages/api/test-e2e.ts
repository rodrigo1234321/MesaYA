import { buildApp } from './src/index';
import { prisma } from './src/lib/prisma';
import { CallType, PaymentMethod, CallStatus } from '@mesaya/shared';

async function runTests() {
  console.log('🧪 Iniciando batería de pruebas E2E automáticas para MesaYA...');

  const app = await buildApp();
  await app.ready();

  // 1. Obtener restaurante y sesión de prueba
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: 'trattoria-del-puerto' },
    include: {
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
    throw new Error('No hay datos en la DB. Corre `npm run prisma:seed` primero.');
  }

  const table = restaurant.tables[0];
  const session = table.sessions[0];
  const token = session.token;

  console.log(`\n1️⃣ Test: Validar sesión de mesa [${table.label}] (${token})`);
  const resSession = await app.inject({
    method: 'GET',
    url: `/v1/sessions/${token}`
  });
  console.log(`   Status: ${resSession.statusCode} (esperado 200)`);
  if (resSession.statusCode !== 200) throw new Error('Falló validación de sesión');
  const sessionBody = JSON.parse(resSession.body);
  console.log(`   Restaurante: ${sessionBody.restaurant.name}, Mesa: ${sessionBody.table.label}`);

  console.log('\n2️⃣ Test: Crear llamado para pedir la cuenta (Mercado Pago)');
  const resCall = await app.inject({
    method: 'POST',
    url: '/v1/calls',
    payload: {
      sessionToken: token,
      type: CallType.BILL,
      paymentMethod: PaymentMethod.MERCADO_PAGO,
      origin: 'WEB_DIRECT'
    }
  });
  console.log(`   Status: ${resCall.statusCode} (esperado 201)`);
  if (resCall.statusCode !== 201) throw new Error(`Falló creación de llamado: ${resCall.body}`);
  const createdCall = JSON.parse(resCall.body);
  console.log(`   Llamado ID: ${createdCall.id}, Estado: ${createdCall.status}`);

  console.log('\n3️⃣ Test: Rate limiting anti-spam (intento de duplicar llamado sin resolver)');
  const resDuplicate = await app.inject({
    method: 'POST',
    url: '/v1/calls',
    payload: {
      sessionToken: token,
      type: CallType.WAITER
    }
  });
  console.log(`   Status: ${resDuplicate.statusCode} (esperado 429 Too Many Requests)`);
  if (resDuplicate.statusCode !== 429) throw new Error('Falló el rate limiting anti-spam');

  console.log('\n4️⃣ Test: Mozo marca llamado como "IN_PROGRESS" (En camino)');
  const resProgress = await app.inject({
    method: 'PATCH',
    url: `/v1/calls/${createdCall.id}`,
    payload: { status: CallStatus.IN_PROGRESS }
  });
  console.log(`   Status: ${resProgress.statusCode} (esperado 200)`);
  if (resProgress.statusCode !== 200) throw new Error('Falló actualización a IN_PROGRESS');

  console.log('\n5️⃣ Test: Mozo marca llamado como "RESOLVED" (Atendido)');
  const resResolved = await app.inject({
    method: 'PATCH',
    url: `/v1/calls/${createdCall.id}`,
    payload: { status: CallStatus.RESOLVED }
  });
  console.log(`   Status: ${resResolved.statusCode} (esperado 200)`);
  if (resResolved.statusCode !== 200) throw new Error('Falló resolución de llamado');

  console.log('\n6️⃣ Test: Apertura de nuevo turno con rotación de tokens UUID');
  const resShift = await app.inject({
    method: 'POST',
    url: '/v1/shifts/open',
    payload: { restaurantId: restaurant.id }
  });
  console.log(`   Status: ${resShift.statusCode} (esperado 201)`);
  if (resShift.statusCode !== 201) throw new Error('Falló apertura de turno');

  console.log('\n7️⃣ Test: Verificar que el token anterior devuelve 410 Gone');
  const resExpired = await app.inject({
    method: 'GET',
    url: `/v1/sessions/${token}`
  });
  console.log(`   Status: ${resExpired.statusCode} (esperado 410 Gone)`);
  if (resExpired.statusCode !== 410) throw new Error('El token viejo no fue invalidado correctamente');

  console.log('\n✨ TODOS LOS TESTS E2E PASARON EXITOSAMENTE CON 100% DE EFECTIVIDAD!\n');

  await app.close();
  await prisma.$disconnect();
}

runTests().catch(err => {
  console.error('❌ Error en tests E2E:', err);
  process.exit(1);
});

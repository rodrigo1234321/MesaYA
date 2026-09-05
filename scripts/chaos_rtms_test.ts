import { prisma } from '../packages/api/src/lib/prisma';
import { fsmService } from '../packages/api/src/services/fsm.service';
import { floorPlanService } from '../packages/api/src/services/floorplan.service';
import { RTMSAnalyticsService } from '../packages/api/src/services/rtms-analytics.service';
import {
  TableFSMState,
  SignalSource,
  FloorPlanUpdateSchema,
  TapStateRequestSchema
} from '@mesaya/shared';

async function runChaosTests() {
  console.log('🔥 [CHAOS TEST SUITE] Iniciando pruebas de estrés y ataques de límite...\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(name: string, condition: boolean, extra?: any) {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passedCount++;
    } else {
      console.error(`  ❌ [FAIL] ${name}`, extra || '');
      failedCount++;
    }
  }

  // 1. Configuración de entorno de prueba
  const restaurant = await prisma.restaurant.findFirst({
    where: { slug: 'trattoria-del-puerto' },
    include: { tables: true }
  });

  if (!restaurant || restaurant.tables.length === 0) {
    console.error('❌ Restaurante o mesas no encontradas en DB');
    process.exit(1);
  }

  const table = restaurant.tables[0];
  console.log(`👉 Restaurante: ${restaurant.name} | Mesa de prueba: ${table.label} (${table.id})\n`);

  // =========================================================================
  // TEST 1: Intento de Inyección SQL y XSS en Etiquetas y Notas
  // =========================================================================
  console.log('--- Test 1: Sanitización e Inyección SQL / XSS ---');
  try {
    const maliciousPayload = "'; DROP TABLE \"Table\"; -- <script>alert('xss')</script>";
    const tapRes = await fsmService.attemptTransition({
      tableId: table.id,
      toState: TableFSMState.AVAILABLE,
      source: SignalSource.MANAGER_OVERRIDE,
      trigger: maliciousPayload
    });

    const event = await prisma.tableStateEvent.findFirst({
      where: { id: tapRes.stateEventId }
    });

    // La BD debe permanecer intacta y el trigger guardado como string escapado
    const tableCount = await prisma.table.count();
    assert('Inyección SQL neutralizada y tablas intactas', tableCount > 0 && event?.trigger === maliciousPayload);
  } catch (err: any) {
    assert('Error inesperado en Test 1', false, err.message);
  }

  // =========================================================================
  // TEST 2: Mesa Inexistente / UUID Falso (Debe arrojar 404 TABLE_NOT_FOUND)
  // =========================================================================
  console.log('\n--- Test 2: Validación de UUID Inexistente ---');
  try {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await fsmService.handleTapAction(fakeId, 'next');
    assert('Debe fallar al buscar mesa inexistente', false);
  } catch (err: any) {
    assert('Arroja 404 TABLE_NOT_FOUND ante mesa inexistente', err.statusCode === 404 && err.code === 'TABLE_NOT_FOUND');
  }

  // =========================================================================
  // TEST 3: Acción 'skip_to' sin targetState (Debe arrojar 400)
  // =========================================================================
  console.log('\n--- Test 3: Validación de Parámetros Faltantes ---');
  try {
    await fsmService.handleTapAction(table.id, 'skip_to', undefined);
    assert('Debe fallar al omitir targetState', false);
  } catch (err: any) {
    assert('Arroja 400 MISSING_TARGET_STATE ante targetState nulo', err.statusCode === 400 && err.code === 'MISSING_TARGET_STATE');
  }

  // =========================================================================
  // TEST 4: Zod Validation en Floor Plan Update (Valores Extremos / Formas Inválidas)
  // =========================================================================
  console.log('\n--- Test 4: Validación Zod de Formas y Coordenadas ---');
  const invalidShapeResult = FloorPlanUpdateSchema.safeParse({
    tables: [{ id: table.id, posX: 100, posY: 100, shape: 'OCTAGON_HEX' }]
  });
  assert('Rechaza forma geométrica inválida (OCTAGON_HEX)', !invalidShapeResult.success);

  const invalidRotationResult = FloorPlanUpdateSchema.safeParse({
    tables: [{ id: table.id, posX: 100, posY: 100, rotation: 500 }]
  });
  assert('Rechaza rotación mayor a 360 grados', !invalidRotationResult.success);

  // =========================================================================
  // TEST 5: Resiliencia de Analytics con Fechas Invertidas (from > to)
  // =========================================================================
  console.log('\n--- Test 5: Resiliencia de Analytics ante Fechas Invertidas ---');
  try {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // from = mañana, to = ayer
    const summary = await RTMSAnalyticsService.getAnalyticsSummary(restaurant.id, tomorrow, yesterday);
    assert('Summary no explota ante rango invertido y retorna números válidos', !isNaN(summary.revPASH) && summary.totalSessions === 0);

    const phases = await RTMSAnalyticsService.getPhaseMetrics(restaurant.id, tomorrow, yesterday);
    assert('Phases no explota ante rango invertido y provee fallbacks válidos', phases.kitchenPrepAvgMinutes > 0);
  } catch (err: any) {
    assert('Error inesperado en Test 5', false, err.message);
  }

  // =========================================================================
  // TEST 6: Ráfaga de Rotación Rápida (10 ciclos completos consecutivos)
  // =========================================================================
  console.log('\n--- Test 6: Resistencia a 10 Ciclos Gastronómicos Consecutivos ---');
  try {
    let loopSuccess = true;
    for (let i = 1; i <= 10; i++) {
      await fsmService.handleTapAction(table.id, 'next'); // AVAILABLE -> OCCUPIED
      await fsmService.handleTapAction(table.id, 'next'); // OCCUPIED -> KITCHEN
      await fsmService.handleTapAction(table.id, 'next'); // KITCHEN -> EATING
      await fsmService.handleTapAction(table.id, 'next'); // EATING -> TO_CLEAN
      await fsmService.handleTapAction(table.id, 'next'); // TO_CLEAN -> AVAILABLE
    }

    const currentTable = await prisma.table.findUnique({ where: { id: table.id } });
    const closedSessionsCount = await prisma.occupancySession.count({
      where: { tableId: table.id, cleanedAt: { not: null } }
    });

    assert('10 ciclos completados sin desincronización, mesa termina en AVAILABLE', currentTable?.currentState === TableFSMState.AVAILABLE);
    assert('10 OccupancySessions cerradas con métricas calculadas', closedSessionsCount >= 10);
  } catch (err: any) {
    assert('Error en rotación rápida', false, err.message);
  }

  // =========================================================================
  // TEST 7: Creación Dinámica de Nueva Mesa desde el Editor de Plano
  // =========================================================================
  console.log('\n--- Test 7: Guardado de Nuevas Mesas desde el Editor (new-*) ---');
  try {
    const tempNewId = `new-chaos-${Date.now()}`;
    const customLabel = `Mesa Chaos ${Date.now() % 1000}`;

    await floorPlanService.updateFloorPlan(restaurant.id, {
      tables: [
        {
          id: tempNewId,
          label: customLabel,
          posX: 340,
          posY: 420,
          width: 90,
          height: 90,
          shape: 'ROUND',
          capacity: 6
        }
      ]
    });

    const createdTable = await prisma.table.findFirst({
      where: { restaurantId: restaurant.id, label: customLabel }
    });

    assert('Mesa creada exitosamente en DB desde payload new-*', !!createdTable && createdTable.capacity === 6 && createdTable.shape === 'ROUND');

    // Limpieza de mesa temporal
    if (createdTable) {
      await prisma.table.delete({ where: { id: createdTable.id } });
    }
  } catch (err: any) {
    assert('Error en Test 7', false, err.message);
  }

  // =========================================================================
  // RESUMEN FINAL
  // =========================================================================
  console.log('\n=============================================');
  console.log(`🏁 RESULTADO CHAOS TESTS: ${passedCount} APROBADOS | ${failedCount} FALLADOS`);
  console.log('=============================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runChaosTests()
  .catch((err) => {
    console.error('Fatal Chaos error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

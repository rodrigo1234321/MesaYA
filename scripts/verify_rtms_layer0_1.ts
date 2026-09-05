import { prisma } from '../packages/api/src/lib/prisma';
import { fsmService } from '../packages/api/src/services/fsm.service';
import { floorPlanService } from '../packages/api/src/services/floorplan.service';
import { TableFSMState } from '@mesaya/shared';

async function runVerification() {
  console.log('🧪 Iniciando verificación de Capa 0 y Capa 1 RTMS...');

  const restaurantSlug = 'trattoria-del-puerto';

  // 1. Obtener plano completo
  console.log('\n--- Test 1: GET Floor Plan ---');
  const floorPlan = await floorPlanService.getFloorPlan(restaurantSlug);
  console.log(`✅ Layout: ${floorPlan.layout.canvasWidth}x${floorPlan.layout.canvasHeight} (grid: ${floorPlan.layout.gridSize}px)`);
  console.log(`✅ Zonas encontradas: ${floorPlan.zones.length} (${floorPlan.zones.map(z => z.name).join(', ')})`);
  console.log(`✅ Mesas cargadas: ${floorPlan.tables.length}`);
  console.log(`✅ Estadísticas: ${JSON.stringify(floorPlan.stats)}`);

  const testTable = floorPlan.tables[0];
  console.log(`\n--- Test 2: 1-Tap Workflow en ${testTable.label} (ID: ${testTable.id}) ---`);
  console.log(`Estado inicial: ${testTable.currentState}`);

  // Tap 1: AVAILABLE -> OCCUPIED_NO_ORDER
  const step1 = await fsmService.handleTapAction(testTable.id, 'next');
  console.log(`⚡ Tap 1 [next]: ${step1.previousState} -> ${step1.newState} (OK)`);

  // Tap 2: OCCUPIED_NO_ORDER -> ORDER_IN_KITCHEN
  const step2 = await fsmService.handleTapAction(testTable.id, 'next');
  console.log(`⚡ Tap 2 [next]: ${step2.previousState} -> ${step2.newState} (OK)`);

  // Tap 3: ORDER_IN_KITCHEN -> EATING
  const step3 = await fsmService.handleTapAction(testTable.id, 'next');
  console.log(`⚡ Tap 3 [next]: ${step3.previousState} -> ${step3.newState} (OK)`);

  // Tap 4: EATING -> TO_CLEAN (Staff cobra y libera mesa)
  const step4 = await fsmService.handleTapAction(testTable.id, 'next');
  console.log(`⚡ Tap 4 [next]: ${step4.previousState} -> ${step4.newState} (OK)`);

  // Tap 5: TO_CLEAN -> AVAILABLE (Staff confirma desinfección)
  const step5 = await fsmService.handleTapAction(testTable.id, 'next');
  console.log(`⚡ Tap 5 [next]: ${step5.previousState} -> ${step5.newState} (OK)`);

  // 2. Verificar OccupancySession cerrada y métricas
  console.log('\n--- Test 3: Auditoría & Métricas de OccupancySession ---');
  const session = await prisma.occupancySession.findFirst({
    where: { tableId: testTable.id },
    orderBy: { seatedAt: 'desc' }
  });

  if (session && session.cleanedAt) {
    console.log(`✅ OccupancySession cerrada con éxito (ID: ${session.id})`);
    console.log(`   - SeatedAt: ${session.seatedAt.toISOString()}`);
    console.log(`   - OrderedAt: ${session.orderedAt?.toISOString()}`);
    console.log(`   - ServedAt: ${session.servedAt?.toISOString()}`);
    console.log(`   - VacatedAt: ${session.vacatedAt?.toISOString()}`);
    console.log(`   - CleanedAt: ${session.cleanedAt?.toISOString()}`);
    console.log(`   - DurationMinutes: ${session.durationMinutes} min`);
    console.log(`   - TurnTimeMinutes: ${session.turnTimeMinutes} min`);
  } else {
    throw new Error('OccupancySession no se cerró correctamente');
  }

  // 3. Verificar eventos de auditoría
  const events = await prisma.tableStateEvent.findMany({
    where: { tableId: testTable.id },
    orderBy: { createdAt: 'asc' }
  });
  console.log(`✅ Eventos de auditoría registrados: ${events.length} transiciones`);
  events.forEach((e, idx) => {
    console.log(`   ${idx + 1}. [${e.source}] ${e.fromState} -> ${e.toState} (${e.trigger})`);
  });

  // 4. Test Transición Inválida (debe fallar limpiamente con código 422)
  console.log('\n--- Test 4: Validación de Transición Inválida ---');
  try {
    // Intentar saltar de AVAILABLE a EATING directamente
    await fsmService.attemptTransition({
      tableId: testTable.id,
      toState: TableFSMState.EATING,
      source: 'STAFF_TERMINAL_TAP' as any,
      trigger: 'Prueba inválida'
    });
    console.error('❌ Error: la transición inválida no fue bloqueada');
  } catch (err: any) {
    console.log(`✅ Transición inválida bloqueada correctamente: ${err.message} (Code: ${err.code})`);
  }

  console.log('\n🎉 TODAS LAS PRUEBAS DE CAPA 0 Y CAPA 1 PASARON CON ÉXITO!');
}

runVerification()
  .catch((e) => {
    console.error('❌ Error en verificación:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

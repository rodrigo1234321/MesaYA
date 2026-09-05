import { buildApp } from '../packages/api/src/index';
import { prisma } from '../packages/api/src/lib/prisma';
import { PaymentMode, SplitMode, TableFSMState, WaitlistStatus, OrderStatus } from '@mesaya/shared';

interface ModuleReportItem {
  module: string;
  name: string;
  expected: string;
  observed: string;
  status: 'PASS' | 'FAIL';
  details: string;
}

const report: ModuleReportItem[] = [];

function recordResult(module: string, name: string, expected: string, observed: string, passed: boolean, details: string) {
  report.push({
    module,
    name,
    expected,
    observed,
    status: passed ? 'PASS' : 'FAIL',
    details
  });
  const icon = passed ? '✅' : '❌';
  console.log(`   ${icon} [${module}] ${name}: ${details}`);
}

async function runWaiterShiftSimulation() {
  console.log('======================================================================');
  console.log('🍽️  SIMULACIÓN INTEGRAL DE TURNO DE MOZO & VALIDACIÓN DE 6 MÓDULOS');
  console.log('======================================================================\n');

  const app = await buildApp();
  await app.ready();

  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: 'trattoria-del-puerto' },
    include: {
      categories: { include: { items: true } },
      tables: true,
      moduleConfig: true
    }
  });

  if (!restaurant) throw new Error('No se encontró el restaurante "trattoria-del-puerto".');

  const dish1 = restaurant.categories[0]?.items[0];
  const dish2 = restaurant.categories[0]?.items[1] || dish1;
  const table1 = restaurant.tables[0];
  const table2 = restaurant.tables[1] || restaurant.tables[0];
  const table3 = restaurant.tables[2] || restaurant.tables[0];

  console.log(`Restaurante: ${restaurant.name} (ID: ${restaurant.id})`);
  console.log(`Mesas activas para la simulación: ${table1.label}, ${table2.label}, ${table3.label}`);
  console.log(`Platos de prueba: "${dish1?.name}" ($${dish1?.price}), "${dish2?.name}" ($${dish2?.price})\n`);

  // ------------------------------------------------------------------
  // INICIO DE TURNO: Login de Mozo y Encargado
  // ------------------------------------------------------------------
  console.log('------------------------------------------------------------------');
  console.log('🧑‍🍳 PASO 0: Inicio de Turno y Autenticación de Roles');
  console.log('------------------------------------------------------------------');

  // Mozo Mateo (PIN 1234)
  const resLoginWaiter = await app.inject({
    method: 'POST',
    url: '/v1/staff/login',
    payload: { restaurantSlug: restaurant.slug, pin: '1234' }
  });
  const waiterData = JSON.parse(resLoginWaiter.body);
  const waiterToken = waiterData.token;
  console.log(`• Mozo logueado: ${waiterData.staffUser.name} (Rol: ${waiterData.staffUser.role})`);

  // Encargado Gonzalo (PIN 9999)
  const resLoginAdmin = await app.inject({
    method: 'POST',
    url: '/v1/staff/login',
    payload: { restaurantSlug: restaurant.slug, pin: '9999' }
  });
  const adminData = JSON.parse(resLoginAdmin.body);
  const adminToken = adminData.token;
  console.log(`• Encargado logueado: ${adminData.staffUser.name} (Rol: ${adminData.staffUser.role})\n`);

  // Helper para actualizar configuración como Encargado
  const updateConfig = async (patch: any) => {
    return await app.inject({
      method: 'PATCH',
      url: `/v1/admin/restaurants/${restaurant.id}/config`,
      headers: { Authorization: `Bearer ${adminToken}` },
      payload: patch
    });
  };

  // ==================================================================
  // MÓDULO 5: Fila Virtual Inteligente & Pre-Order en Espera
  // ==================================================================
  console.log('------------------------------------------------------------------');
  console.log('📋 MÓDULO 5: Fila Virtual Inteligente & Pre-Order en Espera');
  console.log('------------------------------------------------------------------');

  // 5.1 Fila Activa con Pre-Order
  await updateConfig({ enableWaitlist: true, enableWaitlistPreOrder: true });
  const uniquePhone1 = `0223 ${Math.floor(100000 + Math.random() * 900000)}`;

  const resJoinWaitlist = await app.inject({
    method: 'POST',
    url: '/v1/waitlist/join',
    payload: {
      restaurantSlug: restaurant.slug,
      guestName: 'Familia Gómez',
      partySize: 4,
      phone: uniquePhone1,
      preOrderData: {
        dishes: [{ id: dish1.id, name: dish1.name, quantity: 2 }]
      }
    }
  });
  const waitlistEntry = JSON.parse(resJoinWaitlist.body);
  recordResult(
    'Módulo 5',
    'Fila Virtual Activa + Pre-Order',
    'Status 200/201 con datos de espera y pre-order',
    `Status ${resJoinWaitlist.statusCode}, ID: ${waitlistEntry.id}`,
    resJoinWaitlist.statusCode === 200 || resJoinWaitlist.statusCode === 201,
    'El comensal se unió a la fila en vereda y guardó su pedido anticipado.'
  );

  // Mozo llama a la familia y la sienta
  const resCallGuest = await app.inject({
    method: 'PATCH',
    url: `/v1/staff/waitlist/${waitlistEntry.id}/call`,
    headers: { Authorization: `Bearer ${waiterToken}` }
  });
  const resSeatGuest = await app.inject({
    method: 'PATCH',
    url: `/v1/staff/waitlist/${waitlistEntry.id}/seat`,
    headers: { Authorization: `Bearer ${waiterToken}` },
    payload: { tableId: table3.id }
  });
  const seatedEntry = JSON.parse(resSeatGuest.body);
  recordResult(
    'Módulo 5',
    'Mozo llama y sienta comensal de la fila',
    'Status SEATED',
    `Status: ${seatedEntry.status}`,
    seatedEntry.status === WaitlistStatus.SEATED,
    'El mozo atendió la fila en puerta y sentó a los comensales.'
  );

  // 5.2 Fila Desactivada por el Administrador
  await updateConfig({ enableWaitlist: false });
  const uniquePhone2 = `0223 ${Math.floor(100000 + Math.random() * 900000)}`;
  const resJoinDisabled = await app.inject({
    method: 'POST',
    url: '/v1/waitlist/join',
    payload: {
      restaurantSlug: restaurant.slug,
      guestName: 'Pareja López',
      partySize: 2,
      phone: uniquePhone2
    }
  });
  recordResult(
    'Módulo 5',
    'Interruptor Fila Virtual OFF',
    'Rechazo 500/400 (Fila no activa)',
    `Status: ${resJoinDisabled.statusCode}`,
    resJoinDisabled.statusCode >= 400,
    'Al apagar el interruptor en el Dashboard, la fila en vereda queda bloqueada.'
  );

  // ==================================================================
  // MÓDULO 2: Comandas & Carrito en Mesa
  // ==================================================================
  console.log('\n------------------------------------------------------------------');
  console.log('🛒 MÓDULO 2: Comandas & Carrito en Mesa ("Food-First" vs Comandas)');
  console.log('------------------------------------------------------------------');

  // Crear sesión de mesa fresca para Mesa 1
  const session1Res = await app.inject({
    method: 'GET',
    url: `/v1/sessions/${restaurant.slug}/${encodeURIComponent(table1.label)}`
  });
  const session1 = JSON.parse(session1Res.body);
  const sessionToken1 = session1.token;

  // 2.1 Interruptor allowOrdering: FALSE (Carta Food-First informativa)
  await updateConfig({ allowOrdering: false });
  const resAddItemDisabled = await app.inject({
    method: 'POST',
    url: '/v1/orders/items',
    payload: {
      sessionToken: sessionToken1,
      menuItemId: dish1.id,
      quantity: 1,
      guestSessionId: 'guest_test'
    }
  });
  recordResult(
    'Módulo 2',
    'Carta Food-First Solo Informativa (allowOrdering: false)',
    'Error bloqueante de adición a comanda digital',
    `Status: ${resAddItemDisabled.statusCode}`,
    resAddItemDisabled.statusCode >= 400,
    'El cliente no puede agregar ítems al carrito: la carta es puramente informativa.'
  );

  // 2.2 Interruptor allowOrdering: TRUE con Doble Control Mozo (requireWaiterValidation: true)
  await updateConfig({ allowOrdering: true, requireWaiterValidation: true });
  const resAddItem1 = await app.inject({
    method: 'POST',
    url: '/v1/orders/items',
    payload: {
      sessionToken: sessionToken1,
      menuItemId: dish1.id,
      quantity: 2,
      guestSessionId: 'guest_test'
    }
  });
  const orderWithItem = JSON.parse(resAddItem1.body);

  // El comensal envía la comanda
  const resSubmitWithValidation = await app.inject({
    method: 'POST',
    url: '/v1/orders/submit',
    payload: { sessionToken: sessionToken1 }
  });
  const submittedOrder = JSON.parse(resSubmitWithValidation.body);
  recordResult(
    'Módulo 2',
    'Doble Control Mozo (requireWaiterValidation: true)',
    'Status PENDING_VALIDATION',
    `Status: ${submittedOrder.status}`,
    submittedOrder.status === OrderStatus.PENDING_VALIDATION,
    'La orden NO va directo a cocina: espera a que el mozo se acerque a validar.'
  );

  // El mozo Mateo valida la comanda en la mesa
  const resValidate = await app.inject({
    method: 'POST',
    url: `/v1/staff/orders/${submittedOrder.id}/validate`,
    headers: { Authorization: `Bearer ${waiterToken}` }
  });
  const validatedOrder = JSON.parse(resValidate.body);
  recordResult(
    'Módulo 2',
    'Validación presencial del Mozo',
    'Status IN_KITCHEN',
    `Status: ${validatedOrder.status}`,
    validatedOrder.status === OrderStatus.IN_KITCHEN,
    'El mozo tocó "Validar comanda" en su panel y el pedido entró a cocina.'
  );

  // 2.3 Carga Directa por Mozo (Toma de pedidos verbales)
  const resStaffDirectOrder = await app.inject({
    method: 'POST',
    url: `/v1/staff/tables/${table2.id}/orders/items`,
    headers: { Authorization: `Bearer ${waiterToken}` },
    payload: {
      menuItemId: dish2.id,
      quantity: 1,
      notes: 'Punto jugoso (pedido tomado verbalmente por el mozo)'
    }
  });
  const staffDirectData = JSON.parse(resStaffDirectOrder.body);
  recordResult(
    'Módulo 2',
    'Carga Directa de Comanda por Mozo en Salón',
    'Status 201 e ingreso directo IN_KITCHEN',
    `Status ${resStaffDirectOrder.statusCode}, Order status: ${staffDirectData.status}`,
    resStaffDirectOrder.statusCode === 201 && staffDirectData.status === OrderStatus.IN_KITCHEN,
    'El mozo tomó pedido verbal en Mesa 2 y lo cargó directamente a cocina sin papel.'
  );

  // Verificación en KDS de Cocina
  const resKitchenOrders = await app.inject({
    method: 'GET',
    url: `/v1/staff/restaurants/${restaurant.id}/kitchen-orders`,
    headers: { Authorization: `Bearer ${waiterToken}` }
  });
  const kitchenData = JSON.parse(resKitchenOrders.body);
  recordResult(
    'Módulo 2',
    'Pantalla KDS de Cocina Unificada',
    'Listado de comandas activas en preparación',
    `Comandas en cocina: ${kitchenData.orders?.length || 0}`,
    kitchenData.orders && kitchenData.orders.length >= 2,
    'El cocinero ve centralizados los pedidos del QR y los cargados por el mozo.'
  );

  // ==================================================================
  // MÓDULO 3: Smart Upselling & Maridajes Sugeridos
  // ==================================================================
  console.log('\n------------------------------------------------------------------');
  console.log('🍷 MÓDULO 3: Smart Upselling (Sugerencias Automáticas de Maridajes)');
  console.log('------------------------------------------------------------------');

  // 3.1 Upsell Activo (enableUpsell: true)
  await updateConfig({ enableUpsell: true });
  const resUpsellEnabled = await app.inject({
    method: 'GET',
    url: `/v1/restaurants/${restaurant.slug}/upsell?itemId=${dish1.id}`
  });
  const upsellData = JSON.parse(resUpsellEnabled.body);
  recordResult(
    'Módulo 3',
    'Smart Upsell Activo (enableUpsell: true)',
    'enabled: true con lista de sugerencias de maridaje',
    `enabled: ${upsellData.enabled}, sugerencias: ${upsellData.suggestions?.length || 0}`,
    upsellData.enabled === true && upsellData.suggestions?.length > 0,
    `Al pedir "${dish1.name}", el sistema sugiere automáticamente maridajes complementarios.`
  );

  // 3.2 Upsell Desactivado (enableUpsell: false)
  await updateConfig({ enableUpsell: false });
  const resUpsellDisabled = await app.inject({
    method: 'GET',
    url: `/v1/restaurants/${restaurant.slug}/upsell?itemId=${dish1.id}`
  });
  const upsellDisabledData = JSON.parse(resUpsellDisabled.body);
  recordResult(
    'Módulo 3',
    'Smart Upsell Desactivado (enableUpsell: false)',
    'enabled: false, suggestions: []',
    `enabled: ${upsellDisabledData.enabled}, sugerencias: ${upsellDisabledData.suggestions?.length || 0}`,
    upsellDisabledData.enabled === false && upsellDisabledData.suggestions?.length === 0,
    'Al apagar el módulo, no se realizan sugerencias automáticas.'
  );

  // ==================================================================
  // MÓDULO 1: Modalidad de Cobro & Split Bill
  // ==================================================================
  console.log('\n------------------------------------------------------------------');
  console.log('💳 MÓDULO 1: Modalidad de Cobro & Dividir Cuenta (Split Bill)');
  console.log('------------------------------------------------------------------');

  // 5.1 Modo de Pago Solo Mozo Presencial (PaymentMode.WAITER_ONLY)
  await updateConfig({ paymentMode: PaymentMode.WAITER_ONLY, allowSplitBill: true });
  const resBillCall = await app.inject({
    method: 'POST',
    url: '/v1/calls',
    payload: {
      sessionToken: sessionToken1,
      type: 'BILL',
      paymentMethod: 'CARD',
      note: 'Cobro con POS en mesa'
    }
  });
  const billCall = JSON.parse(resBillCall.body);
  recordResult(
    'Módulo 1',
    'Cobro en Salón Solo Mozo Presencial (WAITER_ONLY)',
    'Llamado tipo BILL con POS recibido por el mozo',
    `Call ID: ${billCall.id}, PaymentMethod: ${billCall.paymentMethod}`,
    resBillCall.statusCode === 201 && billCall.type === 'BILL',
    'El comensal pide la cuenta y le avisa al mozo que lleve el posnet a la mesa.'
  );

  // 5.2 Dividir Cuenta (Split Bill) Activo
  const splitSessionRes = await app.inject({
    method: 'POST',
    url: `/v1/orders/${submittedOrder.id}/split-session`,
    payload: { mode: SplitMode.EQUAL_PARTS, totalParts: 2 }
  });
  const splitSession = JSON.parse(splitSessionRes.body);
  recordResult(
    'Módulo 1',
    'Dividir Cuenta (Piloto: bloqueado 503)',
    'Split Bill denegado con 503 DIGITAL_PAYMENTS_UNAVAILABLE',
    `Status: ${splitSessionRes.statusCode}, Code: ${splitSession.code}`,
    splitSessionRes.statusCode === 503 && splitSession.code === 'DIGITAL_PAYMENTS_UNAVAILABLE',
    'En el piloto presencial, la división digital de cuenta está deshabilitada por seguridad.'
  );

  // 5.3 Dividir Cuenta Desactivado (allowSplitBill: false) también 503
  await updateConfig({ allowSplitBill: false });
  const resSplitDisabled = await app.inject({
    method: 'POST',
    url: `/v1/orders/${staffDirectData.id}/split-session`,
    payload: { mode: SplitMode.EQUAL_PARTS, totalParts: 2 }
  });
  const splitDisabledBody = JSON.parse(resSplitDisabled.body);
  recordResult(
    'Módulo 1',
    'Dividir Cuenta Desactivado (allowSplitBill: false)',
    'Error 503 DIGITAL_PAYMENTS_UNAVAILABLE',
    `Status: ${resSplitDisabled.statusCode}, Code: ${splitDisabledBody.code}`,
    resSplitDisabled.statusCode === 503 && splitDisabledBody.code === 'DIGITAL_PAYMENTS_UNAVAILABLE',
    'El intento fue denegado con 503 DIGITAL_PAYMENTS_UNAVAILABLE.'
  );

  // ==================================================================
  // MÓDULO 4: Propinas & Reseñas Google
  // ==================================================================
  console.log('\n------------------------------------------------------------------');
  console.log('⭐ MÓDULO 4: Smart Tips & Enlace Ético a Google Maps');
  console.log('------------------------------------------------------------------');

  const testGooglePlaceId = 'ChIJN1t_tDeuEmsRUsoyG83frY4';
  await updateConfig({
    enableSmartTips: true,
    suggestedTipPercentages: [10, 15, 20],
    googlePlaceId: testGooglePlaceId,
    enableReviews: true
  });

  // Comprobar que la configuración pública expone las propinas y el deep link
  const resPublicConfig = await app.inject({
    method: 'GET',
    url: `/v1/restaurants/${restaurant.slug}/config`
  });
  const publicConfig = JSON.parse(resPublicConfig.body);
  const tipsOk = publicConfig.enableSmartTips === true &&
                 Array.isArray(publicConfig.suggestedTipPercentages) &&
                 publicConfig.suggestedTipPercentages.length === 3 &&
                 publicConfig.googlePlaceId === testGooglePlaceId;

  recordResult(
    'Módulo 4',
    'Smart Tips con Porcentajes (10%, 15%, 20%) & Google Place ID',
    'enableSmartTips: true, Google Deep Link activo',
    `SmartTips: ${publicConfig.enableSmartTips}, PlaceID: ${publicConfig.googlePlaceId}`,
    tipsOk,
    'El comensal ve la sugerencia de propinas personalizadas y el deep link a Google Maps.'
  );

  // ==================================================================
  // MÓDULO 6: MesaYA Rewards (Fidelización)
  // ==================================================================
  console.log('\n------------------------------------------------------------------');
  console.log('🎁 MÓDULO 6: MesaYA Rewards (Fidelización por Consumo)');
  console.log('------------------------------------------------------------------');

  // 6.1 Rewards Activo: 1 punto cada $100
  await updateConfig({ enableRewards: true, pointsPerHundredPesos: 1 });
  const testAmount = 24500; // $24.500 consumidos
  const resRewardsEnabled = await app.inject({
    method: 'GET',
    url: `/v1/restaurants/${restaurant.slug}/rewards/calculate?amount=${testAmount}`
  });
  const rewardsData = JSON.parse(resRewardsEnabled.body);
  const expectedPoints = Math.floor(testAmount / 100);
  recordResult(
    'Módulo 6',
    'MesaYA Rewards Activo (1 punto cada $100)',
    `Cálculo exacto: ${expectedPoints} puntos para $${testAmount}`,
    `Puntos otorgados: ${rewardsData.points}, enabled: ${rewardsData.enabled}`,
    rewardsData.enabled === true && rewardsData.points === expectedPoints,
    `El cliente acumuló ${rewardsData.points} puntos automáticos para canjear en futuras visitas.`
  );

  // 6.2 Rewards Desactivado
  await updateConfig({ enableRewards: false });
  const resRewardsDisabled = await app.inject({
    method: 'GET',
    url: `/v1/restaurants/${restaurant.slug}/rewards/calculate?amount=${testAmount}`
  });
  const rewardsDisabledData = JSON.parse(resRewardsDisabled.body);
  recordResult(
    'Módulo 6',
    'MesaYA Rewards Desactivado',
    'enabled: false, puntos: 0',
    `enabled: ${rewardsDisabledData.enabled}, puntos: ${rewardsDisabledData.points}`,
    rewardsDisabledData.enabled === false && rewardsDisabledData.points === 0,
    'Al apagar la fidelización, el sistema no calcula ni otorga puntos.'
  );

  // ==================================================================
  // CIERRE DE TURNO: Limpieza de Mesas y Liquidación
  // ==================================================================
  console.log('\n------------------------------------------------------------------');
  console.log('🏁 PASO FINAL: Cierre de Turno del Mozo en Salón');
  console.log('------------------------------------------------------------------');

  // Mozo atiende el llamado de la cuenta
  await app.inject({
    method: 'PATCH',
    url: `/v1/calls/${billCall.id}`,
    headers: { Authorization: `Bearer ${waiterToken}` },
    payload: { status: 'RESOLVED' }
  });

  // Mozo marca la mesa como servida
  await app.inject({
    method: 'PATCH',
    url: `/v1/staff/orders/${submittedOrder.id}/status`,
    headers: { Authorization: `Bearer ${waiterToken}` },
    payload: { status: 'SERVED' }
  });

  // Mozo avanza la mesa a TO_CLEAN y luego AVAILABLE en el plano Konva
  const resTap1 = await app.inject({
    method: 'POST',
    url: `/v1/tables/${table1.id}/state/tap`,
    headers: { Authorization: `Bearer ${waiterToken}` },
    payload: { action: 'skip_to', targetState: TableFSMState.TO_CLEAN, trigger: 'Comensales se retiraron' }
  });
  const resTap2 = await app.inject({
    method: 'POST',
    url: `/v1/tables/${table1.id}/state/tap`,
    headers: { Authorization: `Bearer ${waiterToken}` },
    payload: { action: 'next', trigger: 'Mesa desinfectada para el próximo turno' }
  });
  const finalTableState = JSON.parse(resTap2.body);

  recordResult(
    'Salón FSM',
    'Cierre y desinfección de mesa (1-tap)',
    'Estado final AVAILABLE',
    `Estado actual: ${finalTableState.newState}`,
    finalTableState.newState === TableFSMState.AVAILABLE,
    'La mesa quedó lista y disponible para el siguiente comensal.'
  );

  console.log('\n======================================================================');
  console.log('📊 RESUMEN EJECUTIVO DE LA EVALUACIÓN REAL:');
  console.log('======================================================================');
  const total = report.length;
  const passed = report.filter(r => r.status === 'PASS').length;
  const failed = total - passed;
  console.log(`Total Pruebas de Módulo: ${total} | Exitosas: ${passed} | Fallidas: ${failed}`);
  console.log(`Efectividad Operativa: ${Math.round((passed / total) * 100)}%\n`);

  // Restaurar estado estándar de módulos activos
  await updateConfig({
    paymentMode: PaymentMode.WAITER_ONLY,
    allowSplitBill: true,
    allowOrdering: true,
    requireWaiterValidation: true,
    enableUpsell: true,
    enableSmartTips: true,
    enableReviews: true,
    enableWaitlist: true,
    enableWaitlistPreOrder: true,
    enableRewards: true,
    pointsPerHundredPesos: 1
  });

  await app.close();
  await prisma.$disconnect();

  if (failed > 0) {
    process.exit(1);
  }
}

runWaiterShiftSimulation().catch(err => {
  console.error('\n❌ ERROR FATAL DURANTE LA SIMULACIÓN DE TURNO:', err);
  process.exit(1);
});

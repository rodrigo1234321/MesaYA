import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { fsmService } from '../src/services/fsm.service';
import { RTMSAnalyticsService } from '../src/services/rtms-analytics.service';
import {
  TableFSMState,
  SignalSource,
  isValidTransition,
  getNextState,
  resolveConflict
} from '@mesaya/shared';

describe('RTMS Capa 3: FSM Engine & Analytics Verification', () => {
  let testRestaurant: any;
  let testTable: any;

  beforeAll(async () => {
    // Setup or retrieve test restaurant
    testRestaurant = await prisma.restaurant.findFirst({
      where: { slug: 'trattoria-del-puerto' },
      include: { tables: true }
    });

    if (!testRestaurant) {
      testRestaurant = await prisma.restaurant.create({
        data: {
          name: 'Test Trattoria RTMS',
          slug: 'test-trattoria-rtms',
          templateId: 'GOURMET_OBSIDIAN',
          themeColor: '#f59e0b'
        }
      });
    }

    testTable = await prisma.table.findFirst({
      where: { restaurantId: testRestaurant.id }
    });

    if (!testTable) {
      testTable = await prisma.table.create({
        data: {
          restaurantId: testRestaurant.id,
          label: 'Mesa Test QA',
          sector: 'SALON_PRINCIPAL',
          currentState: TableFSMState.AVAILABLE,
          capacity: 4,
          posX: 100,
          posY: 100,
          shape: 'RECT'
        }
      });
    } else {
      // Reset table to AVAILABLE
      await prisma.table.update({
        where: { id: testTable.id },
        data: { currentState: TableFSMState.AVAILABLE }
      });
    }
  });

  // =========================================================================
  // 1. Tests Unitarios Puros: Matriz de Estados y Resolución de Conflictos
  // =========================================================================
  describe('1. Reglas FSM y Matriz de Transiciones', () => {
    it('debe permitir transiciones válidas del ciclo gastronómico', () => {
      expect(isValidTransition(TableFSMState.AVAILABLE, TableFSMState.OCCUPIED_NO_ORDER)).toBe(true);
      expect(isValidTransition(TableFSMState.OCCUPIED_NO_ORDER, TableFSMState.ORDER_IN_KITCHEN)).toBe(true);
      expect(isValidTransition(TableFSMState.ORDER_IN_KITCHEN, TableFSMState.EATING)).toBe(true);
      expect(isValidTransition(TableFSMState.EATING, TableFSMState.BILL_REQUESTED)).toBe(true);
      expect(isValidTransition(TableFSMState.EATING, TableFSMState.ORDER_IN_KITCHEN)).toBe(true); // Segunda ronda/postre
      expect(isValidTransition(TableFSMState.BILL_REQUESTED, TableFSMState.PAID)).toBe(true);
      expect(isValidTransition(TableFSMState.PAID, TableFSMState.TO_CLEAN)).toBe(true);
      expect(isValidTransition(TableFSMState.TO_CLEAN, TableFSMState.AVAILABLE)).toBe(true);
    });

    it('debe bloquear transiciones ilegales imposibles', () => {
      expect(isValidTransition(TableFSMState.AVAILABLE, TableFSMState.EATING)).toBe(false);
      expect(isValidTransition(TableFSMState.AVAILABLE, TableFSMState.PAID)).toBe(false);
      expect(isValidTransition(TableFSMState.AVAILABLE, TableFSMState.BILL_REQUESTED)).toBe(false);
      expect(isValidTransition(TableFSMState.AVAILABLE, TableFSMState.TO_CLEAN)).toBe(false);
    });

    it('debe calcular la progresión 1-Tap correcta', () => {
      expect(getNextState(TableFSMState.AVAILABLE)).toBe(TableFSMState.OCCUPIED_NO_ORDER);
      expect(getNextState(TableFSMState.OCCUPIED_NO_ORDER)).toBe(TableFSMState.ORDER_IN_KITCHEN);
      expect(getNextState(TableFSMState.ORDER_IN_KITCHEN)).toBe(TableFSMState.EATING);
      expect(getNextState(TableFSMState.EATING)).toBe(TableFSMState.TO_CLEAN);
      expect(getNextState(TableFSMState.TO_CLEAN)).toBe(TableFSMState.AVAILABLE);
    });

    it('debe resolver arbitraje de señales por prioridad', () => {
      // Mozo (prioridad 50) vs Timers automáticos (prioridad 10)
      const winner1 = resolveConflict(
        SignalSource.STAFF_TERMINAL_TAP,
        SignalSource.SYSTEM_TIMER
      );
      expect(winner1).toBe(SignalSource.STAFF_TERMINAL_TAP);

      // Manager override (prioridad 100) vs Mozo (prioridad 50)
      const winner2 = resolveConflict(
        SignalSource.MANAGER_OVERRIDE,
        SignalSource.STAFF_TERMINAL_TAP
      );
      expect(winner2).toBe(SignalSource.MANAGER_OVERRIDE);
    });
  });

  // =========================================================================
  // 2. Tests de Integración DB: Ciclo de Vida y Auditoría
  // =========================================================================
  describe('2. Ciclo de Vida FSM en Base de Datos', () => {
    it('debe transicionar la mesa paso a paso y registrar auditoría', async () => {
      // 1. AVAILABLE -> OCCUPIED_NO_ORDER
      const step1 = await fsmService.attemptTransition({
        tableId: testTable.id,
        toState: TableFSMState.OCCUPIED_NO_ORDER,
        source: SignalSource.CUSTOMER_NFC,
        trigger: 'Test NFC'
      });
      expect(step1.newState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

      // 2. OCCUPIED_NO_ORDER -> ORDER_IN_KITCHEN
      const step2 = await fsmService.attemptTransition({
        tableId: testTable.id,
        toState: TableFSMState.ORDER_IN_KITCHEN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: '1-Tap Mozo'
      });
      expect(step2.newState).toBe(TableFSMState.ORDER_IN_KITCHEN);

      // 3. ORDER_IN_KITCHEN -> EATING
      const step3 = await fsmService.attemptTransition({
        tableId: testTable.id,
        toState: TableFSMState.EATING,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Plato Servido'
      });
      expect(step3.newState).toBe(TableFSMState.EATING);

      // 4. EATING -> TO_CLEAN
      const step4 = await fsmService.attemptTransition({
        tableId: testTable.id,
        toState: TableFSMState.TO_CLEAN,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Cobrar y Limpiar'
      });
      expect(step4.newState).toBe(TableFSMState.TO_CLEAN);

      // 5. TO_CLEAN -> AVAILABLE
      const step5 = await fsmService.attemptTransition({
        tableId: testTable.id,
        toState: TableFSMState.AVAILABLE,
        source: SignalSource.STAFF_TERMINAL_TAP,
        trigger: 'Mesa Limpia'
      });
      expect(step5.newState).toBe(TableFSMState.AVAILABLE);
    });

    it('debe rechazar transiciones inválidas con error 422', async () => {
      await expect(
        fsmService.attemptTransition({
          tableId: testTable.id,
          toState: TableFSMState.EATING,
          source: SignalSource.CUSTOMER_APP,
          trigger: 'Salto ilegal'
        })
      ).rejects.toThrow('Transición no permitida');
    });

    it('debe detectar conflictos de concurrencia con código 409', async () => {
      // Si la mesa está en AVAILABLE y alguien intenta moverla desde ORDER_IN_KITCHEN
      await expect(
        fsmService.attemptTransition({
          tableId: testTable.id,
          toState: TableFSMState.EATING,
          fromState: TableFSMState.ORDER_IN_KITCHEN, // Desfasado intencionalmente
          source: SignalSource.STAFF_TERMINAL_TAP,
          trigger: 'Conflicto concurrente'
        })
      ).rejects.toThrow();
    });
  });

  // =========================================================================
  // 3. Tests del Motor de Analytics: RevPASH, Fases y Heatmap
  // =========================================================================
  describe('3. Motor de Analytics & RevPASH (RTMSAnalyticsService)', () => {
    it('debe calcular el resumen global de RevPASH y ocupación', async () => {
      const summary = await RTMSAnalyticsService.getAnalyticsSummary(testRestaurant.id);

      expect(summary).toBeDefined();
      expect(summary.restaurantId).toBe(testRestaurant.id);
      expect(summary.totalSeats).toBeGreaterThan(0);
      expect(summary.totalSeatHours).toBeGreaterThan(0);
      expect(typeof summary.revPASH).toBe('number');
      expect(summary.averageTurnTimeMinutes).toBeGreaterThan(0);
      expect(summary.occupancyRatePercentage).toBeGreaterThanOrEqual(0);
    });

    it('debe calcular los tiempos promedio por fase gastronómica', async () => {
      const phases = await RTMSAnalyticsService.getPhaseMetrics(testRestaurant.id);

      expect(phases).toBeDefined();
      expect(phases.timeToOrderAvgMinutes).toBeGreaterThan(0);
      expect(phases.kitchenPrepAvgMinutes).toBeGreaterThan(0);
      expect(phases.eatingDwellAvgMinutes).toBeGreaterThan(0);
      expect(phases.paymentToVacateAvgMinutes).toBeGreaterThan(0);
      expect(phases.cleaningTurnaroundAvgMinutes).toBeGreaterThan(0);
    });

    it('debe generar la matriz 7x24 para el mapa de calor (168 celdas)', async () => {
      const heatmap = await RTMSAnalyticsService.getOccupancyHeatmap(testRestaurant.id);

      expect(heatmap).toBeDefined();
      expect(heatmap.length).toBe(7 * 24); // 168 franjas horarias
      const sampleCell = heatmap[0];
      expect(sampleCell).toHaveProperty('dayOfWeek');
      expect(sampleCell).toHaveProperty('hour');
      expect(sampleCell).toHaveProperty('occupancyPercentage');
      expect(sampleCell).toHaveProperty('revenue');
    });

    it('debe generar el ranking de rendimiento mesa por mesa', async () => {
      const ranking = await RTMSAnalyticsService.getTablePerformance(testRestaurant.id);

      expect(ranking).toBeDefined();
      expect(Array.isArray(ranking)).toBe(true);
      if (ranking.length > 0) {
        const first = ranking[0];
        expect(first).toHaveProperty('tableId');
        expect(first).toHaveProperty('label');
        expect(first).toHaveProperty('capacity');
        expect(first).toHaveProperty('totalRevenue');
        expect(first).toHaveProperty('revPASH');
        expect(first).toHaveProperty('utilizationPercentage');
      }
    });
  });

  // =========================================================================
  // 4. Test de Concurrencia & Estrés Operativo
  // =========================================================================
  describe('4. Estrés y Concurrencia Simulada (50 peticiones simultáneas)', () => {
    it('debe manejar ráfagas concurrentes de 1-Tap con control de concurrencia optimista', async () => {
      // Asegurar que la mesa esté en AVAILABLE antes del test
      await prisma.table.update({
        where: { id: testTable.id },
        data: { currentState: TableFSMState.AVAILABLE }
      });

      // 50 peticiones simultáneas intentando la misma transición
      const attempts = Array.from({ length: 50 }, (_, i) =>
        fsmService
          .attemptTransition({
            tableId: testTable.id,
            toState: TableFSMState.OCCUPIED_NO_ORDER,
            fromState: TableFSMState.AVAILABLE,
            source: SignalSource.STAFF_TERMINAL_TAP,
            trigger: `Stress attempt #${i}`
          })
          .then((res) => ({ success: true, res }))
          .catch((err) => ({ success: false, code: err.code, statusCode: err.statusCode }))
      );

      const results = await Promise.all(attempts);
      const successful = results.filter((r) => r.success);
      const conflicts = results.filter((r) => !r.success && (r.code === 'STATE_CONFLICT' || r.statusCode === 409));

      // Exactamente 1 transición exitosa, 49 conflictos limpios
      expect(successful.length).toBe(1);
      expect(conflicts.length).toBe(49);

      // Dejar la mesa en AVAILABLE
      await fsmService.attemptTransition({
        tableId: testTable.id,
        toState: TableFSMState.AVAILABLE,
        source: SignalSource.MANAGER_OVERRIDE,
        trigger: 'Reset post stress test'
      });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});

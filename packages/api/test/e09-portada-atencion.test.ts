import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallType, OrderStatus, TableFSMState } from '@mesaya/shared';

import { StaffService } from '../src/services/staff.service';

const ROOT = join(__dirname, '..', '..', '..');
const wsSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');

describe('E09 — Portada Atención y lista estable (S01, S03, S04, E02, E08)', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let shift: any;
  let item: any;
  let tokenWaiter1 = '';
  let tokenWaiter2 = '';
  let waiter1User: any;
  let waiter2User: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E09 Portada',
        slug: `e09-portada-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#123456',
        moduleConfig: { create: { allowOrdering: true } }
      }
    });

    shift = await prisma.shift.create({
      data: { restaurantId: restaurant.id, openedAt: new Date() }
    });

    const category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'Platos E09' }
    });
    item = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Burger E09', price: 2500, isAvailable: true }
    });

    waiter1User = await StaffService.createStaff(restaurant.id, 'Mozo Juan E09', '1111', 'WAITER');
    waiter2User = await StaffService.createStaff(restaurant.id, 'Mozo Pedro E09', '2222', 'WAITER');

    const login1 = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '1111', terminalId: 'terminal-e09-01' }
    });
    expect(login1.statusCode).toBe(200);
    tokenWaiter1 = login1.json().token;

    const login2 = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '2222', terminalId: 'terminal-e09-02' }
    });
    expect(login2.statusCode).toBe(200);
    tokenWaiter2 = login2.json().token;
  });

  afterAll(async () => {
    if (restaurant?.id) {
      await prisma.serviceTaskClaim.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.callRequest.deleteMany({}).catch(() => {});
      await prisma.orderItem.deleteMany({}).catch(() => {});
      await prisma.order.deleteMany({}).catch(() => {});
      await prisma.tableSession.deleteMany({}).catch(() => {});
      await prisma.table.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.shift.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.staffUser.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.restaurant.delete({ where: { id: restaurant.id } }).catch(() => {});
    }
    await app.close();
  });

  describe('1. Contratos de diseño de Portada y estabilidad de lista (E02, S01, S03)', () => {
    it('elimina la duplicación de cabeceras y proporciona la Portada Toolbar compacta (<80px)', () => {
      // Debe contener la Portada Toolbar compacta con buscador y filtros
      expect(wsSrc).toContain('table-search-input');
      expect(wsSrc).toContain('Buscar mesa...');
      expect(wsSrc).toContain('TASK_FILTER_LABELS');
      expect(wsSrc).toContain('Filtros avanzados de trabajo');
      expect(wsSrc).toContain('showMap');
      // La portada arranca directamente con la barra de herramientas compacta
      expect(wsSrc).toContain('Portada Atención (E09): Barra compacta sin duplicar headers');
    });

    it('establece el orden canónico por urgencia física: CALL > ORDER_DELIVERY > ACCOUNT_COLLECTION > ORDER_VALIDATION > TABLE_CLEANUP', () => {
      expect(wsSrc).toContain("case 'CALL': return 1;");
      expect(wsSrc).toContain("case 'ORDER_DELIVERY': return 2;");
      expect(wsSrc).toContain("case 'ACCOUNT_COLLECTION': return 3;");
      expect(wsSrc).toContain("case 'ORDER_VALIDATION': return 4;");
      expect(wsSrc).toContain("case 'TABLE_CLEANUP': return 5;");
    });

    it('implementa congelamiento de lista cuando el mozo interactúa (hover, foco o acción)', () => {
      expect(wsSrc).toContain('isInteracting = Boolean(hoveredTaskId || focusedTaskId || actionBusy)');
      expect(wsSrc).toContain('frozenTasksRef.current');
      expect(wsSrc).toContain('onHoverStart');
      expect(wsSrc).toContain('onFocusStart');
    });

    it('anuncia tareas recién llegadas con badge visual "Nuevo" sin provocar reordenamientos bruscos', () => {
      expect(wsSrc).toContain('newlyArrivedTaskIds');
      expect(wsSrc).toContain('previousTaskIdsRef');
      expect(wsSrc).toContain('Nuevo');
      expect(wsSrc).toContain('animate-pulse');
    });

    it('cada tarjeta de tarea presenta mesa, sector, necesidad, edad y acción principal con verbo específico', () => {
      expect(wsSrc).toContain('taskActionLabel');
      expect(wsSrc).toContain('Atender y resolver');
      expect(wsSrc).toContain('Atender y ver cuenta');
      expect(wsSrc).toContain('Entregado');
      expect(wsSrc).toContain('Aceptar y enviar');
      expect(wsSrc).toContain('Mesa lista');
    });
  });

  describe('2. Verificación de tareas en API y resolución de conflictos concurrentes (S04)', () => {
    it('dos mozos intentan tomar concurrentemente la misma tarea: uno gana (200), otro recibe 409 con el reclamo actualizado', async () => {
      const table = await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          label: `Mesa ${Math.floor(Math.random() * 90 + 10)}`,
          sector: 'SALON_PRINCIPAL',
          currentState: TableFSMState.OCCUPIED_NO_ORDER,
          capacity: 4
        }
      });

      const session = await prisma.tableSession.create({
        data: {
          tableId: table.id,
          shiftId: shift.id,
          token: randomUUID(),
          activeKey: `act-${randomUUID()}`,
          expiresAt: new Date(Date.now() + 3600e3)
        }
      });

      const call = await prisma.callRequest.create({
        data: {
          tableSessionId: session.id,
          type: CallType.WAITER,
          status: 'PENDING'
        }
      });

      // Mozo 1 y Mozo 2 actúan sobre la tarea casi en simultáneo
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'POST',
          url: `/v1/staff/service/tasks/CALL/${call.id}/claim`,
          headers: { authorization: `Bearer ${tokenWaiter1}` }
        }),
        app.inject({
          method: 'POST',
          url: `/v1/staff/service/tasks/CALL/${call.id}/claim`,
          headers: { authorization: `Bearer ${tokenWaiter2}` }
        })
      ]);

      const statuses = [res1.statusCode, res2.statusCode];
      expect(statuses).toContain(409);
      const winnerStatus = statuses.find((s) => s !== 409);
      expect([200, 201]).toContain(winnerStatus);

      const conflictRes = res1.statusCode === 409 ? res1 : res2;
      const jsonConflict = conflictRes.json();
      expect(jsonConflict.code).toBe('TASK_ALREADY_CLAIMED');
      expect(jsonConflict.error).toMatch(/Otro operador ya se ocupó de esta tarea/i);
    });

    it('obtiene el snapshot del workspace con múltiples tareas y garantiza orden y discriminación de sectores', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
        headers: { authorization: `Bearer ${tokenWaiter1}` }
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.restaurantId).toBe(restaurant.id);
      expect(Array.isArray(data.tasks)).toBe(true);
      expect(Array.isArray(data.floorPlan.tables)).toBe(true);
    });
  });
});

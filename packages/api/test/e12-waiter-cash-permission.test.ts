import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { StaffService } from '../src/services/staff.service';
import { ConfigService } from '../src/services/config.service';

const ROOT = join(__dirname, '..', '..', '..');
const wsSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');
const adminConfigSrc = readFileSync(join(ROOT, 'apps/admin-dashboard/src/components/ModuleConfigManager.tsx'), 'utf8');

describe('E12 — Permiso específico de cobro en efectivo (S12 / S13 / S14 / H05)', () => {
  let app: FastifyInstance;
  let restaurantA: any;
  let restaurantB: any;
  let shiftA: any;
  let shiftB: any;
  let itemA: any;
  let itemB: any;
  let tableA1: any;
  let tableA2: any;
  let tableB1: any;
  let waiterAUser: any;
  let managerAUser: any;
  let waiterBUser: any;
  let tokenWaiterA = '';
  let tokenManagerA = '';
  let tokenWaiterB = '';
  let tokenTerminalA = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Restaurante A con configuración por defecto (allowWaitersToCollectCash: false)
    restaurantA = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E12 Principal',
        slug: `e12-rest-a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#123456',
        moduleConfig: { create: { allowOrdering: true, allowWaitersToCollectCash: false } }
      }
    });

    // Restaurante B para pruebas cross-tenant
    restaurantB = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E12 Vecino',
        slug: `e12-rest-b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#654321',
        moduleConfig: { create: { allowOrdering: true, allowWaitersToCollectCash: true } }
      }
    });

    shiftA = await prisma.shift.create({ data: { restaurantId: restaurantA.id, openedAt: new Date() } });
    shiftB = await prisma.shift.create({ data: { restaurantId: restaurantB.id, openedAt: new Date() } });

    const catA = await prisma.menuCategory.create({ data: { restaurantId: restaurantA.id, name: 'Platos A' } });
    itemA = await prisma.menuItem.create({ data: { categoryId: catA.id, name: 'Milanesa A', price: 4500, isAvailable: true } });

    const catB = await prisma.menuCategory.create({ data: { restaurantId: restaurantB.id, name: 'Platos B' } });
    itemB = await prisma.menuItem.create({ data: { categoryId: catB.id, name: 'Pizza B', price: 5000, isAvailable: true } });

    tableA1 = await prisma.table.create({
      data: { restaurantId: restaurantA.id, label: 'Mesa A1', currentState: TableFSMState.EATING }
    });
    tableA2 = await prisma.table.create({
      data: { restaurantId: restaurantA.id, label: 'Mesa A2', currentState: TableFSMState.EATING }
    });
    tableB1 = await prisma.table.create({
      data: { restaurantId: restaurantB.id, label: 'Mesa B1', currentState: TableFSMState.EATING }
    });

    waiterAUser = await StaffService.createStaff(restaurantA.id, 'Mozo A1', '1234', 'WAITER');
    managerAUser = await StaffService.createStaff(restaurantA.id, 'Encargado A1', '9999', 'MANAGER');
    waiterBUser = await StaffService.createStaff(restaurantB.id, 'Mozo B1', '4321', 'WAITER');

    const logWA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantA.slug, pin: '1234', terminalId: 'term-e12-wa' }
    });
    tokenWaiterA = logWA.json().token;

    const logMA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantA.slug, pin: '9999', terminalId: 'term-e12-ma' }
    });
    tokenManagerA = logMA.json().token;

    const logWB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantB.slug, pin: '4321', terminalId: 'term-e12-wb' }
    });
    tokenWaiterB = logWB.json().token;

    // Terminal de hardware sin operador autenticado
    const provTerm = await app.inject({
      method: 'POST',
      url: '/v1/staff/terminal/provision',
      payload: { restaurantSlug: restaurantA.slug, pin: '9999', terminalId: 'tablet-salon-desatendida', mode: 'SALON' }
    });
    tokenTerminalA = provTerm.json().terminalToken;
  });

  afterAll(async () => {
    if (restaurantA?.id) {
      await prisma.accountSettlement.deleteMany({ where: { restaurantId: restaurantA.id } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order: { tableSession: { table: { restaurantId: restaurantA.id } } } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { tableSession: { table: { restaurantId: restaurantA.id } } } }).catch(() => {});
      await prisma.tableSession.deleteMany({ where: { table: { restaurantId: restaurantA.id } } }).catch(() => {});
      await prisma.table.deleteMany({ where: { restaurantId: restaurantA.id } }).catch(() => {});
      await prisma.shift.deleteMany({ where: { restaurantId: restaurantA.id } }).catch(() => {});
      await prisma.staffUser.deleteMany({ where: { restaurantId: restaurantA.id } }).catch(() => {});
      await prisma.restaurantModuleConfigAudit.deleteMany({ where: { restaurantId: restaurantA.id } }).catch(() => {});
      await prisma.restaurantModuleConfig.deleteMany({ where: { restaurantId: restaurantA.id } }).catch(() => {});
      await prisma.restaurant.delete({ where: { id: restaurantA.id } }).catch(() => {});
    }
    if (restaurantB?.id) {
      await prisma.accountSettlement.deleteMany({ where: { restaurantId: restaurantB.id } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order: { tableSession: { table: { restaurantId: restaurantB.id } } } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { tableSession: { table: { restaurantId: restaurantB.id } } } }).catch(() => {});
      await prisma.tableSession.deleteMany({ where: { table: { restaurantId: restaurantB.id } } }).catch(() => {});
      await prisma.table.deleteMany({ where: { restaurantId: restaurantB.id } }).catch(() => {});
      await prisma.shift.deleteMany({ where: { restaurantId: restaurantB.id } }).catch(() => {});
      await prisma.staffUser.deleteMany({ where: { restaurantId: restaurantB.id } }).catch(() => {});
      await prisma.restaurantModuleConfigAudit.deleteMany({ where: { restaurantId: restaurantB.id } }).catch(() => {});
      await prisma.restaurantModuleConfig.deleteMany({ where: { restaurantId: restaurantB.id } }).catch(() => {});
      await prisma.restaurant.delete({ where: { id: restaurantB.id } }).catch(() => {});
    }
    await app.close();
  });

  const freshAccount = async (sessionId: string) => {
    const session = await prisma.tableSession.findUniqueOrThrow({ where: { id: sessionId } });
    const res = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    return res.json().account;
  };

  const createActiveSessionWithOrder = async (table: any, shift: any, menuItem: any, qty = 2) => {
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        activeKey: `${table.id}-${Date.now()}`,
        token: `session-${table.id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        expiresAt: new Date(Date.now() + 7200000)
      }
    });

    const unitPriceMinor = Math.round(menuItem.price * 100);
    const totalAmount = (menuItem.price * qty);
    const order = await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.SERVED,
        totalAmount,
        totalAmountMinor: unitPriceMinor * qty,
        items: {
          create: [{
            menuItemId: menuItem.id,
            quantity: qty,
            unitPrice: menuItem.price,
            unitPriceMinor,
            addedByGuest: session.id
          }]
        }
      }
    });

    const account = await freshAccount(session.id);
    return { session, order, totalAmountMinor: unitPriceMinor * qty, account, version: account.version };
  };

  describe('1. Contratos de diseño e interfaces de configuración (E12 / H05)', () => {
    it('ServiceWorkspace.tsx integra allowWaitersToCollectCash y permite cobro en efectivo directo al mozo', () => {
      expect(wsSrc).toContain('allowWaitersToCollectCash');
      expect(wsSrc).toContain("const isCash = selectedMethod === 'WAITER_CASH';");
      expect(wsSrc).toContain('canCollectDirectly');
    });

    it('ModuleConfigManager.tsx expone el interruptor toggle-waiter-cash-collection en Módulo 1', () => {
      expect(adminConfigSrc).toContain('toggle-waiter-cash-collection');
      expect(adminConfigSrc).toContain('allowWaitersToCollectCash');
      expect(adminConfigSrc).toContain('waiter_cash_collection');
      expect(adminConfigSrc).toContain('Cobro en efectivo por mozos');
    });

    it('ConfigService calcula la capacidad waiter_cash_collection con estado AVAILABLE', async () => {
      const config = await ConfigService.getPublicConfig(restaurantA.slug);
      expect(config).toBeDefined();
      expect(config?.capabilities).toBeDefined();
      expect(config?.capabilities?.waiter_cash_collection).toBeDefined();
      expect(config?.capabilities?.waiter_cash_collection.key).toBe('waiter_cash_collection');
      expect(config?.capabilities?.waiter_cash_collection.configuredEnabled).toBe(false);
      expect(config?.capabilities?.waiter_cash_collection.reasonCode).toBe('WAITER_CASH_DISABLED');
    });
  });

  describe('2. Matriz de permisos de cobro en servidor: flag apagado por defecto (S12)', () => {
    it('cuando allowWaitersToCollectCash es false, el Mozo NO puede liquidar en efectivo (403 SETTLE_REQUIRES_MANAGER)', async () => {
      const { session } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 2);

      const settleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `settle-w-cash-off-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CASH',
          amountMinor: 9000
        }
      });

      expect(settleRes.statusCode).toBe(403);
      const body = settleRes.json();
      expect(body.code).toBe('SETTLE_REQUIRES_MANAGER');
      expect(body.message).toContain('Encargado');

      // Verificar que la cuenta no sufrió deducción
      const checkSession = await prisma.accountSettlement.findFirst({ where: { tableSessionId: session.id } });
      expect(checkSession).toBeNull();
    });

    it('cuando allowWaitersToCollectCash es false, el Mozo tampoco puede liquidar y cerrar en efectivo (403)', async () => {
      const { session } = await createActiveSessionWithOrder(tableA2, shiftA, itemA, 1);

      const closeRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `close-w-cash-off-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CASH',
          amountMinor: 4500
        }
      });

      expect(closeRes.statusCode).toBe(403);
      expect(closeRes.json().code).toBe('SETTLE_REQUIRES_MANAGER');
    });
  });

  describe('3. Habilitación de cobro en efectivo para mozos (S12)', () => {
    it('al activar allowWaitersToCollectCash: true, el Mozo liquida en efectivo con éxito (201)', async () => {
      // Activar flag en restaurante A
      await ConfigService.updateConfigTransacted(restaurantA.id, {
        allowWaitersToCollectCash: true
      }, managerAUser.id);

      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 2);

      const settleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `settle-w-cash-on-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor,
          tipMinor: 500,
          responsibleStaffUserId: waiterAUser.id
        }
      });

      expect(settleRes.statusCode).toBe(201);
      const data = settleRes.json();
      expect(data.settlement).toBeDefined();
      expect(data.settlement.method).toBe('WAITER_CASH');
      expect(data.settlement.amountMinor).toBe(totalAmountMinor);
      expect(data.settlement.tipMinor).toBe(500);
      expect(data.account.saldoMinor).toBe(0);

      // Verificar persistencia y auditoría inmutable de actor
      const dbSettlement = await prisma.accountSettlement.findUnique({
        where: { idempotencyKey: `settle-w-cash-on-${session.id}` }
      });
      expect(dbSettlement).toBeDefined();
      expect(dbSettlement?.createdBy).toBe(waiterAUser.id);
      expect(dbSettlement?.responsibleStaffUserId).toBe(waiterAUser.id);
    });

    it('con allowWaitersToCollectCash: true, el Mozo ejecuta Cobrar y Cerrar en efectivo pasando la mesa a TO_CLEAN', async () => {
      const cleanTable = await prisma.table.create({
        data: { restaurantId: restaurantA.id, label: 'Mesa A-CloseClean', currentState: TableFSMState.EATING }
      });
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(cleanTable, shiftA, itemA, 1);

      const closeRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `close-w-cash-on-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });

      expect(closeRes.statusCode).toBe(201);
      const data = closeRes.json();
      expect(data.closed).toBe(true);

      const updatedTable = await prisma.table.findUnique({ where: { id: cleanTable.id } });
      expect(updatedTable?.currentState).toBe(TableFSMState.TO_CLEAN);
    });
  });

  describe('4. Restricción estricta sobre métodos no-efectivo (S12)', () => {
    it('con allowWaitersToCollectCash: true, el Mozo es RECHAZADO si intenta liquidar con tarjeta WAITER_CARD (403)', async () => {
      const { session } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 2);

      const cardRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `settle-w-card-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CARD',
          amountMinor: 9000
        }
      });

      expect(cardRes.statusCode).toBe(403);
      expect(cardRes.json().code).toBe('SETTLE_REQUIRES_MANAGER');
      expect(cardRes.json().message).toContain('no-efectivo requiere');
    });

    it('con allowWaitersToCollectCash: true, el Mozo es RECHAZADO si intenta liquidar con Mercado Pago WAITER_MP_QR (403)', async () => {
      const { session } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);

      const mpRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `settle-w-mp-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_MP_QR',
          amountMinor: 4500
        }
      });

      expect(mpRes.statusCode).toBe(403);
      expect(mpRes.json().code).toBe('SETTLE_REQUIRES_MANAGER');
    });
  });

  describe('5. Seguridad: anti-suplantación en body, aislamiento tenant y terminal sin operador', () => {
    it('el servidor no confía en staffRole inyectado en el body y mantiene el rechazo', async () => {
      const { session } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);

      // Atacante mozo envía staffRole: 'MANAGER' en el body para evadir control sobre WAITER_CARD
      const fakeRoleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `settle-fake-role-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CARD',
          staffRole: 'MANAGER', // Inyección maliciosa en body
          amountMinor: 4500
        }
      });

      expect(fakeRoleRes.statusCode).toBe(403);
      expect(fakeRoleRes.json().code).toBe('SETTLE_REQUIRES_MANAGER');
    });

    it('bloquea intentos cross-tenant entre restaurantes distintos (403 / 404)', async () => {
      // Mozo B de restaurante B intenta liquidar sesión de restaurante A
      const { session: sessionA } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);

      const crossRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${sessionA.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: {
          idempotencyKey: `settle-cross-${sessionA.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CASH',
          amountMinor: 4500
        }
      });

      expect(crossRes.statusCode).toBe(403);
      expect(crossRes.json().code).toBe('STAFF_TENANT_MISMATCH');
    });

    it('un terminal de hardware sin operador autenticado no puede liquidar cuentas (403 OPERATOR_PIN_REQUIRED)', async () => {
      const { session } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);

      const termRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenTerminalA}` },
        payload: {
          idempotencyKey: `settle-term-only-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CASH',
          amountMinor: 4500
        }
      });

      expect(termRes.statusCode).toBe(403);
      expect(termRes.json().code).toBe('OPERATOR_PIN_REQUIRED');
    });
  });

  describe('6. Token temporal de reautorización y restricción de alcance (S13)', () => {
    it('token temporal de manager para Mesa A1 no puede ser usado para liquidar Mesa A2 (403 TOKEN_SCOPE_MISMATCH)', async () => {
      const { session: session1, version: sess1Version, totalAmountMinor: totalAmountMinor1 } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);
      const { session: session2, version: sess2Version, totalAmountMinor: totalAmountMinor2 } = await createActiveSessionWithOrder(tableA2, shiftA, itemA, 1);

      // Manager emite token temporal acotado a Mesa A1
      const tempLog = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug: restaurantA.slug,
          pin: '9999',
          isTemporary: true,
          purpose: 'CASH_COLLECT',
          tableId: tableA1.id,
          sessionId: session1.id
        }
      });

      const tempToken = tempLog.json().token;
      expect(tempToken).toBeDefined();

      // Intento de liquidar Mesa A2 con token temporal de Mesa A1
      const wrongScopeRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session2.id}/settle`,
        headers: { authorization: `Bearer ${tempToken}` },
        payload: {
          idempotencyKey: `settle-wrong-scope-${session2.id}`,
          expectedAccountVersion: sess2Version,
          method: 'WAITER_CARD',
          amountMinor: totalAmountMinor2
        }
      });

      expect(wrongScopeRes.statusCode).toBe(403);
      expect(wrongScopeRes.json().code).toBe('TOKEN_SCOPE_MISMATCH');

      // Pero contra la sesión para la que fue emitido (Mesa A1), SÍ autoriza la liquidación
      const rightScopeRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session1.id}/settle`,
        headers: { authorization: `Bearer ${tempToken}` },
        payload: {
          idempotencyKey: `settle-right-scope-${session1.id}`,
          expectedAccountVersion: sess1Version,
          method: 'WAITER_CARD',
          amountMinor: totalAmountMinor1
        }
      });

      expect(rightScopeRes.statusCode).toBe(201);
    });
  });

  describe('7. Cambio de configuración en vuelo y reintento idempotente (S14)', () => {
    it('apagar allowWaitersToCollectCash en vuelo bloquea inmediatamente al mozo sin reiniciar el servidor', async () => {
      // 1. Apagar flag
      await ConfigService.updateConfigTransacted(restaurantA.id, {
        allowWaitersToCollectCash: false
      }, managerAUser.id);

      const { session } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);

      // 2. Intento de cobro en efectivo inmediato
      const rejectRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          idempotencyKey: `settle-after-disable-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CASH',
          amountMinor: 4500
        }
      });

      expect(rejectRes.statusCode).toBe(403);
      expect(rejectRes.json().code).toBe('SETTLE_REQUIRES_MANAGER');
    });

    it('S14: el reintento de cobro con la misma idempotencyKey devuelve 200 idempotentReplay sin duplicar pago', async () => {
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);
      const idKey = `idempotent-settle-${session.id}`;

      // Cobro inicial por manager
      const firstRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: idKey,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });
      expect(firstRes.statusCode).toBe(201);
      expect(firstRes.json().idempotentReplay).toBe(false);

      // Reintento idéntico (S14)
      const secondRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: idKey,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });
      expect(secondRes.statusCode).toBe(200);
      expect(secondRes.json().idempotentReplay).toBe(true);

      // Verificar que solo existe exactamente una liquidación en DB
      const settlements = await prisma.accountSettlement.findMany({ where: { idempotencyKey: idKey } });
      expect(settlements).toHaveLength(1);
    });

    it('auditoría inmutable: los cambios de configuración quedan registrados en RestaurantModuleConfigAudit', async () => {
      const audits = await prisma.restaurantModuleConfigAudit.findMany({
        where: { restaurantId: restaurantA.id, changedField: 'allowWaitersToCollectCash' },
        orderBy: { changedAt: 'asc' }
      });

      expect(audits.length).toBeGreaterThanOrEqual(2);
      expect(audits[0].newValue).toBe('true');
      expect(audits[1].newValue).toBe('false');
    });
  });
});

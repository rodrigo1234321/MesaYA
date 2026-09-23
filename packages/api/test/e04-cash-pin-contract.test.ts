import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { StaffService } from '../src/services/staff.service';

const ROOT = join(__dirname, '..', '..', '..');
const wsSource = readFileSync(join(ROOT, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');

describe('E04 — Cobro presencial, efectivo y PIN (Matriz de seguridad y auditoría)', () => {
  let app: FastifyInstance;
  let restaurantA: any;
  let restaurantB: any;
  let shiftA: any;
  let shiftB: any;
  let itemA: any;
  let tableA1: any;
  let tableA2: any;
  let tableB1: any;
  let waiterAUser: any;
  let managerAUser: any;
  let waiterBUser: any;
  let tokenWaiterA = '';
  let tokenManagerA = '';
  let tokenWaiterB = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Restaurante A: mozos sin permiso directo de cobro en efectivo por defecto
    restaurantA = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E04 Local A',
        slug: `e04-rest-a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#123456',
        moduleConfig: { create: { allowOrdering: true, allowWaitersToCollectCash: false } }
      }
    });

    // Restaurante B: local ajeno para pruebas cross-tenant
    restaurantB = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E04 Local B',
        slug: `e04-rest-b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#654321',
        moduleConfig: { create: { allowOrdering: true, allowWaitersToCollectCash: true } }
      }
    });

    shiftA = await prisma.shift.create({ data: { restaurantId: restaurantA.id, openedAt: new Date() } });
    shiftB = await prisma.shift.create({ data: { restaurantId: restaurantB.id, openedAt: new Date() } });

    const catA = await prisma.menuCategory.create({ data: { restaurantId: restaurantA.id, name: 'Platos A' } });
    itemA = await prisma.menuItem.create({ data: { categoryId: catA.id, name: 'Bife E04', price: 4500, isAvailable: true } });

    tableA1 = await prisma.table.create({
      data: { restaurantId: restaurantA.id, label: 'Mesa E04-1', currentState: TableFSMState.EATING }
    });
    tableA2 = await prisma.table.create({
      data: { restaurantId: restaurantA.id, label: 'Mesa E04-2', currentState: TableFSMState.EATING }
    });
    tableB1 = await prisma.table.create({
      data: { restaurantId: restaurantB.id, label: 'Mesa E04-B1', currentState: TableFSMState.EATING }
    });

    waiterAUser = await StaffService.createStaff(restaurantA.id, 'Mozo A1', '1234', 'WAITER');
    managerAUser = await StaffService.createStaff(restaurantA.id, 'Encargado A1', '9999', 'MANAGER');
    waiterBUser = await StaffService.createStaff(restaurantB.id, 'Mozo B1', '4321', 'WAITER');

    const logWA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantA.slug, pin: '1234', terminalId: 'term-e04-wa' }
    });
    tokenWaiterA = logWA.json().token;

    const logMA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantA.slug, pin: '9999', terminalId: 'term-e04-ma' }
    });
    tokenManagerA = logMA.json().token;

    const logWB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantB.slug, pin: '4321', terminalId: 'term-e04-wb' }
    });
    tokenWaiterB = logWB.json().token;
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
        activeKey: `${table.id}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
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

  describe('1. Autenticación, PIN inválido y expiración de credencial', () => {
    it('login con PIN inválido no emite token y responde 401 UNAUTHORIZED', async () => {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug: restaurantA.slug,
          pin: '0000', // PIN erróneo
          terminalId: 'term-e04-invalid-pin'
        }
      });

      expect(loginRes.statusCode).toBe(401);
      const body = loginRes.json();
      expect(body.error).toContain('PIN incorrecto');
      expect(body.token).toBeUndefined();
    });

    it('credencial JWT expirada es rechazada con 401 al intentar liquidar cuenta', async () => {
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);

      // Crear token expirado en el pasado
      const expiredToken = app.jwt.sign(
        {
          sub: managerAUser.id,
          role: 'MANAGER',
          restaurantId: restaurantA.id,
          temp: true,
          purpose: 'CASH_COLLECT',
          tableId: tableA1.id,
          sessionId: session.id
        },
        { expiresIn: '-10s' }
      );

      const settleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${expiredToken}` },
        payload: {
          idempotencyKey: `settle-expired-token-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });

      expect(settleRes.statusCode).toBe(401);
      expect(settleRes.json().error).toBe('UNAUTHORIZED');
    });
  });

  describe('2. Aislamiento multi-tenant y alcance acotado de token', () => {
    it('rechaza liquidar una cuenta de Restaurante A usando credencial de Restaurante B (403 STAFF_TENANT_MISMATCH)', async () => {
      const { session } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);

      const crossSettleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: {
          idempotencyKey: `cross-tenant-settle-${session.id}`,
          expectedAccountVersion: 'v0',
          method: 'WAITER_CASH',
          amountMinor: 4500
        }
      });

      expect(crossSettleRes.statusCode).toBe(403);
      expect(crossSettleRes.json().code).toBe('STAFF_TENANT_MISMATCH');
    });
  });

  describe('3. Idempotencia y protección contra doble clic / reenvío', () => {
    it('doble clic / reintento con la misma clave devuelve 200 idempotentReplay: true sin duplicar la transacción', async () => {
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);
      const idempotencyKey = `e04-double-click-${session.id}`;

      const payload = {
        idempotencyKey,
        expectedAccountVersion: version,
        method: 'WAITER_CASH',
        amountMinor: totalAmountMinor
      };

      // Primer clic (201 Created)
      const firstRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload
      });

      expect(firstRes.statusCode).toBe(201);
      expect(firstRes.json().idempotentReplay).toBe(false);

      // Segundo clic / reintento (200 OK replay)
      const secondRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload
      });

      expect(secondRes.statusCode).toBe(200);
      expect(secondRes.json().idempotentReplay).toBe(true);

      // Verificación en base de datos: exactamente una transacción registrada
      const count = await prisma.accountSettlement.count({ where: { idempotencyKey } });
      expect(count).toBe(1);
    });

    it('reutilizar la misma clave para otra sesión rechaza con 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const { session: sess1, version: v1, totalAmountMinor: amt1 } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 1);
      const { session: sess2, version: v2, totalAmountMinor: amt2 } = await createActiveSessionWithOrder(tableA2, shiftA, itemA, 1);
      const idempotencyKey = `e04-reused-key-${sess1.id}`;

      await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${sess1.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey,
          expectedAccountVersion: v1,
          method: 'WAITER_CASH',
          amountMinor: amt1
        }
      });

      // Intento de cobro en sesión 2 usando la misma clave
      const conflictRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${sess2.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey,
          expectedAccountVersion: v2,
          method: 'WAITER_CASH',
          amountMinor: amt2
        }
      });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('4. Auditoría de dos operadores: distinción de autorizador y responsable de salón', () => {
    it('registra createdBy (encargado que autorizó) y responsibleStaffUserId (mozo que cobra) de forma inmutable', async () => {
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 2);
      const idempotencyKey = `e04-two-operators-${session.id}`;

      // El Mozo no tiene permiso de efectivo directo (allowWaitersToCollectCash: false).
      // El Encargado emite token temporal acotado a la sesión.
      const tempAuthRes = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug: restaurantA.slug,
          pin: '9999',
          isTemporary: true,
          purpose: 'CASH_COLLECT',
          tableId: tableA1.id,
          sessionId: session.id
        }
      });
      expect(tempAuthRes.statusCode).toBe(200);
      const tempManagerToken = tempAuthRes.json().token;

      // El cobro se liquida indicando que el mozo del salón es el operador responsable
      const settleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tempManagerToken}` },
        payload: {
          idempotencyKey,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor,
          responsibleStaffUserId: waiterAUser.id
        }
      });

      expect(settleRes.statusCode).toBe(201);

      // Verificación de auditoría en base de datos:
      // createdBy = managerAUser.id (autorizador titular de la credencial)
      // responsibleStaffUserId = waiterAUser.id (operador del salón)
      const settlement = await prisma.accountSettlement.findUniqueOrThrow({
        where: { idempotencyKey }
      });

      expect(settlement.createdBy).toBe(managerAUser.id);
      expect(settlement.responsibleStaffUserId).toBe(waiterAUser.id);
      expect(settlement.createdBy).not.toBe(settlement.responsibleStaffUserId);
    });
  });

  describe('5. Invariante de deuda: la mesa no se libera ni se cierra con saldo pendiente', () => {
    it('settle-and-close con pago parcial es RECHAZADO (422 CLOSE_REQUIRES_FULL_SETTLEMENT) y la mesa no se cierra', async () => {
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(tableA1, shiftA, itemA, 2); // 9000 centavos
      const partialAmount = Math.round(totalAmountMinor / 2); // 4500 centavos

      const settleCloseRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: `partial-close-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: partialAmount // Intento de cierre con deuda restante
        }
      });

      expect(settleCloseRes.statusCode).toBe(422);
      expect(settleCloseRes.json().code).toBe('CLOSE_REQUIRES_FULL_SETTLEMENT');

      // Verificar que la sesión NO se cerró
      const dbSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(dbSession.closedAt).toBeNull();

      // Verificar que la mesa NO cambió a TO_CLEAN ni a AVAILABLE
      const dbTable = await prisma.table.findUniqueOrThrow({ where: { id: tableA1.id } });
      expect(dbTable.currentState).toBe(TableFSMState.EATING);
    });

    it('cierre directo de sesión con deuda pendiente es RECHAZADO (409 TABLE_HAS_UNPAID_BALANCE)', async () => {
      const { session } = await createActiveSessionWithOrder(tableA2, shiftA, itemA, 1); // 4500 centavos pendiente

      const directCloseRes = await app.inject({
        method: 'POST',
        url: `/v1/tables/${tableA2.id}/close-session`,
        headers: { authorization: `Bearer ${tokenManagerA}` }
      });

      expect(directCloseRes.statusCode).toBe(409);
      expect(directCloseRes.json().code).toBe('TABLE_HAS_UNPAID_BALANCE');

      const dbSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: session.id } });
      expect(dbSession.closedAt).toBeNull();
    });
  });

  describe('6. Protección de PIN en cliente (ServiceWorkspace.tsx)', () => {
    it('el PIN nunca se almacena en almacenamiento persistente ni se expone en logs del cliente', () => {
      // 1. No existe almacenamiento en localStorage ni sessionStorage para el PIN
      expect(wsSource).not.toMatch(/localStorage\.setItem\([^)]*pin/i);
      expect(wsSource).not.toMatch(/sessionStorage\.setItem\([^)]*pin/i);

      // 2. No se escriben cookies con el PIN
      expect(wsSource).not.toMatch(/document\.cookie\s*=\s*[^;]*pin/i);

      // 3. El PIN solo reside en estado efímero (useState) y se borra al cerrar o enviar
      expect(wsSource).toContain("const [reauthPin, setReauthPin] = useState('');");
      expect(wsSource).toContain("setReauthPin('');");

      // 4. No hay logs de auditoría que impriman el PIN en claro
      expect(wsSource).not.toMatch(/console\.(log|info|debug|warn|error)\([^)]*reauthPin/);
    });
  });
});

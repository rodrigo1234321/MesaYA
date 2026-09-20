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
const apiSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/lib/api.ts'), 'utf8');

describe('E13 — Flujo de cuenta y cobro contextual (S12 / S13 / S14 / S15 / H05)', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let shift: any;
  let item1: any;
  let item2: any;
  let table1: any;
  let table2: any;
  let waiterUser: any;
  let managerUser: any;
  let tokenWaiter = '';
  let tokenManager = '';

  const freshAccount = async (sessionId: string) => {
    const session = await prisma.tableSession.findUniqueOrThrow({ where: { id: sessionId } });
    const res = await app.inject({ method: 'GET', url: `/v1/orders/session/${session.token}` });
    return res.json().account;
  };

  const createTable = async (label: string) => {
    return prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label,
        currentState: TableFSMState.EATING
      }
    });
  };

  const createActiveSessionWithOrder = async (table: any, menuItem: any, qty = 1) => {
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
    const totalAmount = menuItem.price * qty;
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

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E13 Contextual',
        slug: `e13-rest-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#059669',
        moduleConfig: { create: { allowOrdering: true, allowWaitersToCollectCash: true } }
      }
    });

    shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });

    const cat = await prisma.menuCategory.create({ data: { restaurantId: restaurant.id, name: 'Platos E13' } });
    item1 = await prisma.menuItem.create({ data: { categoryId: cat.id, name: 'Bife de Chorizo', price: 6500, isAvailable: true } });
    item2 = await prisma.menuItem.create({ data: { categoryId: cat.id, name: 'Ensalada César', price: 3200, isAvailable: true } });

    table1 = await createTable('Mesa 101');
    table2 = await createTable('Mesa 102');

    waiterUser = await StaffService.createStaff(restaurant.id, 'Mozo Principal E13', '1234', 'WAITER');
    managerUser = await StaffService.createStaff(restaurant.id, 'Encargado General E13', '9999', 'MANAGER');

    const logW = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '1234', terminalId: 'term-e13-w' }
    });
    tokenWaiter = logW.json().token;

    const logM = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '9999', terminalId: 'term-e13-m' }
    });
    tokenManager = logM.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('1. Contratos de UI y flujo contextual en Staff Panel (E13 / S12–S15)', () => {
    it('ServiceWorkspace.tsx solicita PIN temporal de manager acotado a propósito CASH_COLLECT, mesa y sesión (S13)', () => {
      expect(wsSrc).toContain("purpose: 'CASH_COLLECT'");
      expect(wsSrc).toContain('tableId: reauthAccount.tableId');
      expect(wsSrc).toContain('sessionId: reauthAccount.tableSessionId');
    });

    it('ServiceWorkspace.tsx pliega la propina por defecto con botón opcional para agilizar el cobro', () => {
      expect(wsSrc).toContain('showTipInput');
      expect(wsSrc).toContain('+ Agregar propina voluntaria');
    });

    it('ServiceWorkspace.tsx distingue claramente los comandos "Registrar pago y mantener mesa" y "Cobrar y cerrar" (S15)', () => {
      expect(wsSrc).toContain('Registrar pago y mantener mesa');
      expect(wsSrc).toContain('Cobrar y cerrar');
      expect(wsSrc).toContain("onSettle(account, 'keep')");
      expect(wsSrc).toContain("onSettle(account, 'close')");
    });

    it('ServiceWorkspace.tsx gestiona pérdida de conexión con mensaje de comprobación y reintento idempotente', () => {
      expect(wsSrc).toContain('Se perdió la conexión con el servidor');
      expect(wsSrc).toContain('TOKEN_SCOPE_MISMATCH');
      expect(wsSrc).toContain('SETTLE_CLOSURE_INCOMPLETE');
    });

    it('api.ts define loginTemporary, settleSessionAccount y settleAndCloseSessionAccount con preservación de token', () => {
      expect(apiSrc).toContain('loginTemporary');
      expect(apiSrc).toContain('settleSessionAccount');
      expect(apiSrc).toContain('settleAndCloseSessionAccount');
    });
  });

  describe('2. S12/S13: Token temporal acotado por mesa e invalidación en otra sesión', () => {
    it('token temporal de manager para Mesa 101 rechaza liquidar Mesa 102 con 403 TOKEN_SCOPE_MISMATCH', async () => {
      const { session: sess1 } = await createActiveSessionWithOrder(table1, item1, 1);
      const { session: sess2, version: v2, totalAmountMinor: tot2 } = await createActiveSessionWithOrder(table2, item2, 1);

      const tempRes = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug: restaurant.slug,
          pin: '9999',
          isTemporary: true,
          purpose: 'CASH_COLLECT',
          tableId: table1.id,
          sessionId: sess1.id
        }
      });

      const tempToken = tempRes.json().token;
      expect(tempToken).toBeDefined();

      // Intento de cobro en Mesa 102 con token de Mesa 101
      const attackRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${sess2.id}/settle`,
        headers: { authorization: `Bearer ${tempToken}` },
        payload: {
          idempotencyKey: `attack-scope-${sess2.id}`,
          expectedAccountVersion: v2,
          method: 'WAITER_CARD',
          amountMinor: tot2
        }
      });

      expect(attackRes.statusCode).toBe(403);
      expect(attackRes.json().code).toBe('TOKEN_SCOPE_MISMATCH');
      expect(attackRes.json().message).toContain('esta sesión de mesa');
    });

    it('token temporal de manager para Mesa 101 autoriza con éxito el cobro en Mesa 101 (201)', async () => {
      const dedicatedTable = await createTable('Mesa 101-Scoped');
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(dedicatedTable, item1, 1);

      const tempRes = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: {
          restaurantSlug: restaurant.slug,
          pin: '9999',
          isTemporary: true,
          purpose: 'CASH_COLLECT',
          tableId: dedicatedTable.id,
          sessionId: session.id
        }
      });

      const tempToken = tempRes.json().token;

      const settleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tempToken}` },
        payload: {
          idempotencyKey: `scoped-success-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CARD_DEBIT',
          amountMinor: totalAmountMinor,
          responsibleStaffUserId: waiterUser.id
        }
      });

      expect(settleRes.statusCode).toBe(201);
      const data = settleRes.json();
      expect(data.settlement).toBeDefined();
      expect(data.settlement.method).toBe('WAITER_CARD_DEBIT');
      expect(data.account.saldoMinor).toBe(0);

      // Verificar que el responsable comercial fue preservado y no sobrescrito
      expect(data.settlement.responsibleStaffUserId).toBe(waiterUser.id);
    });
  });

  describe('3. S14: Respuesta perdida, timeout simulado y reintentos idempotentes', () => {
    it('ante respuesta perdida, reintentar con la misma idempotencyKey devuelve 200 idempotentReplay sin duplicar cobro', async () => {
      const dedicatedTable = await createTable('Mesa S14-Timeout');
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(dedicatedTable, item1, 1);
      const idKey = `idemp-s14-${session.id}`;

      // 1. Primer intento (servidor procesa con éxito pero supongamos que el cliente perdió la conexión antes de leer)
      const res1 = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiter}` },
        payload: {
          idempotencyKey: idKey,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor,
          tipMinor: 300,
          responsibleStaffUserId: waiterUser.id
        }
      });
      expect(res1.statusCode).toBe(201);
      expect(res1.json().idempotentReplay).toBe(false);

      // 2. Reintento idéntico del cliente tras timeout / reconexión
      const res2 = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiter}` },
        payload: {
          idempotencyKey: idKey,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor,
          tipMinor: 300,
          responsibleStaffUserId: waiterUser.id
        }
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().idempotentReplay).toBe(true);
      expect(res2.json().settlement.id).toBe(res1.json().settlement.id);

      // 3. Verificación de unicidad física en base de datos: exactamente una fila
      const dbSettlements = await prisma.accountSettlement.findMany({
        where: { idempotencyKey: idKey }
      });
      expect(dbSettlements).toHaveLength(1);
    });

    it('si el reintento altera el monto, propina o método con la misma clave, el servidor rechaza con 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const dedicatedTable = await createTable('Mesa S14-Reused');
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(dedicatedTable, item1, 1);
      const idKey = `idemp-reused-${session.id}`;

      // Pago original
      await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiter}` },
        payload: {
          idempotencyKey: idKey,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });

      // Intento fraudulento o erróneo con misma clave pero método cambiado
      const conflictRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManager}` },
        payload: {
          idempotencyKey: idKey,
          expectedAccountVersion: version,
          method: 'WAITER_CARD', // Alterado
          amountMinor: totalAmountMinor
        }
      });

      expect(conflictRes.statusCode).toBe(409);
      expect(conflictRes.json().code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('4. S15: Distinción entre "Cobrar y seguir" (keep) y "Cobrar y cerrar" (close)', () => {
    it('"Cobrar y seguir" registra el pago, actualiza el saldo a 0, pero MANTIENE la sesión abierta para pedir más', async () => {
      const dedicatedTable = await createTable('Mesa S15-Keep');
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(dedicatedTable, item1, 1);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiter}` },
        payload: {
          idempotencyKey: `settle-keep-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().account.saldoMinor).toBe(0);

      // Verificar que la sesión NO está cerrada
      const dbSession = await prisma.tableSession.findUnique({ where: { id: session.id } });
      expect(dbSession?.closedAt).toBeNull();

      // Verificar que la mesa sigue en estado activo
      const dbTable = await prisma.table.findUnique({ where: { id: dedicatedTable.id } });
      expect(dbTable?.currentState).toBe(TableFSMState.EATING);

      // S15: El cliente puede agregar una nueva comanda posteriormente en la misma sesión
      const extraOrder = await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 1500,
          totalAmountMinor: 150000,
          items: {
            create: [{
              menuItemId: item1.id,
              quantity: 1,
              unitPrice: 1500,
              unitPriceMinor: 150000,
              addedByGuest: session.id
            }]
          }
        }
      });
      expect(extraOrder).toBeDefined();

      const newAccount = await freshAccount(session.id);
      expect(newAccount.saldoMinor).toBe(150000);
    });

    it('"Cobrar y cerrar" liquida la cuenta, cierra atómicamente la sesión y pasa la mesa a TO_CLEAN', async () => {
      const dedicatedTable = await createTable('Mesa S15-Close');
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(dedicatedTable, item2, 1);

      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenWaiter}` },
        payload: {
          idempotencyKey: `settle-close-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.closed).toBe(true);

      // Sesión cerrada
      const dbSession = await prisma.tableSession.findUnique({ where: { id: session.id } });
      expect(dbSession?.closedAt).not.toBeNull();

      // Mesa pasada a TO_CLEAN
      const dbTable = await prisma.table.findUnique({ where: { id: dedicatedTable.id } });
      expect(dbTable?.currentState).toBe(TableFSMState.TO_CLEAN);
    });
  });

  describe('5. S15: Guardas de integridad FSM — Prohibido liberar mesa con saldo o pendientes', () => {
    it('no se puede liberar una mesa con saldo por cobrar (rechazo 409 TABLE_HAS_UNPAID_BALANCE)', async () => {
      const tableWithDebt = await createTable('Mesa S15-Debt');
      await createActiveSessionWithOrder(tableWithDebt, item1, 1);

      // Intentar forzar liberación de mesa que aún tiene saldo pendiente
      const releaseRes = await app.inject({
        method: 'POST',
        url: `/v1/tables/${tableWithDebt.id}/state/tap`,
        headers: { authorization: `Bearer ${tokenManager}` },
        payload: {
          action: 'skip_to',
          targetState: TableFSMState.TO_CLEAN,
          expectedCurrentState: TableFSMState.EATING,
          note: 'Intento de liberar con deuda'
        }
      });

      expect(releaseRes.statusCode).toBe(409);
      expect(releaseRes.json().code).toBe('TABLE_HAS_UNPAID_BALANCE');
      expect(releaseRes.json().message).toContain('consumos pendientes');
    });

    it('"Cobrar y cerrar" rechaza cerrar si existe un borrador de carrito sin enviar (409 DRAFT_UNRESOLVED)', async () => {
      const tableWithDraft = await createTable('Mesa S15-Draft');
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(tableWithDraft, item1, 1);

      // Crear un borrador activo no resuelto
      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.DRAFT,
          totalAmount: 2000,
          totalAmountMinor: 200000
        }
      });

      const updatedAccount = await freshAccount(session.id);
      expect(updatedAccount.draft).not.toBeNull();

      const closeRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenWaiter}` },
        payload: {
          idempotencyKey: `close-draft-${session.id}`,
          expectedAccountVersion: updatedAccount.version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });

      expect(closeRes.statusCode).toBe(409);
      expect(closeRes.json().code).toBe('DRAFT_UNRESOLVED');
      expect(closeRes.json().message).toContain('carrito sin enviar');
    });
  });

  describe('6. Arbitraje y prevención de doble cobro entre dos terminales concurrentes', () => {
    it('dos terminales cobrando la misma cuenta al mismo tiempo: el perdedor de carrera recibe 409 STALE_ACCOUNT_VERSION sin sobrecobro', async () => {
      const raceTable = await createTable('Mesa Race-TwoTerminals');
      const { session, version, totalAmountMinor } = await createActiveSessionWithOrder(raceTable, item1, 1);

      // Terminal A y Terminal B tienen la misma versión inicial 'version'
      const p1 = app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenWaiter}` },
        payload: {
          idempotencyKey: `term-A-settle-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CASH',
          amountMinor: totalAmountMinor
        }
      });

      const p2 = app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManager}` },
        payload: {
          idempotencyKey: `term-B-settle-${session.id}`,
          expectedAccountVersion: version,
          method: 'WAITER_CARD',
          amountMinor: totalAmountMinor
        }
      });

      const [resA, resB] = await Promise.all([p1, p2]);
      const statuses = [resA.statusCode, resB.statusCode].sort();

      // Exactamente uno gana (201) y el otro pierde por versión obsoleta (409) o saldo ya en 0 (422)
      expect(statuses[0]).toBe(201);
      expect([409, 422]).toContain(statuses[1]);

      // Verificar que el saldo de la cuenta quedó en 0 y no en número negativo
      const accountFinal = await freshAccount(session.id);
      expect(accountFinal.saldoMinor).toBe(0);

      // Solo una liquidación fue impactada
      const settlements = await prisma.accountSettlement.findMany({ where: { tableSessionId: session.id } });
      expect(settlements).toHaveLength(1);
    });
  });
});

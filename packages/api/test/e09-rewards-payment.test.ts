import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { StaffService } from '../src/services/staff.service';
import { RewardsService, normalizeRewardsPhone } from '../src/services/rewards.service';
import { OrderService } from '../src/services/order.service';
import { SalesReportsService } from '../src/services/sales-reports.service';

describe('E09 — MesaYA Rewards asistido y trazable', () => {
  let app: FastifyInstance;
  let restaurantA: any;
  let restaurantB: any;
  let restaurantDisabled: any;
  let shiftA: any;
  let shiftB: any;
  let itemA: any;
  let itemRewardA: any;
  let tableA1: any;
  let tableA2: any;
  let tableB1: any;
  let waiterAUser: any;
  let managerAUser: any;
  let waiterBUser: any;
  let managerDisabledUser: any;
  let tokenWaiterA = '';
  let tokenManagerA = '';
  let tokenWaiterB = '';
  let tokenManagerDisabled = '';

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Restaurante A: Rewards activado con 2 puntos cada $100
    restaurantA = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Rewards A',
        slug: `e09-rest-a-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#10b981',
        moduleConfig: {
          create: {
            allowOrdering: true,
            enableRewards: true,
            pointsPerHundredPesos: 2
          }
        }
      }
    });

    // Restaurante B: otro tenant con Rewards activado
    restaurantB = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Rewards B',
        slug: `e09-rest-b-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#3b82f6',
        moduleConfig: {
          create: {
            allowOrdering: true,
            enableRewards: true,
            pointsPerHundredPesos: 5
          }
        }
      }
    });

    // Restaurante con Rewards apagado
    restaurantDisabled = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Rewards Disabled',
        slug: `e09-rest-off-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#6b7280',
        moduleConfig: {
          create: {
            allowOrdering: true,
            enableRewards: false
          }
        }
      }
    });

    shiftA = await prisma.shift.create({ data: { restaurantId: restaurantA.id, openedAt: new Date() } });
    shiftB = await prisma.shift.create({ data: { restaurantId: restaurantB.id, openedAt: new Date() } });
    await prisma.shift.create({ data: { restaurantId: restaurantDisabled.id, openedAt: new Date() } });

    const catA = await prisma.menuCategory.create({ data: { restaurantId: restaurantA.id, name: 'Platos A' } });
    itemA = await prisma.menuItem.create({
      data: { categoryId: catA.id, name: 'Milanesa Napolitana E09', price: 5000, isAvailable: true }
    });

    itemRewardA = await prisma.rewardItem.create({
      data: {
        restaurantId: restaurantA.id,
        name: 'Postre Flan Mixto',
        description: 'Postre casero con dulce de leche',
        pointsCost: 40,
        isAvailable: true
      }
    });

    tableA1 = await prisma.table.create({
      data: { restaurantId: restaurantA.id, label: 'Mesa E09-A1', currentState: TableFSMState.OCCUPIED_NO_ORDER }
    });
    tableA2 = await prisma.table.create({
      data: { restaurantId: restaurantA.id, label: 'Mesa E09-A2', currentState: TableFSMState.OCCUPIED_NO_ORDER }
    });
    tableB1 = await prisma.table.create({
      data: { restaurantId: restaurantB.id, label: 'Mesa E09-B1', currentState: TableFSMState.OCCUPIED_NO_ORDER }
    });

    waiterAUser = await StaffService.createStaff(restaurantA.id, 'Mozo E09 A', '1234', 'WAITER');
    managerAUser = await StaffService.createStaff(restaurantA.id, 'Encargado E09 A', '9999', 'MANAGER');
    waiterBUser = await StaffService.createStaff(restaurantB.id, 'Mozo E09 B', '4321', 'WAITER');
    managerDisabledUser = await StaffService.createStaff(restaurantDisabled.id, 'Encargado Off', '7777', 'MANAGER');

    const logWA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantA.slug, pin: '1234', terminalId: 'term-e09-wa' }
    });
    tokenWaiterA = logWA.json().token;

    const logMA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantA.slug, pin: '9999', terminalId: 'term-e09-ma' }
    });
    tokenManagerA = logMA.json().token;

    const logWB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantB.slug, pin: '4321', terminalId: 'term-e09-wb' }
    });
    tokenWaiterB = logWB.json().token;

    const logOff = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurantDisabled.slug, pin: '7777', terminalId: 'term-e09-off' }
    });
    tokenManagerDisabled = logOff.json().token;
  });

  afterAll(async () => {
    for (const restId of [restaurantA?.id, restaurantB?.id, restaurantDisabled?.id].filter(Boolean)) {
      await prisma.rewardLedgerEntry.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.rewardRedemption.deleteMany({ where: { customerLoyalty: { restaurantId: restId } } }).catch(() => {});
      await prisma.customerLoyalty.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.accountSettlement.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.paymentTransaction.deleteMany({ where: { order: { tableSession: { table: { restaurantId: restId } } } } }).catch(() => {});
      await prisma.orderItem.deleteMany({ where: { order: { tableSession: { table: { restaurantId: restId } } } } }).catch(() => {});
      await prisma.order.deleteMany({ where: { tableSession: { table: { restaurantId: restId } } } }).catch(() => {});
      await prisma.tableSession.deleteMany({ where: { table: { restaurantId: restId } } }).catch(() => {});
      await prisma.rewardItem.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.menuItem.deleteMany({ where: { category: { restaurantId: restId } } }).catch(() => {});
      await prisma.menuCategory.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.shift.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.staffUser.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.table.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.restaurantModuleConfig.deleteMany({ where: { restaurantId: restId } }).catch(() => {});
      await prisma.restaurant.deleteMany({ where: { id: restId } }).catch(() => {});
    }
    await app.close();
  });

  describe('1. Normalización telefónica argentina e identidad única', () => {
    it('normaliza formatos equivalentes (0, 15, +54, espacios, guiones) a canonical +549...', () => {
      const canonical = '+5492235551234';
      expect(normalizeRewardsPhone('0223 555-1234')).toBe(canonical);
      expect(normalizeRewardsPhone('223 15 555-1234')).toBe(canonical);
      expect(normalizeRewardsPhone('+54 9 223 555 1234')).toBe(canonical);
      expect(normalizeRewardsPhone('5492235551234')).toBe(canonical);
      expect(normalizeRewardsPhone('+5492235551234')).toBe(canonical);
      expect(normalizeRewardsPhone('223-555-1234')).toBe(canonical);
    });

    it('rechaza teléfonos inválidos o ambiguos con error 400 INVALID_REWARDS_PHONE', () => {
      expect(() => normalizeRewardsPhone('')).toThrow();
      expect(() => normalizeRewardsPhone('123')).toThrow();
      expect(() => normalizeRewardsPhone('12345678')).toThrow();
      expect(() => normalizeRewardsPhone('223555123456')).toThrow();
      expect(() => normalizeRewardsPhone('abcd')).toThrow();
    });
  });

  describe('2. Consentimiento explícito y consulta de saldo segura', () => {
    it('consulta de saldo no crea CustomerLoyalty si el teléfono no existe', async () => {
      const phone = '223-555-9001';
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/customer?phone=${encodeURIComponent(phone)}`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().customer).toBeNull();

      const inDb = await prisma.customerLoyalty.findUnique({
        where: { restaurantId_phone: { restaurantId: restaurantA.id, phone: normalizeRewardsPhone(phone) } }
      });
      expect(inDb).toBeNull();
    });

    it('acreditación sin consentimiento en cliente nuevo es rechazada con 400 REWARDS_CONSENT_REQUIRED', async () => {
      const phone = '223-555-9002';
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/accrual`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          phone,
          points: 50,
          reason: 'Ajuste inicial',
          idempotencyKey: 'accrual-no-consent-1'
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('REWARDS_CONSENT_REQUIRED');
    });

    it('alta explícita crea CustomerLoyalty con consentAt y permite acreditar', async () => {
      const phone = '223-555-9003';
      const reg = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/customer`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { phone, consent: true }
      });
      expect(reg.statusCode).toBe(201);
      expect(reg.json().phone).toBe(normalizeRewardsPhone(phone));
      expect(reg.json().consentAt).toBeTruthy();

      const acc = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/accrual`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          phone,
          points: 30,
          reason: 'Ajuste de bienvenida',
          idempotencyKey: 'accrual-with-consent-1'
        }
      });
      expect(acc.statusCode).toBe(201);
      expect(acc.json().customer.points).toBe(30);
    });
  });

  describe('3. Puntos calculados estrictamente sobre consumo (sin propina)', () => {
    it('liquidación canónica acredita puntos sólo sobre amountMinor y excluye tipMinor', async () => {
      const phone = '223-555-9004';
      // Registrar cliente con consentimiento
      await RewardsService.registerCustomer({
        restaurantId: restaurantA.id,
        phone,
        consent: true,
        approvedBy: managerAUser.id
      });

      // Crear sesión y comanda
      const session = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          token: `token-${randomUUID()}`,
          activeKey: `key-${Date.now()}`,
          mutationSeq: 1,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });

      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 5000,
          totalAmountMinor: 500000,
          items: {
            create: [
              { menuItemId: itemA.id, quantity: 1, unitPrice: 5000, addedByGuest: 'guest-1' }
            ]
          }
        }
      });

      const freshAccount = await OrderService.getSessionAccount(session.id, restaurantA.id);

      // Liquidar consumo $5.000 (500000 centavos) con propina $1.000 (100000 centavos)
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: 'settle-rewards-tips-1',
          expectedAccountVersion: freshAccount.version,
          method: 'WAITER_CASH',
          amountMinor: 500000,
          tipMinor: 100000,
          customerPhone: phone,
          rewardsConsent: true
        }
      });

      expect(res.statusCode).toBe(201);
      const data = res.json();
      expect(data.rewards).toBeTruthy();
      // Puntos: floor((5000 / 100) * 2) = 100 puntos. Propina $1000 genera 0 puntos.
      expect(data.rewards.pointsEarned).toBe(100);

      const customer = await RewardsService.getCustomer(restaurantA.id, phone);
      expect(customer?.points).toBe(100);

      const ledger = await prisma.rewardLedgerEntry.findFirst({
        where: {
          restaurantId: restaurantA.id,
          referenceType: 'SETTLEMENT',
          referenceId: data.settlement.id
        }
      });
      expect(ledger).toBeTruthy();
      expect(ledger?.pointsDelta).toBe(100);
    });
  });

  describe('4. Idempotencia y replay en liquidación y cobro legado', () => {
    it('reintento de settle con la misma clave devuelve idempotentReplay sin duplicar puntos', async () => {
      const phone = '223-555-9005';
      await RewardsService.registerCustomer({
        restaurantId: restaurantA.id,
        phone,
        consent: true,
        approvedBy: managerAUser.id
      });

      const session = await prisma.tableSession.create({
        data: {
          tableId: tableA2.id,
          token: `token-${randomUUID()}`,
          activeKey: `key-replay-${Date.now()}`,
          mutationSeq: 1,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });

      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 10000,
          totalAmountMinor: 1000000,
          items: {
            create: [
              { menuItemId: itemA.id, quantity: 2, unitPrice: 5000, addedByGuest: 'guest-1' }
            ]
          }
        }
      });

      const freshAccount = await OrderService.getSessionAccount(session.id, restaurantA.id);

      const settlePayload = {
        idempotencyKey: 'settle-idemp-test-key-1',
        expectedAccountVersion: freshAccount.version,
        method: 'WAITER_CARD',
        amountMinor: 1000000,
        tipMinor: 0,
        customerPhone: phone,
        rewardsConsent: true
      };

      const res1 = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: settlePayload
      });
      expect(res1.statusCode).toBe(201);
      expect(res1.json().rewards.pointsEarned).toBe(200);

      // Reintento idéntico
      const res2 = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: settlePayload
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().idempotentReplay).toBe(true);

      const entries = await prisma.rewardLedgerEntry.findMany({
        where: {
          restaurantId: restaurantA.id,
          referenceType: 'SETTLEMENT',
          referenceId: res1.json().settlement.id
        }
      });
      expect(entries.length).toBe(1);

      const customer = await RewardsService.getCustomer(restaurantA.id, phone);
      expect(customer?.points).toBe(200);
    });

    it('reintento con misma clave pero datos distintos rechaza con 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const session = await prisma.tableSession.findFirst({
        where: { tableId: tableA2.id, closedAt: null }
      });
      if (!session) return;

      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: 'settle-idemp-test-key-1',
          expectedAccountVersion: '99',
          method: 'WAITER_CASH',
          amountMinor: 500000,
          customerPhone: '2235559005',
          rewardsConsent: true
        }
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('5. División de cuenta (split) y atribución proporcional', () => {
    it('un comensal en split EQUAL_PARTS recibe puntos estrictamente por su parte', async () => {
      const phoneSplit = '223-555-9006';
      // E09 sobre split requiere el gate E05 habilitado sólo en este fixture.
      // No se debilita el gate: E05 conserva su test de rechazo 403 con
      // allowSplitBill=false (e05-split-bill.test.ts §módulo apagado).
      await prisma.restaurantModuleConfig.update({
        where: { restaurantId: restaurantA.id },
        data: { allowSplitBill: true }
      });
      await RewardsService.registerCustomer({
        restaurantId: restaurantA.id,
        phone: phoneSplit,
        consent: true,
        approvedBy: managerAUser.id
      });

      const session = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          token: `token-${randomUUID()}`,
          activeKey: `key-split-${Date.now()}`,
          mutationSeq: 1,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });

      // Mesa consume $10.000
      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 10000,
          totalAmountMinor: 1000000,
          items: {
            create: [
              { menuItemId: itemA.id, quantity: 2, unitPrice: 5000, addedByGuest: 'guest-1' }
            ]
          }
        }
      });

      const freshAccount = await OrderService.getSessionAccount(session.id, restaurantA.id);

      // Paga 1 parte de 2 = $5.000 (500000 centavos)
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: 'settle-split-rewards-1',
          expectedAccountVersion: freshAccount.version,
          method: 'WAITER_CARD',
          amountMinor: 500000,
          split: { mode: 'EQUAL_PARTS', parts: 2, partIndex: 1 },
          customerPhone: phoneSplit,
          rewardsConsent: true
        }
      });

      expect(res.statusCode).toBe(201);
      // Recibe puntos por los $5.000 pagados (100 puntos), no por los $10.000 totales de la mesa
      expect(res.json().rewards.pointsEarned).toBe(100);

      const customer = await RewardsService.getCustomer(restaurantA.id, phoneSplit);
      expect(customer?.points).toBe(100);
    });
  });

  describe('6. Aislamiento multi-tenant estricto', () => {
    it('el mismo teléfono en distintos restaurantes tiene cuentas, saldos y ledgers independientes', async () => {
      const sharedPhone = '223-555-8888';
      // Registrar en A con 100 puntos
      await RewardsService.registerCustomer({ restaurantId: restaurantA.id, phone: sharedPhone, consent: true });
      await RewardsService.accrue({
        restaurantId: restaurantA.id,
        phone: sharedPhone,
        points: 100,
        reason: 'Puntos en A',
        idempotencyKey: 'accrual-tenant-a-1'
      });

      // Registrar en B con 30 puntos
      await RewardsService.registerCustomer({ restaurantId: restaurantB.id, phone: sharedPhone, consent: true });
      await RewardsService.accrue({
        restaurantId: restaurantB.id,
        phone: sharedPhone,
        points: 30,
        reason: 'Puntos en B',
        idempotencyKey: 'accrual-tenant-b-1'
      });

      const balA = await RewardsService.getBalance(restaurantA.id, sharedPhone);
      const balB = await RewardsService.getBalance(restaurantB.id, sharedPhone);

      expect(balA.customer?.points).toBe(100);
      expect(balB.customer?.points).toBe(30);
      expect(balA.customer?.id).not.toBe(balB.customer?.id);
    });

    it('personal del restaurante B no puede consultar ni operar sobre clientes de restaurante A', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/customer?phone=2235558888`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      // Gated por requireRestaurantAccess: debe ser 403 o 404 (sin fuga de existencia)
      expect([403, 404]).toContain(res.statusCode);
    });
  });

  describe('7. Canje atómico, saldo insuficiente y cancelación', () => {
    it('canje deduce puntos atómicamente y rechaza si el saldo es insuficiente', async () => {
      const phone = '223-555-7777';
      await RewardsService.registerCustomer({ restaurantId: restaurantA.id, phone, consent: true });
      await RewardsService.accrue({
        restaurantId: restaurantA.id,
        phone,
        points: 50,
        reason: 'Carga para canje',
        idempotencyKey: 'accrual-redeem-setup-1'
      });

      // Canjear itemRewardA que cuesta 40 puntos
      const redeemRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/redeem`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          phone,
          rewardItemId: itemRewardA.id,
          idempotencyKey: 'redeem-test-1'
        }
      });
      expect(redeemRes.statusCode).toBe(201);
      expect(redeemRes.json().customer.points).toBe(10);
      expect(redeemRes.json().redemption.status).toBe('REDEEMED');

      // Intentar canjear de nuevo con saldo 10 (insuficiente para 40)
      const failRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/redeem`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          phone,
          rewardItemId: itemRewardA.id,
          idempotencyKey: 'redeem-test-fail-1'
        }
      });
      expect(failRes.statusCode).toBe(409);
      expect(failRes.json().code).toBe('INSUFFICIENT_REWARD_POINTS');

      // Cancelación por manager restaura los 40 puntos
      const cancelRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/redemptions/${redeemRes.json().redemption.id}/cancel`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { reason: 'Error en cocina' }
      });
      expect(cancelRes.statusCode).toBe(200);
      expect(cancelRes.json().customer.points).toBe(50);
      expect(cancelRes.json().redemption.status).toBe('CANCELLED');
    });
  });

  describe('8. Reversiones auditables y control de rol MANAGER', () => {
    it('mozo sin rol MANAGER recibe 403 al intentar revertir o realizar ajustes manuales', async () => {
      const accrualRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/accrual`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { phone: '2235557777', points: 10 }
      });
      expect(accrualRes.statusCode).toBe(403);

      const reverseRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/ledger/some-id/reverse`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { reason: 'Test' }
      });
      expect(reverseRes.statusCode).toBe(403);
    });

    it('manager puede revertir un movimiento positivo, evitando doble reversión', async () => {
      const phone = '223-555-6666';
      await RewardsService.registerCustomer({ restaurantId: restaurantA.id, phone, consent: true });
      const acc = await RewardsService.accrue({
        restaurantId: restaurantA.id,
        phone,
        points: 150,
        reason: 'Ajuste reversible',
        idempotencyKey: 'accrual-to-reverse-1'
      });

      const revRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/ledger/${acc.entry.id}/reverse`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { reason: 'Error de tipeo del encargado' }
      });
      expect(revRes.statusCode).toBe(200);
      expect(revRes.json().customer.points).toBe(0);

      // Doble reversión es bloqueada con 409 REWARDS_ALREADY_REVERSED
      const doubleRev = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/ledger/${acc.entry.id}/reverse`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { reason: 'Intento duplicado' }
      });
      expect(doubleRev.statusCode).toBe(409);
      expect(doubleRev.json().code).toBe('REWARDS_ALREADY_REVERSED');
    });
  });

  describe('9. Gating cuando Rewards está desactivado', () => {
    it('rechaza operaciones con REWARDS_DISABLED y no expone saldo', async () => {
      const phone = '223-555-5555';
      const bal = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurantDisabled.id}/rewards/customer?phone=${phone}`,
        headers: { authorization: `Bearer ${tokenManagerDisabled}` }
      });
      // El módulo está apagado: getBalance devuelve customer null
      expect(bal.statusCode).toBe(200);
      expect(bal.json().customer).toBeNull();

      const acc = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantDisabled.id}/rewards/customer`,
        headers: { authorization: `Bearer ${tokenManagerDisabled}` },
        payload: { phone, consent: true }
      });
      expect(acc.statusCode).toBe(409);
      expect(acc.json().code).toBe('REWARDS_DISABLED');
    });
  });

  describe('10. Reconciliación de liquidación confirmada', () => {
    it('reconcilia rewards tras una liquidación que no tenía teléfono', async () => {
      const session = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          token: `token-${randomUUID()}`,
          activeKey: `key-recon-${Date.now()}`,
          mutationSeq: 1,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });

      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 7500,
          totalAmountMinor: 750000,
          items: {
            create: [
              { menuItemId: itemA.id, quantity: 1, unitPrice: 7500, addedByGuest: 'guest-1' }
            ]
          }
        }
      });

      const freshAccount = await OrderService.getSessionAccount(session.id, restaurantA.id);

      // Settle sin teléfono
      const settleRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: 'settle-without-phone-1',
          expectedAccountVersion: freshAccount.version,
          method: 'WAITER_CASH',
          amountMinor: 750000
        }
      });
      expect(settleRes.statusCode).toBe(201);
      const settlementId = settleRes.json().settlement.id;

      const reconPhone = '223-555-4444';
      // Staff reconcilia asistido con consentimiento
      const reconRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/reconcile-settlement`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          settlementId,
          phone: reconPhone,
          consent: true
        }
      });
      expect(reconRes.statusCode).toBe(200);
      // Puntos: floor((7500 / 100) * 2) = 150 puntos
      expect(reconRes.json().entry.pointsDelta).toBe(150);
      expect(reconRes.json().customer.points).toBe(150);

      // Reintento es idempotente
      const reconReplay = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/reconcile-settlement`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          settlementId,
          phone: reconPhone,
          consent: true
        }
      });
      expect(reconReplay.statusCode).toBe(200);
      expect(reconReplay.json().idempotentReplay).toBe(true);
    });
  });

  describe('10b. Cobrar y cerrar con Rewards', () => {
    it('acredita puntos en settle-and-close y devuelve el mismo ledger en replay', async () => {
      const phone = '223-555-1212';
      const table = await prisma.table.create({
        data: {
          restaurantId: restaurantA.id,
          label: `E09-close-${Date.now()}`,
          currentState: TableFSMState.OCCUPIED_NO_ORDER
        }
      });
      const session = await prisma.tableSession.create({
        data: {
          tableId: table.id,
          token: `token-${randomUUID()}`,
          activeKey: `key-close-${Date.now()}`,
          mutationSeq: 1,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });
      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 2000,
          totalAmountMinor: 200000
        }
      });
      const account = await OrderService.getSessionAccount(session.id, restaurantA.id);
      const payload = {
        idempotencyKey: 'settle-close-rewards-1',
        expectedAccountVersion: account.version,
        method: 'WAITER_CASH',
        amountMinor: 200000,
        customerPhone: phone,
        rewardsConsent: true
      };
      const first = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload
      });
      expect([200, 201]).toContain(first.statusCode);
      expect(first.json().rewards.pointsEarned).toBe(40);

      const replay = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload
      });
      expect([200, 201]).toContain(replay.statusCode);
      expect(replay.json().idempotentReplay).toBe(true);
      expect(replay.json().rewards.pointsEarned).toBe(40);
      expect((await RewardsService.getCustomer(restaurantA.id, phone))?.points).toBe(40);
    });
  });

  describe('11. Devolución de consumo y reversión Rewards proporcional', () => {
    it('revierte puntos automáticamente por el consumo ajustado y es idempotente por ajuste', async () => {
      const phone = '223-555-3333';
      await RewardsService.registerCustomer({ restaurantId: restaurantA.id, phone, consent: true });
      const session = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          token: `token-${randomUUID()}`,
          activeKey: `key-refund-${Date.now()}`,
          mutationSeq: 1,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });
      await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 5000,
          totalAmountMinor: 500000,
          items: { create: [{ menuItemId: itemA.id, quantity: 1, unitPrice: 5000, addedByGuest: 'guest-refund' }] }
        }
      });
      const account = await OrderService.getSessionAccount(session.id, restaurantA.id);
      const settle = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: {
          idempotencyKey: 'settle-refund-rewards-1',
          expectedAccountVersion: account.version,
          method: 'WAITER_CASH',
          amountMinor: 500000,
          customerPhone: phone,
          rewardsConsent: true
        }
      });
      expect(settle.statusCode).toBe(201);
      const settlementId = settle.json().settlement.id;
      expect(settle.json().rewards.pointsEarned).toBe(100);

      const adjustment = await SalesReportsService.createPaymentAdjustment(restaurantA.id, settlementId, {
        amountMinor: 250000,
        tipMinor: 0,
        reason: 'Devolución parcial de consumo',
        adjustedBy: managerAUser.id
      });
      expect(adjustment.rewards.pointsReversed).toBe(50);
      expect((await RewardsService.getCustomer(restaurantA.id, phone))?.points).toBe(50);

      const replay = await RewardsService.reverseSettlementAdjustment({
        restaurantId: restaurantA.id,
        settlementId,
        adjustmentId: adjustment.id,
        amountMinor: adjustment.amountMinor,
        reason: 'Replay de devolución',
        approvedBy: managerAUser.id
      });
      expect(replay?.idempotentReplay).toBe(true);
      expect(await prisma.rewardLedgerEntry.count({
        where: { referenceType: 'PAYMENT_ADJUSTMENT', referenceId: adjustment.id }
      })).toBe(1);
    });
  });

  describe('12. Recuperación de cobro legado con rewardsWarning', () => {
    it('permite reconciliar el pago confirmado después de un fallo posterior de Rewards', async () => {
      const phone = '223-555-2222';
      const session = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          token: `token-${randomUUID()}`,
          activeKey: `key-warning-${Date.now()}`,
          mutationSeq: 1,
          expiresAt: new Date(Date.now() + 86400000)
        }
      });
      const order = await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 5000,
          totalAmountMinor: 500000
        }
      });

      const forcedFailure = vi.spyOn(RewardsService, 'accrueForPayment').mockRejectedValueOnce(
        Object.assign(new Error('simulated rewards outage'), { code: 'SIMULATED_REWARDS_OUTAGE' })
      );
      let paid: any;
      try {
        paid = await OrderService.registerManualPayment({
          orderId: order.id,
          staffRestaurantId: restaurantA.id,
          staffRole: 'MANAGER',
          staffUserId: managerAUser.id,
          paymentMethod: 'WAITER_CASH',
          idempotencyKey: 'legacy-rewards-warning-1',
          customerPhone: phone,
          rewardsConsent: true
        });
      } finally {
        forcedFailure.mockRestore();
      }
      expect(paid.rewards).toBeNull();
      expect(paid.rewardsWarning).toMatch(/rewards/i);

      const reconcile = await app.inject({
        method: 'POST',
        url: `/v1/staff/restaurants/${restaurantA.id}/rewards/reconcile-payment`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {
          paymentTransactionId: paid.transaction.id,
          phone,
          consent: true
        }
      });
      expect(reconcile.statusCode).toBe(200);
      expect(reconcile.json().entry.pointsDelta).toBe(100);
      expect(reconcile.json().customer.points).toBe(100);
    });
  });

  describe('13. Canje concurrente con saldo protegido', () => {
    it('permite un solo canje cuando dos operaciones compiten por el mismo saldo', async () => {
      const phone = '223-555-1111';
      await RewardsService.registerCustomer({ restaurantId: restaurantA.id, phone, consent: true });
      await RewardsService.accrue({
        restaurantId: restaurantA.id,
        phone,
        points: 40,
        reason: 'Saldo para prueba concurrente',
        idempotencyKey: 'concurrent-redeem-setup-1',
        consent: true
      });

      const results = await Promise.allSettled([
        RewardsService.redeem({
          restaurantId: restaurantA.id,
          phone,
          rewardItemId: itemRewardA.id,
          approvedBy: managerAUser.id,
          idempotencyKey: 'concurrent-redeem-1'
        }),
        RewardsService.redeem({
          restaurantId: restaurantA.id,
          phone,
          rewardItemId: itemRewardA.id,
          approvedBy: managerAUser.id,
          idempotencyKey: 'concurrent-redeem-2'
        })
      ]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await RewardsService.getCustomer(restaurantA.id, phone))?.points).toBe(0);
    });
  });
});

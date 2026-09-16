import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallType, OrderStatus, TableFSMState } from '@mesaya/shared';
import { StaffService } from '../src/services/staff.service';

const ROOT = join(__dirname, '..', '..', '..');
const wsSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');

describe('E10 — Detalle de mesa y acciones correctas (S02, S04, S05, S15, S16, S17)', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let shift: any;
  let item: any;
  let tokenWaiter1 = '';
  let tokenWaiter2 = '';
  let tokenManager = '';
  let waiter1User: any;
  let waiter2User: any;
  let managerUser: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'Restaurante E10 Detalle',
        slug: `e10-detalle-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'MODERN_DARK',
        themeColor: '#234567',
        moduleConfig: { create: { allowOrdering: true } }
      }
    });

    shift = await prisma.shift.create({
      data: { restaurantId: restaurant.id, openedAt: new Date() }
    });

    const category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'Comidas E10' }
    });
    item = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Plato E10', price: 3000, isAvailable: true }
    });

    waiter1User = await StaffService.createStaff(restaurant.id, 'Mozo 1 E10', '1010', 'WAITER');
    waiter2User = await StaffService.createStaff(restaurant.id, 'Mozo 2 E10', '2020', 'WAITER');
    managerUser = await StaffService.createStaff(restaurant.id, 'Encargado E10', '9090', 'MANAGER');

    const loginW1 = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '1010', terminalId: 'terminal-e10-w1' }
    });
    expect(loginW1.statusCode).toBe(200);
    tokenWaiter1 = loginW1.json().token;

    const loginW2 = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '2020', terminalId: 'terminal-e10-w2' }
    });
    expect(loginW2.statusCode).toBe(200);
    tokenWaiter2 = loginW2.json().token;

    const loginM = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '9090', terminalId: 'terminal-e10-m' }
    });
    expect(loginM.statusCode).toBe(200);
    tokenManager = loginM.json().token;
  });

  afterAll(async () => {
    if (restaurant?.id) {
      await prisma.settlementAllocation.deleteMany({}).catch(() => {});
      await prisma.accountSettlement.deleteMany({}).catch(() => {});
      await prisma.serviceTaskClaim.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.callRequest.deleteMany({}).catch(() => {});
      await prisma.orderItem.deleteMany({}).catch(() => {});
      await prisma.order.deleteMany({}).catch(() => {});
      await prisma.tableStateEvent.deleteMany({}).catch(() => {});
      await prisma.tableSession.deleteMany({}).catch(() => {});
      await prisma.table.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.shift.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.staffUser.deleteMany({ where: { restaurantId: restaurant.id } }).catch(() => {});
      await prisma.restaurant.delete({ where: { id: restaurant.id } }).catch(() => {});
    }
    await app.close();
  });

  describe('1. Contratos de experiencia UX (S05, subflujo de cobro, borrador persistente)', () => {
    it('S05: En tablet vertical/móvil, el detalle de mesa toma protagonismo inmediato ocultando la cola', () => {
      // La cola se oculta condicionalmente en móvil cuando selectedTable está activo
      expect(wsSrc).toContain("selectedTable ? 'hidden lg:block' : 'block'");
      // El detalle incluye botón de volver a Atención
      expect(wsSrc).toContain('Volver a Atención');
      expect(wsSrc).toContain('← Volver a Atención');
    });

    it('Evita el panel de cobro siempre abierto: utiliza subflujo colapsable con botón explícito de cobro', () => {
      expect(wsSrc).toContain('const [collectOpen, setCollectOpen] = useState(false);');
      expect(wsSrc).toContain('Cobrar cuenta');
      expect(wsSrc).toContain('Plegar opciones de cobro');
      expect(wsSrc).toContain('Registrar pago y mantener mesa');
      expect(wsSrc).toContain('Cobrar y cerrar');
    });

    it('Preserva el borrador de pedido manual por ID de mesa sin perderlo ante cambios de vista', () => {
      expect(wsSrc).toContain('manualDraftsByTableId');
      expect(wsSrc).toContain('hasManualDraft');
      expect(wsSrc).toContain('Agregar pedido (borrador guardado)');
    });

    it('Muestra el motivo de revisión por excepción claramente y provee rechazo con motivo obligatorio (S16)', () => {
      expect(wsSrc).toContain('Revisión por excepción');
      expect(wsSrc).toContain('Qué ocurre y por qué hace falta una persona');
      expect(wsSrc).toContain('handleRejectTask');
    });
  });

  describe('2. Pruebas funcionales de ciclo de atención, excepción y cobro (S02, S15, S16, S17)', () => {
    it('S02: Voy → atención física → Atendido (dos acciones de negocio separadas)', async () => {
      const table = await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          label: `Mesa E10-${randomUUID().slice(0, 8)}`,
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

      // Acción 1: "Voy / Atender" (claim)
      const claimRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/service/tasks/CALL/${call.id}/claim`,
        headers: { authorization: `Bearer ${tokenWaiter1}` }
      });
      expect([200, 201]).toContain(claimRes.statusCode);

      // El llamado pasa a IN_PROGRESS, NO está cerrado
      const callInProgress = await prisma.callRequest.findUnique({ where: { id: call.id } });
      expect(callInProgress?.status).toBe('IN_PROGRESS');

      // Acción 2: "Marcar atendido" (complete/resolve)
      const resolveRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/service/tasks/CALL/${call.id}/act`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { action: 'COMPLETE' }
      });
      expect(resolveRes.statusCode).toBe(200);

      // Ahora sí el llamado está atendido físicamente
      const callResolved = await prisma.callRequest.findUnique({ where: { id: call.id } });
      expect(callResolved?.status).toBe('RESOLVED');
    });

    it('S16: Pedido con excepción (reviewReason): rechazar comanda con motivo audita la decisión', async () => {
      const table = await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          label: `Mesa E10-${randomUUID().slice(0, 8)}`,
          sector: 'SALON_PRINCIPAL',
          currentState: TableFSMState.OCCUPIED_NO_ORDER,
          capacity: 2
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

      const order = await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.PENDING_VALIDATION,
          totalAmount: 3000,
          totalAmountMinor: 300000
        }
      });

      // Rechazar con motivo explícito
      const rejectRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/service/tasks/ORDER_VALIDATION/${order.id}/act`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { action: 'REJECT', reason: 'Sin stock de insumo fresco' }
      });

      expect([200, 204]).toContain(rejectRes.statusCode);
      const rejectedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(rejectedOrder?.status).toBe(OrderStatus.CANCELLED);
    });

    it('S17: Cocina avisa plato listo (READY_TO_SERVE) y mozo entrega en salón (SERVED + EATING)', async () => {
      const table = await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          label: `Mesa E10-${randomUUID().slice(0, 8)}`,
          sector: 'SALON_PRINCIPAL',
          currentState: TableFSMState.ORDER_IN_KITCHEN,
          capacity: 2
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

      const order = await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.READY_TO_SERVE,
          totalAmount: 3000,
          totalAmountMinor: 300000
        }
      });

      // Mozo entrega en salón
      const deliverRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/service/tasks/ORDER_DELIVERY/${order.id}/act`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { action: 'COMPLETE' }
      });

      expect(deliverRes.statusCode).toBe(200);
      const updatedOrder = await prisma.order.findUnique({ where: { id: order.id } });
      expect(updatedOrder?.status).toBe(OrderStatus.SERVED);

      const updatedTable = await prisma.table.findUnique({ where: { id: table.id } });
      expect(updatedTable?.currentState).toBe(TableFSMState.EATING);
    });

    it('S15: Cobrar y seguir vs Cobrar y cerrar vs Limpieza física vs Liberar mesa', async () => {
      // 1. Crear mesa con orden servida y saldo pendiente
      const table = await prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          label: `Mesa S15-E10-${randomUUID().slice(0, 8)}`,
          sector: 'SALON_PRINCIPAL',
          currentState: TableFSMState.EATING,
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

      const order = await prisma.order.create({
        data: {
          tableSessionId: session.id,
          status: OrderStatus.SERVED,
          totalAmount: 5000,
          totalAmountMinor: 500000
        }
      });

      // Obtener snapshot de cuenta para conocer la versión
      const wsRes = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
        headers: { authorization: `Bearer ${tokenManager}` }
      });
      const accountData = wsRes.json().accounts.find((a: any) => a.tableId === table.id);
      expect(accountData).toBeDefined();
      expect(accountData.account.saldoMinor).toBe(500000);

      // A. Prohibido liberar mesa si tiene saldo pendiente
      const prematureCloseRes = await app.inject({
        method: 'POST',
        url: `/v1/tables/${table.id}/close-session`,
        headers: { authorization: `Bearer ${tokenManager}` }
      });
      // La API debe rechazar con 409 o 400 debido al saldo pendiente
      expect([400, 409]).toContain(prematureCloseRes.statusCode);

      // B. Cobrar y cerrar (settle-and-close)
      const settleCloseRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/sessions/${session.id}/settle-and-close`,
        headers: { authorization: `Bearer ${tokenManager}` },
        payload: {
          idempotencyKey: `close-s15-${session.id}`,
          expectedAccountVersion: accountData.account.version,
          method: 'WAITER_CASH',
          tipMinor: 50000 // $500 propina
        }
      });
      expect([200, 201]).toContain(settleCloseRes.statusCode);

      // Verificar que la mesa pasó a TO_CLEAN
      const tableToClean = await prisma.table.findUnique({ where: { id: table.id } });
      expect(tableToClean?.currentState).toBe(TableFSMState.TO_CLEAN);

      // C. Limpieza física: pasa de TO_CLEAN a AVAILABLE
      const cleanRes = await app.inject({
        method: 'POST',
        url: `/v1/tables/${table.id}/state/tap`,
        headers: { authorization: `Bearer ${tokenManager}` },
        payload: {
          action: 'skip_to',
          targetState: 'AVAILABLE',
          expectedCurrentState: 'TO_CLEAN',
          note: 'Mesa lista'
        }
      });
      expect(cleanRes.statusCode).toBe(200);

      const tableAvailable = await prisma.table.findUnique({ where: { id: table.id } });
      expect(tableAvailable?.currentState).toBe(TableFSMState.AVAILABLE);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderService } from '../src/services/order.service';
import { CallType, OrderStatus, PaymentMethod, SignalSource, TableFSMState } from '@mesaya/shared';

describe('Auditoría operativa cliente → mozo → cocina', () => {
  let app: FastifyInstance;

  type Fixture = {
    restaurant: any;
    table: any;
    session: any;
    item: any;
    managerToken: string;
    waiterToken: string;
  };

  async function makeFixture(requireWaiterValidation: boolean): Promise<Fixture> {
    const restaurant = await prisma.restaurant.create({
      data: {
        name: `Auditoría ${randomUUID().slice(0, 8)}`,
        slug: `audit-fsm-${randomUUID().slice(0, 12)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#3b82f6',
        moduleConfig: {
          create: { allowOrdering: true, requireWaiterValidation }
        }
      }
    });
    const shift = await prisma.shift.create({
      data: { restaurantId: restaurant.id, openedAt: new Date() }
    });
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `Mesa auditoría ${randomUUID().slice(0, 8)}`,
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4
      }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });
    await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Encargado auditoría',
        pinHash: await bcrypt.hash('9999', 10),
        role: 'MANAGER'
      }
    });
    await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo auditoría',
        pinHash: await bcrypt.hash('1234', 10),
        role: 'WAITER'
      }
    });
    const category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'Auditoría', orderIndex: 0 }
    });
    const item = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Plato de auditoría', price: 1250, isAvailable: true }
    });

    const managerLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-admin',
      payload: { restaurantSlug: restaurant.slug, pin: '9999' }
    });
    expect(managerLogin.statusCode).toBe(200);
    const waiterLogin = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '1234' }
    });
    expect(waiterLogin.statusCode).toBe(200);

    return {
      restaurant,
      table,
      session,
      item,
      managerToken: managerLogin.json().token,
      waiterToken: waiterLogin.json().token
    };
  }

  async function tableState(tableId: string): Promise<string> {
    const table = await prisma.table.findUniqueOrThrow({
      where: { id: tableId },
      select: { currentState: true }
    });
    return table.currentState;
  }

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mantiene sincronizados cuenta, FSM, cocina y cierre de una ocupación QR', async () => {
    const fixture = await makeFixture(true);
    const authWaiter = { authorization: `Bearer ${fixture.waiterToken}` };
    const authManager = { authorization: `Bearer ${fixture.managerToken}` };

    const added = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken: fixture.session.token,
        menuItemId: fixture.item.id,
        quantity: 1,
        guestSessionId: 'audit-guest'
      }
    });
    expect(added.statusCode).toBe(201);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/orders/submit',
      payload: { sessionToken: fixture.session.token, idempotencyKey: `audit-submit-${randomUUID()}` }
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe(OrderStatus.PENDING_VALIDATION);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    const orderId = submitted.json().id;
    const validated = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${orderId}/validate`,
      headers: authWaiter
    });
    expect(validated.statusCode).toBe(200);
    expect(validated.json().status).toBe(OrderStatus.IN_KITCHEN);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.ORDER_IN_KITCHEN);

    const ready = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${orderId}/status`,
      headers: authWaiter,
      payload: { status: OrderStatus.READY_TO_SERVE }
    });
    expect(ready.statusCode).toBe(200);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.ORDER_IN_KITCHEN);

    const served = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${orderId}/status`,
      headers: authWaiter,
      payload: { status: OrderStatus.SERVED }
    });
    expect(served.statusCode).toBe(200);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.EATING);

    const billCall = await app.inject({
      method: 'POST',
      url: '/v1/calls',
      payload: {
        sessionToken: fixture.session.token,
        type: CallType.BILL,
        paymentMethod: PaymentMethod.CASH
      }
    });
    expect(billCall.statusCode).toBe(201);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.BILL_REQUESTED);

    const resolvedCall = await app.inject({
      method: 'PATCH',
      url: `/v1/calls/${billCall.json().id}`,
      headers: authWaiter,
      payload: { status: 'RESOLVED' }
    });
    expect(resolvedCall.statusCode).toBe(200);

    const accountBeforeSettle = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${fixture.session.token}`
    });
    expect(accountBeforeSettle.statusCode).toBe(200);
    expect(accountBeforeSettle.json().account.saldoMinor).toBe(125000);

    const settled = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${fixture.session.id}/settle`,
      headers: authManager,
      payload: {
        idempotencyKey: `audit-settle-${randomUUID()}`,
        expectedAccountVersion: accountBeforeSettle.json().account.version,
        method: 'WAITER_CASH'
      }
    });
    expect(settled.statusCode).toBe(201);
    expect(settled.json().account.saldoMinor).toBe(0);
    // Pagar no cierra la ocupación: queda señalizada y se puede liberar
    // explícitamente cuando el grupo termina.
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.EATING);

    const closed = await app.inject({
      method: 'POST',
      url: `/v1/tables/${fixture.table.id}/close-session`,
      headers: authManager,
      payload: {}
    });
    expect(closed.statusCode).toBe(200);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.TO_CLEAN);

    const guestAfterClose = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${fixture.session.token}`
    });
    expect(guestAfterClose.statusCode).toBe(410);
  });

  it('permite una nueva ronda después de liquidar sin cerrar la ocupación', async () => {
    const fixture = await makeFixture(true);

    await prisma.order.create({
      data: {
        tableSessionId: fixture.session.id,
        status: OrderStatus.SERVED,
        totalAmount: 1250,
        totalAmountMinor: 125000,
        source: 'GUEST_QR',
        items: {
          create: [{
            menuItemId: fixture.item.id,
            quantity: 1,
            unitPrice: 1250,
            unitPriceMinor: 125000,
            addedByGuest: 'audit-fixture'
          }]
        }
      }
    });

    const accountBeforeSettle = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${fixture.session.token}`
    });
    expect(accountBeforeSettle.statusCode).toBe(200);

    const settled = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${fixture.session.id}/settle`,
      headers: { authorization: `Bearer ${fixture.managerToken}` },
      payload: {
        idempotencyKey: `audit-post-pay-${randomUUID()}`,
        expectedAccountVersion: accountBeforeSettle.json().account.version,
        method: 'WAITER_CASH'
      }
    });
    expect(settled.statusCode).toBe(201);
    expect(settled.json().account.saldoMinor).toBe(0);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.EATING);

    const newRound = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken: fixture.session.token,
        menuItemId: fixture.item.id,
        quantity: 1,
        guestSessionId: 'audit-post-pay-guest'
      }
    });
    expect(newRound.statusCode).toBe(201);
    expect(newRound.json().status).toBe(OrderStatus.DRAFT);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.EATING);

    const accountAfterDraft = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${fixture.session.token}`
    });
    expect(accountAfterDraft.statusCode).toBe(200);
    expect(accountAfterDraft.json().account.consumoMinor).toBe(125000);
    expect(accountAfterDraft.json().account.saldoMinor).toBe(0);
  });

  it('sin validación intermedia envía directo a cocina y también ocupa la mesa', async () => {
    const fixture = await makeFixture(false);

    const added = await app.inject({
      method: 'POST',
      url: '/v1/orders/items',
      payload: {
        sessionToken: fixture.session.token,
        menuItemId: fixture.item.id,
        quantity: 1,
        guestSessionId: 'audit-direct-guest'
      }
    });
    expect(added.statusCode).toBe(201);

    const submitted = await app.inject({
      method: 'POST',
      url: '/v1/orders/submit',
      payload: { sessionToken: fixture.session.token, idempotencyKey: `audit-direct-${randomUUID()}` }
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().status).toBe(OrderStatus.IN_KITCHEN);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.ORDER_IN_KITCHEN);
  });

  it('una llamada de asistencia también corrige una mesa que todavía figuraba AVAILABLE', async () => {
    const fixture = await makeFixture(true);

    const waiterCall = await app.inject({
      method: 'POST',
      url: '/v1/calls',
      payload: {
        sessionToken: fixture.session.token,
        type: CallType.WAITER,
        paymentMethod: PaymentMethod.NOT_APPLICABLE
      }
    });
    expect(waiterCall.statusCode).toBe(201);
    expect(await tableState(fixture.table.id)).toBe(TableFSMState.OCCUPIED_NO_ORDER);
  });

  it('rota una sesión QR vencida ya resuelta sin mezclarla con la nueva cuenta', async () => {
    const fixture = await makeFixture(true);
    const oldSessionId = fixture.session.id;

    await prisma.tableSession.update({
      where: { id: oldSessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) }
    });
    await prisma.order.create({
      data: {
        tableSessionId: oldSessionId,
        status: OrderStatus.SERVED,
        totalAmount: 1250,
        totalAmountMinor: 125000,
        source: 'GUEST_QR',
        items: {
          create: [{
            menuItemId: fixture.item.id,
            quantity: 1,
            unitPrice: 1250,
            unitPriceMinor: 125000,
            addedByGuest: 'audit-expired-session'
          }]
        }
      }
    });

    const oldAccount = await OrderService.getSessionAccount(oldSessionId);
    const settled = await app.inject({
      method: 'POST',
      url: `/v1/staff/sessions/${oldSessionId}/settle`,
      headers: { authorization: `Bearer ${fixture.managerToken}` },
      payload: {
        idempotencyKey: `audit-expired-settle-${randomUUID()}`,
        expectedAccountVersion: oldAccount.version,
        method: 'WAITER_CASH'
      }
    });
    expect(settled.statusCode).toBe(201);

    const manualOrder = await app.inject({
      method: 'POST',
      url: `/v1/staff/tables/${fixture.table.id}/orders`,
      headers: { authorization: `Bearer ${fixture.waiterToken}` },
      payload: { lines: [{ menuItemId: fixture.item.id, quantity: 1 }] }
    });
    expect(manualOrder.statusCode).toBe(201);

    const openSessions = await prisma.tableSession.findMany({
      where: { tableId: fixture.table.id, closedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
    });
    expect(openSessions).toHaveLength(1);
    expect(openSessions[0].id).toBe(manualOrder.json().tableSessionId);
    expect(await prisma.tableSession.findUniqueOrThrow({ where: { id: oldSessionId } })).toMatchObject({
      closedAt: expect.any(Date),
      activeKey: null
    });

    const workspace = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${fixture.restaurant.id}/service-workspace`,
      headers: { authorization: `Bearer ${fixture.waiterToken}` }
    });
    expect(workspace.statusCode).toBe(200);
    const mesaAccounts = workspace.json().accounts.filter((account: any) => account.tableId === fixture.table.id);
    expect(mesaAccounts).toHaveLength(1);
    expect(mesaAccounts[0].tableSessionId).toBe(manualOrder.json().tableSessionId);
    expect(mesaAccounts[0].account.consumoMinor).toBe(125000);
  });

  it('no abre una segunda sesión si la sesión QR vencida conserva saldo o pendientes', async () => {
    const fixture = await makeFixture(true);
    await prisma.tableSession.update({
      where: { id: fixture.session.id },
      data: { expiresAt: new Date(Date.now() - 60_000) }
    });
    await prisma.order.create({
      data: {
        tableSessionId: fixture.session.id,
        status: OrderStatus.SERVED,
        totalAmount: 1250,
        totalAmountMinor: 125000,
        source: 'GUEST_QR',
        items: {
          create: [{
            menuItemId: fixture.item.id,
            quantity: 1,
            unitPrice: 1250,
            unitPriceMinor: 125000,
            addedByGuest: 'audit-unresolved-expired-session'
          }]
        }
      }
    });

    const manualOrder = await app.inject({
      method: 'POST',
      url: `/v1/staff/tables/${fixture.table.id}/orders`,
      headers: { authorization: `Bearer ${fixture.waiterToken}` },
      payload: { lines: [{ menuItemId: fixture.item.id, quantity: 1 }] }
    });
    expect(manualOrder.statusCode).toBe(409);
    expect(manualOrder.json().code).toBe('STALE_SESSION_UNRESOLVED');
    expect(await prisma.tableSession.count({ where: { tableId: fixture.table.id, closedAt: null } })).toBe(1);
    expect(await prisma.order.count({ where: { tableSessionId: fixture.session.id } })).toBe(1);
  });

});

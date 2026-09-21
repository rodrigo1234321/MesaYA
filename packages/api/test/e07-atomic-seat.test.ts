import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { WaitlistService } from '../src/services/waitlist.service';
import { WaitlistStatus, TableFSMState, STATE_COLORS, STATE_EMOJIS } from '@mesaya/shared';
import { eventBus } from '../src/lib/eventBus';

describe('E07 Corrección atómica — ventana crítica seatGuest + preOrder + FSM', () => {
  let app: FastifyInstance;
  let rest: any;
  let tableA: any;
  let tableB: any;
  let tableC: any;
  let category: any;
  let itemAvailable: any;
  let itemToggle: any;
  let waiter: any;
  let manager: any;
  let tokenWaiter: string;
  let tokenManager: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    rest = await prisma.restaurant.create({
      data: {
        name: `Atomic E07 ${Date.now()}`,
        slug: `atomic-e07-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#ef4444',
        moduleConfig: { create: { enableWaitlist: true, enableWaitlistPreOrder: true, allowOrdering: true, requireWaiterValidation: false } }
      }
    });
    tableA = await prisma.table.create({ data: { restaurantId: rest.id, label: `A-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    tableB = await prisma.table.create({ data: { restaurantId: rest.id, label: `B-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    tableC = await prisma.table.create({ data: { restaurantId: rest.id, label: `C-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    category = await prisma.menuCategory.create({ data: { restaurantId: rest.id, name: 'Cat Atomic', orderIndex: 1 } });
    itemAvailable = await prisma.menuItem.create({ data: { categoryId: category.id, name: `ItemAvail-${Date.now()}`, price: 5000, priceMinor: 500000, isAvailable: true } });
    itemToggle = await prisma.menuItem.create({ data: { categoryId: category.id, name: `ItemToggle-${Date.now()}`, price: 7000, priceMinor: 700000, isAvailable: true } });
    waiter = await prisma.staffUser.create({ data: { restaurantId: rest.id, name: 'Waiter Atomic', pinHash: await bcrypt.hash('1111', 10), role: 'WAITER' } });
    manager = await prisma.staffUser.create({ data: { restaurantId: rest.id, name: 'Manager Atomic', pinHash: await bcrypt.hash('2222', 10), role: 'MANAGER' } });
    const lw = await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: rest.slug, pin: '1111' } });
    tokenWaiter = lw.json().token;
    const lm = await app.inject({ method: 'POST', url: '/v1/staff/login', payload: { restaurantSlug: rest.slug, pin: '2222' } });
    tokenManager = lm.json().token;
  });

  afterAll(async () => { WaitlistService._testSeam = undefined; await app.close(); });

  it('rollback con evento/estado: fallo de stock no deja mesa ocupada ni ticket SEATED ni comanda parcial', async () => {
    const table = await prisma.table.create({ data: { restaurantId: rest.id, label: `Rollback-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const ephemeral = await prisma.menuItem.create({ data: { categoryId: category.id, name: `Eph-${Date.now()}`, price: 9000, isAvailable: true } });
    const join = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Rollback Group', partySize: 2, phone: '2235559001', consent: true, preOrderData: [{ menuItemId: itemAvailable.id, quantity: 1 }, { menuItemId: ephemeral.id, quantity: 1 }] } });
    expect(join.statusCode).toBe(201);
    const ticketId = join.json().id;
    await prisma.menuItem.update({ where: { id: ephemeral.id }, data: { isAvailable: false } });
    const fsmBefore = await prisma.tableStateEvent.count({ where: { tableId: table.id } });
    const seat = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id } });
    expect(seat.statusCode).toBe(409);
    expect(seat.json().code).toBe('PREORDER_PROMOTION_FAILED');
    const tableAfter = await prisma.table.findUnique({ where: { id: table.id } });
    expect(tableAfter?.currentState).toBe(TableFSMState.AVAILABLE);
    const ticketAfter = await prisma.waitlistEntry.findUnique({ where: { id: ticketId } });
    expect(ticketAfter?.status).toBe(WaitlistStatus.WAITING);
    expect(ticketAfter?.seatedAt).toBeNull();
    const orders = await prisma.order.findMany({ where: { tableSession: { tableId: table.id } } });
    expect(orders).toHaveLength(0);
    const fsmAfter = await prisma.tableStateEvent.count({ where: { tableId: table.id } });
    // Con transacción única, el evento OCCUPIED no queda persistido tras rollback.
    expect(fsmAfter).toBe(fsmBefore);
  });

  it('seam: error simulado entre occupy y claim deja estado consistente (mesa AVAILABLE, ticket WAITING)', async () => {
    const table = await prisma.table.create({ data: { restaurantId: rest.id, label: `Seam-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const join = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Seam Group', partySize: 2, phone: '2235559002', consent: true } });
    const ticketId = join.json().id;
    WaitlistService._testSeam = async (phase) => { if (phase === 'after_occupy') throw Object.assign(new Error('injected crash after occupy'), { statusCode: 500, code: 'INJECTED' }); };
    const seat = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id } });
    // Debe ser 500 o 409 según mapeo, pero lo crítico es que no quede inconsistente.
    expect([500, 409]).toContain(seat.statusCode);
    WaitlistService._testSeam = undefined;
    const tableAfter = await prisma.table.findUnique({ where: { id: table.id } });
    expect(tableAfter?.currentState).toBe(TableFSMState.AVAILABLE);
    const ticketAfter = await prisma.waitlistEntry.findUnique({ where: { id: ticketId } });
    expect(ticketAfter?.status).toBe(WaitlistStatus.WAITING);
    const orders = await prisma.order.findMany({ where: { tableSession: { tableId: table.id } } });
    expect(orders).toHaveLength(0);
    // Recovery explícito debe funcionar tras el crash simulado
    const retry = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id } });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().status).toBe(WaitlistStatus.SEATED);
    const tableRetry = await prisma.table.findUnique({ where: { id: table.id } });
    expect(tableRetry?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
  });

  it('carrera: dos mesas reclamando el mismo ticket con preOrder deja exactamente 1 SEATED, 1 mesa ocupada y 1 comanda', async () => {
    const join = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Race Group', partySize: 2, phone: '2235559003', consent: true, preOrderData: [{ menuItemId: itemAvailable.id, quantity: 2 }] } });
    const ticketId = join.json().id;
    // Dos mesas libres distintas
    const t1 = await prisma.table.create({ data: { restaurantId: rest.id, label: `Race1-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const t2 = await prisma.table.create({ data: { restaurantId: rest.id, label: `Race2-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const [r1, r2] = await Promise.all([
      app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: t1.id } }),
      app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: t2.id } })
    ]);
    const success = [r1, r2].filter(r => r.statusCode === 200);
    const failed = [r1, r2].filter(r => r.statusCode === 409);
    expect(success).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(['ALREADY_SEATED', 'INVALID_WAITLIST_STATUS', 'TABLE_NOT_AVAILABLE', 'STATE_CONFLICT']).toContain(failed[0].json().code);
    const ticketAfter = await prisma.waitlistEntry.findUnique({ where: { id: ticketId } });
    expect(ticketAfter?.status).toBe(WaitlistStatus.SEATED);
    const tables = await prisma.table.findMany({ where: { id: { in: [t1.id, t2.id] } } });
    const occupied = tables.filter(t => t.currentState !== TableFSMState.AVAILABLE);
    expect(occupied).toHaveLength(1);
    const orders = await prisma.order.findMany({ where: { tableSession: { tableId: { in: [t1.id, t2.id] } } }, include: { items: true } });
    expect(orders).toHaveLength(1);
    expect(orders[0].items).toHaveLength(1);
    expect(orders[0].items[0].quantity).toBe(2);
  });

  it('reintento post-fallo: tras PREORDER_PROMOTION_FAILED el mismo ticket se puede sentar con skipPreOrder auditado', async () => {
    const table = await prisma.table.create({ data: { restaurantId: rest.id, label: `Retry-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const ephemeral = await prisma.menuItem.create({ data: { categoryId: category.id, name: `RetryEph-${Date.now()}`, price: 8000, isAvailable: true } });
    const join = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Retry Group', partySize: 2, phone: '2235559004', consent: true, preOrderData: [{ menuItemId: ephemeral.id, quantity: 1 }] } });
    const ticketId = join.json().id;
    await prisma.menuItem.update({ where: { id: ephemeral.id }, data: { isAvailable: false } });
    const fail = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id } });
    expect(fail.statusCode).toBe(409);
    expect(fail.json().code).toBe('PREORDER_PROMOTION_FAILED');
    // Reintento sin skip debe seguir fallando (misma causa)
    const fail2 = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id } });
    expect(fail2.statusCode).toBe(409);
    // Recovery con skip + reason
    const ok = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id, skipPreOrder: true, skipReason: 'Quiebre stock auditado, pedido manual' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe(WaitlistStatus.SEATED);
    const tableAfter = await prisma.table.findUnique({ where: { id: table.id } });
    expect(tableAfter?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
    const orders = await prisma.order.findMany({ where: { tableSession: { tableId: table.id } } });
    expect(orders).toHaveLength(0);
    // Auditoría FSM debe contener skipPreOrder
    const lastEvent = await prisma.tableStateEvent.findFirst({ where: { tableId: table.id }, orderBy: { createdAt: 'desc' } });
    expect(lastEvent?.metadata && String(lastEvent.metadata)).toContain('skipPreOrder');
  });

  it('autorización skipPreOrder: WAITER sin skipReason es rechazado, MANAGER sin razón pasa (PENDING_HUMAN documentado)', async () => {
    const table = await prisma.table.create({ data: { restaurantId: rest.id, label: `Auth-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const ephemeral = await prisma.menuItem.create({ data: { categoryId: category.id, name: `AuthEph-${Date.now()}`, price: 6000, isAvailable: true } });
    const join = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Auth Group', partySize: 2, phone: '2235559005', consent: true, preOrderData: [{ menuItemId: ephemeral.id, quantity: 1 }] } });
    const ticketId = join.json().id;
    await prisma.menuItem.update({ where: { id: ephemeral.id }, data: { isAvailable: false } });
    // WAITER sin reason -> 400
    const waiterNoReason = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id, skipPreOrder: true } });
    expect(waiterNoReason.statusCode).toBe(400);
    expect(waiterNoReason.json().code).toBe('SKIP_PREORDER_REQUIRES_REASON');
    const tableStill = await prisma.table.findUnique({ where: { id: table.id } });
    expect(tableStill?.currentState).toBe(TableFSMState.AVAILABLE);
    // WAITER con reason corta -> 400
    const waiterShort = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id, skipPreOrder: true, skipReason: 'x' } });
    expect(waiterShort.statusCode).toBe(400);
    expect(waiterShort.json().code).toBe('INVALID_SKIP_REASON');
    // MANAGER sin reason -> OK (bypass auditado, PENDING_HUMAN)
    const managerNoReason = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenManager}` }, payload: { tableId: table.id, skipPreOrder: true } });
    expect(managerNoReason.statusCode).toBe(200);
    expect(managerNoReason.json().status).toBe(WaitlistStatus.SEATED);
  });

  it('si cambia stock/precio o se apaga pre-order antes de sentar, la transacción revierte sin orden parcial', async () => {
    const table = await prisma.table.create({ data: { restaurantId: rest.id, label: `Toggle-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const join = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Toggle Group', partySize: 2, phone: '2235559006', consent: true, preOrderData: [{ menuItemId: itemToggle.id, quantity: 1 }] } });
    const ticketId = join.json().id;
    await prisma.restaurantModuleConfig.update({ where: { restaurantId: rest.id }, data: { enableWaitlistPreOrder: false } });
    const seat = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: table.id } });
    expect(seat.statusCode).toBe(409);
    expect(seat.json().code).toBe('PREORDER_PROMOTION_FAILED');
    const tableAfter = await prisma.table.findUnique({ where: { id: table.id } });
    expect(tableAfter?.currentState).toBe(TableFSMState.AVAILABLE);
    const ticketAfter = await prisma.waitlistEntry.findUnique({ where: { id: ticketId } });
    expect(ticketAfter?.status).toBe(WaitlistStatus.WAITING);
    const orders = await prisma.order.findMany({ where: { tableSession: { tableId: table.id } } });
    expect(orders).toHaveLength(0);
    // Restaurar para no afectar otros tests
    await prisma.restaurantModuleConfig.update({ where: { restaurantId: rest.id }, data: { enableWaitlistPreOrder: true } });
    // Recovery con skip
    const retry = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketId}/seat`, headers: { authorization: `Bearer ${tokenManager}` }, payload: { tableId: table.id, skipPreOrder: true, skipReason: 'Pre-order apagado, se toma pedido manual' } });
    expect(retry.statusCode).toBe(200);
  });

  it('broadcast table.state_changed reporta estado final comprometido: ORDER_IN_KITCHEN si promueve pre-order, OCCUPIED_NO_ORDER si es skip/sin pre-order', async () => {
    // Caso A: con pre-order promovido -> final ORDER_IN_KITCHEN con color/emoji naranja
    const spy = vi.spyOn(eventBus, 'broadcastTableState');
    const tablePromoted = await prisma.table.create({ data: { restaurantId: rest.id, label: `BcstP-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const joinP = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Bcst Promoted', partySize: 2, phone: '2235559007', consent: true, preOrderData: [{ menuItemId: itemAvailable.id, quantity: 1 }] } });
    const ticketP = joinP.json().id;
    spy.mockClear();
    const seatP = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketP}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: tablePromoted.id } });
    expect(seatP.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const payloadPromoted: any = spy.mock.calls[0][0];
    expect(payloadPromoted.newState).toBe(TableFSMState.ORDER_IN_KITCHEN);
    expect(payloadPromoted.previousState).toBe(TableFSMState.AVAILABLE);
    expect(payloadPromoted.stateColor).toBe(STATE_COLORS[TableFSMState.ORDER_IN_KITCHEN].hex);
    expect(payloadPromoted.stateEmoji).toBe(STATE_EMOJIS[TableFSMState.ORDER_IN_KITCHEN]);
    expect(payloadPromoted.tableId).toBe(tablePromoted.id);
    // DB debe coincidir con el broadcast
    const dbPromoted = await prisma.table.findUnique({ where: { id: tablePromoted.id } });
    expect(dbPromoted?.currentState).toBe(TableFSMState.ORDER_IN_KITCHEN);
    // TablaStateEvent final debe ser ORDER_IN_KITCHEN (no el intermedio OCCUPIED)
    const eventsPromoted = await prisma.tableStateEvent.findMany({ where: { tableId: tablePromoted.id }, orderBy: { createdAt: 'asc' } });
    expect(eventsPromoted[eventsPromoted.length - 1]?.toState).toBe(TableFSMState.ORDER_IN_KITCHEN);

    // Caso B: sin pre-order -> final OCCUPIED_NO_ORDER con color/emoji amarillo
    spy.mockClear();
    const tableNoPre = await prisma.table.create({ data: { restaurantId: rest.id, label: `BcstN-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const joinN = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Bcst NoPre', partySize: 2, phone: '2235559008', consent: true } });
    const ticketN = joinN.json().id;
    const seatN = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketN}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: tableNoPre.id } });
    expect(seatN.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const payloadNoPre: any = spy.mock.calls[0][0];
    expect(payloadNoPre.newState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
    expect(payloadNoPre.stateColor).toBe(STATE_COLORS[TableFSMState.OCCUPIED_NO_ORDER].hex);
    expect(payloadNoPre.stateEmoji).toBe(STATE_EMOJIS[TableFSMState.OCCUPIED_NO_ORDER]);
    const dbNoPre = await prisma.table.findUnique({ where: { id: tableNoPre.id } });
    expect(dbNoPre?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    // Caso C: con pre-order pero skipPreOrder -> final OCCUPIED_NO_ORDER (bypass auditado)
    spy.mockClear();
    const ephemeral = await prisma.menuItem.create({ data: { categoryId: category.id, name: `BcstSkip-${Date.now()}`, price: 8000, isAvailable: true } });
    const tableSkip = await prisma.table.create({ data: { restaurantId: rest.id, label: `BcstS-${Date.now()}`, sector: 'SALON', currentState: TableFSMState.AVAILABLE, capacity: 4 } });
    const joinS = await app.inject({ method: 'POST', url: '/v1/waitlist/join', payload: { restaurantSlug: rest.slug, guestName: 'Bcst Skip', partySize: 2, phone: '2235559009', consent: true, preOrderData: [{ menuItemId: ephemeral.id, quantity: 1 }] } });
    const ticketS = joinS.json().id;
    await prisma.menuItem.update({ where: { id: ephemeral.id }, data: { isAvailable: false } });
    const seatS = await app.inject({ method: 'PATCH', url: `/v1/staff/waitlist/${ticketS}/seat`, headers: { authorization: `Bearer ${tokenWaiter}` }, payload: { tableId: tableSkip.id, skipPreOrder: true, skipReason: 'Broadcast skip auditado motivo valido' } });
    expect(seatS.statusCode).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    const payloadSkip: any = spy.mock.calls[0][0];
    expect(payloadSkip.newState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
    expect(payloadSkip.stateColor).toBe(STATE_COLORS[TableFSMState.OCCUPIED_NO_ORDER].hex);
    expect(payloadSkip.stateEmoji).toBe(STATE_EMOJIS[TableFSMState.OCCUPIED_NO_ORDER]);
    const dbSkip = await prisma.table.findUnique({ where: { id: tableSkip.id } });
    expect(dbSkip?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    spy.mockRestore();
  });
});

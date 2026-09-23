import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { TableFSMState } from '@mesaya/shared';

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  findRestaurant: vi.fn(),
  findTable: vi.fn(),
  countTables: vi.fn(),
  findZone: vi.fn(),
  countZones: vi.fn(),
  getFloorPlan: vi.fn(),
  updateFloorPlan: vi.fn(),
  updateTablePosition: vi.fn(),
  createZone: vi.fn(),
  updateZone: vi.fn(),
  deleteZone: vi.fn(),
  deleteTable: vi.fn(),
  handleTapAction: vi.fn(),
  attemptTransition: vi.fn(),
  findStateEvents: vi.fn(),
  findManyTables: vi.fn()
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) },
    restaurant: { findFirst: (...args: unknown[]) => mocks.findRestaurant(...args) },
    table: {
      findUnique: (...args: unknown[]) => mocks.findTable(...args),
      findMany: (...args: unknown[]) => mocks.findManyTables(...args),
      count: (...args: unknown[]) => mocks.countTables(...args)
    },
    floorZone: {
      findUnique: (...args: unknown[]) => mocks.findZone(...args),
      count: (...args: unknown[]) => mocks.countZones(...args)
    },
    tableStateEvent: {
      findMany: (...args: unknown[]) => mocks.findStateEvents(...args)
    }
  }
}));

vi.mock('../src/services/floorplan.service', () => ({
  floorPlanService: {
    getFloorPlan: (...args: unknown[]) => mocks.getFloorPlan(...args),
    updateFloorPlan: (...args: unknown[]) => mocks.updateFloorPlan(...args),
    updateTablePosition: (...args: unknown[]) => mocks.updateTablePosition(...args),
    createZone: (...args: unknown[]) => mocks.createZone(...args),
    updateZone: (...args: unknown[]) => mocks.updateZone(...args),
    deleteZone: (...args: unknown[]) => mocks.deleteZone(...args),
    deleteTable: (...args: unknown[]) => mocks.deleteTable(...args)
  }
}));

vi.mock('../src/services/fsm.service', () => ({
  fsmService: {
    handleTapAction: (...args: unknown[]) => mocks.handleTapAction(...args),
    attemptTransition: (...args: unknown[]) => mocks.attemptTransition(...args)
  }
}));

import { floorPlanRoutes } from '../src/routes/floorplan.routes';
import { tableStateRoutes } from '../src/routes/tablestate.routes';

const SECRET = 'jwt-secret-for-floorplan-fsm-access-tests-which-is-long-enough';
const restaurant = (id: string) => ({ id, name: id, slug: id });
const staff = (id: string) => ({
  id,
  name: id,
  role: id.startsWith('manager') ? 'MANAGER' : 'WAITER',
  restaurantId: id.endsWith('-a') ? 'restaurant-a' : 'restaurant-b',
  assignedSector: null
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findStaff.mockImplementation(({ where }: any) => Promise.resolve(staff(where.id)));
  mocks.findRestaurant.mockImplementation(({ where }: any) => {
    const identifier = where.OR?.[0]?.id || where.OR?.[1]?.slug;
    return Promise.resolve(restaurant(identifier));
  });
});

async function createApp() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.register(floorPlanRoutes);
  await app.register(tableStateRoutes);
  return app;
}

describe('Etapa 11 — Autorizar plano y transiciones FSM', () => {
  it('1. GET /floor-plan y PUT /floor-plan segregan permisos entre staff y manager por tenant', async () => {
    const app = await createApp();

    // GET /floor-plan
    const anonGet = await app.inject({ method: 'GET', url: '/floor-plan/restaurant-a' });
    expect(anonGet.statusCode).toBe(401);

    const waiterB = app.jwt.sign({ sub: 'waiter-b', role: 'WAITER', restaurantId: 'restaurant-b' });
    const crossTenantGet = await app.inject({
      method: 'GET',
      url: '/floor-plan/restaurant-a',
      headers: { authorization: `Bearer ${waiterB}` }
    });
    expect(crossTenantGet.statusCode).toBe(404);

    mocks.getFloorPlan.mockResolvedValue({ layout: {}, zones: [], tables: [], stats: {} });
    const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
    const staffGet = await app.inject({
      method: 'GET',
      url: '/floor-plan/restaurant-a',
      headers: { authorization: `Bearer ${waiterA}` }
    });
    expect(staffGet.statusCode).toBe(200);

    // PUT /floor-plan
    const payload = { tables: [] };
    const waiterPut = await app.inject({
      method: 'PUT',
      url: '/floor-plan/restaurant-a',
      headers: { authorization: `Bearer ${waiterA}` },
      payload
    });
    expect(waiterPut.statusCode).toBe(403);

    const managerB = app.jwt.sign({ sub: 'manager-b', role: 'MANAGER', restaurantId: 'restaurant-b' });
    const crossTenantPut = await app.inject({
      method: 'PUT',
      url: '/floor-plan/restaurant-a',
      headers: { authorization: `Bearer ${managerB}` },
      payload
    });
    expect(crossTenantPut.statusCode).toBe(404);

    mocks.updateFloorPlan.mockResolvedValue({ success: true, updatedTablesCount: 0 });
    const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });
    const managerPut = await app.inject({
      method: 'PUT',
      url: '/floor-plan/restaurant-a',
      headers: { authorization: `Bearer ${managerA}` },
      payload
    });
    expect(managerPut.statusCode).toBe(200);
  });

  it('2. Validación estricta multi-tenant de tableId y zoneId en plano y geometría', async () => {
    const app = await createApp();
    const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });

    // PUT floor-plan con mesa perteneciente a otro tenant
    mocks.countTables.mockResolvedValue(1);
    const foreignTablePut = await app.inject({
      method: 'PUT',
      url: '/floor-plan/restaurant-a',
      headers: { authorization: `Bearer ${managerA}` },
      payload: { tables: [{ id: 'table-from-restaurant-b', posX: 10, posY: 20 }] }
    });
    expect(foreignTablePut.statusCode).toBe(404);
    expect(mocks.updateFloorPlan).not.toHaveBeenCalled();

    // PUT floor-plan con zona perteneciente a otro tenant
    mocks.countTables.mockResolvedValue(0);
    mocks.countZones.mockResolvedValue(1);
    const foreignZonePut = await app.inject({
      method: 'PUT',
      url: '/floor-plan/restaurant-a',
      headers: { authorization: `Bearer ${managerA}` },
      payload: { tables: [{ id: 'table-a1', posX: 10, posY: 20, floorZoneId: 'zone-from-b' }] }
    });
    expect(foreignZonePut.statusCode).toBe(404);
    expect(mocks.updateFloorPlan).not.toHaveBeenCalled();

    // PATCH /tables/:tableId/position con mesa ajena
    mocks.findTable.mockResolvedValue({ id: 'table-b1', restaurantId: 'restaurant-b' });
    const moveForeignTable = await app.inject({
      method: 'PATCH',
      url: '/tables/table-b1/position',
      headers: { authorization: `Bearer ${managerA}` },
      payload: { posX: 50, posY: 50, expectedVersion: 0 }
    });
    expect(moveForeignTable.statusCode).toBe(404);
    expect(mocks.updateTablePosition).not.toHaveBeenCalled();

    // PATCH /tables/:tableId/position con zona ajena
    mocks.findTable.mockResolvedValue({ id: 'table-a1', restaurantId: 'restaurant-a' });
    mocks.findZone.mockResolvedValue({ id: 'zone-b1', restaurantId: 'restaurant-b' });
    const moveWithForeignZone = await app.inject({
      method: 'PATCH',
      url: '/tables/table-a1/position',
      headers: { authorization: `Bearer ${managerA}` },
      payload: { posX: 50, posY: 50, floorZoneId: 'zone-b1', expectedVersion: 0 }
    });
    expect(moveWithForeignZone.statusCode).toBe(404);
    expect(mocks.updateTablePosition).not.toHaveBeenCalled();
  });

  it('3. Taps FSM: rechazo de anon, mozo foráneo y suplantación de staffUserId con derivación desde JWT', async () => {
    const app = await createApp();

    // Anónimo
    const anonTap = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/tap',
      payload: { action: 'next' }
    });
    expect(anonTap.statusCode).toBe(401);

    // Mozo de tenant B sobre mesa de tenant A
    mocks.findTable.mockResolvedValue({ id: 'table-a1', restaurantId: 'restaurant-a', currentState: TableFSMState.AVAILABLE });
    const waiterB = app.jwt.sign({ sub: 'waiter-b', role: 'WAITER', restaurantId: 'restaurant-b' });
    const foreignTap = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/tap',
      headers: { authorization: `Bearer ${waiterB}` },
      payload: { action: 'next' }
    });
    expect(foreignTap.statusCode).toBe(404);

    // Intento de suplantar actor enviando staffUserId foráneo en body
    const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
    const spoofTap = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/tap',
      headers: { authorization: `Bearer ${waiterA}` },
      payload: { action: 'next', staffUserId: 'spoofed-waiter-id' }
    });
    expect(spoofTap.statusCode).toBe(403);
    expect(mocks.handleTapAction).not.toHaveBeenCalled();

    // Tap legítimo: deriva sub del JWT
    mocks.handleTapAction.mockResolvedValue({
      success: true,
      tableId: 'table-a1',
      previousState: TableFSMState.AVAILABLE,
      newState: TableFSMState.OCCUPIED_NO_ORDER
    });
    const validTap = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/tap',
      headers: { authorization: `Bearer ${waiterA}` },
      payload: { action: 'next', note: 'Cliente sentado' }
    });
    expect(validTap.statusCode).toBe(200);
    expect(mocks.handleTapAction).toHaveBeenCalledWith(
      'table-a1',
      'next',
      undefined,
      'waiter-a',
      'Cliente sentado',
      undefined
    );
  });

  it('4. Override de estado reservado exclusivamente a MANAGER del tenant', async () => {
    const app = await createApp();
    mocks.findTable.mockResolvedValue({ id: 'table-a1', restaurantId: 'restaurant-a', currentState: TableFSMState.AVAILABLE });

    // Mozo no puede ejecutar override
    const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });
    const waiterOverride = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/override',
      headers: { authorization: `Bearer ${waiterA}` },
      payload: { targetState: TableFSMState.PAID }
    });
    expect(waiterOverride.statusCode).toBe(403);

    // Manager de otro tenant
    const managerB = app.jwt.sign({ sub: 'manager-b', role: 'MANAGER', restaurantId: 'restaurant-b' });
    const crossTenantOverride = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/override',
      headers: { authorization: `Bearer ${managerB}` },
      payload: { targetState: TableFSMState.PAID }
    });
    expect(crossTenantOverride.statusCode).toBe(404);

    // Manager legítimo
    mocks.attemptTransition.mockResolvedValue({
      success: true,
      tableId: 'table-a1',
      previousState: TableFSMState.AVAILABLE,
      newState: TableFSMState.PAID
    });
    const managerA = app.jwt.sign({ sub: 'manager-a', role: 'MANAGER', restaurantId: 'restaurant-a' });
    const okOverride = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/override',
      headers: { authorization: `Bearer ${managerA}` },
      payload: { targetState: TableFSMState.PAID, reason: 'Liberación de emergencia' }
    });
    expect(okOverride.statusCode).toBe(200);
    expect(mocks.attemptTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: 'table-a1',
        toState: TableFSMState.PAID,
        staffUserId: 'manager-a',
        isOverride: true
      })
    );
  });

  it('5. expectedCurrentState viaja hasta el servicio y condición obsoleta retorna 409 STATE_CONFLICT', async () => {
    const app = await createApp();
    mocks.findTable.mockResolvedValue({ id: 'table-a1', restaurantId: 'restaurant-a', currentState: TableFSMState.OCCUPIED_ORDER_PLACED });
    const waiterA = app.jwt.sign({ sub: 'waiter-a', role: 'WAITER', restaurantId: 'restaurant-a' });

    const conflictErr = new Error('Conflicto de concurrencia: se esperaba el estado AVAILABLE pero la mesa se encuentra en OCCUPIED_ORDER_PLACED');
    (conflictErr as any).code = 'STATE_CONFLICT';
    (conflictErr as any).statusCode = 409;
    (conflictErr as any).details = { tableId: 'table-a1', currentState: 'OCCUPIED_ORDER_PLACED', expectedState: 'AVAILABLE' };
    mocks.handleTapAction.mockRejectedValue(conflictErr);

    const staleTap = await app.inject({
      method: 'POST',
      url: '/tables/table-a1/state/tap',
      headers: { authorization: `Bearer ${waiterA}` },
      payload: {
        action: 'next',
        expectedCurrentState: TableFSMState.AVAILABLE
      }
    });

    expect(staleTap.statusCode).toBe(409);
    const body = JSON.parse(staleTap.body);
    expect(body.code).toBe('STATE_CONFLICT');
    expect(body.error).toContain('Conflicto de concurrencia');
    expect(mocks.handleTapAction).toHaveBeenCalledWith(
      'table-a1',
      'next',
      undefined,
      'waiter-a',
      undefined,
      TableFSMState.AVAILABLE
    );
  });
});

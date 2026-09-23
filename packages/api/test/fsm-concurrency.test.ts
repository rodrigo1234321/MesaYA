import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { prisma } from '../src/lib/prisma';
import { fsmService } from '../src/services/fsm.service';
import { eventBus } from '../src/lib/eventBus';
import { tableStateRoutes } from '../src/routes/tablestate.routes';
import { TableFSMState } from '@mesaya/shared';

const SECRET = 'jwt-secret-for-fsm-concurrency-tests-which-is-long-enough';

describe('Etapa 11 — Concurrencia real FSM con SQLite efímera', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let table: any;
  let waiter: any;
  let waiterToken: string;

  beforeAll(async () => {
    restaurant = await prisma.restaurant.create({
      data: {
        name: 'Test FSM Concurrency',
        slug: `test-fsm-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b'
      }
    });

    table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa Concurrencia 1',
        sector: 'SALON_PRINCIPAL',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4,
        posX: 100,
        posY: 100,
        shape: 'RECT'
      }
    });

    waiter = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo Concurrente',
        role: 'WAITER',
        pinHash: '1234'
      }
    });

    app = Fastify();
    await app.register(jwt, { secret: SECRET });
    await app.register(tableStateRoutes);

    waiterToken = app.jwt.sign({
      sub: waiter.id,
      role: 'WAITER',
      restaurantId: restaurant.id
    });
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await prisma.$disconnect();
  });

  it('Dos requests HTTP concurrentes con el mismo expectedCurrentState: exactamente 1 éxito (200), 1 conflicto (409 STATE_CONFLICT), 1 TableStateEvent y 1 broadcast SSE', async () => {
    await prisma.table.update({
      where: { id: table.id },
      data: { currentState: TableFSMState.AVAILABLE }
    });
    await prisma.tableStateEvent.deleteMany({ where: { tableId: table.id } });

    const broadcastSpy = vi.spyOn(eventBus, 'broadcastTableState');
    broadcastSpy.mockClear();

    const [resA, resB] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/tables/${table.id}/state/tap`,
        headers: { authorization: `Bearer ${waiterToken}` },
        payload: {
          action: 'next',
          expectedCurrentState: TableFSMState.AVAILABLE
        }
      }),
      app.inject({
        method: 'POST',
        url: `/tables/${table.id}/state/tap`,
        headers: { authorization: `Bearer ${waiterToken}` },
        payload: {
          action: 'next',
          expectedCurrentState: TableFSMState.AVAILABLE
        }
      })
    ]);

    const statuses = [resA.statusCode, resB.statusCode].sort();
    expect(statuses).toEqual([200, 409]);

    const successRes = resA.statusCode === 200 ? resA : resB;
    const conflictRes = resA.statusCode === 409 ? resA : resB;

    const successBody = successRes.json();
    expect(successBody.success).toBe(true);
    expect(successBody.previousState).toBe(TableFSMState.AVAILABLE);
    expect(successBody.newState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    const conflictBody = conflictRes.json();
    expect(conflictBody.code).toBe('STATE_CONFLICT');
    expect(conflictBody.error).toContain('Conflicto de concurrencia');
    expect(conflictBody.message).toContain('Conflicto de concurrencia');

    const finalTable = await prisma.table.findUnique({ where: { id: table.id } });
    expect(finalTable?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    const events = await prisma.tableStateEvent.findMany({ where: { tableId: table.id } });
    expect(events).toHaveLength(1);
    expect(events[0].fromState).toBe(TableFSMState.AVAILABLE);
    expect(events[0].toState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
    expect(events[0].staffUserId).toBe(waiter.id);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);
    expect(broadcastSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tableId: table.id,
        previousState: TableFSMState.AVAILABLE,
        newState: TableFSMState.OCCUPIED_NO_ORDER,
        staffUserId: waiter.id
      })
    );

    broadcastSpy.mockRestore();
  });

  it('Dos llamadas concurrentes directas a FSMService con el mismo expectedCurrentState: exactamente 1 resuelta, 1 rechazada con 409, 1 TableStateEvent y 1 broadcast', async () => {
    await prisma.table.update({
      where: { id: table.id },
      data: { currentState: TableFSMState.AVAILABLE }
    });
    await prisma.tableStateEvent.deleteMany({ where: { tableId: table.id } });

    const broadcastSpy = vi.spyOn(eventBus, 'broadcastTableState');
    broadcastSpy.mockClear();

    const results = await Promise.allSettled([
      fsmService.handleTapAction(
        table.id,
        'next',
        undefined,
        waiter.id,
        'Tap simultáneo 1',
        TableFSMState.AVAILABLE
      ),
      fsmService.handleTapAction(
        table.id,
        'next',
        undefined,
        waiter.id,
        'Tap simultáneo 2',
        TableFSMState.AVAILABLE
      )
    ]);

    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    expect(fulfilled[0].value.success).toBe(true);
    expect(fulfilled[0].value.newState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    const error = rejected[0].reason;
    expect(error.code).toBe('STATE_CONFLICT');
    expect(error.statusCode).toBe(409);

    const dbTable = await prisma.table.findUnique({ where: { id: table.id } });
    expect(dbTable?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

    const dbEvents = await prisma.tableStateEvent.findMany({ where: { tableId: table.id } });
    expect(dbEvents).toHaveLength(1);

    expect(broadcastSpy).toHaveBeenCalledTimes(1);

    broadcastSpy.mockRestore();
  });
});

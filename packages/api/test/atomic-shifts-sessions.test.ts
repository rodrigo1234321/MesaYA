import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { ShiftService } from '../src/services/shift.service';
import { SessionService } from '../src/services/session.service';
import { eventBus } from '../src/lib/eventBus';

describe('Etapa 24 — Atomicidad de turnos y sesiones', () => {
  let restaurantId: string;
  let tableIds: string[];
  let initialToken: string;

  beforeAll(async () => {
    const restaurant = await prisma.restaurant.create({
      data: { name: 'Atomicidad Fixture', slug: `atomic-${randomUUID()}` }
    });
    restaurantId = restaurant.id;
    const tables = await Promise.all([
      prisma.table.create({ data: { restaurantId, label: 'Atomic A' } }),
      prisma.table.create({ data: { restaurantId, label: 'Atomic B' } })
    ]);
    tableIds = tables.map((table) => table.id);
  });

  afterAll(async () => {
    if (restaurantId) await prisma.restaurant.delete({ where: { id: restaurantId } });
    await prisma.$disconnect();
  });

  it('dos aperturas concurrentes dejan exactamente un turno activo y sesiones activas completas', async () => {
    const events: unknown[] = [];
    const originalBroadcast = eventBus.broadcast.bind(eventBus);
    eventBus.broadcast = ((restaurant, name, data) => {
      events.push({ restaurant, name, data });
      originalBroadcast(restaurant, name, data);
    }) as typeof eventBus.broadcast;

    const results = await Promise.allSettled([
      ShiftService.openShift(restaurantId),
      ShiftService.openShift(restaurantId)
    ]);
    eventBus.broadcast = originalBroadcast;

    const activeShifts = await prisma.shift.findMany({ where: { restaurantId, closedAt: null } });
    const activeSessions = await prisma.tableSession.findMany({ where: { activeKey: { not: null }, table: { restaurantId } } });
    expect(activeShifts).toHaveLength(1);
    expect(activeSessions).toHaveLength(tableIds.length);
    expect(activeSessions.map((session) => session.tableId).sort()).toEqual([...tableIds].sort());
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const eventShiftId = (events[events.length - 1] as any).data.shiftId;
    expect(await prisma.shift.findUnique({ where: { id: eventShiftId } })).not.toBeNull();
    initialToken = (await prisma.tableSession.findFirstOrThrow({ where: { tableId: tableIds[0], closedAt: null } })).token;
  });

  it('dos rotaciones concurrentes dejan una sola sesión activa y revocan el token anterior', async () => {
    const results = await Promise.allSettled([
      SessionService.createNewSessionForTable(tableIds[0]),
      SessionService.createNewSessionForTable(tableIds[0])
    ]);
    const active = await prisma.tableSession.findMany({ where: { tableId: tableIds[0], closedAt: null } });
    const old = await prisma.tableSession.findUnique({ where: { token: initialToken } });
    expect(active).toHaveLength(1);
    expect(active[0].activeKey).toBe(tableIds[0]);
    expect(old?.closedAt).not.toBeNull();
    expect(results.some((result) => result.status === 'fulfilled')).toBe(true);
  });

  it('el cierre transaccional marca el turno y todas sus sesiones como cerrados', async () => {
    const shift = await prisma.shift.findFirstOrThrow({ where: { restaurantId, closedAt: null } });
    const closed = await ShiftService.closeShift(shift.id, restaurantId);
    expect(closed.closedAt).not.toBeNull();
    const sessions = await prisma.tableSession.findMany({ where: { shiftId: shift.id } });
    expect(sessions.every((session) => session.closedAt !== null && session.activeKey === null)).toBe(true);
  });

  it('sanea claves activas residuales de registros cerrados antes de abrir', async () => {
    const closedShift = await prisma.shift.findFirstOrThrow({
      where: { restaurantId, closedAt: { not: null } },
      orderBy: { openedAt: 'desc' }
    });
    const closedSession = await prisma.tableSession.findFirstOrThrow({
      where: { shiftId: closedShift.id, tableId: tableIds[0], closedAt: { not: null } }
    });

    await prisma.shift.update({
      where: { id: closedShift.id },
      data: { activeKey: restaurantId }
    });
    await prisma.tableSession.update({
      where: { id: closedSession.id },
      data: { activeKey: tableIds[0] }
    });

    const result = await ShiftService.openShift(restaurantId);
    expect(result.sessionsCount).toBe(tableIds.length);

    const repairedShift = await prisma.shift.findUniqueOrThrow({ where: { id: closedShift.id } });
    const repairedSession = await prisma.tableSession.findUniqueOrThrow({ where: { id: closedSession.id } });
    expect(repairedShift.activeKey).toBeNull();
    expect(repairedSession.activeKey).toBeNull();
  });
});

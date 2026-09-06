import { randomUUID } from 'crypto';
import { prisma } from '../lib/prisma';
import { eventBus } from '../lib/eventBus';

export class ShiftService {
  static async openShift(restaurantId: string) {
    let committed: { shift: any; sessionsCount: number; tablesCount: number } | null = null;
    for (let attempt = 0; attempt < 2 && !committed; attempt += 1) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 3 * 60 * 60 * 1000); // 3 hours TTL
      try {
        committed = await prisma.$transaction(async (tx) => {
          // Todas las invalidaciones y la nueva apertura comparten commit.
          await tx.shift.updateMany({
            where: { restaurantId, closedAt: null },
            data: { closedAt: now, activeKey: null }
          });

          await tx.tableSession.updateMany({
            where: { table: { restaurantId }, closedAt: null },
            data: { closedAt: now, activeKey: null }
          });

          const shift = await tx.shift.create({
            data: { restaurantId, activeKey: restaurantId, openedAt: now }
          });

          const tables = await tx.table.findMany({ where: { restaurantId } });
          const sessionsData = tables.map(table => ({
            id: randomUUID(),
            tableId: table.id,
            shiftId: shift.id,
            activeKey: table.id,
            token: randomUUID(),
            expiresAt,
            createdAt: now
          }));

          if (sessionsData.length > 0) {
            await tx.tableSession.createMany({ data: sessionsData });
          }
          return { shift, sessionsCount: sessionsData.length, tablesCount: tables.length };
        });
      } catch (err: any) {
        // Dos aperturas desde cero pueden competir por el índice único. Reintentar
        // convierte la segunda en una rotación serializada; nunca deja dos activas.
        if (err?.code !== 'P2002' || attempt === 1) throw err;
      }
    }

    if (!committed) throw new Error('No se pudo confirmar la apertura del turno');
    eventBus.broadcast(restaurantId, 'shift.opened', {
      shiftId: committed.shift.id,
      openedAt: committed.shift.openedAt.toISOString(),
      tablesCount: committed.tablesCount
    });
    return { shift: committed.shift, sessionsCount: committed.sessionsCount };
  }

  static async closeShift(shiftId: string, restaurantId: string) {
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const shift = await tx.shift.findFirst({ where: { id: shiftId, restaurantId } });
      if (!shift) {
        const error: any = new Error('Turno no encontrado');
        error.statusCode = 404;
        throw error;
      }

      const closed = await tx.shift.update({
        where: { id: shiftId },
        data: { closedAt: now, activeKey: null }
      });

      await tx.tableSession.updateMany({
        where: { shiftId, closedAt: null },
        data: { closedAt: now, activeKey: null }
      });

      await tx.visitParticipant.updateMany({
        where: { tableSession: { shiftId }, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now }
      });
      return closed;
    });

    eventBus.broadcast(restaurantId, 'shift.closed', {
      shiftId: updated.id,
      closedAt: updated.closedAt?.toISOString()
    });

    return updated;
  }

  static async getCurrentShift(restaurantId: string) {
    return prisma.shift.findFirst({
      where: { restaurantId, closedAt: null },
      include: {
        sessions: {
          select: {
            id: true,
            tableId: true,
            shiftId: true,
            expiresAt: true,
            createdAt: true,
            closedAt: true,
            table: true
          }
        }
      }
    });
  }
}

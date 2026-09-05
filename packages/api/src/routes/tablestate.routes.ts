import { FastifyInstance } from 'fastify';
import { fsmService } from '../services/fsm.service';
import { prisma } from '../lib/prisma';
import {
  TapStateRequestSchema,
  TableFSMState,
  SignalSource,
  STATE_COLORS,
  STATE_EMOJIS
} from '@mesaya/shared';
import { verifyStaffToken, verifyManagerRole } from '../middlewares/auth.middleware';

export async function tableStateRoutes(fastify: FastifyInstance) {
  /**
   * POST /tables/:tableId/state/tap
   * High-speed 1-tap endpoint for the central salon tablet (<100ms).
   * Actions: 'next' (optimal workflow step), 'skip_to' (direct jump), 'revert' (undo).
   */
  fastify.post('/tables/:tableId/state/tap', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { tableId } = request.params as { tableId: string };

    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, restaurantId: true }
    });

    if (!table || table.restaurantId !== request.staffUser!.restaurantId) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Mesa no encontrada.'
      });
    }

    const parsed = TapStateRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Petición de cambio de estado inválida',
        details: parsed.error.format()
      });
    }

    const { action, targetState, expectedCurrentState, staffUserId: bodyStaffId, note } = parsed.data;

    // Reject actor spoofing if provided and does not match authenticated token
    if (bodyStaffId && bodyStaffId !== request.staffUser!.sub) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'No está autorizado a suplantar la identidad de otro miembro del personal.'
      });
    }

    const staffUserId = request.staffUser!.sub;

    try {
      const result = await fsmService.handleTapAction(
        tableId,
        action,
        targetState as TableFSMState | undefined,
        staffUserId,
        note,
        expectedCurrentState as TableFSMState | undefined
      );

      return reply.send(result);
    } catch (err: any) {
      if (err.code === 'TABLE_NOT_FOUND' || err.statusCode === 404) {
        return reply.status(404).send({
          error: 'TABLE_NOT_FOUND',
          message: err.message
        });
      }

      if (err.code === 'MISSING_TARGET_STATE' || err.statusCode === 400) {
        return reply.status(400).send({
          error: 'MISSING_TARGET_STATE',
          message: err.message
        });
      }

      if (err.code === 'STATE_CONFLICT' || err.statusCode === 409) {
        return reply.status(409).send({
          error: 'STATE_CONFLICT',
          message: err.message,
          details: err.details
        });
      }

      if (err.code === 'INVALID_TRANSITION' || err.statusCode === 422) {
        return reply.status(422).send({
          error: 'INVALID_TRANSITION',
          message: err.message,
          details: err.details
        });
      }

      request.log.error(err);
      return reply.status(err.statusCode || 500).send({ error: err.message || 'Error al procesar acción de mesa' });
    }
  });

  /**
   * POST /tables/:tableId/state/override
   * Manager forced override: allows any transition directly (long-press on table).
   */
  fastify.post('/tables/:tableId/state/override', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    const { tableId } = request.params as { tableId: string };

    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, restaurantId: true }
    });

    if (!table || table.restaurantId !== request.staffUser!.restaurantId) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Mesa no encontrada.'
      });
    }

    const { targetState, staffUserId: bodyStaffId, reason } = request.body as {
      targetState: TableFSMState;
      staffUserId?: string;
      reason?: string;
    };

    if (!targetState || !Object.values(TableFSMState).includes(targetState)) {
      return reply.status(400).send({ error: 'targetState válido requerido' });
    }

    // Reject actor spoofing if provided and does not match authenticated manager
    if (bodyStaffId && bodyStaffId !== request.staffUser!.sub) {
      return reply.status(403).send({
        error: 'FORBIDDEN',
        message: 'No está autorizado a suplantar la identidad de otro miembro del personal.'
      });
    }

    const staffUserId = request.staffUser!.sub;

    try {
      const result = await fsmService.attemptTransition({
        tableId,
        toState: targetState,
        source: SignalSource.MANAGER_OVERRIDE,
        trigger: reason || `Manager Override -> ${targetState}`,
        staffUserId,
        isOverride: true
      });

      return reply.send(result);
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message || 'Error en override de estado' });
    }
  });

  /**
   * GET /tables/:tableId/state-history
   * Returns immutable audit log of table state transitions.
   */
  fastify.get('/tables/:tableId/state-history', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { tableId } = request.params as { tableId: string };

    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, restaurantId: true }
    });

    if (!table || table.restaurantId !== request.staffUser!.restaurantId) {
      return reply.status(404).send({
        error: 'NOT_FOUND',
        message: 'Mesa no encontrada.'
      });
    }

    const limit = Number((request.query as any)?.limit) || 50;

    try {
      const events = await prisma.tableStateEvent.findMany({
        where: { tableId },
        orderBy: { createdAt: 'desc' },
        take: Math.min(100, limit)
      });

      return reply.send({
        tableId,
        count: events.length,
        events: events.map((e) => ({
          id: e.id,
          fromState: e.fromState,
          toState: e.toState,
          trigger: e.trigger,
          source: e.source,
          staffUserId: e.staffUserId,
          metadata: e.metadata ? JSON.parse(e.metadata) : null,
          createdAt: e.createdAt.toISOString()
        }))
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message || 'Error al obtener historial' });
    }
  });

  /**
   * GET /tables/states/:restaurantId
   * Bulk endpoint returning current states of all tables for fast polling / fallback.
   */
  fastify.get('/tables/states/:restaurantId', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { restaurantId } = request.params as { restaurantId: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantId }, { slug: restaurantId }] },
      select: { id: true }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Restaurante no encontrado' });
    }

    try {
      const tables = await prisma.table.findMany({
        where: { restaurantId: restaurant.id },
        select: {
          id: true,
          label: true,
          sector: true,
          currentState: true,
          stateChangedAt: true
        },
        orderBy: { label: 'asc' }
      });

      return reply.send({
        restaurantId: restaurant.id,
        timestamp: new Date().toISOString(),
        tables: tables.map((t) => {
          const state = (t.currentState as TableFSMState) || TableFSMState.AVAILABLE;
          return {
            id: t.id,
            label: t.label,
            sector: t.sector,
            currentState: state,
            stateColor: STATE_COLORS[state]?.hex ?? '#22c55e',
            stateEmoji: STATE_EMOJIS[state] ?? '🟢',
            stateChangedAt: t.stateChangedAt.toISOString()
          };
        })
      });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message || 'Error al consultar estados' });
    }
  });
}


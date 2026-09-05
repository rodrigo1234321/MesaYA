import { FastifyInstance } from 'fastify';
import { floorPlanService } from '../services/floorplan.service';
import { prisma } from '../lib/prisma';
import {
  FloorPlanUpdateSchema,
  ZoneCreateSchema,
  ZoneUpdateSchema,
  TablePositionUpdateSchema
} from '@mesaya/shared';
import { verifyStaffToken, verifyManagerRole } from '../middlewares/auth.middleware';

export async function floorPlanRoutes(fastify: FastifyInstance) {
  /**
   * GET /floor-plan/:restaurantId
   * Returns complete floor plan: layout, zones, tables with live FSM state and summary stats.
   */
  fastify.get('/floor-plan/:restaurantId', { preHandler: [verifyStaffToken] }, async (request, reply) => {
    const { restaurantId } = request.params as { restaurantId: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantId }, { slug: restaurantId }] },
      select: { id: true }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }

    try {
      const data = await floorPlanService.getFloorPlan(restaurant.id);
      return reply.send(data);
    } catch (err: any) {
      request.log.error(err);
      return reply.status(404).send({ error: err.message || 'Error al obtener plano de mesas' });
    }
  });

  /**
   * PUT /floor-plan/:restaurantId
   * Batch updates table positions and canvas layout.
   */
  fastify.put('/floor-plan/:restaurantId', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    const { restaurantId } = request.params as { restaurantId: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantId }, { slug: restaurantId }] },
      select: { id: true }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }

    const parsed = FloorPlanUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Datos de actualización de plano inválidos',
        details: parsed.error.format()
      });
    }

    // Verify tenant of existing tables before mutating
    const existingTableIds = parsed.data.tables
      .map(t => t.id)
      .filter(id => !id.startsWith('new-'));
    if (existingTableIds.length > 0) {
      const foreignTables = await prisma.table.count({
        where: {
          id: { in: existingTableIds },
          restaurantId: { not: restaurant.id }
        }
      });
      if (foreignTables > 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Una o más mesas no pertenecen a este restaurante.'
        });
      }
    }

    // Verify tenant of zoneIds before mutating
    const zoneIds = parsed.data.tables
      .map(t => t.floorZoneId)
      .filter((z): z is string => !!z);
    if (zoneIds.length > 0) {
      const foreignZones = await prisma.floorZone.count({
        where: {
          id: { in: zoneIds },
          restaurantId: { not: restaurant.id }
        }
      });
      if (foreignZones > 0) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Una o más zonas no pertenecen a este restaurante.'
        });
      }
    }

    try {
      const result = await floorPlanService.updateFloorPlan(restaurant.id, parsed.data);
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err);
      if (err.statusCode === 400 || err.statusCode === 404 || err.statusCode === 409) {
        return reply.status(err.statusCode).send({
          error: err.code || 'FLOOR_PLAN_ERROR',
          message: err.message,
          ...(err.details !== undefined && { details: err.details })
        });
      }
      return reply.status(500).send({ error: err.message || 'Error al guardar plano' });
    }
  });

  /**
   * PATCH /tables/:tableId/position
   * Ultra-fast position update when a single table is dragged or rotated.
   */
  fastify.patch('/tables/:tableId/position', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    const { tableId } = request.params as { tableId: string };

    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, restaurantId: true }
    });

    if (!table || table.restaurantId !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Mesa no encontrada' });
    }

    const parsed = TablePositionUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      // Etapa 26: la precondición de versión es obligatoria; su ausencia se
      // rechaza con código propio antes de cualquier escritura.
      const missingVersion = parsed.error.issues.some(
        (issue) => issue.code === 'invalid_type' && issue.path.length === 1 && issue.path[0] === 'expectedVersion'
      );
      if (missingVersion) {
        return reply.status(400).send({
          error: 'LAYOUT_VERSION_REQUIRED',
          message: 'Falta expectedVersion: recargá el plano y reintentá con la versión vigente.'
        });
      }
      return reply.status(400).send({
        error: 'Coordenadas inválidas',
        details: parsed.error.format()
      });
    }

    if (parsed.data.floorZoneId) {
      const zone = await prisma.floorZone.findUnique({
        where: { id: parsed.data.floorZoneId },
        select: { id: true, restaurantId: true }
      });
      if (!zone || zone.restaurantId !== request.staffUser!.restaurantId) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: 'Zona no encontrada' });
      }
    }

    try {
      const result = await floorPlanService.updateTablePosition(tableId, parsed.data);
      return reply.send(result);
    } catch (err: any) {
      request.log.error(err);
      if (err.statusCode === 400 || err.statusCode === 404 || err.statusCode === 409) {
        return reply.status(err.statusCode).send({
          error: err.code || 'TABLE_POSITION_ERROR',
          message: err.message,
          ...(err.details !== undefined && { details: err.details })
        });
      }
      return reply.status(500).send({ error: err.message || 'Error al mover mesa' });
    }
  });

  /**
   * POST /floor-plan/:restaurantId/zones
   * Creates a new floor zone (e.g. "Patio", "Terraza", "Salón Principal").
   */
  fastify.post('/floor-plan/:restaurantId/zones', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    const { restaurantId } = request.params as { restaurantId: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantId }, { slug: restaurantId }] },
      select: { id: true }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }

    const parsed = ZoneCreateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Datos de zona inválidos',
        details: parsed.error.format()
      });
    }

    try {
      const zone = await floorPlanService.createZone(restaurant.id, parsed.data);
      return reply.status(201).send(zone);
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message || 'Error al crear zona' });
    }
  });

  /**
   * PATCH /floor-plan/:restaurantId/zones/:id
   * Updates an existing zone.
   */
  fastify.patch('/floor-plan/:restaurantId/zones/:id', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    const { id, restaurantId } = request.params as { id: string; restaurantId: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantId }, { slug: restaurantId }] },
      select: { id: true }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }

    const zone = await prisma.floorZone.findUnique({
      where: { id },
      select: { id: true, restaurantId: true }
    });

    if (!zone || zone.restaurantId !== restaurant.id) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Zona no encontrada' });
    }

    const parsed = ZoneUpdateSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Datos de actualización de zona inválidos',
        details: parsed.error.format()
      });
    }

    try {
      const updatedZone = await floorPlanService.updateZone(id, parsed.data);
      return reply.send(updatedZone);
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message || 'Error al actualizar zona' });
    }
  });

  /**
   * DELETE /floor-plan/:restaurantId/zones/:id
   * Deletes a zone and detaches assigned tables.
   */
  fastify.delete('/floor-plan/:restaurantId/zones/:id', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    const { id, restaurantId } = request.params as { id: string; restaurantId: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantId }, { slug: restaurantId }] },
      select: { id: true }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }

    const zone = await prisma.floorZone.findUnique({
      where: { id },
      select: { id: true, restaurantId: true }
    });

    if (!zone || zone.restaurantId !== restaurant.id) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Zona no encontrada' });
    }

    try {
      await floorPlanService.deleteZone(id);
      return reply.send({ success: true, message: 'Zona eliminada correctamente' });
    } catch (err: any) {
      request.log.error(err);
      return reply.status(500).send({ error: err.message || 'Error al eliminar zona' });
    }
  });

  /**
   * DELETE /floor-plan/:restaurantId/tables/:tableId
   * Deletes a table permanently from the floor plan and restaurant.
   */
  fastify.delete('/floor-plan/:restaurantId/tables/:tableId', { preHandler: [verifyManagerRole] }, async (request, reply) => {
    const { restaurantId, tableId } = request.params as { restaurantId: string; tableId: string };

    const restaurant = await prisma.restaurant.findFirst({
      where: { OR: [{ id: restaurantId }, { slug: restaurantId }] },
      select: { id: true }
    });

    if (!restaurant || restaurant.id !== request.staffUser!.restaurantId) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Recurso no encontrado' });
    }

    const table = await prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, restaurantId: true }
    });

    if (!table || table.restaurantId !== restaurant.id) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Mesa no encontrada' });
    }

    try {
      const result = await floorPlanService.deleteTable(restaurant.id, tableId);
      return reply.send({ ...result, message: 'Mesa eliminada correctamente' });
    } catch (err: any) {
      request.log.error(err);
      if (err.statusCode === 404 || err.statusCode === 409) {
        return reply.status(err.statusCode).send({
          error: err.code || 'DELETE_TABLE_ERROR',
          message: err.message,
          ...(err.details !== undefined && { details: err.details })
        });
      }
      return reply.status(500).send({ error: err.message || 'Error al eliminar mesa' });
    }
  });
}


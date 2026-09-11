import { FastifyPluginAsync } from 'fastify';
import { ConfigService } from '../services/config.service';
import { requireRestaurantAccess, verifyManagerRole } from '../middlewares/auth.middleware';
import { UpdateModuleConfigDTO } from '@mesaya/shared';

export const configRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /v1/restaurants/:slug/config
   * Endpoint PÚBLICO para el comensal.
   * SEGURIDAD: Whitelist select estricto. Cero filtración de credenciales.
   */
  fastify.get<{ Params: { slug: string } }>(
    '/restaurants/:slug/config',
    async (request, reply) => {
      const { slug } = request.params;
      const config = await ConfigService.getPublicConfig(slug);

      if (!config) {
        return reply.status(404).send({
          error: 'Restaurante no encontrado o sin configuración'
        });
      }

      return reply.send(config);
    }
  );

  /**
   * GET /v1/restaurants/:slug/capabilities
   * Endpoint PÚBLICO que expone la disponibilidad efectiva de cada módulo.
   * NO duplica los flags almacenados: los traduce a estados operativos.
   * SEGURIDAD: No expone credenciales ni secretos de pago.
   */
  fastify.get<{ Params: { slug: string } }>(
    '/restaurants/:slug/capabilities',
    async (request, reply) => {
      const { slug } = request.params;
      const capabilities = await ConfigService.getCapabilities(slug);

      if (!capabilities) {
        return reply.status(404).send({
          error: 'Restaurante no encontrado'
        });
      }

      return reply.send(capabilities);
    }
  );

  /**
   * GET /v1/admin/restaurants/:id/config
   * Endpoint de configuración para el dashboard administrativo.
   */
  fastify.get<{ Params: { id: string } }>(
    '/admin/restaurants/:id/config',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((request) => (request.params as { id: string }).id)] },
    async (request, reply) => {
      const { id } = request.params;
      try {
        const config = await ConfigService.getAdminConfig(id);
        return reply.send(config);
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: err.message || 'Error al obtener la configuración' });
      }
    }
  );

  /**
   * PATCH /v1/admin/restaurants/:id/config
   * Actualiza los flags de módulos de forma transaccional y audita el cambio.
   * SEGURIDAD: Bloquea explícitamente a roles no autorizados (ej: WAITER -> 403 Forbidden).
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateModuleConfigDTO }>(
    '/admin/restaurants/:id/config',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((request) => (request.params as { id: string }).id)] },
    async (request, reply) => {
      const { id } = request.params;
      const body = request.body;

      try {
        const updated = await ConfigService.updateConfigTransacted(
          id,
          body,
          request.staffUser!.sub
        );
        return reply.send(updated);
      } catch (err: any) {
        request.log.error(err);
        if (err?.code === 'CAPABILITY_NOT_AVAILABLE' && err?.statusCode === 409) {
          return reply.status(409).send({
            error: err.message,
            code: err.code,
            field: err.field,
            capability: err.capability
          });
        }
        return reply.status(err?.statusCode || 500).send({
          error: err.message || 'Error al actualizar la configuración modular',
          code: err.code
        });
      }
    }
  );

  /**
   * GET /v1/admin/restaurants/:id/config/audit
   * Devuelve el historial de auditoría de cambios de configuración.
   */
  fastify.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/admin/restaurants/:id/config/audit',
    { preHandler: [verifyManagerRole, requireRestaurantAccess((request) => (request.params as { id: string }).id)] },
    async (request, reply) => {
      const { id } = request.params;
      const limit = Number(request.query.limit) || 50;

      try {
        const logs = await ConfigService.getAuditLogs(id, limit);
        return reply.send(logs);
      } catch (err: any) {
        request.log.error(err);
        return reply.status(500).send({ error: err.message || 'Error al consultar logs de auditoría' });
      }
    }
  );

  /**
   * GET /v1/restaurants/:slugOrId/rewards/calculate
   * Calcula puntos de fidelización para un consumo determinado (Módulo 6).
   */
  fastify.get<{ Params: { slugOrId: string }; Querystring: { amount: string } }>(
    '/restaurants/:slugOrId/rewards/calculate',
    async (request, reply) => {
      const { slugOrId } = request.params;
      const amount = Number(request.query.amount) || 0;

      try {
        const config = await ConfigService.getAdminConfig(slugOrId);
        if (!config.enableRewards) {
          return reply.send({
            enabled: false,
            points: 0,
            pointsPerHundredPesos: config.pointsPerHundredPesos || 1,
            message: 'Programa de fidelización MesaYA Rewards no activo'
          });
        }

        const points = Math.floor((amount / 100) * (config.pointsPerHundredPesos || 1));
        return reply.send({
          enabled: true,
          points,
          pointsPerHundredPesos: config.pointsPerHundredPesos || 1,
          message: `¡Sumas ${points} puntos MesaYA Rewards con este consumo!`
        });
      } catch (err: any) {
        return reply.status(500).send({ error: err.message });
      }
    }
  );
};

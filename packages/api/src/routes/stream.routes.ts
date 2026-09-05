import { FastifyInstance } from 'fastify';

export async function streamRoutes(fastify: FastifyInstance) {
  /**
   * GET/ALL /stream
   * Endpoint de Server-Sent Events (SSE) deshabilitado para el piloto presencial.
   *
   * Decisión de arquitectura (Etapa 17):
   * - En entornos de un solo nodo sin broker distribuido (Redis), SSE presentaba riesgos
   *   de conexiones colgadas, fugas de snapshots de salón a anónimos y JWTs expuestos en query strings.
   * - El transporte autoritativo y resiliente para el piloto es el polling HTTP autenticado
   *   sobre endpoints de snapshot dedicados por tenant (/calls, /floor-plan, /sessions/:token).
   * - Cualquier petición a /stream es rechazada de inmediato con 410 GONE, sin datos,
   *   cerrando la conexión HTTP de inmediato.
   */
  fastify.all('/stream', async (request, reply) => {
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    return reply.status(410).send({
      statusCode: 410,
      code: 'SSE_STREAM_DISABLED',
      error: 'Gone',
      message:
        'El endpoint de Server-Sent Events /stream ha sido deshabilitado. Utilice los endpoints de snapshot autenticados mediante polling HTTP.'
    });
  });
}

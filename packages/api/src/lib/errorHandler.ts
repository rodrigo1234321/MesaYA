import { FastifyReply } from 'fastify';

/**
 * Sanitiza y envía una respuesta de error estandarizada (P0-05).
 * - Errores 5xx: SIEMPRE opacos con requestId y logueados internamente.
 * - Errores 4xx: conservan código público de dominio y mensaje tipado.
 */
export function sendSanitizedError(reply: FastifyReply, err: any) {
  const statusCode = Number(err?.statusCode || err?.status) || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const requestId = String((reply.request as any)?.id || err?.requestId || '');

  if (!isClientError) {
    (reply.request as any)?.log?.error?.({ err, requestId }, 'Server exception intercepted in route catch');
    return reply.status(500).send({
      code: 'INTERNAL_SERVER_ERROR',
      error: 'Ocurrió un error inesperado al procesar la solicitud',
      message: 'Ocurrió un error inesperado al procesar la solicitud',
      statusCode: 500,
      requestId
    });
  }

  const publicCode =
    err?.code ||
    (statusCode === 404
      ? 'NOT_FOUND'
      : statusCode === 401
      ? 'UNAUTHORIZED'
      : statusCode === 403
      ? 'FORBIDDEN'
      : 'BAD_REQUEST');
  const publicMessage = err?.message || 'Error en la solicitud';

  return reply.status(statusCode).send({
    code: publicCode,
    error: publicMessage,
    message: publicMessage,
    statusCode,
    requestId,
    ...(err?.details !== undefined ? { details: err.details } : {})
  });
}

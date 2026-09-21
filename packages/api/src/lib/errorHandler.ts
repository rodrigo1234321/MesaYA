import { FastifyReply } from 'fastify';

interface ErrorLike {
  statusCode?: number;
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
  retryAfterSeconds?: number;
  [key: string]: unknown;
}

const SENSITIVE_DB_PATTERNS = [
  /prisma/i,
  /sqlite/i,
  /postgres/i,
  /foreign key/i,
  /unique constraint/i,
  /syntax error/i,
  /database/i,
  /column .* does not exist/i,
  /table .* does not exist/i,
  /invalid .* invocation/i
];

function isSensitiveMessage(msg: string): boolean {
  if (!msg) return false;
  if (msg.includes('\n') || msg.includes('at ')) return true;
  return SENSITIVE_DB_PATTERNS.some((pattern) => pattern.test(msg));
}

function sanitizeDetails(details: unknown): unknown {
  if (details === undefined || details === null) return undefined;
  if (typeof details !== 'object') return undefined;

  try {
    const serialized = JSON.stringify(details);
    if (/password|secret|token|hash|DATABASE_URL|postgres:\/\/|sqlite:/i.test(serialized)) {
      return undefined;
    }
    return details;
  } catch {
    return undefined;
  }
}

/**
 * Sanitiza y envía una respuesta de error estandarizada (P0-05, R02).
 * - Errores 5xx: SIEMPRE opacos con requestId y logueados internamente.
 * - Errores 4xx: conservan código público de dominio y mensaje tipado seguro.
 */
export function sendSanitizedError(
  reply: FastifyReply,
  err: unknown,
  extraFields?: Record<string, unknown>
) {
  const errObj = (typeof err === 'object' && err !== null ? err : {}) as ErrorLike;
  const statusCode = Number(errObj.statusCode || errObj.status) || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const req = (reply as unknown as { request?: { id?: string; log?: { error?: (data: unknown, msg: string) => void } } }).request;
  const requestId = String(req?.id || errObj.requestId || '');

  if (!isClientError) {
    req?.log?.error?.({ err, requestId }, 'Server exception intercepted in route catch');
    return reply.status(500).send({
      code: 'INTERNAL_SERVER_ERROR',
      error: 'Ocurrió un error inesperado al procesar la solicitud',
      message: 'Ocurrió un error inesperado al procesar la solicitud',
      statusCode: 500,
      requestId,
      ...(extraFields || {})
    });
  }

  // Si es 429 Too Many Requests y hay un retryAfterSeconds, inyectar la cabecera estándar
  if (statusCode === 429 && typeof errObj.retryAfterSeconds === 'number') {
    reply.header('Retry-After', String(Math.max(1, Math.ceil(errObj.retryAfterSeconds))));
  }

  const rawMessage =
    typeof errObj.message === 'string' && errObj.message
      ? errObj.message
      : typeof errObj.error === 'string'
      ? errObj.error
      : '';
  const isMessageSafe = !isSensitiveMessage(rawMessage);

  const publicCode =
    errObj.code ||
    (statusCode === 404
      ? 'NOT_FOUND'
      : statusCode === 401
      ? 'UNAUTHORIZED'
      : statusCode === 403
      ? 'FORBIDDEN'
      : statusCode === 409
      ? 'CONFLICT'
      : statusCode === 422
      ? 'UNPROCESSABLE_ENTITY'
      : statusCode === 429
      ? 'TOO_MANY_REQUESTS'
      : 'BAD_REQUEST');

  const publicMessage = isMessageSafe && rawMessage
    ? rawMessage
    : (statusCode === 404
      ? 'Recurso no encontrado'
      : statusCode === 401
      ? 'No autorizado'
      : statusCode === 403
      ? 'Acceso denegado'
      : statusCode === 409
      ? 'Conflicto en el estado del recurso'
      : 'Error en la solicitud');

  const publicError =
    publicCode === 'STATE_CONFLICT' ||
    publicCode === 'LAYOUT_VERSION_CONFLICT' ||
    publicCode === 'ZONE_NOT_FOUND' ||
    publicCode === 'TABLE_NOT_FOUND' ||
    (typeof errObj.error === 'string' && errObj.error === publicCode)
      ? publicCode
      : (typeof errObj.error === 'string' && isMessageSafe && errObj.error
        ? errObj.error
        : publicMessage);

  const sanitized = sanitizeDetails(errObj.details);

  return reply.status(statusCode).send({
    code: publicCode,
    error: publicError,
    message: publicMessage,
    statusCode,
    requestId,
    ...(sanitized !== undefined ? { details: sanitized } : {}),
    ...(extraFields || {})
  });
}

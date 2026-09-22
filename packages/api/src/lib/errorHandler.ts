import { FastifyReply, FastifyRequest } from 'fastify';

export interface ErrorLike {
  statusCode?: number;
  status?: number;
  code?: string;
  message?: string;
  error?: string;
  details?: unknown;
  requestId?: string;
  retryAfterSeconds?: number;
  [key: string]: unknown;
}

// Mensajes públicos canónicos de fallback por status code
export const CANONICAL_STATUS_MESSAGES: Record<number, string> = {
  400: 'Error en la solicitud',
  401: 'No autorizado',
  403: 'Acceso denegado',
  404: 'Recurso no encontrado',
  408: 'Tiempo de espera agotado',
  409: 'Conflicto en el estado del recurso',
  410: 'El recurso ya no está disponible',
  422: 'Validación fallida',
  429: 'Límite de solicitudes superado',
  500: 'Ocurrió un error inesperado al procesar la solicitud'
};

export const CANONICAL_STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  410: 'GONE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  500: 'INTERNAL_SERVER_ERROR'
};

// Patrones que jamás deben aparecer en un mensaje público seguro
const UNSAFE_MESSAGE_PATTERNS = [
  /[=\\]/,                  // Asignaciones clave=valor, query strings, backslashes
  /\bBearer\b/i,            // Tokens Bearer
  /\b(?:postgres|sqlite|mysql|mongodb|redis|prisma):\/\//i, // URIs de conexión
  /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|UNION)\b/i,  // SQL keywords
  /password|secret|token|hash|api_key|authorization|cookie|private_key/i, // Credenciales y secretos
  /\.(?:ts|js|jsx|tsx|json|env|prisma)\b/i, // Rutas o nombres de archivos de código
  /at (?:[a-zA-Z0-9_$.]+ )?\(?.*:\d+:\d+\)?/, // Stack traces 'at Module (file:line:col)'
  /[\r\n]/,                 // Múltiples líneas
  /prisma|foreign key|unique constraint|syntax error|database|column .* does not exist|table .* does not exist|invalid .* invocation/i
];

/**
 * Valida si un código de error es un identificador de dominio público seguro.
 * Debe ser un SCREAMING_SNAKE_CASE (ej. STATE_CONFLICT, TABLE_NOT_AVAILABLE, SESSION_CLOSED)
 * y no contener nombres de infraestructura interna de bases de datos.
 */
export function isSafeDomainCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (!/^[A-Z0-9_]{3,64}$/.test(trimmed)) return false;
  if (/PRISMA|SQLITE|POSTGRES|DATABASE|SYNTAX_ERROR|FOREIGN_KEY/.test(trimmed)) return false;
  return true;
}

/**
 * Valida si un mensaje es texto legible y seguro para el usuario final.
 * - Sin saltos de línea, sin stack traces, sin signos '=', sin URLs o secrets.
 * - Longitud máxima razonable (< 250 chars).
 */
export function isSafePublicMessage(msg: unknown): msg is string {
  if (typeof msg !== 'string') return false;
  const trimmed = msg.trim();
  if (!trimmed || trimmed.length > 250) return false;
  return !UNSAFE_MESSAGE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Valida y sanitiza el campo `code`.
 * Si el código es un identificador de dominio válido, se conserva.
 * De lo contrario, se asigna el código canónico del HTTP status correspondiente.
 */
export function sanitizePublicCode(code: unknown, statusCode: number): string {
  if (isSafeDomainCode(code)) {
    return code.trim();
  }
  return CANONICAL_STATUS_CODES[statusCode] || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
}

function isSensitiveDetailKey(key: string): boolean {
  return /authorization|bearer|password|secret|token|api_key|cookie|session_token|hash|private|host|hostname|addr|endpoint|connection|dsn|uri|database_url/i.test(key);
}

function isSensitiveDetailValue(val: unknown): boolean {
  if (typeof val === 'string') {
    if (val.length > 500) return true;
    if (/[=\\]/.test(val) && !val.includes('==')) return true;
    if (/bearer\s+[a-zA-Z0-9_\-.]+/i.test(val)) return true;
    if (/password|secret|token|hash|api_key|database_url/i.test(val)) return true;
    // Connection URIs (postgres://, mysql://, mongodb://, redis://, sqlite:, amqp://, etc.)
    if (/(?:postgres|mysql|mongodb|redis|sqlite|amqp|mariadb|mssql)(?:ql)?:\/?\//i.test(val)) return true;
    // Any URL with embedded credentials (scheme://user:pass@host)
    if (/[a-z]+:\/\/[^/]*:[^/]*@/i.test(val)) return true;
    // Private/internal IP addresses (10.x, 172.16-31.x, 192.168.x, 127.x)
    if (/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/.test(val)) return true;
    // Internal hostnames (.internal, .local, .lan, .private, .corp, .intranet)
    if (/\b[\w.-]+\.(?:internal|local|lan|private|corp|intranet)\b/i.test(val)) return true;
    // File system paths (Unix or Windows)
    if (/(?:^|\s)[/\\](?:[\w.-]+[/\\]){2,}/i.test(val)) return true;
  }
  return false;
}

/**
 * Valida y sanitiza el campo `details`.
 * Permite estructuras de validación y metadatos de dominio (versiones, IDs de tabla, razones, etc.)
 * Jamás propaga objetos con headers de autorización, tokens, contraseñas o secretos.
 */
export function sanitizeDetails(details: unknown): unknown {
  if (!details || typeof details !== 'object') return undefined;

  try {
    const serialized = JSON.stringify(details);
    if (/password|secret|token|hash|api_key|authorization|cookie|database_url|postgres|sqlite|bearer/i.test(serialized)) {
      return undefined;
    }

    if (Array.isArray(details)) {
      const sanitizedArray = details
        .filter((item) => item !== null && item !== undefined)
        .map((item) => {
          if (typeof item !== 'object') {
            return isSensitiveDetailValue(item) ? null : item;
          }
          return sanitizeDetails(item);
        })
        .filter((item) => item !== null && item !== undefined);

      return sanitizedArray.length > 0 ? sanitizedArray : undefined;
    }

    const safeObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(details)) {
      if (isSensitiveDetailKey(key)) continue;

      if (value !== null && typeof value === 'object') {
        const nested = sanitizeDetails(value);
        if (nested !== undefined) {
          safeObj[key] = nested;
        }
      } else if (!isSensitiveDetailValue(value)) {
        safeObj[key] = value;
      }
    }

    return Object.keys(safeObj).length > 0 ? safeObj : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Sanitiza campos extra opcionales para evitar la sobrescritura de campos del contrato público.
 * Solo se permiten flags específicos de negocio explícitamente autorizados (ej. valid: boolean).
 */
export function sanitizeExtraFields(extra?: Record<string, unknown>): Record<string, unknown> {
  if (!extra || typeof extra !== 'object') return {};
  const safe: Record<string, unknown> = {};
  if ('valid' in extra && typeof extra.valid === 'boolean') {
    safe.valid = extra.valid;
  }
  return safe;
}

export interface SanitizedErrorResponse {
  code: string;
  error: string;
  message: string;
  statusCode: number;
  requestId: string;
  details?: unknown;
  valid?: boolean;
}

/**
 * Genera el payload de error público completamente tipado y sanitizado.
 */
export function buildSanitizedErrorPayload(
  err: unknown,
  requestId: string,
  extraFields?: Record<string, unknown>
): { statusCode: number; payload: SanitizedErrorResponse } {
  const errObj = (typeof err === 'object' && err !== null ? err : {}) as ErrorLike;
  const rawStatus = Number(errObj.statusCode || errObj.status);
  const statusCode = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  if (!isClientError) {
    return {
      statusCode: 500,
      payload: {
        code: 'INTERNAL_SERVER_ERROR',
        error: CANONICAL_STATUS_MESSAGES[500],
        message: CANONICAL_STATUS_MESSAGES[500],
        statusCode: 500,
        requestId,
        ...sanitizeExtraFields(extraFields)
      }
    };
  }

  const publicCode = sanitizePublicCode(errObj.code, statusCode);

  const rawMessage = typeof errObj.message === 'string' ? errObj.message : '';
  const publicMessage = isSafePublicMessage(rawMessage)
    ? rawMessage
    : (CANONICAL_STATUS_MESSAGES[statusCode] || 'Error en la solicitud');

  let publicError: string;
  if (
    publicCode === 'STATE_CONFLICT' ||
    publicCode === 'LAYOUT_VERSION_CONFLICT' ||
    publicCode === 'ZONE_NOT_FOUND' ||
    publicCode === 'TABLE_NOT_FOUND' ||
    errObj.error === publicCode
  ) {
    publicError = publicCode;
  } else if (isSafeDomainCode(errObj.error)) {
    publicError = errObj.error.trim();
  } else if (isSafePublicMessage(errObj.error)) {
    publicError = errObj.error;
  } else {
    publicError = publicMessage;
  }

  const sanitizedDetails = sanitizeDetails(errObj.details);
  const safeExtra = sanitizeExtraFields(extraFields);

  const payload: SanitizedErrorResponse = {
    code: publicCode,
    error: publicError,
    message: publicMessage,
    statusCode,
    requestId,
    ...(sanitizedDetails !== undefined ? { details: sanitizedDetails } : {}),
    ...safeExtra
  };

  return { statusCode, payload };
}

/**
 * Sanitiza y envía una respuesta de error estandarizada (P0-05, R02, C01).
 * - Errores 5xx: SIEMPRE opacos con requestId y logueados internamente.
 * - Errores 4xx: conservan código público de dominio y mensaje tipado seguro.
 */
export function sendSanitizedError(
  reply: FastifyReply,
  err: unknown,
  extraFields?: Record<string, unknown>
) {
  const errObj = (typeof err === 'object' && err !== null ? err : {}) as ErrorLike;
  const req = (reply as unknown as { request?: FastifyRequest }).request;
  const requestId = String(req?.id || errObj.requestId || '');

  const { statusCode, payload } = buildSanitizedErrorPayload(err, requestId, extraFields);

  if (statusCode >= 500) {
    const correlationId = (req as any)?.correlationId || requestId;
    const staffUser = (req as any)?.staffUser;
    req?.log?.error?.(
      {
        err,
        requestId,
        correlationId,
        url: req?.url,
        method: req?.method,
        restaurantId: staffUser?.restaurantId,
        staffUserId: staffUser?.sub,
        terminalId: staffUser?.terminalId
      },
      'Server exception intercepted and sanitized'
    );
  }

  if (statusCode === 429 && typeof errObj.retryAfterSeconds === 'number') {
    reply.header('Retry-After', String(Math.max(1, Math.ceil(errObj.retryAfterSeconds))));
  }

  return reply.status(statusCode).send(payload);
}

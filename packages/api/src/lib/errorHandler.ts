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

/**
 * Registro explícito y cerrado de códigos de error de dominio públicos reconocidos por el servidor.
 * Cualquier código que no pertenezca a esta lista canónica será degradado al código HTTP canónico.
 */
export const KNOWN_PUBLIC_DOMAIN_CODES = new Set<string>([
  // Códigos canónicos HTTP
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'REQUEST_TIMEOUT',
  'CONFLICT',
  'GONE',
  'UNPROCESSABLE_ENTITY',
  'TOO_MANY_REQUESTS',
  'INTERNAL_SERVER_ERROR',

  // Autenticación / Roles / Permisos
  'INVALID_PIN',
  'OPERATOR_PIN_REQUIRED',
  'SETTLE_REQUIRES_MANAGER',
  'MANAGER_ROLE_REQUIRED',
  'TOKEN_PURPOSE_MISMATCH',
  'TOKEN_SCOPE_MISMATCH',
  'STAFF_TENANT_MISMATCH',
  'TEMPORARY_TOKEN_NOT_ALLOWED',
  'ROLE_NOT_AUTHORIZED',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'FORBIDDEN_FORCE_CLOSE',
  'FORBIDDEN_CROSS_TENANT',
  'PIN_ALREADY_IN_USE',

  // Sesión y Mesa
  'SESSION_TOKEN_REQUIRED',
  'SESSION_NOT_FOUND',
  'SESSION_CLOSED',
  'SESSION_EXPIRED',
  'SESSION_ALREADY_ACTIVE',
  'STALE_SESSION_UNRESOLVED',
  'TABLE_NOT_FOUND',
  'TABLE_NOT_AVAILABLE',
  'TABLE_NEEDS_CLEANING',
  'TABLE_ID_REQUIRED',
  'TABLE_NOT_ORDERABLE',
  'TABLE_RESTAURANT_MISMATCH',
  'TABLE_HAS_UNPAID_BALANCE',
  'TABLE_CLOSURE_INCOMPLETE',
  'ZONE_NOT_FOUND',
  'SHIFT_CLOSED',
  'SHIFT_INACTIVE',
  'SHIFT_NOT_FOUND',
  'STATE_CONFLICT',
  'TABLE_STATE_CONFLICT',
  'WAITLIST_STATE_CONFLICT',
  'LAYOUT_VERSION_CONFLICT',
  'INVALID_TRANSITION',
  'INVALID_TABLE_STATE_FLOW',
  'MISSING_TARGET_STATE',
  'DRAFT_UNRESOLVED',
  'DRAFT_CONFLICT',
  'PENDING_VALIDATION_UNRESOLVED',
  'RESTAURANT_NOT_FOUND',
  'SLUG_REQUIRED',

  // Comandas, Pedidos, Carta y Cocina
  'STOCK_UNAVAILABLE',
  'QUANTITY_THRESHOLD',
  'WAITER_VALIDATION_REQUIRED',
  'INVALID_MANUAL_ORDER',
  'STATUS_REQUIRED',
  'DIGITAL_PAYMENTS_UNAVAILABLE',
  'ACTIVE_CALL_EXISTS',
  'ACTIVE_CALL_LIMIT',
  'PENDING_CALLS',
  'CALL_NOT_FOUND',
  'CALL_ALREADY_CANCELLED',
  'CALL_ALREADY_RESOLVED',
  'CALL_INVALID_TRANSITION',
  'PAYMENT_METHOD_REQUIRED',
  'INVALID_PAYMENT_METHOD',
  'INVALID_POINTS_DELTA',
  'SSE_STREAM_DISABLED',
  'EMPTY_JSON_BODY',
  'INVALID_JSON_BODY',
  'VALIDATION_ERROR',
  'FST_ERR_VALIDATION',
  'ITEM_NOT_FOUND',
  'ITEM_NOT_AVAILABLE',
  'ORDERING_DISABLED',
  'INVALID_QUANTITY',
  'QUANTITY_LIMIT_EXCEEDED',
  'NOTES_TOO_LONG',
  'EMPTY_ORDER',
  'ORDER_NOT_IN_DRAFT',
  'ORDER_FINAL_STATE',
  'INVALID_ORDER_STATUS',
  'INVALID_ORDER_TRANSITION',
  'TASK_NO_LONGER_AVAILABLE',

  // Caja, Facturación, Ajustes y Liquidación
  'RECEIPT_COUNTER_UNAVAILABLE',
  'SETTLEMENT_NOT_FOUND',
  'RECEIPT_NOT_FOUND',
  'INVALID_SHIFT_RANGE',
  'INVALID_DATE_RANGE',
  'INVALID_ADJUSTMENT_AMOUNTS',
  'REASON_REQUIRED',
  'ADJUSTMENT_EXCEEDS_SETTLEMENT',
  'ADJUSTMENT_EXCEEDS_TIP',
  'INVALID_TIP',
  'TIP_REQUIRES_BILL',
  'INVALID_RESPONSIBLE_STAFF',
  'IDEMPOTENCY_KEY_REUSED',
  'UPSELL_IDEMPOTENCY_CONFLICT',

  // Fila Virtual (Waitlist)
  'WAITLIST_FULL',
  'WAITLIST_DISABLED',
  'WAITLIST_TICKET_NOT_FOUND',
  'INVALID_GUEST_NAME',
  'INVALID_PARTY_SIZE',
  'INVALID_PHONE',
  'CONSENT_REQUIRED',
  'ALREADY_SEATED',
  'INVALID_WAITLIST_STATUS',
  'PREORDER_PROMOTION_FAILED',
  'PREORDER_DISABLED',
  'RESERVATION_CONFLICT',

  // Fidelización, Encuestas y Extras
  'INVALID_RATING',
  'COMMENT_TOO_LONG',
  'INVALID_REVIEW_QUANTITY_THRESHOLD',
  'INSUFFICIENT_REWARD_POINTS',
  'REWARDS_DISABLED',
  'GEOFENCE_EXCEEDED',
  'GUEST_NAME_TOO_LONG',

  // Códigos de dominio emitidos por otros servicios y contratos compartidos.
  // Mantenerlos registrados conserva los mensajes accionables sin aceptar códigos arbitrarios.
  'CANCELLATION_REASON_REQUIRED',
  'CAPABILITY_NOT_AVAILABLE',
  'CLOSE_CONFLICT',
  'CLOSE_REQUIRES_FULL_SETTLEMENT',
  'CONCURRENCY_CONFLICT',
  'COVERAGE_EXCEEDS_SESSION_CONSUMPTION',
  'COVERAGE_EXCEEDS_TOTAL',
  'DELIVERY_UNDO_EXPIRED',
  'DELIVERY_UNDO_UNAVAILABLE',
  'DIGITAL_METHOD_UNAVAILABLE',
  'FEEDBACK_ALREADY_EXISTS',
  'FISCAL_DOC_ALREADY_EXISTS',
  'FORBIDDEN_LEGACY_ROUTE',
  'FORCE_REASON_REQUIRED',
  'INVALID_FISCAL_COVERAGE',
  'INVALID_FISCAL_DOC',
  'INVALID_IDEMPOTENCY_KEY',
  'INVALID_MENU_ITEM_ID',
  'INVALID_ORDER_ITEM_ID',
  'INVALID_PAYLOAD',
  'INVALID_PREORDER',
  'INVALID_SERVICE_ACTION',
  'INVALID_SERVICE_TASK',
  'INVALID_SETTLE_REQUEST',
  'INVALID_SUBMIT_KEY',
  'ITEM_ALREADY_PAID',
  'NOTHING_TO_SETTLE',
  'ORDER_NOT_FOUND',
  'ORDER_NOT_REVIEWABLE',
  'ORDER_REVIEW_CONFLICT',
  'OVERPAYMENT',
  'OVERPAYMENT_NOT_ALLOWED',
  'PIN_INVALID',
  'REJECTION_REASON_REQUIRED',
  'ROTATION_CONFLICT',
  'SERVICE_ACTION_NOT_SUPPORTED',
  'SETTLE_CONFLICT',
  'SETTLE_CLOSURE_INCOMPLETE',
  'STAFF_ACTOR_REQUIRED',
  'STALE_ACCOUNT_VERSION',
  'STALE_SESSION_CONFLICT',
  'SUBMIT_CONFLICT',
  'SUBMIT_KEY_REUSED',
  'TABLE_STATE_NOT_ORDERABLE',
  'TASK_ALREADY_CLAIMED',
  'TASK_RELEASE_FORBIDDEN',
  'TASK_RESOLVE_FORBIDDEN',
  'WAITLIST_ENTRY_NOT_FOUND'
]);

// Redes privadas, loopback y link-local que nunca deben aparecer en errores públicos.
const PRIVATE_NETWORK_ADDRESS_PATTERN = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b|(?:\[\s*::1\s*\]|(?<![A-Za-z0-9:])::1(?![A-Fa-f0-9:]))/i;
const INTERNAL_HOSTNAME_PATTERN = /\b(?:localhost|[\w.-]+\.(?:internal|local|lan|private|corp|intranet|invalid|localhost|test))\b/i;
const URL_PATTERN = /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/i;

// Patrones estrictos que bloquean cualquier contenido inseguro, de infraestructura, URLs o secretos
const UNSAFE_MESSAGE_PATTERNS = [
  /[=\\]/,                  // Asignaciones clave=valor, query strings, backslashes
  /\bBearer\b/i,            // Tokens Bearer
  /\b(?:postgres|sqlite|mysql|mongodb|redis|prisma|mariadb|mssql|amqp):\/\//i, // URIs de conexión
  /\b(?:SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|UNION)\b/i,  // SQL keywords
  /password|secret|token|hash|api_key|authorization|cookie|private_key/i, // Credenciales y secretos
  /\.(?:ts|js|jsx|tsx|json|env|prisma)\b/i, // Rutas o nombres de archivos de código
  /at (?:[a-zA-Z0-9_$.]+ )?\(?.*:\d+:\d+\)?/, // Stack traces 'at Module (file:line:col)'
  /[\r\n]/,                 // Múltiples líneas
  /prisma|foreign key|unique constraint|syntax error|database|column .* does not exist|table .* does not exist|invalid .* invocation/i,
  PRIVATE_NETWORK_ADDRESS_PATTERN,
  // URLs con credenciales embebidas (scheme://user:pass@host)
  /[a-z]+:\/\/[^/]*:[^/]*@/i,
  // Hostnames internos o de infraestructura
  INTERNAL_HOSTNAME_PATTERN,
  URL_PATTERN,
  // Rutas de archivos de infraestructura
  /(?:^|\s)[/\\](?:[\w.-]+[/\\]){2,}/i
];

/**
 * Valida si un código de error es un identificador de dominio público seguro y registrado.
 */
export function isSafeDomainCode(code: unknown): code is string {
  if (typeof code !== 'string') return false;
  const trimmed = code.trim();
  if (!KNOWN_PUBLIC_DOMAIN_CODES.has(trimmed)) return false;
  return true;
}

/**
 * Valida si un mensaje es texto legible y seguro para el usuario final.
 * - Sin saltos de línea, stack traces, URLs, direcciones internas ni secretos.
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
 * Si el código está explícitamente registrado en la allowlist de dominio, se conserva.
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
    if (URL_PATTERN.test(val)) return true;
    // Any URL with embedded credentials (scheme://user:pass@host)
    if (/[a-z]+:\/\/[^/]*:[^/]*@/i.test(val)) return true;
    if (PRIVATE_NETWORK_ADDRESS_PATTERN.test(val)) return true;
    if (INTERNAL_HOSTNAME_PATTERN.test(val)) return true;
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

  const isExplicitCodeProvided = errObj.code !== undefined && errObj.code !== null && String(errObj.code).trim() !== '';
  const isKnownCode = isExplicitCodeProvided && isSafeDomainCode(errObj.code);
  const isUnregisteredCode = isExplicitCodeProvided && !isKnownCode;

  const publicCode = sanitizePublicCode(errObj.code, statusCode);

  const rawMessage = typeof errObj.message === 'string' ? errObj.message : '';
  // Si se proporcionó un código explícito pero no está registrado en el contrato público,
  // se trata como error desconocido y debe recibir mensaje y detalles genéricos canónicos (Ficha P1).
  const publicMessage = (!isUnregisteredCode && isSafePublicMessage(rawMessage))
    ? rawMessage
    : (CANONICAL_STATUS_MESSAGES[statusCode] || 'Error en la solicitud');

  const sanitizedDetails = isUnregisteredCode ? undefined : sanitizeDetails(errObj.details);
  const safeExtra = sanitizeExtraFields(extraFields);

  const payload: SanitizedErrorResponse = {
    code: publicCode,
    // Keep the legacy `error` field user-readable; `code` is the machine identifier.
    error: publicMessage,
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

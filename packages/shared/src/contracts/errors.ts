/**
 * Contrato canónico de errores públicos y manejo uniforme de excepciones.
 */

export interface PublicErrorPayload {
  code: string;
  message: string;
  requestId?: string;
  details?: unknown;
}

/**
 * Error de dominio o aplicación con mensaje y código aprobados para exposición pública.
 */
export class AppPublicError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;
  public readonly isPublic = true;

  constructor(
    code: string,
    message: string,
    statusCode: number = 400,
    details?: unknown
  ) {
    super(message);
    this.name = 'AppPublicError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const StandardErrorCodes = {
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  BAD_REQUEST: 'BAD_REQUEST',
  CONFLICT: 'CONFLICT',
  PIN_INVALID: 'PIN_INVALID',
  PIN_ALREADY_IN_USE: 'PIN_ALREADY_IN_USE',
  TABLE_NOT_FOUND: 'TABLE_NOT_FOUND',
  SESSION_CLOSED: 'SESSION_CLOSED',
  OVERPAYMENT_NOT_ALLOWED: 'OVERPAYMENT_NOT_ALLOWED',
  CONCURRENCY_CONFLICT: 'CONCURRENCY_CONFLICT',
  SETTLE_CLOSURE_INCOMPLETE: 'SETTLE_CLOSURE_INCOMPLETE'
} as const;

export type StandardErrorCode = (typeof StandardErrorCodes)[keyof typeof StandardErrorCodes];

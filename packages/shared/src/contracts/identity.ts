/**
 * Contratos canónicos de identidad: dispositivo de salón vs operador humano.
 */

export interface TerminalContext {
  terminalId: string;
  restaurantId: string;
  name: string;
}

export interface StaffOperatorContext {
  staffUserId: string;
  role: 'ADMIN' | 'MANAGER' | 'WAITER' | 'KITCHEN' | 'CASHIER' | 'TERMINAL' | string;
  name: string;
  restaurantId: string;
  terminalId?: string;
  temp?: boolean;
  purpose?: string;
  tableId?: string;
  sessionId?: string;
  isTerminalOnly?: boolean;
}

export interface TemporaryAuthorizationDTO {
  purpose: 'CASH_COLLECT' | 'MANAGER_OVERRIDE' | string;
  tableId?: string;
  sessionId?: string;
  expiresInSeconds: number;
}

/**
 * Valida si un PIN cumple estrictamente el formato de 4 a 6 dígitos numéricos.
 */
export function isValidPinFormat(pin: unknown): boolean {
  if (typeof pin !== 'string') return false;
  return /^\d{4,6}$/.test(pin);
}

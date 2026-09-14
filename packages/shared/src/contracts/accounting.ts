/**
 * Estados de comanda que integran consumo cobrable en la cuenta de mesa.
 * - PENDING_VALIDATION NO computa (requiere validación de mozo/staff).
 * - DRAFT NO computa (comanda en preparación local por comensal).
 * - CANCELLED / REJECTED NO computa.
 */
export const CANONICAL_CONSUMO_STATUSES: readonly string[] = Object.freeze([
  'CONFIRMED',
  'IN_KITCHEN',
  'READY_TO_SERVE',
  'SERVED',
  'PAID'
]);

/**
 * Predicado formal: indica si una orden computa en el saldo exigible de la mesa.
 */
export function isOrderComputable(status: unknown): boolean {
  return typeof status === 'string' && CANONICAL_CONSUMO_STATUSES.includes(status);
}

/**
 * Calcula el importe total de una línea de comanda en minor units (centavos enteros).
 */
export function calculateOrderItemTotalMinor(
  quantity: number,
  unitPriceMinor: number,
  modifiersMinor: number = 0
): number {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new TypeError(`quantity must be a non-negative integer, got: ${quantity}`);
  }
  if (!Number.isInteger(unitPriceMinor) || unitPriceMinor < 0) {
    throw new TypeError(`unitPriceMinor must be a non-negative integer, got: ${unitPriceMinor}`);
  }
  if (!Number.isInteger(modifiersMinor) || modifiersMinor < 0) {
    throw new TypeError(`modifiersMinor must be a non-negative integer, got: ${modifiersMinor}`);
  }
  return quantity * unitPriceMinor + modifiersMinor;
}

/**
 * Calcula el importe total de una comanda a partir de sus líneas en minor units.
 */
export function calculateOrderTotalMinor(
  items: ReadonlyArray<{
    quantity: number;
    unitPriceMinor: number;
    modifiersMinor?: number;
  }>
): number {
  let total = 0;
  for (const item of items) {
    total += calculateOrderItemTotalMinor(
      item.quantity,
      item.unitPriceMinor,
      item.modifiersMinor ?? 0
    );
  }
  return total;
}

/**
 * Invariantes de balance de cuenta de sesión de mesa.
 */
export interface SessionBalanceCalculation {
  consumoMinor: number;
  tipMinor: number;
  adjustmentsMinor: number;
  totalDueMinor: number;
  paidMinor: number;
  saldoMinor: number;
  isSettled: boolean;
}

/**
 * Calcula el balance contable canónico de una mesa.
 * Invariante estricto: saldoMinor = max(0, totalDueMinor - paidMinor)
 */
export function calculateSessionBalance(params: {
  consumoMinor: number;
  paidMinor: number;
  tipMinor?: number;
  adjustmentsMinor?: number;
}): SessionBalanceCalculation {
  const { consumoMinor, paidMinor } = params;
  const tipMinor = params.tipMinor ?? 0;
  const adjustmentsMinor = params.adjustmentsMinor ?? 0;

  if (!Number.isInteger(consumoMinor) || consumoMinor < 0) {
    throw new TypeError(`consumoMinor must be a non-negative integer, got: ${consumoMinor}`);
  }
  if (!Number.isInteger(paidMinor) || paidMinor < 0) {
    throw new TypeError(`paidMinor must be a non-negative integer, got: ${paidMinor}`);
  }
  if (!Number.isInteger(tipMinor) || tipMinor < 0) {
    throw new TypeError(`tipMinor must be a non-negative integer, got: ${tipMinor}`);
  }
  if (!Number.isInteger(adjustmentsMinor)) {
    throw new TypeError(`adjustmentsMinor must be an integer, got: ${adjustmentsMinor}`);
  }

  const totalDueMinor = Math.max(0, consumoMinor + tipMinor + adjustmentsMinor);
  // El saldo pendiente de cobro de la mesa es el consumo (con sus ajustes) pendiente de ser cubierto
  const consumptionDueMinor = Math.max(0, consumoMinor + adjustmentsMinor);
  const saldoMinor = Math.max(0, consumptionDueMinor - paidMinor);
  const isSettled = saldoMinor === 0 && (consumoMinor > 0 ? paidMinor >= consumptionDueMinor : true);

  return {
    consumoMinor,
    tipMinor,
    adjustmentsMinor,
    totalDueMinor,
    paidMinor,
    saldoMinor,
    isSettled
  };
}

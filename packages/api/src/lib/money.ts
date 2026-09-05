/**
 * Autoridad monetaria en centavos enteros (Etapa 03 COCINA-CUENTAS).
 *
 * Decisión del plan: el dinero vive en `Int` centavos con moneda ARS
 * explícita. Los `Float` heredados (`MenuItem.price`, `Order.totalAmount`,
 * `PaymentTransaction.amount`, ...) se conservan como lectura legacy para no
 * perder ni reescribir pedidos previos; la etapa 04+ validará y escribirá
 * los campos `*Cents`. Nada en este módulo usa floats como autoridad: toda
 * entrada float se convierte una sola vez con redondeo explícito.
 */

export const CENTS_CURRENCY = 'ARS';
export const MAX_CENTS = 999_999_999;
export const MAX_QUANTITY = 50;

export function isValidCents(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_CENTS
  );
}

/** Lanza error 400 si el valor no es un importe válido en centavos. */
export function assertValidCents(value: unknown, field = 'amountCents'): asserts value is number {
  if (!isValidCents(value)) {
    const error: any = new Error(`Importe inválido en ${field}: se exigen centavos enteros >= 0`);
    error.statusCode = 400;
    error.code = 'MONEY_INVALID';
    error.field = field;
    throw error;
  }
}

/**
 * Conversión única y explícita desde un precio legacy en float hacia
 * centavos. Rechaza NaN, Infinity, negativos y valores que excedan el
 * máximo entero seguro. Sólo para compatibilidad de lectura/migración;
 * el servidor nunca multiplica floats encadenados.
 */
export function toCentsFromFloatPrice(price: unknown): number {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    const error: any = new Error('Precio legacy inválido: se exige número finito >= 0');
    error.statusCode = 400;
    error.code = 'MONEY_INVALID';
    throw error;
  }
  const cents = Math.round(price * 100);
  assertValidCents(cents, 'priceCents');
  return cents;
}

/** Suma entera con control de overflow; invariante: sin floats intermedios. */
export function sumCents(values: readonly unknown[], field = 'totalCents'): number {
  let total = 0;
  for (const v of values) {
    assertValidCents(v, field);
    total += v;
    if (total > MAX_CENTS) {
      const error: any = new Error(`Desborde de importe en ${field}`);
      error.statusCode = 400;
      error.code = 'MONEY_OVERFLOW';
      throw error;
    }
  }
  return total;
}

/** Importe de línea: unitCents * qty con cantidad entera 1..50. */
export function lineTotalCents(unitPriceCents: unknown, quantity: unknown): number {
  assertValidCents(unitPriceCents, 'unitPriceCents');
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QUANTITY) {
    const error: any = new Error(`Cantidad inválida: entero 1..${MAX_QUANTITY}`);
    error.statusCode = 400;
    error.code = 'INVALID_QUANTITY';
    throw error;
  }
  const total = (unitPriceCents as number) * quantity;
  assertValidCents(total, 'lineTotalCents');
  return total;
}

/**
 * Reparto en partes iguales con residuo determinista: base = floor(total/parts)
 * y el resto (0..parts-1 centavos) se asigna a las primeras posiciones en
 * orden estable. Invariantes: suma exacta == total; repetir lectura no cambia
 * a quién se asignó el centavo restante.
 */
export function splitEqualParts(totalCents: unknown, parts: unknown): number[] {
  assertValidCents(totalCents, 'totalCents');
  if (typeof parts !== 'number' || !Number.isInteger(parts) || parts <= 0 || parts > 100) {
    const error: any = new Error('Partes inválidas: entero 1..100');
    error.statusCode = 400;
    error.code = 'SPLIT_PARTS_INVALID';
    throw error;
  }
  const total = totalCents as number;
  const base = Math.floor(total / parts);
  const remainder = total - base * parts;
  const out: number[] = new Array(parts).fill(base);
  for (let i = 0; i < remainder; i += 1) out[i] += 1;
  return out;
}

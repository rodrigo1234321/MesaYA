import { assertValidCents, CENTS_CURRENCY, MAX_CENTS } from './money';

/**
 * Contratos de datos cocina/cuentas (Etapa 03): participantes, tandas,
 * snapshots de modificadores y claves de idempotencia.
 *
 * Sólo validación pura y versionado. No abre endpoints ni UI (etapas 04–08);
 * el servidor usará estos validadores al confirmar pedidos en etapa 04.
 *
 * Regla contable: jamás se guarda precio, ingrediente disponible ni
 * contabilidad en notas libres. Las notas (`OrderItem.notes`) son texto
 * para cocina; los importes y modificadores viajan en JSON estructurado
 * con schema/version que el servidor puede revalidar.
 */

export const MODIFIER_SNAPSHOT_SCHEMA = 'mesaya.modifiers/v1';
export const MODIFIER_SNAPSHOT_VERSION = 1;
export const MAX_MODIFIER_SELECTIONS = 20;

export const TANDA_STATUSES = ['DRAFT', 'CONFIRMED', 'IN_KITCHEN', 'SERVED', 'CANCELLED'] as const;
export type TandaStatus = (typeof TANDA_STATUSES)[number];

/** FSM mínima de tanda: sin retrocesos; CANCELLED/terminales no transicionan. */
export const TANDA_TRANSITIONS: Record<TandaStatus, readonly TandaStatus[]> = Object.freeze({
  DRAFT: ['CONFIRMED', 'CANCELLED'] as const,
  CONFIRMED: ['IN_KITCHEN', 'CANCELLED'] as const,
  IN_KITCHEN: ['SERVED', 'CANCELLED'] as const,
  SERVED: [] as const,
  CANCELLED: [] as const,
});

export function canTransitionTanda(from: unknown, to: unknown): boolean {
  if (!TANDA_STATUSES.includes(from as TandaStatus) || !TANDA_STATUSES.includes(to as TandaStatus)) return false;
  return TANDA_TRANSITIONS[from as TandaStatus].includes(to as TandaStatus);
}

export const PARTICIPANT_STATUSES = ['ACTIVE', 'REVOKED'] as const;

export interface ModifierSelectionSnapshot {
  groupName: string;
  optionName: string;
  /** Diferencia de precio en centavos (puede ser negativa por descuento). */
  priceDeltaCents: number;
  /** Etiqueta legible para cocina, ej: "Tamaño: Grande (+$500)". */
  readableLabel: string;
  groupId?: string;
  optionId?: string;
}

export interface OrderLineModifiersSnapshot {
  schema: typeof MODIFIER_SNAPSHOT_SCHEMA;
  version: typeof MODIFIER_SNAPSHOT_VERSION;
  selections: ModifierSelectionSnapshot[];
}

function invalidModifierError(reason: string): any {
  const error: any = new Error(`Snapshot de modificadores inválido: ${reason}`);
  error.statusCode = 400;
  error.code = 'MODIFIERS_INVALID';
  throw error;
}

/** Valida el JSON estructurado de modificadores de una línea (servidor). */
export function validateModifierSnapshot(value: unknown): asserts value is OrderLineModifiersSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalidModifierError('se exige objeto con schema/version/selections');
  }
  const v = value as Record<string, unknown>;
  if (v.schema !== MODIFIER_SNAPSHOT_SCHEMA) return invalidModifierError('schema debe ser mesaya.modifiers/v1');
  if (v.version !== MODIFIER_SNAPSHOT_VERSION) return invalidModifierError('version debe ser 1');
  if (!Array.isArray(v.selections)) return invalidModifierError('selections debe ser arreglo');
  if (v.selections.length > MAX_MODIFIER_SELECTIONS) {
    return invalidModifierError(`máximo ${MAX_MODIFIER_SELECTIONS} selecciones`);
  }
  for (const s of v.selections) {
    if (typeof s !== 'object' || s === null) return invalidModifierError('selección debe ser objeto');
    const sel = s as Record<string, unknown>;
    for (const field of ['groupName', 'optionName', 'readableLabel'] as const) {
      if (typeof sel[field] !== 'string' || (sel[field] as string).length === 0 || (sel[field] as string).length > 200) {
        return invalidModifierError(`${field} debe ser texto 1..200`);
      }
    }
    if (
      typeof sel.priceDeltaCents !== 'number' ||
      !Number.isInteger(sel.priceDeltaCents) ||
      sel.priceDeltaCents < -MAX_CENTS ||
      sel.priceDeltaCents > MAX_CENTS
    ) {
      return invalidModifierError('priceDeltaCents debe ser entero en centavos');
    }
    for (const idField of ['groupId', 'optionId'] as const) {
      if (sel[idField] !== undefined && (typeof sel[idField] !== 'string' || (sel[idField] as string).length > 64)) {
        return invalidModifierError(`${idField} debe ser string <= 64`);
      }
    }
  }
}

/** Suma de deltas de modificadores en centavos (entera, sin floats). */
export function sumModifierDeltas(snapshot: OrderLineModifiersSnapshot): number {
  let total = 0;
  for (const s of snapshot.selections) {
    total += s.priceDeltaCents;
    if (total < -MAX_CENTS || total > MAX_CENTS) {
      const error: any = new Error('Desborde en deltas de modificadores');
      error.statusCode = 400;
      error.code = 'MONEY_OVERFLOW';
      throw error;
    }
  }
  return total;
}

/** Etiqueta legible conjunta para cocina a partir de selecciones validadas. */
export function buildReadableModifierLabel(selections: readonly ModifierSelectionSnapshot[]): string {
  return selections.map((s) => s.readableLabel).join(' · ');
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

/**
 * Claves de idempotencia para tandas/pagos: opacas, 8..128 chars
 * alfanuméricos con `:`/`_`/`-`. Reintentar con la misma clave devuelve la
 * misma operación; misma clave con distinto importe es conflicto (etapa 07).
 */
export function assertValidIdempotencyKey(key: unknown, field = 'idempotencyKey'): asserts key is string {
  if (typeof key !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(key)) {
    const error: any = new Error(`Clave de idempotencia inválida en ${field}: 8..128 [A-Za-z0-9:_-]`);
    error.statusCode = 400;
    error.code = 'IDEMPOTENCY_KEY_INVALID';
    error.field = field;
    throw error;
  }
}

/** Nombre visible de participante: opcional, 1..60, sin caracteres de control. */
export function assertParticipantDisplayName(name: unknown): string | null {
  if (name === undefined || name === null) return null;
  if (typeof name !== 'string') {
    const error: any = new Error('Nombre de participante inválido');
    error.statusCode = 400;
    error.code = 'PARTICIPANT_NAME_INVALID';
    throw error;
  }
  const clean = name.trim().replace(/\s+/g, ' ');
  // eslint-disable-next-line no-control-regex
  if (clean.length === 0 || clean.length > 60 || /[\u0000-\u001F\u007F]/.test(clean)) {
    const error: any = new Error('Nombre de participante inválido: 1..60 sin controles');
    error.statusCode = 400;
    error.code = 'PARTICIPANT_NAME_INVALID';
    throw error;
  }
  return clean;
}

/** Moneda única soportada en esta entrega; rechaza ambigüedad multi-moneda. */
export function assertCentsCurrency(currency: unknown, field = 'currency'): asserts currency is typeof CENTS_CURRENCY {
  if (currency !== CENTS_CURRENCY) {
    const error: any = new Error(`Moneda inválida en ${field}: sólo ${CENTS_CURRENCY}`);
    error.statusCode = 400;
    error.code = 'CURRENCY_INVALID';
    throw error;
  }
}

/** Valida un importe en centavos ya normalizado junto a su moneda. */
export function assertMoneyCents(value: unknown, currency: unknown, field = 'amountCents'): void {
  assertCentsCurrency(currency, 'currency');
  assertValidCents(value, field);
}

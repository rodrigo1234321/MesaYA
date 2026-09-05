import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  create: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({
  prisma: {
    staffUser: {
      findMany: (...args: unknown[]) => mocks.findMany(...args),
      create: (...args: unknown[]) => mocks.create(...args),
    },
  },
}));

// @ts-ignore - script JS de soporte sin declaraciones
import syncSchema from '../../../scripts/sync_supabase_schema.js';
import {
  assertValidCents,
  isValidCents,
  lineTotalCents,
  splitEqualParts,
  sumCents,
  toCentsFromFloatPrice,
} from '../src/lib/money';
import { computePinDigest } from '../src/lib/pin-digest';
import {
  assertParticipantDisplayName,
  assertValidIdempotencyKey,
  buildReadableModifierLabel,
  canTransitionTanda,
  MODIFIER_SNAPSHOT_SCHEMA,
  sumModifierDeltas,
  validateModifierSnapshot,
  assertMoneyCents,
} from '../src/lib/order-contracts';
import { StaffService } from '../src/services/staff.service';

const projectRoot = path.resolve(__dirname, '../../..');
const sqliteSchemaPath = path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.prisma');
const postgresSchemaPath = path.join(projectRoot, 'packages', 'api', 'prisma', 'schema.supabase.prisma');
const migrationPath = path.join(
  projectRoot, 'packages', 'api', 'prisma', 'migrations-postgres',
  '20260905120000_cocina_cuentas_etapa03', 'migration.sql',
);

beforeEach(() => {
  mocks.findMany.mockReset();
  mocks.create.mockReset();
  mocks.findMany.mockResolvedValue([]);
});

// Contrato consistente (corrección Codex etapa 03): los helpers conservan
// mensajes humanos en `error.message` y exponen el código estructurado en
// `error.code`. Los tests afirman `error.code` sin exigir que el texto
// humano contenga el código.
function expectErrorCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error: any) {
    expect(error?.code).toBe(code);
    return;
  }
  throw new Error(`Se esperaba error con code ${code} pero no lanzó`);
}

describe('COCINA-CUENTAS Etapa 03 — centavos, digest PIN, contratos y migración aditiva', () => {
  it('reparto 10.000/3: 3.334 + 3.333 + 3.333, suma exacta y orden estable', () => {
    expect(splitEqualParts(10000, 3)).toEqual([3334, 3333, 3333]);
    expect(splitEqualParts(10000, 3)).toEqual(splitEqualParts(10000, 3));
    const parts = splitEqualParts(10000, 3);
    expect(sumCents(parts)).toBe(10000);
    expect(splitEqualParts(0, 3)).toEqual([0, 0, 0]);
    expect(splitEqualParts(2, 3)).toEqual([1, 1, 0]);
  });

  it('dinero: rechaza floats/NaN/Infinity/negativos y controla overflow', () => {
    for (const bad of [NaN, Infinity, -Infinity, -1, 1.5, '100', null, undefined, 999_999_999 + 1]) {
      expect(isValidCents(bad)).toBe(false);
      expectErrorCode(() => assertValidCents(bad), 'MONEY_INVALID');
    }
    expectErrorCode(() => sumCents([999_999_999, 1]), 'MONEY_OVERFLOW');
    expectErrorCode(() => lineTotalCents(100, 0), 'INVALID_QUANTITY');
    expectErrorCode(() => lineTotalCents(100, 51), 'INVALID_QUANTITY');
    expectErrorCode(() => lineTotalCents(100, 1.5), 'INVALID_QUANTITY');
    expect(lineTotalCents(3334, 2)).toBe(6668);
    expectErrorCode(() => assertMoneyCents(100, 'USD'), 'CURRENCY_INVALID');
    expectErrorCode(() => assertMoneyCents(1.5, 'ARS'), 'MONEY_INVALID');
  });

  it('compat legacy: float finito >= 0 convierte una vez; resto se rechaza', () => {
    expect(toCentsFromFloatPrice(14500)).toBe(1450000);
    expect(toCentsFromFloatPrice(0)).toBe(0);
    for (const bad of [NaN, Infinity, -0.01, -5, '10', null]) {
      expectErrorCode(() => toCentsFromFloatPrice(bad), 'MONEY_INVALID');
    }
  });

  it('digest PIN: determinista por tenant, sin PIN almacenado, secreto del servidor', () => {
    const a = computePinDigest('rest-a', '4829', 'secreto-servidor-fijo-para-test');
    const b = computePinDigest('rest-a', '4829', 'secreto-servidor-fijo-para-test');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain('4829');
    // Aísla por restaurante y por PIN: mismo PIN en otro local no colisiona.
    expect(computePinDigest('rest-b', '4829', 'secreto-servidor-fijo-para-test')).not.toBe(a);
    expect(computePinDigest('rest-a', '4830', 'secreto-servidor-fijo-para-test')).not.toBe(a);
    // Sin el secreto no hay diccionario offline: otro secreto, otro digest.
    expect(computePinDigest('rest-a', '4829', 'otro-secreto-distinto')).not.toBe(a);
    // Formato inválido falla antes de cualquier cómputo.
    for (const bad of ['123', '1234567', '12a4', ' 4829', '48 29']) {
      expect(() => computePinDigest('rest-a', bad, 's')).toThrow(/4 y 6 dígitos/);
    }
  });

  it('carrera realista: dos altas concurrentes con igual PIN, una gana y otra 409', async () => {
    const taken = new Set<string>();
    mocks.create.mockImplementation(async ({ data }: any) => {
      await new Promise((r) => setTimeout(r, 5)); // ventana de carrera
      const key = `${data.restaurantId}:${data.pinDigest}`;
      if (taken.has(key)) {
        const err: any = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      taken.add(key);
      return { id: `user-${taken.size}`, name: data.name, role: data.role };
    });

    const [r1, r2] = await Promise.allSettled([
      StaffService.createStaff('rest-carrera', 'Ana', '4829', 'WAITER'),
      StaffService.createStaff('rest-carrera', 'Bruno', '4829', 'WAITER'),
    ]);
    const ok = [r1, r2].filter((r) => r.status === 'fulfilled');
    const failed = [r1, r2].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toMatchObject({ statusCode: 409, code: 'PIN_DUPLICATE' });

    // El constraint arbitra: ambos calcularon el MISMO digest (determinista),
    // mientras los bcrypt difieren por sal (prueba de que bcrypt no unifica).
    const digests = mocks.create.mock.calls.map((c: any) => c[0].data.pinDigest);
    expect(digests).toHaveLength(2);
    expect(digests[0]).toBe(digests[1]);
    expect(digests[0]).toMatch(/^[0-9a-f]{64}$/);
    const hashes = mocks.create.mock.calls.map((c: any) => c[0].data.pinHash);
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('legacy sin digest: bcrypt secuencial rechaza duplicado y conserva login previo', async () => {
    const { default: bcrypt } = await import('bcryptjs');
    const legacyHash = await bcrypt.hash('7777', 4);
    mocks.findMany.mockResolvedValue([{ pinHash: legacyHash }]);
    await expect(StaffService.createStaff('rest-legacy', 'Nuevo', '7777', 'WAITER')).rejects.toMatchObject({
      statusCode: 409, code: 'PIN_DUPLICATE',
    });
    expect(mocks.create).not.toHaveBeenCalled();
    // PIN distinto convive con la fila legacy NULL y crea con digest nuevo.
    mocks.create.mockResolvedValue({ id: 'u2', name: 'Otro', role: 'WAITER' });
    await StaffService.createStaff('rest-legacy', 'Otro', '8888', 'WAITER');
    const data = mocks.create.mock.calls[0][0].data;
    expect(data.pinDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(data.pinHash).not.toContain('8888');
  });

  it('modificadores: snapshot v1 válido pasa; precio en notas jamás es autoridad', () => {
    const snapshot = {
      schema: MODIFIER_SNAPSHOT_SCHEMA,
      version: 1,
      selections: [
        { groupName: 'Tamaño', optionName: 'Grande', priceDeltaCents: 50000, readableLabel: 'Tamaño: Grande (+$500)' },
        { groupName: 'Extra', optionName: 'Queso', priceDeltaCents: 0, readableLabel: 'Extra: Queso' },
      ],
    };
    expect(() => validateModifierSnapshot(snapshot)).not.toThrow();
    expect(sumModifierDeltas(snapshot as any)).toBe(50000);
    expect(buildReadableModifierLabel((snapshot as any).selections)).toContain('Grande');
    // Campo libre extra (p. ej. notes) no se lee como precio ni rompe el schema.
    expect(() => validateModifierSnapshot({ ...snapshot, notes: 'sin cebolla, $999 inventado' })).not.toThrow();
    expect(sumModifierDeltas({ ...snapshot, notes: 'x' } as any)).toBe(50000);

    for (const bad of [
      { schema: 'otro/v9', version: 1, selections: [] },
      { schema: MODIFIER_SNAPSHOT_SCHEMA, version: 2, selections: [] },
      { schema: MODIFIER_SNAPSHOT_SCHEMA, version: 1, selections: [{ groupName: '', optionName: 'X', priceDeltaCents: 0, readableLabel: 'x' }] },
      { schema: MODIFIER_SNAPSHOT_SCHEMA, version: 1, selections: [{ groupName: 'G', optionName: 'X', priceDeltaCents: 1.5, readableLabel: 'x' }] },
      { schema: MODIFIER_SNAPSHOT_SCHEMA, version: 1, selections: [{ groupName: 'G', optionName: 'X', priceDeltaCents: NaN, readableLabel: 'x' }] },
      { schema: MODIFIER_SNAPSHOT_SCHEMA, version: 1, selections: new Array(21).fill({ groupName: 'G', optionName: 'X', priceDeltaCents: 0, readableLabel: 'x' }) },
      'not-an-object',
    ]) {
      expectErrorCode(() => validateModifierSnapshot(bad), 'MODIFIERS_INVALID');
    }
  });

  it('tandas e idempotencia: FSM sin retroceso y claves opacas estrictas', () => {
    expect(canTransitionTanda('DRAFT', 'CONFIRMED')).toBe(true);
    expect(canTransitionTanda('CONFIRMED', 'IN_KITCHEN')).toBe(true);
    expect(canTransitionTanda('IN_KITCHEN', 'SERVED')).toBe(true);
    expect(canTransitionTanda('CONFIRMED', 'DRAFT')).toBe(false);
    expect(canTransitionTanda('SERVED', 'DRAFT')).toBe(false);
    expect(canTransitionTanda('CANCELLED', 'DRAFT')).toBe(false);
    expect(canTransitionTanda('DRAFT', 'PAID')).toBe(false);
    expect(canTransitionTanda('NOPE', 'DRAFT')).toBe(false);
    expect(() => assertValidIdempotencyKey('tanda_rest-a_001')).not.toThrow();
    for (const bad of ['', 'corta', 'con espacios', 'con/slash', 'x'.repeat(129), null, 123]) {
      expectErrorCode(() => assertValidIdempotencyKey(bad), 'IDEMPOTENCY_KEY_INVALID');
    }
    expect(assertParticipantDisplayName('  Ana  María  ')).toBe('Ana María');
    expect(assertParticipantDisplayName(null)).toBeNull();
    expectErrorCode(() => assertParticipantDisplayName('a'.repeat(61)), 'PARTICIPANT_NAME_INVALID');
    expectErrorCode(() => assertParticipantDisplayName('Ana\u0000'), 'PARTICIPANT_NAME_INVALID');
  });

  it('migración aditiva: crea sin destruir y preserva pedidos previos', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    for (const table of ['"VisitParticipant"', '"OrderTanda"', '"ModifierGroup"', '"ModifierOption"']) {
      expect(sql).toContain(`CREATE TABLE ${table}`);
    }
    for (const col of ['"pinDigest"', '"priceCents"', '"unitPriceCents"', '"lineTotalCents"', '"amountCents"', '"tipCents"', '"partAmountCents"', '"modifiersSnapshot"', '"participantId"', '"tandaId"', '"idempotencyKey"']) {
      expect(sql).toContain(col);
    }
    // Corrección Codex: evaluar sentencias reales ignorando líneas de comentario
    // (`-- ...`), que describen justamente la ausencia de UPDATE/DELETE/DROP.
    // Un UPDATE/DELETE/DROP/TRUNCATE real sigue fallando; un comentario no.
    const statements = sql
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n');
    expect(statements).not.toMatch(/^\s*DROP\s+(TABLE|COLUMN)\b/im);
    expect(statements).not.toMatch(/^\s*DELETE\s+FROM\b/im);
    expect(statements).not.toMatch(/^\s*TRUNCATE\b/im);
    expect(statements).not.toMatch(/^\s*UPDATE\s+/im);
  });

  it('schemas sincronizados y compatibles: nuevos modelos + legacy intacto', () => {
    const sqlite = fs.readFileSync(sqliteSchemaPath, 'utf8');
    const postgres = fs.readFileSync(postgresSchemaPath, 'utf8');
    for (const model of ['model VisitParticipant', 'model OrderTanda', 'model ModifierGroup', 'model ModifierOption']) {
      expect(sqlite).toContain(model);
      expect(postgres).toContain(model);
    }
    // Legacy preservado: floats y autoría previa siguen existiendo.
    for (const legacy of ['price        Float', 'totalAmount    Float', 'addedByGuest   String', 'amount         Float']) {
      expect(sqlite).toContain(legacy);
    }
    // Digest único compuesto por restaurante.
    expect(sqlite).toContain('@@unique([restaurantId, pinDigest])');
    expect(postgres).toContain('@@unique([restaurantId, pinDigest])');
    // El sincronizador produce exactamente el schema PG (--check limpio).
    const built = syncSchema.buildPostgresSchema(sqlite);
    expect(syncSchema.normalizeLineEndings(built)).toBe(syncSchema.normalizeLineEndings(postgres));
    expect(syncSchema.diffSchemas(built, postgres)).toEqual([]);
  });
});

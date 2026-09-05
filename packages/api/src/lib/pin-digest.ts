import crypto from 'crypto';
import { getEnvironmentConfig } from './environment';
import { assertValidPin, PIN_DUPLICATE_ERROR } from './pin-policy';

/**
 * Garantía resistente de PIN duplicado concurrente por restaurante
 * (Etapa 03 COCINA-CUENTAS).
 *
 * Diseño:
 * - `bcrypt` sigue siendo la ÚNICA autoridad de autenticación; el PIN en
 *   claro jamás se almacena y `pinHash` no se toca.
 * - Columna nueva `StaffUser.pinDigest` (nullable) con constraint único
 *   compuesto `(restaurantId, pinDigest)`. La base rechaza la carrera
 *   concurrente exacta; la app traduce P2002 a 409 `PIN_DUPLICATE`.
 * - Digest = HMAC-SHA256 con secreto del servidor (misma
 *   `ENCRYPTION_SECRET_KEY` ya exigida en producción) sobre
 *   `pin-digest-v1:<restaurantId>:<pin>`. Sin el secreto, la tabla filtrada
 *   no permite diccionario offline de PINs de 4–6 cifras; con SHA simple
 *   sin secreto sí lo permitiría, por eso no se usa.
 *
 * Migración de registros existentes (sin conocer el PIN):
 * - La columna es NULL para filas previas; NULL no colisiona (SQLite y PG
 *   tratan NULL como distinto en únicos), así que no se pierde ni se
 *   reescribe nada y el login bcrypt sigue funcionando.
 * - El digest se completa hacia adelante en creación y rotación explícita.
 *   NO existe backfill irreversible: derivar digests exigiría el PIN en
 *   claro, que el servidor no conserva. Ver `docs` de entrega 03.
 */

export const PIN_DIGEST_VERSION = 'v1';
const PIN_DIGEST_DOMAIN = 'pin-digest-v1';

function resolveDigestSecret(explicitSecret?: string): string {
  if (typeof explicitSecret === 'string' && explicitSecret.length > 0) return explicitSecret;
  return getEnvironmentConfig().encryptionSecret;
}

/**
 * Calcula el digest HMAC para un restaurante+PIN. Valida formato de PIN
 * antes de cualquier cómputo (misma política 4–6 dígitos, sin trim).
 */
export function computePinDigest(restaurantId: unknown, pin: unknown, explicitSecret?: string): string {
  if (typeof restaurantId !== 'string' || restaurantId.length === 0 || restaurantId.length > 64) {
    const error: any = new Error('restaurantId inválido para digest de PIN');
    error.statusCode = 400;
    error.code = 'PIN_DIGEST_TENANT_INVALID';
    throw error;
  }
  assertValidPin(pin);
  const secret = resolveDigestSecret(explicitSecret);
  return crypto
    .createHmac('sha256', secret)
    .update(`${PIN_DIGEST_DOMAIN}:${restaurantId}:${pin}`, 'utf8')
    .digest('hex');
}

/** Detecta violación de constraint único Prisma (carrera de digest). */
export function isUniqueViolation(error: any): boolean {
  return error?.code === 'P2002';
}

/** Traduce P2002 del digest a 409 PIN_DUPLICATE sin filtrar detalles. */
export function toDuplicatePinError(): any {
  const error: any = new Error('Ese PIN ya está en uso en este restaurante');
  error.statusCode = 409;
  error.code = PIN_DUPLICATE_ERROR;
  return error;
}

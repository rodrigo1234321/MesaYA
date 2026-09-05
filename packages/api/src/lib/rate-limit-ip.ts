import { isIP } from 'node:net';

/**
 * Contrato explícito de IP para rate limit (Etapa 02 COCINA-CUENTAS).
 *
 * - Fastify corre con `trustProxy: false` (ver `src/index.ts`): `request.ip`
 *   es la dirección observada por el servidor y NO se deriva de cabeceras.
 * - Fuera de Vercel se ignoran `x-forwarded-for`, `x-real-ip` y
 *   `x-vercel-forwarded-for` enviadas por el cliente: un atacante con acceso
 *   directo no puede rotar la clave del bucket falsificando cabeceras.
 * - En ejecución Vercel reconocida (`VERCEL=1`) la plataforma sobrescribe
 *   `x-forwarded-for` y expone la IP del cliente en
 *   `x-vercel-forwarded-for`. Sólo en ese modo se lee ese header, con parseo
 *   estricto (`net.isIP`) y fallback seguro a la dirección del socket/Fastify.
 * - Host/proto/IP reenviados NUNCA se usan para autorización; sólo como clave
 *   de rate limit en el modo documentado.
 *
 * Centralizado aquí y usado en login Admin/Staff y registro público.
 */

export type RateLimitRequestLike = {
  ip?: unknown;
  headers?: Record<string, unknown>;
  raw?: { socket?: { remoteAddress?: unknown } };
  socket?: { remoteAddress?: unknown };
};

export function isVercelRuntime(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VERCEL === '1';
}

function asSocketFallback(req: RateLimitRequestLike): string | undefined {
  const candidates = [
    req.ip,
    req.raw?.socket?.remoteAddress,
    req.socket?.remoteAddress,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function firstHeaderValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim()) return entry;
    }
  }
  return undefined;
}

/** Parseo estricto: primer token de la cabecera, validado como IP literal. */
export function parseVercelForwardedFor(value: unknown): string | undefined {
  const raw = firstHeaderValue(value);
  if (!raw) return undefined;
  const first = raw.split(',')[0]?.trim();
  if (!first) return undefined;
  // Sólo literales IP (v4/v6). Nada de hostnames, puertos ni listas.
  return isIP(first) ? first : undefined;
}

/**
 * Devuelve la IP canónica para claves de rate limit según el contrato.
 * Fuera de Vercel ignora TODAS las cabeceras de reenvío.
 */
export function getRateLimitIp(
  req: RateLimitRequestLike,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const fallback = asSocketFallback(req) ?? 'unknown';
  if (!isVercelRuntime(env)) return fallback;
  return parseVercelForwardedFor(req.headers?.['x-vercel-forwarded-for']) ?? fallback;
}

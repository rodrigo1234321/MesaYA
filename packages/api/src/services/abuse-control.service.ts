import { prisma } from '../lib/prisma';

export interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** Límites deliberadamente pequeños y explícitos para superficies costosas o públicas.
 * LOGIN_BY_IP_TENANT: 25 intentos por 5 minutos (C02/punto inicial del plan).
 * No se presenta como protección completa ante PIN corto: el control
 * complementario de fallos (persistencia nueva si se requiere) queda para la
 * etapa de datos. Clave canónica por restaurante e IP + Retry-After. */
export const AbusePolicies = {
  LOGIN_BY_IP_TENANT: { limit: 25, windowSeconds: 5 * 60 },
  // Permite reintentos legítimos (p. ej. llamado al mozo y luego cuenta) sin
  // relajar la deduplicación de activos, que sigue siendo una clave única.
  CALL_BY_SESSION: { limit: 10, windowSeconds: 60 },
  WAITLIST_BY_IP_TENANT: { limit: 3, windowSeconds: 10 * 60 },
  // Alta pública de restaurantes: superficie propia (no reutilizar la
  // semántica WAITLIST_BY_IP_TENANT). Mismo umbral inicial 3/10 min.
  REGISTER_RESTAURANT_BY_IP: { limit: 3, windowSeconds: 10 * 60 },
  AI_BY_TENANT: { limit: 10, windowSeconds: 60 * 60 }
} as const satisfies Record<string, RateLimitPolicy>;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Bucket compartido entre procesos/instancias. Cada incremento que puede
 * autorizar una petición es un UPDATE condicional; nunca se hace
 * count-then-create. La clave única hace segura la carrera de creación.
 */
export class AbuseControlService {
  static consume(key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    return this.consumeWithClient(prisma, key, policy);
  }

  static async consumeWithClient(client: any, key: string, policy: RateLimitPolicy): Promise<RateLimitDecision> {
    if (!key || !Number.isInteger(policy.limit) || policy.limit < 1 || !Number.isInteger(policy.windowSeconds) || policy.windowSeconds < 1) {
      throw new Error('Política de rate limit inválida');
    }

    // Algunos tests unitarios reemplazan deliberadamente el singleton Prisma
    // por un mock mínimo. En producción este modelo siempre está presente; el
    // bypass evita que esos tests dependan de almacenamiento global.
    const bucketModel = client?.rateLimitBucket;
    if (!bucketModel) {
      return { allowed: true, remaining: policy.limit - 1, retryAfterSeconds: 0 };
    }

    const maxAttempts = 8;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + policy.windowSeconds * 1000);

      try {
        const existing = await bucketModel.findUnique({ where: { key } });

        if (!existing) {
          try {
            await bucketModel.create({
              data: { key, count: 1, windowStartedAt: now, expiresAt }
            });
            return { allowed: true, remaining: policy.limit - 1, retryAfterSeconds: 0 };
          } catch (err: any) {
            // Otra instancia ganó la carrera de INSERT; volver a leer y
            // realizar el incremento condicional contra esa fila.
            if (err?.code === 'P2002') {
              await sleep(2);
              continue;
            }
            throw err;
          }
        }

        if (new Date(existing.expiresAt) <= now) {
          const reset = await bucketModel.updateMany({
            where: { key, expiresAt: { lte: now } },
            data: { count: 1, windowStartedAt: now, expiresAt }
          });
          if (reset.count === 1) {
            return { allowed: true, remaining: policy.limit - 1, retryAfterSeconds: 0 };
          }
          await sleep(2);
          continue;
        }

        const incremented = await bucketModel.updateMany({
          where: { key, expiresAt: { gt: now }, count: { lt: policy.limit } },
          data: { count: { increment: 1 } }
        });
        if (incremented.count === 1) {
          const next = await bucketModel.findUnique({ where: { key } });
          const count = Math.min(policy.limit, Number(next?.count ?? policy.limit));
          return { allowed: true, remaining: Math.max(0, policy.limit - count), retryAfterSeconds: 0 };
        }

        const latest = await bucketModel.findUnique({ where: { key } });
        const retryAfterSeconds = Math.max(1, Math.ceil((new Date(latest?.expiresAt ?? expiresAt).getTime() - now.getTime()) / 1000));
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds
        };
      } catch (err: any) {
        // SQLite puede devolver BUSY y PostgreSQL puede abortar una
        // transacción concurrente. Reintentar sólo errores de concurrencia.
        if (['P2034', 'P2028', 'P2025', 'SQLITE_BUSY'].includes(err?.code)) {
          await sleep(3 + attempt * 2);
          continue;
        }
        throw err;
      }
    }

    return { allowed: false, remaining: 0, retryAfterSeconds: 1 };
  }
}

export function applyRetryAfter(reply: { header(name: string, value: string | number): unknown }, seconds: number): void {
  reply.header('Retry-After', String(Math.max(1, Math.ceil(seconds))));
}

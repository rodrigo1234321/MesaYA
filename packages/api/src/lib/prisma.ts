import { PrismaClient } from '@prisma/client';

/**
 * Vercel runs many short-lived Prisma clients. Supabase's session pooler
 * keeps one backend connection per client and exhausts its small pool quickly.
 * Runtime traffic must use the transaction pooler; DIRECT_URL remains the
 * migration-only URL consumed by Prisma tooling.
 */
export function normalizePrismaRuntimeDatabaseUrl(rawUrl = process.env.DATABASE_URL): string | undefined {
  if (!rawUrl || rawUrl.startsWith('file:')) return rawUrl;

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    if (!hostname.endsWith('.pooler.supabase.com')) return rawUrl;

    if (!url.port || url.port === '5432') url.port = '6543';
    url.searchParams.set('pgbouncer', 'true');
    url.searchParams.set('connection_limit', '1');
    return url.toString();
  } catch {
    // Preserve Prisma's normal validation/error message for malformed URLs.
    return rawUrl;
  }
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const runtimeDatabaseUrl = normalizePrismaRuntimeDatabaseUrl();

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    ...(runtimeDatabaseUrl
      ? { datasources: { db: { url: runtimeDatabaseUrl } } }
      : {})
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

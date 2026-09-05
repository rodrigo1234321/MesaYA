import { afterAll, describe, expect, it } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from '../src/lib/prisma';
import { buildApp } from '../src/index';

/**
 * Etapa 27 — Smoke del entrypoint serverless con cliente PG correcto.
 * Se ejecuta vía `scripts/test-postgres.mjs` (migraciones revisadas sobre
 * PostgreSQL efímero + cliente generado desde `schema.supabase.prisma`).
 * NO pertenece al runner SQLite: `SELECT version()` exige PostgreSQL.
 */
describe('Etapa 27 — Smoke serverless con cliente PG', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('el datasource activo es PostgreSQL (cliente correcto)', async () => {
    const rows = (await prisma.$queryRaw`SELECT version()`) as { version: string }[];
    expect(rows[0].version).toMatch(/PostgreSQL/i);
  });

  it('el entrypoint api/index expone el handler serverless', async () => {
    const entryUrl = pathToFileURL(
      path.resolve(__dirname, '..', '..', '..', 'api', 'index.ts')
    ).href;
    const mod = (await import(entryUrl)) as { default: unknown };
    expect(typeof mod.default).toBe('function');
  });

  it('la app arranca y responde health en /health y /v1/health', async () => {
    const app = await buildApp();
    await app.ready();
    try {
      const root = await app.inject({ method: 'GET', url: '/health' });
      expect(root.statusCode).toBe(200);
      expect(root.json().status).toBe('ok');

      const v1 = await app.inject({ method: 'GET', url: '/v1/health' });
      expect(v1.statusCode).toBe(200);
      expect(v1.json().service).toMatch(/MesaYA/);
    } finally {
      await app.close();
    }
  });
});

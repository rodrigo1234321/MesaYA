# Reporte de etapa 23 — Migraciones y harness PostgreSQL desechable

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Codex (GPT-5)
Ficha: [Etapa 23](../etapas/23-postgres-migraciones.md)
Predecesora aprobada: Etapa 22 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git local utilizable; cambios previos preservados

## Alcance realizado

- [x] Creado historial PG diferenciado en `packages/api/prisma/migrations-postgres/20260904201500_init/migration.sql` desde el schema PostgreSQL derivado; no se sobrescribió historial previo (no existía).
- [x] Agregado `migrate deploy` específico mediante `scripts/postgres-migrate.mjs`, con runtime temporal y variables `MESAYA_PG_*` obligatorias; no usa `DATABASE_URL`/`DIRECT_URL` como fallback.
- [x] Agregado `scripts/test-postgres.mjs`: aplica migraciones, genera cliente PG, ejecuta suite crítica y restaura cliente SQLite en `finally`.
- [x] Documentada estrategia para una BD existente: inventario, backup restaurable, baseline/diff, rollback y aprobación previa; no se automatiza migración de datos reales.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/prisma/migrations-postgres/20260904201500_init/migration.sql` | Historial inicial PG generado desde schema | Reconstrucción desde cero |
| `scripts/generate-postgres-migration.mjs` | Generación offline desde `--from-empty` y protección de historial | Crear migración revisable |
| `scripts/postgres-migrate.mjs` | Copia runtime + `prisma migrate deploy` con URLs explícitas | Evitar fallback/colisión de rutas |
| `scripts/test-postgres.mjs` | Harness PG con restauración garantizada | Integración real reproducible |
| `packages/api/package.json` | Scripts `prisma:postgres:migration:generate`, `prisma:postgres:migrate`, `test:postgres` | Comandos operativos acotados |
| `docs/DEPLOY_VERCEL_SUPABASE.md` | Sustituye `migrate dev` por deploy y agrega baseline/backup | Operación segura de BD existente |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---:|---|
| `node scripts/generate-postgres-migration.mjs init` en la raíz | Sólo schema local, sin conexión | 0 | Creó una migración de 18,778 caracteres en historial diferenciado |
| `$env:MESAYA_PG_DATABASE_URL='postgresql://mesaya_test:mesaya_test@127.0.0.1:55432/mesaya_test?schema=public'; $env:MESAYA_PG_DIRECT_URL=$env:MESAYA_PG_DATABASE_URL; node scripts/postgres-migrate.mjs deploy` dos veces | Contenedor local `postgres:16-alpine`, vacío | 0 / 0 | Primera aplicación creó `20260904201500_init`; segunda informó `No pending migrations to apply`; `_prisma_migrations` quedó en 1 fila |
| Mismo contenedor, con `node scripts/test-postgres.mjs` y variables `MESAYA_PG_*` explícitas | PostgreSQL real, recién creado | 0 | Migró, generó cliente PG, ejecutó `guest-orders-validation.test.ts` 32/32 PASS y restauró cliente SQLite |
| `docker rm -f mesaya-stage23-postgres` | Sólo contenedor efímero identificado | 0 | Contenedor eliminado; no queda instancia PG del harness |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/build.mjs` en la raíz | Build local, 6 workspaces | 0 | 6/6 workspaces PASS (46.24 s) |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs` en la raíz | 23 sandboxes SQLite efímeras | 0 | 23/23 suites PASS, 0 fallas; resumen en `.tmp/test-isolated-stage23-final-d8c7d1d337224ecca8b8b40ec8d521f5.out.log` |

El contenedor se levantó con `postgres:16-alpine` y credenciales sintéticas locales. Nunca se leyó ni usó una URL de Supabase real.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| DB efímera vacía se reconstruye sólo desde migraciones | PASS | Contenedor recién creado + `migrate deploy` desde `migrations-postgres` |
| Tests críticos pasan en PostgreSQL real, no mock ni SQLite etiquetada PG | PASS | `scripts/test-postgres.mjs`: `guest-orders-validation` 32/32 con cliente PG |
| Segunda aplicación no borra datos ni repite cambios | PASS | Segundo `migrate deploy`: `No pending migrations`; una fila en `_prisma_migrations` |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Evidencia y URLs sintéticas; sin valores de `.env` |
| Build completo y suite aislada aprobada | PASS | Build 6/6; runner 23/23 |

## Integridad y seguridad

- Base demo intacta: SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` antes/después.
- Cruce tenant A/B: suite PG crítica cubrió aislamiento de tenants, sesiones y pedidos.
- Rechazo sin escrituras: no corresponde a migraciones; no se tocó BD externa.
- Build: 6/6 workspaces exitosos.
- Migración/paridad: historial PG desde schema derivado; cliente SQLite restaurado después del ensayo.
- Ausencia de secretos en diff/logs: verificada; credenciales del contenedor fueron fixtures sintéticas y no se documentan como secretos operativos.

## Pendientes, riesgos y decisiones

Qué falta: revisión formal de Codex.
Qué impide avanzar: ninguna dentro de la ficha; etapas siguientes requieren decisión sobre concurrencia/operación.
Pregunta concreta si hace falta: ninguna.
Cambios fuera de alcance propuestos pero NO implementados: baseline o migración de una Supabase existente; seed productivo; recursos cloud.

## Handoff

CONTROL actualizado sólo para esta etapa.
No se inició la Etapa 24 al crear este reporte.
Solicito revisión de Codex.

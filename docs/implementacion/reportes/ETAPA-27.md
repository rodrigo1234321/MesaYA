# Reporte de etapa 27 — CI y build reproducible de despliegue

Estado: NEEDS_REVIEW
Fecha: 2026-09-06
Ejecutor y modelo realmente usado: OpenCode + Muse Spark
Ficha: [Etapa 27](../etapas/27-ci-release.md)
Predecesora aprobada: Etapa 26 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git propio utilizable (Git apunta al home `C:/Users/rodri`, sin commits ni remoto); cambios previos preservados
Cambios previos preservados: sí; suites 00–26 siguen en verde en la corrida completa

## Alcance realizado

- [x] Paso 1 — Lockfile + CI: `.gitignore` ya no ignora `package-lock.json` (el lockfile raíz se versiona para `npm ci` reproducible; verificado en sync con `npm ci --dry-run`, exit 0). NUEVO `.github/workflows/ci.yml` (instalación limpia, build 6 workspaces, paridad `--check`, matriz de rutas, suite SQLite aislada, job PostgreSQL efímero con smoke + suite PG) y NUEVO `.github/workflows/release-migrate.yml` (sólo `workflow_dispatch` + entorno `production`, únicamente `migrate deploy`; prohibidos seed/`db push`/`migrate dev`).
- [x] Paso 2 — Matriz de rutas + gate: auditoría completa contra plugins actuales (76 rutas: 2 health + 74 en módulos; ninguna sensible sin auth). NUEVO `scripts/check-route-matrix.mjs` (análisis estático con API TypeScript, clasifica por `preHandler`/`onRequest`, compara con manifiesto revisado `scripts/route-matrix.json`): ruta nueva sin clasificar, entrada obsoleta o cambio de auth → exit 1. Control negativo ejecutado con ruta sonda temporal (falló como debía, archivo restaurado byte-idéntico por hash). NUEVO `packages/api/test/route-matrix-guard.test.ts` registrado en el runner (`route-matrix-guard`).
- [x] Paso 3 — Build PG explícito + smoke + CORS: NUEVO `scripts/build-pg.mjs` (cliente desde `schema.supabase.prisma` + `tsc` shared/api + verificación de artefactos; `npm run vercel-build` delega en él para Vercel). NUEVO `packages/api/test/serverless-smoke.test.ts` (datasource PostgreSQL real, entrypoint `api/index` expone handler, health 200 en `/health` y `/v1/health`; corre vía `test-postgres.mjs`, no en SQLite). CORS contradictorio de `vercel.json` (`Allow-Origin: *` + credenciales) eliminado: CORS es propiedad exclusiva de la API por allowlist `CORS_ORIGIN` (`*` prohibido por código, etapa 05).
- [x] Paso 4 — Migración como release + secretos sin valores: preview/CI sólo compilan y prueban (ningún job migra ni siembra); release exclusivamente manual y auditada. `docs/DEPLOY_VERCEL_SUPABASE.md` ampliado (settings Vercel API/frontends, tabla de secretos por nombre sin valores, sección preview-vs-release, funcionalidades apagadas en piloto). `.env.example` completado con placeholders (piloto, IA, `MESAYA_PG_*` para operador/CI). Scripts `deploy:supabase:push/seed` no se renombran (evitar rotura) pero ya están auditados como prohibidos (`SCRIPTS_AUDITADOS.md`) y ningún workflow los invoca.
- [x] Paso 5 — Sin Git propio/remoto/CI: archivos preparados, verificación local completa; CI remota pendiente, reportada como NO EJECUTADA (no cuenta como evidencia). Sin push, deploy, remoto ni infraestructura.

No copiar criterios como cumplidos sin ejecutarlos.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `.gitignore` | `package-lock.json` deja de ignorarse | Lockfile versionado en alcance raíz |
| `package.json` | Scripts `build`, `build:pg`, `vercel-build`, `smoke:serverless`, `check:routes`, `check:supabase-schema` | Entradas reproducibles del pipeline (se detectó y eliminó una clave `smoke:serverless` duplicada que apuntaba a un script inexistente; JSON validado) |
| `.github/workflows/ci.yml` | NUEVO: npm ci, build, paridad, rutas, suite SQLite, job PG efímero | CI de la ficha |
| `.github/workflows/release-migrate.yml` | NUEVO: migrate deploy manual con entorno production | Release separada de preview |
| `scripts/check-route-matrix.mjs` | NUEVO: gate estático de rutas vs manifiesto | Detectar rutas sin clasificar |
| `scripts/route-matrix.json` | NUEVO: 76 rutas clasificadas ANON/STAFF/MANAGER con notas | Manifiesto revisado |
| `packages/api/test/route-matrix-guard.test.ts` | NUEVO: ejecuta el checker (exit 0) | Gate dentro del runner |
| `scripts/build-pg.mjs` | NUEVO: build productivo PG explícito + artefactos | Build de despliegue |
| `packages/api/test/serverless-smoke.test.ts` | NUEVO: smoke entrypoint + cliente PG + health | Smoke serverless con cliente correcto |
| `scripts/test-isolated.mjs` | Registro de suite `route-matrix-guard` | Gate aislado |
| `vercel.json` | Eliminado bloque `headers` CORS contradictorio | API como única dueña de CORS |
| `docs/DEPLOY_VERCEL_SUPABASE.md` | Settings Vercel, tabla de secretos, preview-vs-release, flags apagados | Documentación sin valores |
| `.env.example` | Placeholders de piloto, IA y `MESAYA_PG_*` | Secretos necesarios sin valores |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `npm ci --dry-run --no-audit --no-fund` | Local, sin escritura en `node_modules` | 0 | Lockfile sincronizado (`up to date`); sin reinstalación |
| `npm run build:pg` | Local, cliente PG generado | 0 | Cliente postgresql + `tsc` shared/api + artefactos `dist` verificados |
| `node scripts/test-postgres.mjs packages/api/test/serverless-smoke.test.ts` (PG `16-alpine` desechable, contenedor eliminado) | PostgreSQL real, 4 migraciones | 0 | 3/3 PASS (datasource PostgreSQL, handler serverless, health x2); cliente SQLite restaurado |
| `node scripts/test-postgres.mjs packages/api/test/floorplan-atomic-save.test.ts` (mismo PG) | PostgreSQL real | 0 | 6/6 PASS; cliente SQLite restaurado |
| `node scripts/check-route-matrix.mjs` | Estático, sin DB | 0 | 76 rutas clasificadas, sin deriva |
| Control negativo con ruta sonda temporal | Estático | 1 (esperado) | 2 problemas `SIN CLASIFICAR`; archivo restaurado (hash idéntico) y re-verificado OK |
| `node scripts/build.mjs` | Build local, 6 workspaces | 0 | 6/6 PASS (48.50 s) |
| `node scripts/sync_supabase_schema.js --check` | Inspección local | 0 | Sincronizado |
| `node scripts/test-isolated.mjs` | 29 sandboxes SQLite efímeras | 0 | 29/29 suites PASS (incluye `route-matrix-guard`); dev.db intacta |
| `npm run smoke:serverless` (sin env PG) | Local, sin Docker | 2 (esperado) | El alias resuelve al comando test-postgres y se detiene exigiendo `MESAYA_PG_*` explícitas: falla cerrado |
| SHA-256 `packages/api/prisma/dev.db` | Verificación directa | — | `499C2F9C…48CFF` = hash canónico |

No se usó base remota, seed productivo, push ni migración real. Credenciales PG sintéticas del contenedor local, no documentadas. No se creó remoto ni se ejecutó CI remota (sin Git propio/CI habilitado).

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Desde instalación limpia se generan todos los artefactos y cliente PG correcto | PASS (local) | `npm ci --dry-run` sync + `build:pg` con artefactos + smoke PG (datasource PostgreSQL, health 200) |
| Un test fallido, deriva de schema o ruta no clasificada bloquea pipeline | PASS (local) | Gate ruta falla con sonda (exit 1); `--check` y runner en CI; control negativo documentado |
| Preview no migra ni siembra una base real; logs no exponen secretos | PASS (diseño + local) | Workflows: ningún job migra/siembra; release manual separada; URLs sintéticas en logs |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Esta tabla; CI remota marcada NO EJECUTADA |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión | PASS | Build 6/6; runner 29/29; ningún test existente modificado (sólo payloads ya adaptados en etapa 26) |

## Integridad y seguridad

- Base demo intacta: SHA-256 canónico `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` verificado directo.
- Cruce tenant A/B: sin cambios de producto; matriz clasifica tenant-scoping (manager+tenant) y suites previas en verde.
- Rechazo sin escrituras: gate y 410/403/503 verificados por suites existentes (28 previas + guard).
- Build: 6/6 workspaces + build PG explícito exitosos.
- Migración/paridad si corresponde: `--check` PASS; 4 migraciones aplicadas sólo en PG efímero desechable.
- Ausencia de secretos en diff/logs: verificada; `.env.example` y docs sólo con nombres/placeholders.

## Pendientes, riesgos y decisiones

Qué falta: revisión formal de Codex; crear repo Git propio + remoto + habilitar CI (requiere decisión de Rodrigo; esta ficha no lo autoriza).
Qué impide avanzar: nada dentro de la ficha.
Pregunta concreta si hace falta: ¿se crea repositorio propio para `mdpmesasvivas` y se habilita GitHub Actions, o se mantiene el flujo local?
Cambios fuera de alcance propuestos pero NO implementados: renombrar `deploy:supabase:push/seed` (ya auditados como prohibidos),precation de `migrate dev` en scripts de dev, matriz de rutas como página Notion.
CI remota: NO EJECUTADA (no cuenta como evidencia; pendiente de repo + Actions habilitado).

## Corrección Codex (2026-09-06): job PostgreSQL ejecutable

Hallazgo: el job `postgres` invocaba `node scripts/smoke-serverless.mjs`, archivo inexistente (primera CI remota habría fallado con `MODULE_NOT_FOUND`), y no cubría `npm run build:pg`.

- [x] `.github/workflows/ci.yml` (job `postgres`): pasos en orden con comandos existentes y verificados — `npm ci`, `npm run build:pg`, `npm run smoke:serverless`, `node scripts/test-postgres.mjs packages/api/test/floorplan-atomic-save.test.ts`. Sin referencias a archivos inexistentes (barrido del repo: sólo la revisión histórica lo menciona).
- [x] Flujo efectivo verificado localmente contra PostgreSQL `16-alpine` efímero (contenedor eliminado): `build:pg` OK, smoke 3/3, suite enfocada 6/6, cliente SQLite restaurado.
- [x] Alcance seguro intacto: CI/preview no migran ni siembran bases reales; `release-migrate.yml` sigue manual con sólo `migrate deploy` (sin seed ni `db push`).

| Comando exacto y cwd (corrección) | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `npm run build:pg` | Local, cliente PG | 0 | Artefactos `dist` verificados |
| `npm run smoke:serverless` (PG `16-alpine` desechable) | PostgreSQL real, 4 migraciones | 0 | 3/3 PASS; cliente SQLite restaurado |
| `node scripts/test-postgres.mjs packages/api/test/floorplan-atomic-save.test.ts` (mismo PG) | PostgreSQL real | 0 | 6/6 PASS; cliente SQLite restaurado |
| SHA-256 `packages/api/prisma/dev.db` | Verificación directa | — | Hash canónico intacto |

## Handoff

CONTROL actualizado sólo para esta etapa.
No se inició la Etapa 28.
Solicito revisión de Codex.

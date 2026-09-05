# Reporte de etapa 24 — Hacer atómicos turnos y sesiones

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Codex (GPT-5)
Ficha: [Etapa 24](../etapas/24-atomicidad-turnos.md)
Predecesora aprobada: Etapa 23 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git local utilizable; cambios previos preservados

## Alcance realizado

- [x] Definidas las invariantes mediante `activeKey`: `restaurantId` para un turno abierto y `tableId` para una sesión activa; se vuelve `null` al revocar/cerrar.
- [x] Encapsuladas apertura, cierre y rotación en transacciones Prisma; se agregó reintento acotado para carreras que compiten por la clave única.
- [x] Sincronizados ambos schemas y agregada migración PG incremental `20260904210000_add_active_keys`.
- [x] Eventos `shift.opened`, `shift.closed` y avisos de llamados se emiten sólo después del commit; los efectos intermedios se revierten con la transacción.
- [x] Agregadas pruebas de carreras desde operaciones concurrentes y ejecutadas en SQLite aislada y PostgreSQL real.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/prisma/schema.prisma` | Campos `activeKey` únicos en Shift/TableSession | Invariantes cross-provider |
| `packages/api/prisma/schema.supabase.prisma` | Mismos campos en derivado PG | Paridad de contratos |
| `packages/api/prisma/migrations-postgres/migration_lock.toml` | Provider PostgreSQL declarado | Historial Prisma revisable |
| `packages/api/prisma/migrations-postgres/20260904210000_add_active_keys/migration.sql` | Columnas e índices únicos PG | Migración incremental |
| `scripts/generate-postgres-migration.mjs` | Soporte diff incremental con shadow URL explícita | Generación sin sobrescritura |
| `packages/api/src/services/shift.service.ts` | Apertura/cierre transaccionales, claves activas y retry | Atomicidad de turno |
| `packages/api/src/services/session.service.ts` | Cierre/rotación transaccionales, claves activas y retry | Atomicidad de sesión |
| `packages/api/test/atomic-shifts-sessions.test.ts` | Carreras, revocación y eventos post-commit | Evidencia ejecutable |
| `scripts/test-isolated.mjs` | Registro de suite de atomicidad | Gate aislado |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---:|---|
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs atomic-shifts-sessions` | SQLite efímera | 0 | 3/3 tests PASS: una apertura activa, una sesión activa por mesa, token anterior revocado y cierre completo |
| `$env:MESAYA_PG_DATABASE_URL='postgresql://fixture...'; $env:MESAYA_PG_DIRECT_URL=$env:MESAYA_PG_DATABASE_URL; node scripts/test-postgres.mjs packages/api/test/atomic-shifts-sessions.test.ts` | PostgreSQL `16-alpine` real, base vacía + 2 migraciones | 0 | 3/3 tests PASS con cliente PG; cliente SQLite restaurado |
| `node scripts/sync_supabase_schema.js --check` | Inspección local, sin escritura | 0 | Schema PG derivado sincronizado |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/build.mjs` | Build local, 6 workspaces | 0 | 6/6 workspaces PASS (34.18 s) |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs` | 24 sandboxes SQLite efímeras | 0 | 24/24 suites PASS, 0 fallas; resumen en `.tmp/test-isolated-stage24-final-fc5a92d18f3b468882e942bfa1e32035.out.log` |

No se usó base remota, seed productivo ni migración de datos reales. Las carreras PG usaron conexiones del cliente Prisma contra el contenedor local desechable.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Dos aperturas simultáneas no dejan dos turnos/sesiones activos | PASS | `atomic-shifts-sessions` 3/3 en SQLite y PostgreSQL |
| Cierre fallido no deja mitad de sesiones abiertas y mitad cerradas | PASS | Cierre transaccional verifica todas las sesiones del turno; cualquier error revierte el bloque |
| Token anterior queda inválido después del commit de rotación | PASS | Test de rotación: token previo `closedAt != null`, sólo una sesión con `activeKey` |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Evidencia separada; URLs PG sintéticas |
| Build completo y suite aislada aprobada | PASS | Build 6/6; runner 24/24 |

## Integridad y seguridad

- Base demo intacta: SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` antes/después.
- Cruce tenant A/B: servicios mantienen `restaurantId` en apertura/cierre; suites previas y runner completo sin regresión.
- Rechazo sin escrituras: no corresponde a esta ficha; no se tocó ninguna BD externa.
- Build: 6/6 workspaces exitosos.
- Migración/paridad: schemas sincronizados; migración PG incremental aplicada en DB efímera.
- Ausencia de secretos en diff/logs: verificada; credenciales del contenedor fueron sintéticas y no se documentan.

## Pendientes, riesgos y decisiones

Qué falta: revisión formal de Codex.
Qué impide avanzar: ninguna dentro de la ficha.
Pregunta concreta si hace falta: ninguna.
Cambios fuera de alcance propuestos pero NO implementados: outbox general, locks distribuidos externos y migración de datos existentes.

## Handoff

CONTROL actualizado sólo para esta etapa.
No se inició la Etapa 25 al crear este reporte.
Solicito revisión de Codex.

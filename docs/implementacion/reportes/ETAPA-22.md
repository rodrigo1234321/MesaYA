# Reporte de etapa 22 — Unificar contratos SQLite/PostgreSQL

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Codex (GPT-5)
Ficha: [Etapa 22](../etapas/22-postgres-schema.md)
Predecesora aprobada: Etapa 21 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git local utilizable; cambios previos preservados

## Alcance realizado

- [x] Comparados modelos/campos completos: la única deriva era `Table.mergedWithTableId` ausente en el derivado PostgreSQL; se regeneró desde SQLite canónico.
- [x] `scripts/sync_supabase_schema.js` ahora ofrece `--check`, que detecta deriva y termina sin escribir archivos.
- [x] SQLite quedó como fuente canónica; `schema.supabase.prisma` se deriva por reemplazo explícito del datasource.
- [x] Separados `generate:sqlite` y `generate:postgres` mediante wrapper con provider, destino y lock validados; no se generan clientes Prisma en paralelo.
- [x] Añadida prueba de paridad y validación local con URLs ficticias; no se abrió conexión PostgreSQL.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/prisma/schema.supabase.prisma` | Regenerado con `mergedWithTableId` | Eliminar deriva del contrato PG |
| `scripts/sync_supabase_schema.js` | Modo `--check` sin escritura y diff acotado | Detectar deriva de forma segura |
| `scripts/prisma-generate.mjs` | Wrapper de generación con validación de provider/destino y lock | Separar clientes sin concurrencia |
| `packages/api/package.json` | Scripts `generate:sqlite` / `generate:postgres` y aliases | Comandos explícitos por proveedor |
| `packages/api/test/postgres-schema-parity.test.ts` | Paridad, deriva y `prisma validate` offline | Aceptación verificable |
| `scripts/test-isolated.mjs` | Registro de la suite `postgres-schema-parity` | Ejecución aislada reproducible |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---:|---|
| `node scripts/sync_supabase_schema.js` en la raíz | Sólo archivos de schema locales | 0 | Derivado PG regenerado (451 líneas) |
| `node scripts/sync_supabase_schema.js --check` en la raíz | Sólo inspección, sin escritura | 0 | Schema PG sincronizado |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs postgres-schema-parity` en la raíz | SQLite efímera del runner | 0 | 1 archivo, 3 tests PASS; deriva temporal detectada/restaurada; ambos `prisma validate` PASS |
| `node scripts/prisma-generate.mjs postgres` seguido de `node scripts/prisma-generate.mjs sqlite` | Generación local secuencial; sin DB | 0 / 0 | Ambos destinos validados y clientes generados; lock liberado |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/build.mjs` en la raíz | Build local, 6 workspaces | 0 | 6/6 workspaces PASS (41.09 s) |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs` en la raíz | 23 sandboxes SQLite efímeras | 0 | 23/23 suites PASS, 0 fallas; resumen conservado en `.tmp/test-isolated-stage22-ed049de8d3574408ab6ba4becb0ff5bc.out.log` |

Las URLs usadas para `prisma validate` fueron ficticias y de sintaxis válida (`127.0.0.1`, usuario/clave de fixture); validar no conecta ni crea una base.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| `--check` detecta deriva sin modificar archivos | PASS | Suite `postgres-schema-parity`, prueba de deriva temporal y restauración byte a byte |
| Ambos schemas validan y comparten modelos/campos equivalentes | PASS | Paridad completa; sólo datasource difiere; `prisma validate` 2/2 |
| Provider y `directUrl` son diferencias explícitas; no se toca DB externa | PASS | Datasources inspeccionados; URLs ficticias; no `db push`/migración PG |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Evidencia separada; fixtures sintéticas |
| Build completo y suite aislada aprobada | PASS | Build 6/6; runner 23/23 |

## Integridad y seguridad

- Base demo intacta: SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` antes/después.
- Cruce tenant A/B: no corresponde a esta ficha; las suites previas y el runner completo no regresaron.
- Rechazo sin escrituras: no corresponde a esta ficha; no se ejecutó ninguna escritura remota.
- Build: 6/6 workspaces exitosos.
- Migración/paridad: paridad de schema validada; no se aplicaron migraciones ni `db push` a PostgreSQL.
- Ausencia de secretos en diff/logs: verificada; sólo URLs sintéticas de validación.

## Pendientes, riesgos y decisiones

Qué falta: revisión formal de Codex.
Qué impide avanzar: PostgreSQL real queda deliberadamente para la Etapa 23 y su harness desechable.
Pregunta concreta si hace falta: ninguna.
Cambios fuera de alcance propuestos pero NO implementados: migraciones, `db push`, seed o conexión a Supabase.

## Handoff

CONTROL actualizado sólo para esta etapa.
No se inició la Etapa 23 al crear este reporte.
Solicito revisión de Codex.

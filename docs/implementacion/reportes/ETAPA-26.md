# Reporte de etapa 26 — Guardar plano sin pérdidas ni sobrescrituras

Estado: NEEDS_REVIEW
Fecha: 2026-09-05
Ejecutor y modelo realmente usado: OpenCode + Muse Spark
Revisión Codex atendida: [ETAPA-26](../revisiones/ETAPA-26.md) (`CHANGES_REQUESTED`, 2026-09-05)
Ficha: [Etapa 26](../etapas/26-plano-atomico.md)
Predecesora aprobada: Etapa 25 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git local utilizable (Git apunta al home `C:/Users/rodri`); cambios previos preservados
Cambios previos preservados: sí; suites 00–25 siguen en verde en la corrida completa

## Alcance realizado

- [x] Paso 1 — Validación completa antes de escribir: `updateFloorPlan` valida en orden, sin ninguna escritura previa: lista vacía (400 `EMPTY_TABLE_LIST` salvo `confirmEmptyTables`), duplicados de ID/etiqueta y auto-combinación en payload (400), existencia + tenant de cada mesa (404 `TABLE_NOT_FOUND`), existencia + tenant de cada zona (404 `ZONE_NOT_FOUND`, antes era 500 por FK), y resolución de cada `mergedWithTableId` dentro del payload guardado (404 `MERGED_TABLE_NOT_FOUND` / 400 `MERGED_TABLE_REMOVED` si este mismo guardado la eliminaría). Zod (`FloorPlanUpdateSchema`) replica duplicados/auto-merge/zona vacía y suma `expectedVersion` + `confirmEmptyTables`.
- [x] Paso 2 — Versión/precondición y guardado atómico: `FloorPlanLayout.version` (nuevo campo, default 0, ambos schemas + migración PG `20260905000000_floorplan_layout_version`); todo el guardado (layout + borrados + altas + ediciones) corre en una sola transacción Prisma; con `expectedVersion` se usa compare-and-swap (`updateMany` con guarda de versión) y la segunda edición sobre la misma versión recibe 409 `LAYOUT_VERSION_CONFLICT` con `expectedVersion`/`currentVersion`. Cada guardado exitoso incrementa la versión. `getFloorPlan` expone `layout.version`.
- [x] Paso 3 — No borrar con dependencias: helper `findTablesWithDependencies` (sesiones abiertas/cerradas, ocupaciones abiertas/históricas, pedidos, llamados, feedback, historial FSM). La omisión en `PUT` y el `DELETE` directo de una mesa con dependencias responden 409 `TABLE_HAS_DEPENDENCIES` con detalle por mesa/motivo, sin borrar nada (antes el `deleteMany` borraba en cascada silenciosa todo el historial).
- [x] Paso 4 — Borrador preservado ante 409: `AdminApi.updateFloorPlan` propaga `statusCode`/`code`/`details`; el store envía `expectedVersion`, actualiza `layout.version` al guardar, y ante 409 conserva tablas + `hasUnsavedChanges` intactos, expone `floorPlanConflict` + `conflictDraft`, y ofrece `saveFloorPlan` / `reloadServerPlanAfterConflict` (recarga servidor sin perder el borrador) / `restoreDraftAfterConflict` (reintento consciente con versión fresca) / `dismissFloorPlanConflict`. Tests de rollback incluidos en la suite (casos 1, 3 y 5 verifican estado intacto tras cada rechazo).

No copiar criterios como cumplidos sin ejecutarlos.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/prisma/schema.prisma` | `FloorPlanLayout.version Int @default(0)` | Precondición optimista cross-provider |
| `packages/api/prisma/schema.supabase.prisma` | Mismo campo en derivado PG | Paridad de contratos (`--check` en verde) |
| `packages/api/prisma/migrations-postgres/20260905000000_floorplan_layout_version/migration.sql` | `ALTER TABLE "FloorPlanLayout" ADD COLUMN "version" ...` | Migración incremental PG (aplicada en PG real desechable) |
| `packages/shared/src/rtms-schemas.ts` | `expectedVersion`, `confirmEmptyTables`, `superRefine` (IDs/etiquetas duplicadas, auto-merge, zona vacía) | Validación de payload en borde |
| `packages/shared/src/rtms-types.ts` | `FloorLayoutDTO.version`, `FloorPlanUpdateDTO.expectedVersion/confirmEmptyTables` | Contratos de versión/confirmación |
| `packages/api/src/services/floorplan.service.ts` | Validación previa total, transacción única con CAS de versión, `findTablesWithDependencies`, `deleteTable` con guarda 409, `layoutVersion` en respuesta | Núcleo de la ficha (checklist 1–3) |
| `packages/api/src/routes/floorplan.routes.ts` | Mapeo 400/404/409 del servicio con `code`/`details` en PUT y DELETE de mesa | Conflicto visible, sin cambiar 500 genérico ni auth existente |
| `apps/admin-dashboard/src/lib/api.ts` | `updateFloorPlan` propaga `statusCode`/`code`/`details` | El cliente puede distinguir el 409 |
| `apps/admin-dashboard/src/stores/useFloorPlanStore.ts` | `version` en layout, `floorPlanConflict`/`conflictDraft`, `persistTables` versionado, `saveFloorPlan`, recarga/restauración/descarte tras conflicto | Checklist 4 (borrador preservado, reintento consciente) |
| `packages/api/test/floorplan-atomic-save.test.ts` | 6 tests reales contra servicio + Prisma (SQLite efímera y PG real) | Evidencia ejecutable, incluye rollbacks |
| `scripts/test-isolated.mjs` | Registro de suite `floorplan-atomic-save` | Gate aislado |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs floorplan-atomic-save` | SQLite efímera (sandbox `.tmp/qa`) | 0 | 6/6 PASS: rechazo inválido sin escrituras, vacío sin confirmación no borra, éxito+409+reintento, tenant/merge inválidos sin escrituras, omisión con operatoria → 409 atómico, mesa limpia eliminable |
| `$env:MESAYA_PG_DATABASE_URL='postgresql://.../mesaya_test'; ... node scripts/test-postgres.mjs packages/api/test/floorplan-atomic-save.test.ts` | PostgreSQL `16-alpine` real desechable (contenedor local, luego eliminado), 4 migraciones aplicadas incl. la nueva | 0 | 6/6 PASS con cliente PG; cliente SQLite restaurado al final |
| `node scripts/sync_supabase_schema.js --check` | Inspección local, sin escritura | 0 | Schema PG derivado sincronizado |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/build.mjs` | Build local, 6 workspaces | 0 | 6/6 workspaces PASS (42.51 s). Nota: 1er intento falló por `,` sobrante en el store (línea 483); corregido y rebuild en verde |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs` | 26 sandboxes SQLite efímeras | 0 | 26/26 suites PASS, 0 fallas |

Diagnóstico intermedio registrado (no oculto): la primera corrida de la suite nueva falló porque el Prisma Client generado no conocía `version`; se regeneró con `node scripts/prisma-generate.mjs sqlite` (flujo oficial del repo) y pasó. Sandbox forense de ese intento conservado por el runner en `.tmp/qa/856285c5-...`.

No se usó base remota, seed productivo ni migración de datos reales. Credenciales PG sintéticas del contenedor local, no documentadas.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Payload parcialmente inválido no cambia ninguna posición/zona | PASS | Tests 1 y 4: posiciones, canvas y versión intactos tras 404/400 |
| Plano vacío/omisión no borra silenciosamente mesas del restaurante | PASS | Test 2: `[]` → 400 sin borrado; sólo `confirmEmptyTables: true` vacía |
| Dos editores no pierden cambios por último escritor; conflicto visible | PASS | Test 3: éxito + 409 `LAYOUT_VERSION_CONFLICT` + reintento consciente ok; rutas exponen `code`/`details` y el store muestra el conflicto |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Este reporte; URLs PG sintéticas; fixtures con sufijos aleatorios |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión | PASS | Build 6/6; runner 26/26; ningún test existente modificado |

## Integridad y seguridad

- Base demo intacta: SHA-256 `499c2f9c...` (mismo prefijo que etapa 24) antes/después según el runner.
- Cruce tenant A/B: mesa foránea en payload → 404 sin escrituras (test 4); checks de ruta de etapa 11 intactos (`floorplan-fsm-access` 5/5 en corrida completa).
- Rechazo sin escrituras: verificado en tests 1, 2, 4 y 5 (relectura post-rechazo idéntica).
- Build: 6/6 workspaces exitosos.
- Migración/paridad si corresponde: `sync --check` PASS; `postgres-schema-parity` PASS; migración nueva aplicada en PG real desechable.
- Ausencia de secretos en diff/logs: verificada; sin tokens/PINs/conexiones privadas en reporte ni logs citados.

## Pendientes, riesgos y decisiones

Qué falta: revisión formal de Codex.
Qué impide avanzar: nada dentro de la ficha.
Pregunta concreta si hace falta: ninguna.
Cambios fuera de alcance propuestos pero NO implementados: UI de resolución visual de conflictos en el editor (el store expone el estado; la pantalla queda para una ficha de frontend), archivado general de mesas con historial, y `expectedVersion` en `PATCH /tables/:tableId/position` (vía rápida de arrastre; documentado como pendiente consciente).

## Correcciones pedidas por Codex (2026-09-05, misma ficha, sin Etapa 27)

- [x] Hallazgo 1 — `FloorPlanManager.handleSaveLayout` ya no llama a `AdminApi.updateFloorPlan` directo: usa el action versionado `saveFloorPlan` del store (que ahora incluye canvas/layout + `mergedWithTableId` en el payload, envía `expectedVersion` y actualiza `layout.version` con la respuesta). Ante 409 no hay `markChangesSaved` ni `alert` genérico: el borrador se conserva y se muestra un banner con versión actual, botones «Recargar plano del servidor» y «Reintentar con mis cambios» (recarga/restaura/reintento consciente) y «Ocultar». Prueba: `apps/admin-dashboard/src/stores/useFloorPlanStore.test.ts` (3/3: payload con versión/canvas/merge, 409 sin marcar guardado con borrador intacto, recarga + reintento con versión fresca).
- [x] Hallazgo 2 — `PATCH /tables/:tableId/position` incorporó `expectedVersion` (opcional, compatible) + CAS atómico en transacción que mueve la mesa e incrementa `FloorPlanLayout.version`, con 409 `LAYOUT_VERSION_CONFLICT` y respuesta con `layoutVersion`; la ruta mapea 400/404/409 con `code`/`details` y `AdminApi.updateTablePosition` propaga el status. Se eligió versionar la vía en vez de eliminarla; el arrastre del canvas sigue siendo local y persiste por el bulk versionado. Prueba: `packages/api/test/floorplan-position-cas.test.ts` (4/4 con rutas Fastify + JWT + servicio reales, sin mocks: 200 con bump, 409 obsoleto sin escrituras, compat sin versión, PUT bulk 409/404 vía HTTP).

| Archivo (corrección) | Cambio | Motivo |
|---|---|---|
| `packages/shared/src/rtms-schemas.ts`, `rtms-types.ts` | `TablePositionUpdateDTO/Schema.expectedVersion?` | Precondición en vía rápida |
| `packages/api/src/services/floorplan.service.ts` | `updateTablePosition` transaccional con CAS + bump de versión, 404 defensivos | Cerrar bypass de último escritor |
| `packages/api/src/routes/floorplan.routes.ts` | Mapeo 400/404/409 en PATCH position | Conflicto visible |
| `apps/admin-dashboard/src/lib/api.ts` | `updateTablePosition` propaga `statusCode`/`code`/`details` | Paridad con bulk |
| `apps/admin-dashboard/src/stores/useFloorPlanStore.ts` | `persistTables` incluye canvas del layout | El bulk real lleva plano completo |
| `apps/admin-dashboard/src/components/FloorPlan/FloorPlanManager.tsx` | `handleSaveLayout`/`handleRetryAfterConflict`/`handleReloadServerPlan` + banner de conflicto | Botón real sobre el CAS |
| `packages/api/test/floorplan-position-cas.test.ts`, `apps/.../useFloorPlanStore.test.ts` | 7 tests nuevos de consumidores/rutas | Evidencia exigida |
| `scripts/test-isolated.mjs` | Suites `floorplan-position-cas`, `floorplan-store-save` | Gates |

Evidencia de la corrección:

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `node scripts/test-isolated.mjs floorplan-store-save` | SQLite efímera | 0 | 3/3 PASS |
| `node scripts/test-isolated.mjs floorplan-position-cas` | SQLite efímera | 0 | 4/4 PASS |
| `node scripts/test-postgres.mjs packages/api/test/floorplan-position-cas.test.ts` (PG `16-alpine` desechable, contenedor eliminado) | PostgreSQL real, 4 migraciones | 0 | 4/4 PASS; cliente SQLite restaurado |
| `node scripts/build.mjs` | Build local, 6 workspaces | 0 | 6/6 PASS (46.09 s) |
| `node scripts/test-isolated.mjs` | 28 sandboxes SQLite efímeras | 0 | 28/28 suites PASS, 0 fallas; dev.db intacta (hash `499c2f9c...` inicial = final) |

## Segunda corrección Codex (2026-09-05): `expectedVersion` obligatorio en PATCH position

Hallazgo restante: la vía rápida aceptaba escrituras sin `expectedVersion` (rama sin CAS) y el test de compatibilidad fijaba ese 200. Opción preferida aplicada:

- [x] `expectedVersion` obligatorio en `TablePositionUpdateSchema` (zod) y `TablePositionUpdateDTO` (tipo).
- [x] Ausencia rechazada antes de cualquier escritura: la ruta detecta el issue zod en `expectedVersion` y responde 400 `LAYOUT_VERSION_REQUIRED`; el servicio repite la guarda como defensa en profundidad antes de abrir la transacción (misma código/status).
- [x] Eliminada la rama del servicio que escribía con `data.expectedVersion === undefined`; sólo queda el CAS transaccional (fresca: mueve + bump; obsoleta: 409 `LAYOUT_VERSION_CONFLICT` sin tocar mesa ni layout).
- [x] Test de compatibilidad reemplazado por prueba HTTP real de rechazo con cero escrituras (posición y versión intactas) + prueba directa al servicio sin versión; se conservan éxito con versión fresca y 409 obsoleto.
- [x] Ajustes al nuevo contrato en tests existentes sin cambiar su intención: payloads PATCH de `floorplan-fsm-access` (etapa 11) y e2e llevan `expectedVersion` (el e2e además verifica `layoutVersion = versión + 1`).

| Archivo (2ª corrección) | Cambio | Motivo |
|---|---|---|
| `packages/shared/src/rtms-schemas.ts`, `rtms-types.ts` | `expectedVersion` requerido en posición | Cerrar bypass sin precondición |
| `packages/api/src/routes/floorplan.routes.ts` | Mapeo ausencia → 400 `LAYOUT_VERSION_REQUIRED` antes del servicio | Rechazo con código, cero escrituras |
| `packages/api/src/services/floorplan.service.ts` | Guarda 400 previa a la tx; eliminada rama sin CAS | Defensa en profundidad, un solo camino de escritura |
| `packages/api/test/floorplan-position-cas.test.ts` | 5 tests (rechazo HTTP + guarda directa + fresca + 409 + bulk) | Evidencia exigida |
| `packages/api/test/floorplan-fsm-access.test.ts`, `full-system-e2e.test.ts` | Payloads PATCH con `expectedVersion` | Adaptación al contrato, misma intención |

Evidencia de la 2ª corrección:

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `node scripts/test-isolated.mjs floorplan-position-cas` | SQLite efímera | 0 | 5/5 PASS |
| `node scripts/test-isolated.mjs floorplan-fsm-access` | SQLite efímera | 0 | 5/5 PASS |
| `node scripts/test-isolated.mjs full-system-e2e` | SQLite efímera + seed | 0 | 39/39 PASS |
| `node scripts/test-postgres.mjs packages/api/test/floorplan-position-cas.test.ts` (PG `16-alpine` desechable, contenedor eliminado) | PostgreSQL real, 4 migraciones | 0 | 5/5 PASS; cliente SQLite restaurado |
| `node scripts/build.mjs` | Build local, 6 workspaces | 0 | 6/6 PASS (56.47 s) |
| `node scripts/test-isolated.mjs` | 28 sandboxes SQLite efímeras | 0 | 28/28 suites PASS; dev.db intacta |
| Hash SHA-256 `packages/api/prisma/dev.db` | Verificación directa | — | `499C2F9C...48CFF` = hash canónico de la revisión Codex |

## Handoff

CONTROL actualizado sólo para esta etapa (IN_PROGRESS → NEEDS_REVIEW tras la corrección).
No se inició siguiente ficha.
Solicito revisión de Codex.

# Reporte de etapa 02 — Restaurar build y contratos compartidos

Estado: NEEDS_REVIEW  
Fecha: 2026-09-03  
Ejecutor y modelo realmente usado: Antigravity / Gemini 3.8 Flash (High)  
Ficha: docs/implementacion/etapas/02-build.md  
Predecesora aprobada: Etapa 01 — Aislar tests y proteger el seed (APPROVED, dictamen en `docs/implementacion/revisiones/ETAPA-01.md`)  
Ruta del proyecto: C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas  
Commit de base o manifiesto: `docs/implementacion/evidencia/00-baseline.json` (223 archivos SHA-256)  
Cambios previos preservados: Todos los archivos de las etapas 00 y 01 se mantuvieron intactos. El harness de tests aislados, el guard centinela y la base persistente `dev.db` se conservaron sin alteraciones.

---

## Alcance realizado

- [x] **Paso 1 — Reproducción y diagnóstico de compilación en serie**:
  - Se compiló workspace por workspace para diagnosticar el estado inicial sin confiar en `dist/` preexistente.
  - `@mesaya/shared`: compiló con `tsc` sin errores.
  - `@mesaya/api`: falló con 12 errores TypeScript: 11 errores `TS2339` en `src/services/floorplan.service.ts` debido a que `FloorPlanUpdateItem` carecía de `sector`, `isOutdoor` y `mergedWithTableId`, y 1 error `TS2783` en `src/routes/floorplan.routes.ts(145,27)` por duplicación de la clave `success` en el objeto de respuesta.
  - Apps (`client-web`, `staff-panel`, `admin-dashboard`): compilaron exitosamente con Vite / Rollup.
- [x] **Paso 2 — Alineación de `FloorPlanUpdateItem`**:
  - En `packages/shared/src/rtms-types.ts`, se agregaron las propiedades `sector?: string`, `isOutdoor?: boolean` y `mergedWithTableId?: string | null` a la interfaz `FloorPlanUpdateItem`.
  - Los tipos coinciden 100% con `FloorPlanTableItemSchema` de `packages/shared/src/rtms-schemas.ts`.
  - Cero dependencias circulares, cero uso de `any` y cero directivas de supresión (`@ts-ignore`).
- [x] **Paso 3 — Corrección de `success` duplicado**:
  - En `packages/api/src/routes/floorplan.routes.ts`, se corrigió la respuesta del endpoint `DELETE /floor-plan/:restaurantId/tables/:tableId` reemplazando `{ success: true, message: '...', ...result }` por `{ ...result, message: 'Mesa eliminada correctamente' }`.
  - Se eliminó el error `TS2783` preservando exactamente la semántica y estructura del payload.
- [x] **Paso 4 — Secuencia de build ordenada por dependencias**:
  - Se implementó `scripts/build.mjs` y se configuró `"build": "node scripts/build.mjs"` en `package.json`.
  - Secuencia estricta:
    1. `@mesaya/shared` (tsc)
    2. `@mesaya/api` (prisma generate && tsc)
    3. `@mesaya/client-web` (vite build)
    4. `@mesaya/staff-panel` (tsc && vite build)
    5. `@mesaya/admin-dashboard` (tsc && vite build)
    6. `@mesaya/qr-generator` (tsc --noEmit)
  - Comportamiento fail-fast: ante cualquier fallo en un workspace, el script aborta inmediatamente con el exit code no-cero del paso fallido.
- [x] **Paso 5 — Verificación de build completo**:
  - Se ejecutó `npm run build` desde la raíz, logrando compilación limpia al 100% en los 6 workspaces con exit code 0.
- [x] **Paso 6 — Verificación de contratos y regresión en tests**:
  - En `packages/api/test/full-system-e2e.test.ts`, se incorporaron pruebas enfocadas para validar que:
    1. `PUT /v1/floor-plan/:restaurantId` acepta `sector`, `isOutdoor` y `mergedWithTableId` con sus tipos correctos y persiste los cambios.
    2. `PUT /v1/floor-plan/:restaurantId` rechaza con 400 tipos inválidos (número en `sector`, string en `isOutdoor`, boolean en `mergedWithTableId`).
    3. `DELETE /v1/floor-plan/:restaurantId/tables/:tableId` responde `{ success: true, message: '...' }` sin duplicación.
- [x] **Paso 7 — Ejecución de suite aislada**:
  - Se ejecutó `npm run test:isolated`, pasando las 4 suites en serie: 73 tests en total (100% PASS), exit code 0, con `packages/api/prisma/dev.db` intacta.

---

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/shared/src/rtms-types.ts` | Modificación | Incorporación de `sector?: string`, `isOutdoor?: boolean` y `mergedWithTableId?: string | null` en `FloorPlanUpdateItem` para alinear con el schema Zod. |
| `packages/api/src/routes/floorplan.routes.ts` | Modificación | Corrección de duplicación de propiedad `success` en la respuesta de borrado de mesa (`deleteTable`). |
| `packages/api/test/full-system-e2e.test.ts` | Modificación | Pruebas de contrato para aceptación y rechazo de tipos en `FloorPlanUpdate` y verificación de `deleteTable`. |
| `package.json` | Modificación | Enrutamiento de `"build"` a `node scripts/build.mjs` y adición de scripts auxiliares `"build:shared"` y `"build:api"`. |
| `scripts/build.mjs` | Nuevo | Runner determinístico de build ordenado por dependencias con detención fail-fast. |
| `docs/implementacion/CONTROL.md` | Modificación | Actualización de estado de Etapa 02 a `NEEDS_REVIEW`. |

---

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `npm run build` (cwd: `.../mdpmesasvivas`) | Todos los workspaces del monorepo | 0 | **Build completo exitoso en 59.11s**:<br>• `[1/6]` `@mesaya/shared`: tsc OK (1.73s)<br>• `[2/6]` `@mesaya/api`: prisma generate + tsc OK (11.06s)<br>• `[3/6]` `@mesaya/client-web`: vite build OK (3.28s)<br>• `[4/6]` `@mesaya/staff-panel`: tsc + vite build OK (17.76s)<br>• `[5/6]` `@mesaya/admin-dashboard`: tsc + vite build OK (19.84s)<br>• `[6/6]` `@mesaya/qr-generator`: tsc --noEmit OK (5.44s) |
| `npm run test:isolated` (cwd: `.../mdpmesasvivas`) | SQLite efímera por suite en `.tmp/qa/<uuid>` | 0 | **4 suites PASSED en serie (73 tests en total, 0 fallos):**<br>• `seed-guard`: 18 passed (47ms)<br>• `system-lifecycle`: 9 passed (98ms)<br>• `rtms-fsm-analytics`: 12 passed (943ms)<br>• `full-system-e2e`: 34 passed (2205ms)<br>• Exit code: 0<br>• Hash `dev.db`: `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff` 100% intacto. |

---

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Build limpio de todos los workspaces con exit 0 | PASS | `scripts/build.mjs` ejecutado vía `npm run build` compila los 6 workspaces con exit code 0 sin errores. |
| Contrato acepta los tres campos con sus tipos correctos y rechaza tipos inválidos | PASS | Pruebas añadidas en `full-system-e2e.test.ts` verifican: `PUT /v1/floor-plan` persiste `sector='TERRAZA'`, `isOutdoor=true`, `mergedWithTableId=<uuid>` (status 200), y rechaza con status 400 cuando reciben tipos no válidos. |
| Sin supresión de errores TypeScript ni dependencia de artefactos viejos | PASS | Se verificó la ausencia de `@ts-ignore`, `@ts-nocheck` o casts inseguros (`any`). Se recompiló `@mesaya/shared` desde fuentes antes de compilar `@mesaya/api`. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Documentado con precisión; pruebas ejecutadas en vivo, logs sin secretos y distinción clara de diagnósticos. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión | PASS | Los 70 tests de la etapa 01 continúan pasando, sumando 3 nuevos tests de contrato para un total de 73 tests verdes. Cero supresión de tests preexistentes. |

---

## Integridad y seguridad

- **Base demo intacta**: SHA-256 pre/post ejecución: `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff` 100% idéntico.
- **Cruce tenant A/B**: No aplica a la compilación de contratos.
- **Rechazo sin escrituras**: Validado en `full-system-e2e.test.ts`: los payloads con tipos inválidos abortan en el schema Zod con HTTP 400 antes de mutar registros de tabla en base de datos.
- **Build**: Compilación limpia verificada de packages, apps y hardware.
- **Migración/paridad**: No se modificó el schema Prisma en esta etapa (las columnas `sector`, `isOutdoor` y `mergedWithTableId` ya existían en el modelo `Table`).
- **Ausencia de secretos en diff/logs**: Verificado; no se expuso ningún secreto ni token sensible.

---

## Pendientes, riesgos y decisiones

- **Qué falta**: Nada en Etapa 02. Cumplimiento integral del checklist y criterios de aceptación.
- **Qué impide avanzar**: Esperar revisión y aprobación de Codex según protocolo.
- **Decisiones técnicas registradas**:
  - Para ordenar la compilación de forma reproducible y cross-platform (Windows, Linux, CI), se creó `scripts/build.mjs` invocando secuencialmente cada workspace y aplicando fail-fast inmediato.
  - Se alineó `FloorPlanUpdateItem` directamente en `packages/shared/src/rtms-types.ts` para que los clientes TypeScript obtengan autocompletado estricto sin dependencias circulares.

---

## Handoff

- `docs/implementacion/CONTROL.md` actualizado a `NEEDS_REVIEW` para la etapa 02.
- No se inició la Etapa 03 ni ninguna subsiguiente (permanecen `BLOCKED`).
- Solicito revisión formal de Codex: «Codex, revisá la etapa 02».

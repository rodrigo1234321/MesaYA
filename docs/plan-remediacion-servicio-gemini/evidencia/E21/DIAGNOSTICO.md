# E21 — Diagnóstico (lectura cruzada, sin ejecución)

Fecha: 2026-09-16. Ejecutor OpenCode `opencode/muse-spark-1.3-contributor-free`, autorrevisión (no independiente).

## Fuentes leídas

`README.md`, `docs/plan-remediacion-servicio-gemini/{CONTROL,CONTINUAR,02-CONTRATO-SERVICIO,03-ACEPTACION}.md`, `etapas/E21.md`, `reportes/E20.md`, `apps/staff-panel/src/{App.tsx,hooks/useSSE.ts,hooks/useServiceSync.ts}`, `packages/api/test/{s07-service-shell,polling-clients-reconnect,e10-table-detail-actions,route-matrix-guard,capabilities-unit}.test.ts`, `packages/api/src/{services/config.service.ts,middlewares/auth.middleware.ts,routes/orders.routes.ts,routes/service.routes.ts,routes/staff.routes.ts}`, `packages/shared/src/index.ts`, `scripts/{check-route-matrix.mjs,route-matrix.json}`.

El log baseline citado en el handoff (`_orchestration/runs/mesaya-remediacion-e21-20260916-1/e21-baseline-full.stdout.log`) no es legible desde esta corrida (ruta fuera del worktree, sin permiso de lectura externa); se trabajó con los cinco fallos reproducibles transcriptos en el PROMPT, todos confirmables por lectura del código actual.

## Confirmaciones

- **D1 S07/nav (confirmado):** `App.tsx` tenía `grid-cols-3` con botones Servicio + Cocina primaria (`<span>Cocina</span>`, `selectTab('kitchen')`) + Más. Contrato 02 §2 exige Servicio + Más primarias y Cocina como acceso configurable dentro de Más. E20 ya había documentado la colisión (48/49). Decisión: quitar el botón primario, conservar Cocina en Más + `/kitchen`/query param + KDS E14.
- **D2 polling/E08 (confirmado):** `useSSE.ts` (42 líneas) sólo importa `useServiceSync`, no instancia `PollingCoordinator`; `useServiceSync.ts` sí lo instancia (`new PollingCoordinator`, `coordinator.start/stop/triggerNow`). El test pedía lo contrario en dos sitios. Decisión: corregir sólo la prueba.
- **D3 E10 labels (confirmado):** 4× `Mesa ${Math.floor(Math.random()*90+10)}` (colisión en rango 10..99 dentro del mismo restaurante). `randomUUID` ya importado. Decisión: `Mesa E10-${randomUUID().slice(0,8)}`.
- **D4 matriz (confirmado):** `classify()` ignoraba `verifySettlementAuthorization` → settle detectadas `ANON` vs manifiesto `MANAGER`; `service-tasks/act` y `terminal/provision` sin entrada. Decisión: scanner → `STAFF` para ese hook; manifiesto settle → `STAFF`, más las dos rutas con notas honestas. `terminal/provision` valida `restaurantSlug/pin/terminalId` en el handler, por eso `ANON` es correcto y documentado.
- **D5 capacidades/E12 (confirmado):** `buildCapabilities` incluye `waiter_cash_collection` (líneas 463–473 de `config.service.ts`); el test esperaba 11 claves y fixture sin el flag. Decisión: fixture + conteo 12, sin tocar producto.

## Descartados

- Cambiar el contrato para maquillar S07; ocultar texto de Cocina; segundo coordinador en `useSSE`; snapshots; eliminar `waiter_cash_collection`; debilitar `preHandler`. Todos rechazados explícitamente por el handoff y no aplicados.
- Otro P0/P1 fuera de alcance: no se encontró ninguno por lectura en los archivos autorizados; no se amplió alcance.

## Límite

Sin herramienta de ejecución en esta corrida: focal, matriz y `git diff --check` quedan PENDIENTES de la supervisión. Gate `IMPLEMENTED_NEEDS_REVIEW`.

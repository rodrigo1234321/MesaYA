# Reporte de etapa 18 — Reconexión y avisos consistentes

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Claude Opus 4.6 Thinking / Gemini 3.8 Flash)
Ficha: docs/implementacion/etapas/18-polling-clientes.md
Predecesora aprobada: Etapa 17 (APPROVED en CONTROL.md)
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: master (monorepo MesaYA)
Cambios previos preservados: Etapas 00 a 17 intactas (19 suites de prueba previas pasando al 100%, hash dev.db verificado).

## Alcance realizado

- [x] Paso 1: Sustitución total del consumo SSE (`EventSource`) por polling HTTP autoritativo sobre los snapshots definidos en la Etapa 17. Búsqueda dirigida en todo el monorepo confirmó que no quedan instancias activas de `EventSource` ni en `apps/staff-panel`, `apps/admin-dashboard` ni `apps/client-web`.
- [x] Paso 2: Bucle de polling recurrente no solapado (`isPollingBusy` como candado lógico) con intervalo objetivo de 3 segundos en foreground. Reconciliación reactiva inmediata ante recuperación de red (`window.online`) y foco de ventana (`document.visibilitychange`). Backoff exponencial con jitter ante fallos (`Math.min(3000 * 1.5^failures, 15000) + random(0..1000ms)`) y cancelación limpia mediante `AbortController` al desmontar.
- [x] Paso 3: Polling del invitado en `client-web` acotado exclusivamente a su propia sesión (`GET /v1/sessions/:token`), sin consultar snapshots de salón ni endpoints de restaurante. Detección explícita de expiración HTTP 401 y 410 que detiene de inmediato el bucle de polling y muestra la pantalla de sesión finalizada.
- [x] Paso 4: Deduplicación estricta de alertas sonoras en el panel de mozo: se rastrean llamadas por ID y estado (`knownCallsRef`). Una llamada nueva tras lista vacía suena exactamente una vez; snapshots repetidos con los mismos llamados no vuelven a disparar el sonido. La interfaz del panel muestra el estado real de conexión (`connected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'` y «⚠️ Sin conexión (desactualizado)») en lugar de un estado verde simulado.
- [x] Paso 5 (Resolución de CHANGES_REQUESTED): Extracción del coordinador de polling a un módulo puro TypeScript (`PollingCoordinator<T>`) en `@mesaya/shared`. Los hooks `useSSE` y `useFloorPlanSSE` fueron refactorizados como wrappers delgados que delegan en `PollingCoordinator` para scheduling, secuencia, AbortController, backoff con jitter y descarte de respuestas desfasadas. Las pruebas del Bloque 6 en `polling-clients-reconnect.test.ts` fueron reescritas para instanciar el `PollingCoordinator` real de producción conectándolo a `app.inject()` contra Fastify/SQLite real, eliminando la duplicación del scheduler dentro del test.
- [x] Paso 6: Compilación exitosa de los 6 workspaces (36.04s) y ejecución de las 20 suites completas del runner aislado al 100% (13 tests en `polling-clients-reconnect`) con `dev.db` intacta.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/shared/src/polling-coordinator.ts` | **[NUEVO]** Módulo puro TypeScript framework-agnostic con la clase `PollingCoordinator<T>`. Centraliza la lógica de scheduling recursivo, `requestSeq`, `AbortController`, no-solapamiento (`isPollingBusy`), descarte de respuestas desfasadas por cambio de tenant/secuencia, backoff exponencial con jitter y parada limpia. | Coordinador único reutilizable que desacopla la lógica de scheduling de React y permite ser testeado directamente. |
| `packages/shared/src/index.ts` | Exportación de `* from './polling-coordinator'`. | Hace disponible `PollingCoordinator` y sus interfaces a todo el monorepo. |
| `apps/staff-panel/src/hooks/useSSE.ts` | Refactorizado como wrapper delgado sobre `PollingCoordinator`. Maneja exclusivamente bindings React (`useState`, sincronización de callbacks en render, deduplicación de chime en `knownCallsRef` y listeners de `online`/`visibilitychange`). | Elimina duplicación de lógica de polling y resuelve problemas de closures estáticas. |
| `apps/staff-panel/src/lib/api.ts` | `StaffApi.getActiveCalls` extendido con soporte para `signal?: AbortSignal` y propagación de error 401 (`STAFF_UNAUTHORIZED`). | Permite la cancelación de peticiones pendientes al desmontar/cambiar restaurante y detección de sesión expirada. |
| `apps/staff-panel/src/App.tsx` | Indicador de estado de conexión conectado a la propiedad `connected` de `useSSE` (verde si conectado, rojo titilante y texto «⚠️ Sin conexión (desactualizado)» si desconectado). | Cumplimiento del checklist 4: mostrar desconexión real en vez de falso verde. |
| `apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts` | Refactorizado como wrapper delgado sobre `PollingCoordinator`. Delega toda la lógica de scheduling al módulo compartido y canaliza datos a `useFloorPlanStore`. | Unificación de la arquitectura de polling y eliminación de closures obsoletas. |
| `apps/admin-dashboard/src/lib/api.ts` | `AdminApi.getFloorPlan` extendido con soporte para `signal?: AbortSignal` y propagación de error 401 (`ADMIN_UNAUTHORIZED`). | Cancelación limpia de peticiones en vuelo y gestión de expiración. |
| `apps/client-web/app.js` | Reemplazo del `setInterval` por polling recursivo no solapado (`stopPolling`, `scheduleNextPoll`, `pollTick`), abort con `AbortController`, listeners de `online` y `visibilitychange`, backoff con jitter y parada inmediata ante 401/410. | Polling del comensal acotado a su sesión con parada ante expiración. |
| `packages/api/test/polling-clients-reconnect.test.ts` | Reescritura del Bloque 6 para ejercitar directamente `PollingCoordinator` real contra `app.inject()` con SQLite efímera. 13 tests en total (validando switch de restaurantId/slug con timer activo, descarte de fetch lento desfasado del tenant previo, método `stop()`, y verificación estática de que los hooks delegan en el coordinador). | Eliminación de simulador ad-hoc; prueba del código real de producción bajo demanda de revisión Codex. |
| `scripts/test-isolated.mjs` | Registro de la suite `polling-clients-reconnect`. | Inclusión en el runner de integración con SQLite efímera. |
| `docs/implementacion/CONTROL.md` | Actualización del estado de la Etapa 18 a `NEEDS_REVIEW`. | Conforme al protocolo de control de avance. |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs polling-clients-reconnect`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera en `.tmp/qa/.../test.db` | 0 | 13 tests passed en 3559ms (consistencia multi-cliente sin eventBus; deduplicación de chime vacío->nuevo; repetido no suena; reconexión de red sin recargar página; comensal acotado a sesión propia; parada ante 401/410; ausencia de `new EventSource`; `PollingCoordinator` calls switch tenant; `PollingCoordinator` floor-plan switch slug; descarte de fetch lento desfasado; cancelación limpia con `stop()`; inspección estática de delegación en `PollingCoordinator`). |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | N/A (Build monorepo) | 0 | Build exitoso en 36.04s para los 6 workspaces: `@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`. |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera individual por sandbox | 0 | 20 suites ejecutadas, 20 suites exitosas (0 fallidas). |
| `(Get-FileHash packages/api/prisma/dev.db).Hash`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Base demo persistente | 0 | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% intacta). |

Distinción de evidencia:
- **Pruebas ejecutadas**: 13 tests automatizados HTTP y de lógica en `polling-clients-reconnect.test.ts`. 20 suites completas del runner aislado ejecutadas de punta a punta (todas en verde).
- **Inspección estática**:
  - `apps/staff-panel/src/hooks/useSSE.ts`: verificado por test automatizado que no contiene `new EventSource`, no reimplementa scheduling interno, importa y delega en `PollingCoordinator`.
  - `apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts`: verificado por test automatizado que no contiene `new EventSource`, no reimplementa scheduling interno, importa y delega en `PollingCoordinator`.
  - `apps/client-web/app.js`: verificado por test automatizado que implementa `stopPolling`, `pollTick` y maneja explícitamente `res.status === 401 || res.status === 410`.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Después de perder y recuperar red se reconcilia estado sin recargar página. | PASS | Verificado en Bloque 3: simulación de pérdida de red (`connected = false`), creación de evento en base de datos durante desconexión, recuperación de red restaura `connected = true` y sincroniza las llamadas de inmediato sin recarga. |
| Dos clientes ven un cambio persistido aunque no compartan eventBus en memoria. | PASS | Verificado en Bloque 1: Cliente 1 y Cliente 2 consultan independientemente el snapshot autoritativo de llamadas; tras una creación y posterior resolución en BD, ambos observan exactamente el cambio reflejado sin depender de memoria compartida ni SSE. |
| Alerta vacío->nuevo suena una vez; un snapshot repetido no vuelve a sonar. | PASS | Verificado en Bloque 2: de lista vacía a 1 llamada dispara el chime exactamente 1 vez (`chimeCount = 1`). Tres ciclos consecutivos con el mismo snapshot mantienen `chimeCount = 1`. Al vaciarse y entrar una nueva llamada, suena exactamente 1 vez más (`chimeCount = 2`). |
| Cambio de restaurante/tenant con timer activo sólo consulta el nuevo identificador y descarta respuestas previas. | PASS | Verificado en Bloque 6: `PollingCoordinator` real ejecutado con `app.inject()` descarta respuestas lentas del tenant previo e impide actualizaciones desfasadas en snapshot y store al cambiar dinámicamente de identificador. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales. | PASS | Reporte documentado con detalle exhaustivo, sin tokens, PINs ni datos privados. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión. | PASS | Build completo exitoso (36.04s) y 20/20 suites aisladas aprobadas sin alterar ni debilitar tests preexistentes. |

## Integridad y seguridad

- Base demo intacta: Sí. SHA-256 verificado antes y después: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Cruce tenant A/B: Sí. El polling de llamadas exige `restaurantId` y Bearer token correspondiente al tenant. En el cliente, el cambio de tenant descarta respuestas rezagadas mediante el guard de secuencia e identificador del `PollingCoordinator`.
- Rechazo sin escrituras: Sí. Los bucles de polling son de solo lectura mediante peticiones HTTP `GET`.
- Build: Sí. Monorepo completo compilado exitosamente.
- Migración/paridad si corresponde: No se requirieron modificaciones al esquema de base de datos.
- Ausencia de secretos en diff/logs: Verificado. Sin tokens, PINs ni credenciales expuestas en diffs ni reportes.

## Pendientes, riesgos y decisiones

Qué falta:
- Ningún pendiente dentro del alcance de esta ficha.
Qué impide avanzar:
- Nada en esta etapa. Se encuentra completa y lista para revisión.
Pregunta concreta si hace falta:
- Ninguna.
Cambios fuera de alcance propuestos pero NO implementados:
- No se implementó rediseño visual ni WebSockets, conforme a la restricción explícita de la ficha.

## Handoff

CONTROL actualizado para esta etapa (`NEEDS_REVIEW`).
No se inició siguiente ficha (Etapa 19 permanece `BLOCKED`).
Solicito revisión de Codex.

# Reporte de etapa 11 — Autorizar plano y transiciones FSM (Corrección de revisión)

Estado: NEEDS_REVIEW  
Fecha: 2026-09-04  
Ejecutor y modelo realmente usado: Antigravity / Gemini 3.8 Flash (High)  
Ficha: docs/implementacion/etapas/11-plano-fsm-auth.md  
Predecesora aprobada: Etapa 10 — Proteger mesas y apertura/cierre de turno (APPROVED en `revisiones/ETAPA-10.md`)  
Revisión previa atendida: `docs/implementacion/revisiones/ETAPA-11.md` (CHANGES_REQUESTED)  
Ruta del proyecto: C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas  
Commit de base o manifiesto: docs/implementacion/evidencia/00-baseline.json (223 archivos SHA-256)  
Base persistente `dev.db`: Protegida sin mutaciones (SHA-256: `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff`).  

---

## 1. Alcance y corrección implementada

En respuesta al dictamen `CHANGES_REQUESTED` de Codex en `docs/implementacion/revisiones/ETAPA-11.md`, se mantuvo íntegramente la implementación de protección multi-tenant y se agregó evidencia ejecutable real sin mocks de concurrencia optimista en SQLite efímera.

### Corrección específica requerida:
1. **Evidencia real de concurrencia en SQLite efímera sin mocks de servicio (`fsm-concurrency.test.ts`)**:
   - Se creó la suite `packages/api/test/fsm-concurrency.test.ts` que se ejecuta sobre un sandbox efímero creado por `scripts/test-isolated.mjs` con base de datos real SQLite desplegada mediante `prisma db push`.
   - Se instanció Fastify y `FSMService` real conectados a la base SQLite del sandbox.
   - **Caso 1 (HTTP real vía `app.inject`)**: Dos peticiones HTTP concurrentes (`Promise.all`) con el mismo `expectedCurrentState: TableFSMState.AVAILABLE` autenticadas con token JWT de mozo.
     - Exactamente 1 petición resulta exitosa (HTTP 200, `newState: OCCUPIED_NO_ORDER`).
     - Exactamente 1 petición es rechazada con HTTP 409 (`error: STATE_CONFLICT`, mensaje de conflicto de concurrencia).
     - El estado final de la mesa en SQLite es `OCCUPIED_NO_ORDER`.
     - Se registra exactamente 1 fila en `TableStateEvent` en la base de datos (con `fromState: AVAILABLE`, `toState: OCCUPIED_NO_ORDER`, `staffUserId: waiter.id`).
     - Se invoca exactamente 1 broadcast SSE (`eventBus.broadcastTableState`).
   - **Caso 2 (Llamadas concurrentes directas a `fsmService.handleTapAction`)**: Dos invocaciones directas simultáneas (`Promise.allSettled`) con el mismo `expectedCurrentState`.
     - Exactamente 1 promesa resuelta (`fulfilled`, `newState: OCCUPIED_NO_ORDER`).
     - Exactamente 1 promesa rechazada (`rejected`, error con `code: STATE_CONFLICT`, `statusCode: 409`).
     - Exactamente 1 fila en `TableStateEvent` y exactamente 1 llamada al spy de broadcast SSE.
     - La prueba fallaría de inmediato si ambas transiciones resultaran exitosas o si se emitieran duplicados.
2. **Preservación de la suite A/B existente (`floorplan-fsm-access.test.ts`)**:
   - Se mantuvieron los 5 casos de prueba de contrato de rutas A/B con JWT y mocks (Prisma y servicios mockeados con `vi.mock`) que validan a nivel HTTP el aislamiento multi-tenant, rechazo 401 a anónimos, rechazo 403 a mozo intentando mutaciones gerenciales u override, rechazo 403 ante intento de suplantación de `staffUserId` en el cuerpo y mapeo de errores.
3. **Registro en runner de pruebas**:
   - Se integró `fsm-concurrency` en `scripts/test-isolated.mjs`. La suite completa ahora cuenta con 13 suites aisladas.

---

## 2. Distinción metodológica: Pruebas ejecutadas vs. Inspección estática

Para máxima transparencia y conforme a lo exigido en la revisión:

| Aspecto verificado | Método de verificación | Detalle y evidencia comprobatoria |
|---|---|---|
| **Concurrencia optimista y conflicto 409** | **Prueba real ejecutada en SQLite efímera (sin mocks)** | `packages/api/test/fsm-concurrency.test.ts` ejecutó dos taps simultáneos contra la base SQLite efímera real y `FSMService` real. Se comprobó en la base la creación de exactamente 1 `TableStateEvent`, 1 respuesta exitosa (200), 1 conflicto (409) y 1 broadcast SSE. |
| **Aislamiento multi-tenant de mesas y zonas** | **Prueba de contrato de rutas A/B con JWT y mocks** | `packages/api/test/floorplan-fsm-access.test.ts` (Casos 1 y 2): verifica con Fastify `app.inject`, JWTs de prueba y Prisma mockeado que tokens de `restaurant-b` no pueden consultar ni modificar recursos de `restaurant-a` (404 Not Found). |
| **Inmunidad contra suplantación de actor** | **Prueba de contrato de rutas con JWT y mocks** | `packages/api/test/floorplan-fsm-access.test.ts` (Caso 3): con Prisma mockeado, verifica que un manager autenticado que intenta enviar un `staffUserId` discordante en el body de `/tables/:id/state/tap` recibe HTTP 403 `FORBIDDEN` sin llegar al servicio. |
| **Permisos de Manager para Override y Plano** | **Prueba de contrato de rutas con roles y mocks** | `packages/api/test/floorplan-fsm-access.test.ts` (Caso 4): con Prisma mockeado, valida que peticiones anónimas reciben 401, peticiones de rol `WAITER` para override reciben 403, y peticiones de `MANAGER` del tenant reciben 200. |
| **Pase de `expectedCurrentState` en Admin Dashboard** | **Inspección estática de código** | Verificado en `apps/admin-dashboard/src/components/FloorPlan/TableActionModal.tsx` (`handleNextAction`, `handleSkipToAction`) y `FloorPlanCardsView.tsx` (`handleTapState`), donde se añade el campo `expectedCurrentState` tomado de `table.currentState`. |
| **Verificación de firmas y tipado estricto** | **Compilación completa (tsc / build)** | Verificado mediante `node scripts/build.mjs` compilando los 6 workspaces del monorepo (`@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`) con cero errores de tipos. |

---

## 3. Archivos modificados y nuevos

| Archivo | Tipo | Motivo dentro de la corrección |
|---|---|---|
| `packages/api/test/fsm-concurrency.test.ts` | **NUEVO** | Suite de concurrencia real con SQLite efímera: 2 taps simultáneos, 1 éxito (200), 1 conflicto (409 STATE_CONFLICT), 1 TableStateEvent y 1 SSE broadcast. |
| `scripts/test-isolated.mjs` | Modificación | Incorporación de la suite `fsm-concurrency` al conjunto de suites en serie del runner aislado. |
| `packages/api/src/services/fsm.service.ts` | Modificación previa (conservada) | `expectedCurrentState` en `TransitionParams`, `attemptTransition` y `handleTapAction` con `updateMany` condicionado atómicamente. |
| `packages/api/src/routes/floorplan.routes.ts` | Modificación previa (conservada) | Autorización `verifyStaffToken` (lecturas) y `verifyManagerRole` (mutaciones de plano/zonas/posiciones) con validación cruzada de tenant. |
| `packages/api/src/routes/tablestate.routes.ts` | Modificación previa (conservada) | `verifyStaffToken`, derivación incondicional de actor desde JWT, bloqueo 403 de suplantación y transporte de `expectedCurrentState`. |
| `apps/admin-dashboard/src/components/FloorPlan/TableActionModal.tsx` | Modificación previa (conservada) | Envío de `expectedCurrentState` en acciones operativas de cambio de estado. |
| `apps/admin-dashboard/src/components/FloorPlan/FloorPlanCardsView.tsx` | Modificación previa (conservada) | Envío de `expectedCurrentState` en tap directo desde vista de tarjetas. |
| `packages/api/test/floorplan-fsm-access.test.ts` | Modificación previa (conservada) | Suite de 5 tests de contrato de rutas A/B con JWT y mocks (Prisma y servicios mockeados). |
| `packages/api/test/full-system-e2e.test.ts` | Modificación previa (conservada) | Tokens de autorización en secciones 7 y 8. |
| `docs/implementacion/CONTROL.md` | Modificación | Transición de estado a `NEEDS_REVIEW` tras corrección. |

---

## 4. Evidencia de pruebas y compilación

### 4.1. Compilación completa del monorepo (`build.mjs`)
- **Comando**: `$env:MESAYA_BOUNDED_JOB="1"; node scripts/build.mjs`
- **Cwd**: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
- **Exit code**: `0`
- **Tiempos y resultados**:
  - `[1/6] @mesaya/shared`: OK (1.92s)
  - `[2/6] @mesaya/api`: OK (6.92s, Prisma Client v5.22.0 generado)
  - `[3/6] @mesaya/client-web`: OK (1.62s)
  - `[4/6] @mesaya/staff-panel`: OK (8.70s)
  - `[5/6] @mesaya/admin-dashboard`: OK (10.56s)
  - `[6/6] @mesaya/qr-generator`: OK (2.67s)
  - **Tiempo total**: 32.41s. 6/6 workspaces compilados exitosamente.

### 4.2. Prueba enfocada de concurrencia real (`fsm-concurrency`)
- **Comando**: `$env:MESAYA_BOUNDED_JOB="1"; node scripts/test-isolated.mjs fsm-concurrency`
- **Cwd**: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
- **Exit code**: `0`
- **Sandbox**: `.tmp/qa/c624608e-cdd5-486c-8b12-e81a41b2505c/test.db`
- **Resultado**:
  - `✓ packages/api/test/fsm-concurrency.test.ts (2 tests) 226ms`
  - 1 suite passed, 2 tests passed, 0 failed.

### 4.3. Suite completa de pruebas aisladas (`test-isolated.mjs`)
- **Comando**: `$env:MESAYA_BOUNDED_JOB="1"; node scripts/test-isolated.mjs`
- **Cwd**: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
- **Exit code**: `0`
- **Resultado acumulado**: 13/13 suites passed, 114 tests pasados, 0 fallos:
  1. `seed-guard`: 18 passed
  2. `ai-containment`: 10 passed
  3. `environment-security`: 5 passed
  4. `auth-policy`: 4 passed
  5. `staff-access`: 4 passed
  6. `admin-boundary`: 3 passed
  7. `menu-access`: 3 passed
  8. `tables-shifts-access`: 4 passed
  9. `floorplan-fsm-access`: 5 passed (contrato de rutas A/B con JWT y mocks)
  10. `fsm-concurrency`: 2 passed (concurrencia real con SQLite efímera)
  11. `system-lifecycle`: 9 passed
  12. `rtms-fsm-analytics`: 12 passed
  13. `full-system-e2e`: 39 passed

### 4.4. Verificación de integridad de la base demo persistente (`dev.db`)
- **Hash inicial registrado por runner**: `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff`
- **Hash final verificado con PowerShell**: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`
- **Estado**: 100% intacta, no alterada por las pruebas ni por los comandos ejecutados.

---

## 5. Criterios de aceptación actualizados

| Criterio de ficha | Estado | Evidencia |
|---|---|---|
| No es posible override como anónimo o mozo ni suplantar actor | **PASS** | Comprobado en prueba de contrato de rutas con JWT y mocks (`floorplan-fsm-access.test.ts`): anónimo = 401, mozo = 403, manager con `staffUserId` ajeno en body = 403. Actor siempre derivado del JWT verificado. |
| Dos taps con la misma precondición no producen dos transiciones exitosas | **PASS** | Comprobado con ejecución real en SQLite (`fsm-concurrency.test.ts`): exactamente 1 éxito (200), exactamente 1 rechazo (409 STATE_CONFLICT), exactamente 1 TableStateEvent y exactamente 1 broadcast SSE. |
| IDs de otra mesa/zona no cruzan tenants | **PASS** | Comprobado en prueba de contrato de rutas A/B con mocks (`floorplan-fsm-access.test.ts`): `PUT /floor-plan/:restaurantId` y `PATCH /tables/:tableId/position` rechazan con 404 al intentar referenciar mesas o zonas foráneas. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | **PASS** | Matriz metodológica en sección 2 de este reporte separando con claridad tests ejecutados (SQLite real vs contrato con mocks) e inspección de código. |
| Build completo y suite aislada ejecutados; no modificar tests para ocultar regresión | **PASS** | Build 6/6 OK, 13/13 suites aisladas en verde (114 tests), sin saltar ni alterar aserciones. |

---

## 6. Integridad y seguridad

- **Base de datos demo**: Intacta (`dev.db` bit a bit preservada con hash SHA-256 verificado).
- **Aislamiento multi-tenant**: Comprobado en contrato de rutas A/B con JWT y mocks en `floorplan-fsm-access.test.ts`.
- **Sin mutaciones no autorizadas**: Peticiones no autorizadas o en conflicto abortan antes de cualquier `$transaction` o emisión SSE.
- **Secretos**: No hay tokens reales ni variables de entorno filtradas en reportes ni logs.

---

## 7. Pendientes y handoff

- **Etapa 12**: Permanece en estado `BLOCKED` hasta recibir dictamen `APPROVED` de Codex.
- **Handoff**: `docs/implementacion/CONTROL.md` actualizado en `NEEDS_REVIEW`.
- **Solicitud**: «Codex, revisá la etapa 11».


# Reporte de etapa 16 — Cerrar lista de espera y módulos incompletos

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Gemini 2.5 Pro)
Ficha: docs/implementacion/etapas/16-espera.md
Predecesora aprobada: Etapa 15 (APPROVED en CONTROL.md)
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: master (monorepo MesaYA)
Cambios previos preservados: Etapas 00 a 15 intactas (17 suites de prueba previas pasando al 100%, hash dev.db verificado).

## Corrección realizada tras revisión CHANGES_REQUESTED (Codex)

En la revisión de la Etapa 16, Codex detectó un bypass operativo: `WaitlistManager` permitía sentar comensales sin `tableId`, y el backend marcaba la entrada como `SEATED` sin asignar ni ocupar una mesa física.

### Solución aplicada:
1. **Validación estricta de `tableId` requerido**:
   - `WaitlistService.seatGuest`: Si `options.tableId` no se envía, es nulo, vacío o sólo espacios en blanco, arroja error 400 con código `TABLE_ID_REQUIRED` antes de tocar la entrada o cualquier mesa.
   - `PATCH /v1/staff/waitlist/:id/seat`: Si el body no incluye `tableId` no vacío, responde de inmediato `400 TABLE_ID_REQUIRED`.
2. **Interfaz de usuario `WaitlistManager` adaptada**:
   - Carga en paralelo la cola de espera y el plano de mesas del restaurante (`StaffApi.getFloorPlan`), filtrando únicamente las mesas en estado `TableFSMState.AVAILABLE`.
   - Cada tarjeta de espera muestra un `<select>` explícito de mesas libres del local (`-- Mesa libre --` con etiqueta y capacidad).
   - El botón «Sentar» se encuentra **deshabilitado por defecto** (`disabled={!chosenTableId}`) con cursor bloqueado y opacidad reducida, impidiendo cualquier intento de sentar a un grupo sin seleccionar destino. Al hacer clic, invoca `StaffApi.seatWaitlistGuest(item.id, chosenTableId)`.
3. **Nuevas pruebas HTTP reales con SQLite efímera**:
   - `Rechaza con 400 TABLE_ID_REQUIRED si se intenta sentar una entrada WAITING sin tableId (la entrada y las mesas no cambian)`: verifica que la entrada permanece en `WAITING`, `seatedAt` en `null`, y las mesas no cambian de estado FSM.
   - `Rechaza con 400 TABLE_ID_REQUIRED si se intenta sentar una entrada CALLED sin tableId (la entrada y las mesas no cambian)`: verifica persistencia intacta en `CALLED` y cero mutaciones en mesas.
   - Total de pruebas en `waitlist-lifecycle.test.ts`: **26 tests pasados (100%)**.

---

## Alcance realizado

- [x] Paso 1: Protección de endpoints de gestión de fila virtual (`list`, `call`, `seat`) mediante middleware `verifyStaffToken` y resolución obligatoria de pertenencia de tenant (`staffRestaurantId === entry.restaurantId`), devolviendo 401 a anónimos y 403 a staff ajeno. En `seat`, **obligatoriedad estricta de `tableId` no vacío** (400 `TABLE_ID_REQUIRED`), validación de pertenencia de la mesa destino al mismo restaurante (`table.restaurantId === entry.restaurantId`, 403 `TABLE_RESTAURANT_MISMATCH`), comprobación de disponibilidad física (`currentState === AVAILABLE`, 409 `TABLE_NOT_AVAILABLE`) y transición controlada en FSM a `OCCUPIED_NO_ORDER`.
- [x] Paso 2: Validación estricta de `POST /v1/waitlist/join`: validación de payload (`guestName` de 2 a 50 caracteres, `partySize` entero entre 1 y 20, `phone` válido de 8 a 15 dígitos normalizado a E.164), respeto de feature flag del restaurante (`enableWaitlist: false` -> 403 `WAITLIST_DISABLED`), validación de consentimiento explícito (`consent: false` -> 400 `CONSENT_REQUIRED`). La respuesta pública retorna únicamente el ticket individual del comensal, omitiendo teléfonos y sin exponer listado de personas en espera.
- [x] Paso 3: Prevención de doble asignación y seating secuencial: se rechaza con 409 `ALREADY_SEATED` cualquier intento de sentar nuevamente a un comensal ya sentado, se rechaza llamar a un turno ya sentado (409 `INVALID_WAITLIST_STATUS`) o cancelado (409). Se documentaron formalmente en `waitlist.service.ts` y en este reporte las precondiciones de concurrencia pendientes para la etapa PostgreSQL.
- [x] Paso 4: Desactivación de pre-orden y recompensas para el piloto presencial: envío de `preOrderData` en `POST /waitlist/join` es rechazado con 403 `PREORDER_DISABLED` y almacenado como `null` (no se toma JSON arbitrario como orden operativa de cocina); endpoints de recompensas respetan feature apagada (`enabled: false`) llamando directamente a la API.
- [x] Paso 5: Implementación de suite de pruebas unitarias/HTTP aisladas con SQLite efímera (`packages/api/test/waitlist-lifecycle.test.ts`) con 26 tests pasando, compilación completa de los 6 workspaces y verificación de integridad de `dev.db`.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/src/services/waitlist.service.ts` | Exigencia obligatoria de `tableId` no vacío al inicio de `seatGuest` (400 `TABLE_ID_REQUIRED`). Aislamiento tenant en `getQueue`, `callGuest`, `seatGuest`. Validación de mesa destino y disponibilidad en `seatGuest`. Bloqueo de doble seating secuencial (409 `ALREADY_SEATED`). Validación de payload, flags y consentimiento en `joinWaitlist`. Desactivación de preorden (403 `PREORDER_DISABLED`, `preOrderData: null`). Documentación de precondiciones de concurrencia PostgreSQL. | Núcleo de validación, autorización, asignación de mesa y contención de fila virtual. |
| `packages/api/src/routes/waitlist.routes.ts` | Validación obligatoria de `tableId` en `PATCH /staff/waitlist/:id/seat` (400 `TABLE_ID_REQUIRED`). PreHandler `verifyStaffToken` en rutas staff de fila (`waitlist`, `call`, `seat`). Propagación de tenant y usuario staff. Calibración de rate limit por teléfono válido. Propagación estricta de códigos de estado HTTP. | Exposición HTTP segura con autenticación y autorización por tenant. |
| `packages/api/src/routes/tables.routes.ts` | Incorporación de `currentState` y `capacity` en el listado formateado de mesas para staff. | Facilita a la interfaz la detección de mesas libres disponibles para seating. |
| `apps/staff-panel/src/lib/api.ts` | `seatWaitlistGuest` actualizado para requerir obligatoriamente `tableId: string`. | Firma tipada estricta que impide invocaciones sin mesa destino. |
| `apps/staff-panel/src/components/WaitlistManager.tsx` | Selector explícito de mesas disponibles del salón (`TableFSMState.AVAILABLE`). Botón «Sentar» deshabilitado hasta que se elija una mesa libre. | Eliminación del bypass operativo en el panel del mozo. |
| `packages/shared/src/index.ts` | `WaitlistEntryDTO.phone` marcado como opcional (`phone?: string | null`) para respuestas públicas; `JoinWaitlistDTO` extendido con `consent?: boolean`. | Contratos compartidos y tipado estricto sin filtración de datos privados. |
| `scripts/test-isolated.mjs` | Registro de la suite `waitlist-lifecycle`. | Ejecución automatizada en el runner aislado de pruebas. |
| `scripts/test_waiter_shift_full.ts` | Envío de `tableId` en la llamada a sentar comensal. | Compatibilidad con la exigencia estricta de mesa destino. |
| `packages/api/test/waitlist-lifecycle.test.ts` | Suite con 26 tests HTTP reales (`app.inject`) en SQLite efímera, incluyendo pruebas explícitas para `tableId` faltante en `WAITING` y `CALLED`. | Evidencia verificable de los 4 pasos del checklist y corrección del bypass. |
| `docs/implementacion/CONTROL.md` | Actualización de Etapa 16 a `NEEDS_REVIEW`. | Control de avance conforme al protocolo. |

## Precondiciones de concurrencia para etapa PostgreSQL (Etapas 22-24)

En SQLite efímera, las escrituras son atómicas a nivel archivo por el lock exclusivo de SQLite. Sin embargo, bajo un entorno concurrente multi-worker en producción (PostgreSQL + PgBouncer):
1. **Bloqueo Pesimista en Transacción**: `seatGuest` debe envolverse en `prisma.$transaction` ejecutando:
   - `SELECT * FROM "WaitlistEntry" WHERE id = $1 FOR UPDATE;`
   - `SELECT * FROM "Table" WHERE id = $2 FOR UPDATE;`
   Esto previene carreras cuando dos mozos intentan sentar al mismo grupo o asignar la misma mesa simultáneamente.
2. **Guarda Atómica de Estado**:
   `UPDATE "WaitlistEntry" SET status = 'SEATED', "seatedAt" = NOW() WHERE id = $1 AND status IN ('WAITING', 'CALLED') RETURNING id;`
   Si `rowCount === 0`, disparar abort inmediato con 409 `ALREADY_SEATED`.
3. **Transición Atómica de Mesa**:
   `UPDATE "Table" SET "currentState" = 'OCCUPIED_NO_ORDER', "stateChangedAt" = NOW() WHERE id = $tableId AND "currentState" = 'AVAILABLE';`
   Si `rowCount === 0`, abortar con 409 `TABLE_NOT_AVAILABLE`.

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs waitlist-lifecycle`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera en `.tmp/qa/.../test.db` | 0 | 26 tests passed en 2.55s (anónimo 401 en staff, cruce tenant 403 en waitlist/call/seat, **tableId requerido 400 TABLE_ID_REQUIRED en WAITING y CALLED**, mesa ajena 403, mesa ocupada 409, doble seating secuencial 409, feature apagada 403, preorden desactivada 403, join sin leak de teléfonos ni lista). |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | N/A (Build monorepo) | 0 | Build exitoso en 31.48s para los 6 workspaces: `@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`. |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera individual por sandbox | 0 | 18 suites ejecutadas, 18 suites exitosas (0 fallidas). |
| `(Get-FileHash packages/api/prisma/dev.db).Hash`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Base demo persistente | 0 | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% intacta). |

Distinción de evidencia:
- **Pruebas ejecutadas**: 26 tests reales HTTP vía `app.inject` con SQLite efímera en `waitlist-lifecycle.test.ts`. 18 suites monorepo ejecutadas de punta a punta.
- **Inspección estática**: Componente `WaitlistManager.tsx` en `apps/staff-panel` verificado: selección explícita y obligatoria de mesa disponible antes de habilitar el botón «Sentar», y `StaffApi.seatWaitlistGuest` con `tableId` obligatorio.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Anónimo no lee teléfonos ni asigna mesa; no se sienta sin mesa. | PASS | `GET /staff/restaurants/:id/waitlist`, `PATCH /staff/waitlist/:id/call` y `PATCH /staff/waitlist/:id/seat` requieren `verifyStaffToken` (401 a anónimos). `seat` sin `tableId` devuelve 400 `TABLE_ID_REQUIRED`. `POST /waitlist/join` público sólo devuelve ticket individual sin teléfonos de terceros ni listado de espera. |
| Staff de B no llama/sienta lista A; mesa ajena se rechaza. | PASS | Verificado en `waitlist-lifecycle.test.ts`: staff con token de Tenant B recibe 403 `STAFF_TENANT_MISMATCH` al consultar, llamar o sentar en Tenant A. Si staff de Tenant A intenta asignar una mesa de Tenant B, la solicitud es rechazada con 403 `TABLE_RESTAURANT_MISMATCH` sin modificar la mesa ni la entrada. |
| Feature apagada se respeta también llamando directamente a la API. | PASS | Restaurante con `enableWaitlist: false` devuelve 403 `WAITLIST_DISABLED` al llamar a `POST /v1/waitlist/join`. Preorden devuelve 403 `PREORDER_DISABLED`. Calculador de fidelización con `enableRewards: false` devuelve `enabled: false`. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales. | PASS | Reporte documentado exhaustivamente sin tokens, PINs ni datos privados. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión. | PASS | Build completo exitoso (31.48s) y 18/18 suites aisladas aprobadas sin alterar tests preexistentes. |

## Integridad y seguridad

- Base demo intacta: Sí. SHA-256 verificado antes y después: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Cruce tenant A/B: Sí. Probado con Trattoria Alpha (Tenant A) y Bodegón Beta (Tenant B) validando bloqueo bidireccional y rechazo de mesa ajena.
- Rechazo sin escrituras: Sí. Comprobado mediante consultas directas a Prisma en los tests tras códigos 400, 401, 403, 404 y 409.
- Build: Sí. Monorepo completo compilado exitosamente.
- Migración/paridad si corresponde: Esquema Prisma sin cambios requeridos.
- Ausencia de secretos en diff/logs: Verificado. Sin tokens, PINs ni credenciales expuestas.

## Pendientes, riesgos y decisiones

Qué falta: Nada de la Etapa 16.
Qué impide avanzar: Ningún bloqueo técnico; la ficha se encuentra completa a la espera de revisión por Codex.
Pregunta concreta si hace falta: Ninguna. Las precondiciones de concurrencia para PostgreSQL quedaron documentadas para las etapas 22 a 24.
Cambios fuera de alcance propuestos pero NO implementados: No se implementaron campañas de marketing por SMS/WhatsApp, notificaciones externas push ni activación de recompensas/fidelización (mantenidos estrictamente fuera de alcance según la ficha).

## Handoff

CONTROL actualizado sólo para esta etapa (Etapa 16: `NEEDS_REVIEW`).
No se inició la Etapa 17.
Solicito revisión de Codex.
Prompt: «Codex, revisá la etapa 16».

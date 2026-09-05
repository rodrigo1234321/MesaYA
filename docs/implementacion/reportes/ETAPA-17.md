# Reporte de etapa 17 — Cerrar SSE público y definir snapshots

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Gemini 2.5 Pro)
Ficha: docs/implementacion/etapas/17-stream-cierre.md
Predecesora aprobada: Etapa 16 (APPROVED en CONTROL.md)
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: master (monorepo MesaYA)
Cambios previos preservados: Etapas 00 a 16 intactas (18 suites de prueba previas pasando al 100%, hash dev.db verificado).

## Corrección realizada tras revisión CHANGES_REQUESTED (Codex)

En la revisión de la Etapa 17, Codex identificó una fuga de credenciales del lado cliente: `apps/staff-panel/src/hooks/useSSE.ts` obtenía el JWT del staff (`StaffApi.getAuthToken()`) y lo agregaba a `URLSearchParams` como parámetro `token` antes de instanciar `new EventSource(...)`. Aunque la API respondiera `410 GONE`, la credencial ya atravesaba el navegador, proxies y logs de acceso, además de repetirse en posibles reintentos automáticos del navegador.

### Solución aplicada:

1. **Erradicación de credenciales en URL en el cliente (`useSSE.ts`)**:
   - Se eliminó por completo la invocación a `StaffApi.getAuthToken()` y la asignación `if (token) queryParams.set('token', token);`.
   - Se modularizó y exportó la función constructora canónica `buildStaffStreamUrl(restaurantId: string): string`, la cual únicamente configura `restaurantId`, garantizando por construcción la ausencia total de `token`, `authorization` o cualquier credencial bearer en la query string.
   - En `apps/staff-panel/src/lib/api.ts`, se incorporaron guardas seguras `typeof localStorage !== 'undefined'` para proteger el entorno ante ejecuciones en entornos Node/testing/SSR.
   - Se mantuvo intacta la lógica de fallback sin anticipar el rediseño a polling de la Etapa 18.

2. **Pruebas de regresión del consumidor y contrato automatizado**:
   - En `packages/api/test/stream-closure-snapshots.test.ts`, se incorporó el **Bloque 5** enfocado específicamente en el contrato del consumidor:
     - `buildStaffStreamUrl construye la URL sin incluir token ni credenciales bearer en query params`: verifica mediante `URLSearchParams` que no existen los campos `token`, `authorization` ni `bearer`.
     - `Aun existiendo JWT en storage o sesión, el consumidor nunca lo incorpora a la URL legacy`: demuestra que la URL construida para el endpoint legacy no contiene el JWT de staff ni la clave `token=`.
     - `Inspección estática de useSSE.ts confirma eliminación de getAuthToken y queryParams.set(token)`: análisis estático del archivo fuente para certificar que no existe código residual que lea credenciales para el stream.
   - Total de pruebas en la suite `stream-closure-snapshots.test.ts`: **23 tests pasados (100%)**.

---

## Alcance realizado

- [x] Paso 1: Decisión de piloto implementada: polling HTTP autenticado como transporte autoritativo y resiliente; deshabilitación total de `/stream` y `/v1/stream` mediante `fastify.all` devolviendo respuesta inmediata `410 GONE` con código `SSE_STREAM_DISABLED`, `Cache-Control: no-store, no-cache, must-revalidate`, cerrando de inmediato la conexión HTTP sin secuestro de socket, sin streaming persistente y sin fugas de datos. `eventBus.addClient` convertido en no-op seguro para evitar consumo inútil de memoria o retención de clientes. No se añadió Redis ni broker externo.
- [x] Paso 2: Verificación y completitud de endpoints de snapshot para mesas, plano, llamadas y pedidos con aislamiento estricto de tenant y DTO mínimo. Incorporación del endpoint de conveniencia `GET /v1/orders/active` (vía header `x-session-token` o query) complementando `GET /v1/orders/session/:token`. Documentación exhaustiva en matriz de snapshots.
- [x] Paso 3: Erradicación de JWT permanente en query strings tanto en el backend como en los clientes: `/stream` rechaza con 410 GONE sin procesar URLs, y `useSSE.ts` en `staff-panel` no incluye tokens ni credenciales en la URL construida. La disponibilidad de la plataforma no depende en ningún momento de canales SSE abiertos.
- [x] Paso 4: Aislamiento comprobado: el comensal/invitado no tiene acceso a endpoints de salón (`/calls`, `/floor-plan`, `/restaurants/:id/tables`, `/kitchen-orders` devuelven 401 a comensales anónimos o portadores de token de mesa). El invitado solo accede a su propio snapshot mediante `GET /sessions/:token` y `GET /orders/active`, restringido a su mesa.
- [x] Paso 5: Redacción de datos sensibles en snapshots de salón: `activeSessionToken` en `/floor-plan` y `activeToken` en `/tables` retornan explícitamente `null` para evitar el robo o suplantación de sesiones de comensales por parte de observadores del plano; `/calls` no expone tokens de comensales ni números telefónicos privados.
- [x] Paso 6: Suite de pruebas HTTP reales en SQLite efímera (`packages/api/test/stream-closure-snapshots.test.ts`) con 23 tests unitarios, de integración y de regresión del consumidor pasando al 100%, build completo del monorepo (6/6 workspaces) y suite aislada global aprobada (19/19 suites exitosas).

## Matriz Canónica de Endpoints de Snapshot y Control de Acceso

| Entidad | Endpoint Canónico | Actor Autorizado | Mecanismo de Autenticación | Aislamiento Tenant / Mesa | DTO Mínimo y Redacción de Sensibles |
|---|---|---|---|---|---|
| **Canal SSE (Legacy)** | `ALL /stream`<br>`ALL /v1/stream` | **DESHABILITADO** | Ninguno (Cierre general) | 410 GONE universal para cualquier solicitante (`SSE_STREAM_DISABLED`) | Cero datos de negocio; headers `Cache-Control: no-store`; no se secuestra la conexión HTTP. Cliente no anexa JWT en query string. |
| **Mesas del Salón** | `GET /v1/restaurants/:id/tables` | Staff del restaurante | Bearer JWT (Staff) | `staffUser.restaurantId === id` (403 si mismatch) | Lista de mesas con sector y estado FSM; `activeToken: null` redactado para evitar suplantación de comensales. |
| **Plano del Salón** | `GET /v1/floor-plan/:restaurantId` | Staff del restaurante | Bearer JWT (Staff) | `staffUser.restaurantId === id` (403/404 si mismatch) | Topología visual de mesas y zonas; `activeSessionToken: null` forzado en el DTO para impedir secuestro de sesión. |
| **Llamados Activos** | `GET /v1/calls?restaurantId=:id` | Staff del restaurante | Bearer JWT (Staff) | `staffUser.restaurantId === id` (403 si mismatch) | Llamados pendientes/en progreso; sin tokens de sesión de mesa ni teléfonos privados de comensales. |
| **Comandas Cocina** | `GET /v1/staff/restaurants/:id/kitchen-orders` | Staff del restaurante | Bearer JWT (Staff) | `staffUser.restaurantId === id` (403 si mismatch) | Comandas unificadas (QR comensal y mozo), platos y notas; sin pasarelas de pago ni tokens. |
| **Sesión Propia (Invitado)** | `GET /v1/sessions/:token` | Comensal activo | Token de sesión en URL | Valida sesión activa (`closedAt === null`); acotado a su mesa física | Solo datos de su mesa y estado de llamado propio; sin visibilidad del resto del salón ni otras mesas. |
| **Comanda Propia (Invitado)** | `GET /v1/orders/session/:token`<br>`GET /v1/orders/active` | Comensal activo | Token en URL o header `x-session-token` | Valida sesión activa; acotado a la comanda de su mesa | Comanda activa con ítems, flags `allowOrdering` y `requireWaiterValidation`; sin datos de otras mesas. |

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `apps/staff-panel/src/hooks/useSSE.ts` | Eliminación de `StaffApi.getAuthToken()` y `queryParams.set('token', token)`. Exportación de `buildStaffStreamUrl(restaurantId)` que solo incluye `restaurantId`. | Corrección del hallazgo bloqueante de Codex: suprime la transmisión de JWTs en URL desde el cliente. |
| `apps/staff-panel/src/lib/api.ts` | Guardas seguras `typeof localStorage !== 'undefined'` en métodos de acceso a almacenamiento. | Previene errores de entorno al importar librerías del cliente en suites de prueba Node/Vitest. |
| `packages/api/src/routes/stream.routes.ts` | Reemplazo completo de la lógica SSE por un manejador `fastify.all('/stream')` que responde inmediatamente HTTP 410 GONE con código `SSE_STREAM_DISABLED` y cabeceras `no-store, no-cache`. | Cumplimiento del checklist ítem 1: deshabilitar SSE de forma explícita, rápida y sin datos. |
| `packages/api/src/lib/eventBus.ts` | `addClient` convertido en no-op seguro; `broadcast` optimizado para salir de inmediato si `clients.size === 0`. | Evita que el EventBus acumule o intente enviar eventos SSE a conexiones inexistentes. |
| `packages/api/src/index.ts` | Registro de `streamRoutes` tanto en la raíz (`/stream`) como con el prefijo `/v1` (`/v1/stream`). | Garantiza respuesta 410 GONE rápida sin importar qué ruta o prefijo use el cliente legacy. |
| `packages/api/src/services/floorplan.service.ts` | En el mapeo de mesas para el snapshot del plano, `activeSessionToken: null` de forma fija (previamente exponía `activeSession?.token`). | Previene la filtración de tokens de sesión activos de comensales a cualquier usuario del plano. |
| `packages/api/src/routes/orders.routes.ts` | Incorporación del endpoint `GET /v1/orders/active` autenticado mediante `x-session-token` para snapshots del comensal. | Completa la matriz de snapshots seguros para clientes móviles comensales. |
| `scripts/test-isolated.mjs` | Registro de la suite `stream-closure-snapshots`. | Inclusión en el runner de integración con SQLite efímera. |
| `packages/api/test/stream-closure-snapshots.test.ts` | Suite con 23 tests HTTP y unitarios reales cubriendo: cierre de `/stream` (anónimo, tenant válido, JWT en URL, Bearer, POST, `/v1/stream`), aislamiento del comensal frente al salón, aislamiento tenant A/B para staff, redacción de datos en snapshots y contrato del consumidor staff-panel sin JWT en URL. | Evidencia automatizada de cumplimiento de los 4 criterios de aceptación de la ficha y de la corrección del hallazgo bloqueante. |
| `docs/implementacion/CONTROL.md` | Actualización del estado de la Etapa 17 a `NEEDS_REVIEW`. | Conforme al protocolo de control de avance. |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs stream-closure-snapshots`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera en `.tmp/qa/.../test.db` | 0 | 23 tests passed en 953ms (GET/POST /stream 410 GONE; 401 en /calls, /floor-plan, /tables, /kitchen-orders para comensales; snapshot comensal en /sessions y /orders/active; 403 en cross-tenant staff; `activeSessionToken: null` y `activeToken: null` en snapshots; `addClient` no-op; **`buildStaffStreamUrl` sin token ni bearer; ausencia de `getAuthToken` en `useSSE.ts`**). |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | N/A (Build monorepo) | 0 | Build exitoso en 32.16s para los 6 workspaces: `@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`. |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera individual por sandbox | 0 | 19 suites ejecutadas, 19 suites exitosas (0 fallidas). |
| `(Get-FileHash packages/api/prisma/dev.db).Hash`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Base demo persistente | 0 | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% intacta). |

Distinción de evidencia:
- **Pruebas ejecutadas**: 23 tests HTTP reales vía `app.inject` y contratos automatizados de URL en `stream-closure-snapshots.test.ts`. 19 suites del runner aislado ejecutadas de punta a punta (todas en verde).
- **Inspección estática**:
  - `apps/staff-panel/src/hooks/useSSE.ts`: inspeccionado y validado mediante regex en test unitario: no realiza lecturas de `StaffApi.getAuthToken` ni agrega `token` a `queryParams`.
  - `apps/staff-panel/src/components/KitchenOrdersManager.tsx`: se verificó que implementa polling HTTP autónomo periódico (`setInterval(fetchOrders, 4000)`).
  - `packages/api/src/services/floorplan.service.ts`: se inspeccionó la asignación de `activeSessionToken: null` garantizando que no se filtren credenciales.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| `/stream` anónimo/credencial en URL no expone snapshot ni queda abierto. | PASS | Verificado en tests HTTP: tanto `/stream` como `/v1/stream`, con o sin `restaurantId`, con JWT en query string o Bearer header, o vía POST, responden inmediatamente `410 GONE` con código `SSE_STREAM_DISABLED` y `Cache-Control: no-store`. No abre event-stream ni secuestra conexión. El cliente staff ya no envía el token en la URL. |
| Snapshots sólo accesibles por permisos previstos. | PASS | Endpoints de salón (`/calls`, `/floor-plan`, `/restaurants/:id/tables`, `/kitchen-orders`) exigen autenticación staff y devuelven 401 a comensales anónimos o con token de mesa. Staff de Tenant B recibe 403 / 404 al intentar consultar snapshots de Tenant A. |
| No tokens ni teléfonos ajenos en respuestas de snapshots. | PASS | Verificado en assertions: `/floor-plan` entrega `activeSessionToken: null`, `/tables` entrega `activeToken: null`, `/calls` no expone tokens de comensales ni teléfonos. Comensal en `/sessions/:token` y `/orders/active` sólo ve su propia mesa y pedido. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales. | PASS | Reporte detallado sin PINs, secretos ni credenciales expuestas. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión. | PASS | Build completo exitoso de los 6 workspaces (32.16s) y 19/19 suites aisladas aprobadas sin regresiones ni modificación de suites previas. |

## Integridad y seguridad

- Base demo intacta: Sí. SHA-256 verificado antes y después: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Cruce tenant A/B: Sí. Comprobado en todas las rutas de snapshot con Tenant Alpha y Tenant Beta, validando 403 `STAFF_TENANT_MISMATCH` / 404 `FLOOR_PLAN_NOT_FOUND`.
- Rechazo sin escrituras: Sí. Los endpoints de snapshot y `/stream` son de solo lectura y no realizan mutaciones en la base de datos.
- Build: Sí. Monorepo completo compilado exitosamente.
- Migración/paridad si corresponde: No se requirieron modificaciones al esquema de base de datos.
- Ausencia de secretos en diff/logs: Verificado. El cliente ya no transmite el JWT en query parameters de la URL, evitando persistencia en logs o proxies.

## Pendientes, riesgos y decisiones

Qué falta:
- Transición completa del frontend comensal y paneles para reemplazar definitivamente el consumo SSE por polling adaptativo y reconexión consistente, lo cual corresponde a la Etapa 18 según el plan.
Qué impide avanzar:
- Nada en esta etapa. Corrección finalizada y lista para revisión.
Pregunta concreta si hace falta:
- Ninguna.
Cambios fuera de alcance propuestos pero NO implementados:
- No se implementó broker de mensajería externo (Redis Pub/Sub) ni SSE distribuido, conforme a la restricción explícita de la ficha de no añadir Redis en el piloto presencial.
- No se implementó el rediseño completo de polling/reconexión de la Etapa 18 (se mantuvo acotado a eliminar la fuga de JWT en query string).

## Handoff

CONTROL actualizado sólo para esta etapa.
No se inició siguiente ficha.
Solicito revisión de Codex.

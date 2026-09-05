# Reporte de etapa 15 — Autorizar cocina y estados de pedidos

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Gemini 2.5 Pro)
Ficha: docs/implementacion/etapas/15-pedidos-staff.md
Predecesora aprobada: Etapa 14 (APPROVED en CONTROL.md)
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: master (monorepo MesaYA)
Cambios previos preservados: Etapas 01 a 14 intactas (16 suites de prueba previas pasando al 100%, hash dev.db verificado).

## Alcance realizado

- [x] Paso 1: Protección de endpoints de staff (`validate`, `kitchen-orders`, `add` items, `status`, `pay`) mediante middleware `verifyStaffToken` y resolución obligatoria de pertenencia de tenant desde la base de datos (`orderId`/`tableId`/`tableSessionId`), devolviendo 401 a anónimos y 403 a staff de otro restaurante.
- [x] Paso 2: Definición de tabla estricta de transiciones permitidas (`ALLOWED_ORDER_TRANSITIONS`) y validación de esquema contra enum `OrderStatus`. Verificación previa a cualquier escritura en DB; rechazo de estados inventados (400), saltos o regresiones inválidas (422) y bloqueos desde estados finales (`PAID`/`CANCELLED`) o segundo cierre (409) garantizando ausencia total de escrituras.
- [x] Paso 3: Confirmación de cobro manual presencial exclusivo para staff autenticado con rol `MANAGER` (`WAITER` recibe 403 `MANAGER_ROLE_REQUIRED`). Validación de métodos presenciales (`WAITER_CASH`, `WAITER_CARD`). Creación de registro trazable en `PaymentTransaction` con `status: 'MANUAL_SETTLED'`, actor encargado registrado en `guestSessionId`, fecha `resolvedAt`, y `mpPaymentId: null` (diferenciado de pasarelas digitales, sin simular `APPROVED` del proveedor).
- [x] Paso 4: Corrección de la transición errónea `PAID -> EATING` en `order.service.ts`: al marcarse la orden como `PAID`, la mesa en la FSM transiciona a `TableFSMState.PAID` (sobremesa previa al cierre y limpieza) y nunca regresa a `TableFSMState.EATING`. Compatible con los estados `EATING` y `BILL_REQUESTED`.
- [x] Paso 5: Contención de pagos digitales preservada: endpoints `/v1/orders/items/claim`, `/v1/orders/:id/split-session` y `/v1/orders/split-session/:id/pay-part` responden 503 `DIGITAL_PAYMENTS_UNAVAILABLE`.
- [x] Paso 6: Implementación de suite de pruebas unitarias/HTTP aisladas con SQLite efímera (`packages/api/test/staff-orders-kitchen.test.ts`) con 27 tests pasando, compilación completa de los 6 workspaces y verificación de integridad de `dev.db`.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/src/services/order.service.ts` | Matriz `ALLOWED_ORDER_TRANSITIONS`, validación tenant en `validateOrder`, `addItemByStaff`, `updateOrderStatusByStaff` y `getKitchenOrders`. Validación de enum `OrderStatus` (400), transiciones permitidas (422), rechazo de estados finales/segundo cierre (409). Cobro manual para `MANAGER` con `PaymentTransaction` `MANUAL_SETTLED` (`mpPaymentId: null`). Corrección FSM `PAID -> TableFSMState.PAID`. | Núcleo de autorización, transiciones permitidas, trazabilidad de cobro y corrección de FSM. |
| `packages/api/src/routes/orders.routes.ts` | PreHandler `verifyStaffToken` agregado en `POST /staff/orders/:id/validate`. Propagación de `staffRestaurantId`, `staffRole`, `staffUserId` en endpoints de cocina, carga y status. Incorporación de ruta `POST /staff/orders/:id/pay`. | Exposición HTTP segura con autenticación y autorización por tenant/rol. |
| `apps/staff-panel/src/lib/api.ts` | Incorporación del método `payOrder` en la clase `StaffApi`. | Soporte en cliente mozo/encargado para cobro presencial trazable. |
| `scripts/test-isolated.mjs` | Registro de la suite `staff-orders-kitchen`. | Ejecución automatizada en el runner aislado de pruebas. |
| `packages/api/test/staff-orders-kitchen.test.ts` | Suite con 27 tests HTTP reales (`app.inject`) en SQLite efímera. | Evidencia verificable de los 4 pasos del checklist y criterios de aceptación. |
| `docs/implementacion/CONTROL.md` | Actualización de Etapa 15 de `IN_PROGRESS` a `NEEDS_REVIEW`. | Control de avance conforme al protocolo. |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs staff-orders-kitchen`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera en `.tmp/qa/0b03601b-ab2d-4453-831f-e5bf1b750231/test.db` | 0 | 27 tests passed en 3.58s (anónimo 401, cruce tenant 403, enum inválido 400, salto inválido 422, regresión 422, mozo cobrando 403, cobro manager 200 con MANUAL_SETTLED, rechazo segundo cierre 409, FSM a PAID). |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | N/A (Build monorepo) | 0 | Build exitoso en 32.43s para los 6 workspaces: `@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`. |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera individual por sandbox | 0 | 17 suites ejecutadas, 17 suites exitosas (0 fallidas). |
| `(Get-FileHash packages/api/prisma/dev.db).Hash`<br>(cwd: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Base demo persistente | 0 | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% intacta). |

Distinción de evidencia:
- **Pruebas ejecutadas**: 27 tests reales HTTP vía `app.inject` con SQLite efímera en `staff-orders-kitchen.test.ts`. 16 suites preexistentes ejecutadas de punta a punta.
- **Inspección estática**: Validación de botones y acciones en `apps/staff-panel/src/components/KitchenOrdersManager.tsx` confirmando alineación estricta con `ALLOWED_ORDER_TRANSITIONS`.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Anónimo y otro tenant no validan ni leen cocina. | PASS | Verificado en tests de `staff-orders-kitchen.test.ts`: requests sin bearer token reciben 401; requests con token de staff de Tenant B hacia recursos de Tenant A reciben 403 `STAFF_TENANT_MISMATCH` tanto en `kitchen-orders`, `validate`, `items` como en `status`. |
| Estado inventado, regresión desde final o segundo cierre no altera pedido. | PASS | Status fuera de enum retorna 400 `INVALID_ORDER_STATUS`. Regresiones (ej. `SERVED` -> `IN_KITCHEN`) retornan 422 `INVALID_ORDER_TRANSITION`. Intento de modificación sobre comanda `PAID` o `CANCELLED` y segundo cobro retornan 409 `ORDER_FINAL_STATE` sin alterar la base de datos ni crear transacciones duplicadas. |
| Cobro manual queda trazable y nunca se presenta como confirmación del proveedor. | PASS | Probado en `staff-orders-kitchen.test.ts`: sólo rol `MANAGER` puede cobrar; se genera registro en `PaymentTransaction` con `status: 'MANUAL_SETTLED'`, `mpPaymentId: null`, `method: 'WAITER_CASH'` / `'WAITER_CARD'`, actor `staffUserId` y timestamp `resolvedAt`. Mozo (`WAITER`) recibe 403 `MANAGER_ROLE_REQUIRED`. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales. | PASS | Reporte documentado exhaustivamente sin tokens, PINs ni datos privados. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión. | PASS | Build completo exitoso (32.43s) y 17/17 suites aisladas aprobadas sin alterar tests preexistentes. |

## Integridad y seguridad

- Base demo intacta: Sí. SHA-256 verificado antes y después: `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff`.
- Cruce tenant A/B: Sí. Probado con Trattoria Alpha (Tenant A) y Bodegón Beta (Tenant B) validando bloqueo bidireccional en todas las rutas de staff.
- Rechazo sin escrituras: Sí. Comprobado mediante consultas directas a Prisma en los tests tras códigos 400, 401, 403, 404, 409, 422 y 503.
- Build: Sí. Monorepo completo compilado exitosamente.
- Migración/paridad si corresponde: Sin cambios de esquema requeridos; `PaymentTransaction` soporta campos presenciales.
- Ausencia de secretos en diff/logs: Verificado. Sin tokens, PINs ni credenciales expuestas.

## Pendientes, riesgos y decisiones

Qué falta: Nada de la Etapa 15.
Qué impide avanzar: Ningún bloqueo técnico; la ficha se encuentra completa a la espera de revisión por Codex.
Pregunta concreta si hace falta: Ninguna. La corrección FSM `PAID -> TableFSMState.PAID` resolvió completamente el bug sin requerir cambios en el flujo de cierre operativo.
Cambios fuera de alcance propuestos pero NO implementados: No se implementó integración con pasarelas digitales de pago ni facturación AFIP (mantenidos estrictamente fuera de alcance según la ficha).

## Handoff

CONTROL actualizado sólo para esta etapa (Etapa 15: `NEEDS_REVIEW`).
No se inició la Etapa 16.
Solicito revisión de Codex.
Prompt: «Codex, revisá la etapa 15».

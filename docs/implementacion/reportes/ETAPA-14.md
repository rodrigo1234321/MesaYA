# Reporte de etapa 14 — Validar pedidos del comensal

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Google DeepMind) para la implementación inicial; Codex (GPT-5.6 Terra) para la corrección solicitada en revisión.
Ficha: docs/implementacion/etapas/14-pedidos-invitado.md
Predecesora aprobada: 13
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: Base de trabajo de la jornada de hardening y control por etapas
Cambios previos preservados: Todas las protecciones de etapas 00 a 13 intactas (auth staff/manager, blindaje de menú, aislamiento de seeds, concurrencia FSM, separación QR/sesión, llamados/feedback con revocación inmediata en TO_CLEAN).

## Alcance realizado

- [x] Paso 1: Sesión activa centralizada en GET/add/remove/submit del comensal y aplicación de flags en servidor:
  - Implementado `OrderService.validateActiveGuestSession(token)` verificando: token no vacío/placeholder inválido (404), existencia en BD (404), expiración temporal `now > expiresAt` (410 `SESSION_EXPIRED`), sesión cerrada `closedAt !== null` o mesa en `TO_CLEAN` (410 `SESSION_CLOSED`), y turno cerrado `shift.closedAt !== null` (410 `SHIFT_CLOSED`).
  - Implementado `OrderService.getActiveOrderForGuest(token)` para `GET /v1/orders/session/:token`, resolviendo la comanda activa junto con los flags del restaurante (`allowOrdering`, `requireWaiterValidation`).
  - En `addItem` y `submitOrder`, se aplica la bandera `allowOrdering` a nivel de servidor: si `allowOrdering === false`, se rechaza de inmediato con `403 Forbidden` (`ORDERING_DISABLED`), impidiendo omitir la regla desde clientes modificados.
  - En `submitOrder`, se aplica la bandera `requireWaiterValidation`: si es `true`, la comanda pasa al estado intermedio `PENDING_VALIDATION`; si es `false`, pasa directamente a `IN_KITCHEN`.
- [x] Paso 2: Aislamiento de tenant en platos, disponibilidad, límites y cálculo en servidor:
  - En `addItem`, el plato (`menuItemId`) se resuelve consultando obligatoriamente `category: { restaurantId: session.table.restaurantId }`. Si un comensal con sesión en Restaurante A intenta ordenar un plato perteneciente a Restaurante B, se rechaza con `404 Not Found` (`ITEM_NOT_FOUND`), garantizando que jamás entre un plato ajeno a la cuenta.
  - Se valida disponibilidad de stock: si `menuItem.isAvailable === false`, se rechaza con `422 Unprocessable Entity` (`ITEM_NOT_AVAILABLE`).
  - Validación estricta de cantidad: número entero positivo mayor a cero (`Number.isInteger(qty) && qty > 0`), con límite explícito de 50 unidades por ítem (`MAX_ITEM_QUANTITY = 50`). Cantidades 0, negativas, fraccionarias o excesivas retornan `400 Bad Request`.
  - Notas de pedido restringidas a un máximo de 500 caracteres (`NOTES_TOO_LONG`).
  - **Anti-tampering absoluto de precios**: el servidor ignora completamente cualquier campo `unitPrice`, `totalAmount` o `price` enviado por el cliente en el payload; el precio unitario se toma indefectiblemente de `menuItem.price` en la base de datos y el total de la orden se calcula sumando `sum(unitPrice * quantity)` en el backend.
- [x] Paso 3: Restricción a DRAFT propio, idempotencia de envío y rechazo de estados finales:
  - En `removeItem`, se verifica que el ítem pertenezca a la orden de la sesión solicitante (404) y que `item.order.status === OrderStatus.DRAFT` (409 `ORDER_NOT_IN_DRAFT`). Una vez enviada la comanda a cocina/validación, los platos no pueden ser eliminados o manipulados por el comensal.
  - En `submitOrder`, se implementó **idempotencia total**: si el cliente envía la comanda por segunda vez (doble click o reintento de red) y no hay DRAFT pendiente pero sí una comanda activa ya enviada (`PENDING_VALIDATION`, `CONFIRMED`, `IN_KITCHEN`, etc.), el servidor devuelve la comanda existente con código 200 sin duplicar comanda ni duplicar líneas de ítems.
  - Rechazo de estados finales: no se permite re-enviar ni mutar una orden que ya haya finalizado en `PAID` o `CANCELLED`, devolviendo `409 Conflict` (`ORDER_FINAL_STATE`).
  - Se rechaza el envío de comandas vacías con `400 Bad Request` (`EMPTY_ORDER`).
- [x] Paso 4: Adaptación del cliente web y suite de pruebas:
  - En `apps/client-web/app.js`, se adaptó `loadRestaurantModuleConfig` para reflejar visualmente cuando `allowOrdering === false` (mostrando «📖 Modo Carta • Llamar al Mozo» y deshabilitando botones de carga), y se intercepta el intento de agregar platos avisando con toast y solicitando llamar al mozo.
  - Creada la suite `packages/api/test/guest-orders-validation.test.ts` con 30 pruebas HTTP reales sobre SQLite efímera, cubriendo expiración, cruce tenant A/B, cantidades inválidas (0, -1, fraccionarias, >50), manipulación de precios, idempotencia de envío, flujo de staff y confirmación del bloqueo de pagos digitales (`503 DIGITAL_PAYMENTS_UNAVAILABLE`).

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/src/services/order.service.ts` | Validador `validateActiveGuestSession`, `getActiveOrderForGuest`, aislamiento tenant en platos (`category.restaurantId`), validación de cantidades (1..50), notas <= 500 chars, anti-tampering con precios de BD, idempotencia en `submitOrder`, y rechazo de estados finales (PAID/CANCELLED) | Núcleo de validación y seguridad de pedidos del comensal |
| `packages/api/src/routes/orders.routes.ts` | Integración de `getActiveOrderForGuest` en `GET /session/:token`, propagación de códigos de error de dominio (403, 404, 409, 410, 422) en endpoints de pedidos | Contrato y códigos de respuesta HTTP de pedidos |
| `apps/client-web/app.js` | Adaptación de UI y botones según flag `allowOrdering` de la sesión activa, notificación amigable en modo carta | UX comensal coherente con flags del servidor |
| `packages/api/test/guest-orders-validation.test.ts` | Nueva suite con 30 pruebas HTTP reales (`app.inject`) con SQLite efímera que valida la totalidad de los requisitos de la etapa 14 | Evidencia automatizada de seguridad, tenant isolation e idempotencia |
| `scripts/test-isolated.mjs` | Registro de la suite `guest-orders-validation` en `allSuites` del runner aislado | Ejecución oficial en serie en el pipeline de tests |
| `docs/implementacion/CONTROL.md` | Actualización de Etapa 14 a `NEEDS_REVIEW` | Cumplimiento del protocolo de control por etapas |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs guest-orders-validation` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | SQLite aislada efímera `.tmp/qa/9b2e0ee3-58a8-4695-865d-a6a95debd1fb/test.db` | 0 | 30 tests pasaron (100%). Token inexistente 404; sesión cerrada 410; sesión expirada 410; mesa en TO_CLEAN 410; turno cerrado 410; lectura comanda activa 200; cruce tenant B->A rechazado 404 con 0 pedidos creados; plato no disponible 422; allowOrdering false 403; cantidad 0 rechazada 400; cantidad -1 rechazada 400; cantidad fraccionaria 1.5 rechazada 400; cantidad 51 rechazada 400; notas > 500 rechazada 400; precio/total manipulado ignorado y calculado con precio de BD 201; eliminación en sesión ajena 404; eliminación en DRAFT propio 200 con total recalculado; comanda vacía rechazada 400; submit con validación mozo -> PENDING_VALIDATION 200; idempotencia en re-submit confirmado (1 orden lógica, 1 ítem en BD, 200); eliminación en comanda enviada prohibida 409; submit directo a cocina (requireWaiterValidation false) -> IN_KITCHEN 200; submit sobre comanda PAID/CANCELLED rechazado 409; validación de mozo 200 con idempotencia; mozo no puede cruzar tenant 404; mozo rechaza cantidades <= 0 400; pagos digitales bloqueados 503 (claim, split, pay-part). |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Node.js build runner | 0 | Compilación exitosa de los 6 workspaces (`@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`) en 30.19s sin errores de TypeScript |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Sandboxes temporales SQLite efímeros bajo `.tmp/qa/` | 0 | 16 suites ejecutadas en serie, 16 suites pasadas (100%), 0 fallidas |
| `(Get-FileHash packages/api/prisma/dev.db).Hash` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Archivo base demo local | 0 | SHA-256: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% idéntico e intacto) |

### Extractos breves de logs

1. **Suite enfocada `guest-orders-validation` (30 tests)**:
```
✓ packages/api/test/guest-orders-validation.test.ts (30 tests) 2336ms
  ✓ 1. Validación centralizada de sesión activa para pedidos
    ✓ Rechaza consultar comanda activa con token inexistente (404)
    ✓ Rechaza consultar comanda activa con placeholder inválido (404)
    ✓ Rechaza consultar comanda activa si la sesión ya fue cerrada (410)
    ✓ Rechaza consultar comanda activa si la sesión está expirada en tiempo (410)
    ✓ Rechaza consultar comanda si la mesa se encuentra en TO_CLEAN (410)
    ✓ Rechaza consultar comanda si el turno del restaurante fue cerrado (410)
    ✓ Retorna null y los flags del restaurante para sesión activa válida sin comanda previa
  ✓ 2. Aislamiento de Tenant y Disponibilidad de Menú
    ✓ CRUCIAL: Un plato de Tenant B jamás entra en la cuenta de Tenant A (404 ITEM_NOT_FOUND)
    ✓ Rechaza agregar un plato que no está disponible (isAvailable: false) (422)
    ✓ Rechaza agregar ítems si el restaurante tiene comandas digitales desactivadas (403 ORDERING_DISABLED)
  ✓ 3. Validación estricta de Cantidades y Límite Explícito
    ✓ Rechaza cantidad 0 (400 INVALID_QUANTITY)
    ✓ Rechaza cantidad negativa -1 (400 INVALID_QUANTITY)
    ✓ Rechaza cantidad fraccionaria 1.5 (400 INVALID_QUANTITY)
    ✓ Rechaza cantidad mayor al límite permitido de 50 unidades (400 QUANTITY_LIMIT_EXCEEDED)
    ✓ Rechaza notas que superen 500 caracteres (400 NOTES_TOO_LONG)
  ✓ 4. Anti-tampering de Precios y Totales Calculados en Servidor
    ✓ Ignora precio y total manipulados enviados por el cliente y usa el valor de BD
  ✓ 5. Restricción de Modificación a DRAFT Propio y Eliminación
    ✓ Rechaza eliminar ítem inexistente o perteneciente a otra sesión (404)
    ✓ Permite eliminar un ítem de DRAFT propio y recalcula el total correctamente
  ✓ 6. Envío de Comanda, Flags e Idempotencia (Doble Envío)
    ✓ Rechaza enviar comanda vacía sin ítems (400 EMPTY_ORDER)
    ✓ Con requireWaiterValidation: true, submitOrder pasa a PENDING_VALIDATION
    ✓ IDEMPOTENCIA: Doble envío devuelve la misma comanda sin duplicar líneas ni pedidos
    ✓ Prohíbe modificar o eliminar ítems de una comanda ya enviada (409 ORDER_NOT_IN_DRAFT)
    ✓ Con requireWaiterValidation: false (Tenant D), submitOrder pasa directamente a IN_KITCHEN
    ✓ Rechaza submit de orden en estado final (PAID o CANCELLED) (409 ORDER_FINAL_STATE)
  ✓ 7. Acciones de Staff (Validación y Agregado de Ítems)
    ✓ Staff valida comanda en PENDING_VALIDATION y pasa a IN_KITCHEN
    ✓ Staff no puede agregar plato de Tenant B a mesa de Tenant A (404 ITEM_NOT_FOUND)
    ✓ Staff rechaza cantidades inválidas (0 o negativas) al cargar ítems (400)
  ✓ 8. Bloqueo de Pagos Digitales (Piloto Presencial)
    ✓ POST /v1/orders/items/claim retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE
    ✓ POST /v1/orders/:id/split-session retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE
    ✓ POST /v1/orders/split-session/:id/pay-part retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE
```

2. **Runner Monorepo (`test-isolated.mjs` - 16 suites)**:
```
=============================================================
🔍 VERIFICACIÓN DE INTEGRIDAD DE LA BASE DEMO
🛡️ dev.db permanece 100% INTACTA. Hash: 499c2f9cd68d2207...

📊 RESUMEN DEL TEST RUNNER:
• Total suites ejecutadas: 16
• Suites exitosas: 16
• Suites fallidas: 0

🎉 Todas las suites aisladas pasaron exitosamente sin tocar datos de demo.
```

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Un plato de B jamás entra en cuenta A | PASS | Test ejecutado con HTTP real: comensal con sesión de Tenant A intenta agregar plato de Tenant B -> `404 Not Found` (`ITEM_NOT_FOUND`). Verificado en BD que no se crea comanda ni ítem. |
| No hay totales negativos ni modificación de pedido ya enviado | PASS | Test ejecutado: intentos de inyectar precios negativos son descartados y el servidor calcula el total sobre `menuItem.price` de BD (`totalAmount > 0`). Intentar eliminar ítems de una comanda en `PENDING_VALIDATION` o `IN_KITCHEN` es rechazado con `409 Conflict` (`ORDER_NOT_IN_DRAFT`). |
| Enviar dos veces conserva una sola comanda lógica; pago digital sigue bloqueado | PASS | Test ejecutado: doble envío inmediato de comanda devuelve la comanda existente (código 200) y la BD conserva exactamente 1 orden y 1 sola línea de ítem. Endpoints `/claim`, `/:id/split-session` y `/split-session/:id/pay-part` devuelven `503 DIGITAL_PAYMENTS_UNAVAILABLE`. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Reporte formal completado siguiendo la plantilla oficial. Todos los tests reportados fueron ejecutados con SQLite efímera en memoria/disco temporal. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión | PASS | `node scripts/build.mjs` exit 0 (30.19s). `node scripts/test-isolated.mjs` exit 0 (16/16 suites aprobadas). No se modificó ningún test existente para eludir fallos. |

## Integridad y seguridad

- **Base demo intacta**: SHA-256 verificado `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- **Cruce tenant A/B**: Comprobado de forma cruzada tanto para comensales (`POST /v1/orders/items` -> 404) como para personal (`POST /v1/staff/tables/:tableId/orders/items` -> 404).
- **Rechazo sin escrituras**: Todos los casos de error (tenant ajeno, sesión cerrada, plato no disponible, cantidades inválidas) no crean registros de órdenes ni de ítems en la base de datos.
- **Build**: Compilación limpia en TypeScript de los 6 workspaces sin diagnósticos de error.
- **Migración/paridad**: No se requirió alteración de schema ni migración de base de datos; los modelos existentes en Prisma satisfacen de forma completa los requisitos del dominio.
- **Ausencia de secretos en diff/logs**: Sin credenciales, tokens estáticos ni datos de producción en repositorios ni logs.

## Corrección posterior de Codex

Se cerró la observación de `docs/implementacion/revisiones/ETAPA-14.md` sin ampliar el alcance de la etapa:

- `OrderService.validateActiveGuestSession` ahora requiere que la relación `session.shift` exista, que su `closedAt` sea `null` y que su `restaurantId` coincida con el restaurante de `session.table`.
- Cualquier incumplimiento se rechaza con `410` antes de consultar o mutar comandas. Se conserva `SHIFT_CLOSED` para un turno cerrado y se usa `SHIFT_INACTIVE` para un turno inexistente o de otro restaurante.
- La prueba HTTP SQLite real agrega dos regresiones: sesión con `shiftId: null` y sesión de mesa A vinculada a turno abierto de restaurante B. En ambos casos, `GET /v1/orders/session/:token` y `POST /v1/orders/items` devuelven `410`; las aserciones ORM confirman cero `Order` y cero `OrderItem` para la sesión.

### Evidencia ejecutada por Codex

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado |
|---|---|---:|---|
| `$env:MESAYA_BOUNDED_JOB = '1'; node scripts/test-isolated.mjs guest-orders-validation` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | SQLite efímera bajo `.tmp/qa/` | 0 | 32/32 pruebas pasadas; incluye ausencia de turno y turno de otro restaurante, con rechazo 410 y cero escrituras. |
| `$env:MESAYA_BOUNDED_JOB = '1'; node scripts/build.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Build ordenado de seis workspaces | 0 | Build completo aprobado. |
| `$env:MESAYA_BOUNDED_JOB = '1'; node scripts/test-isolated.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | SQLite efímera por suite bajo `.tmp/qa/` | 0 | 16/16 suites pasadas. |
| `Get-FileHash -Algorithm SHA256 packages/api/prisma/dev.db` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Base demo local | 0 | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`, igual al hash previo y al posterior a las pruebas. |

## Pendientes, riesgos y decisiones

- **Decisiones tomadas**:
  1. *Idempotencia de submit*: Se garantizó que un re-envío no falle ni cree órdenes huérfanas, devolviendo la comanda activa existente con estado 200.
  2. *Cálculo estricto en servidor*: Todo parámetro monetario proveniente del cliente es ignorado; `unitPrice` y `totalAmount` provienen 100% de la entidad de menú en base de datos.
  3. *Límite superior*: Se estableció un tope de seguridad de 50 unidades por ítem para prevenir desbordes y spam en cocina.
- **Qué falta**: Revisión y aprobación de la corrección posterior.
- **Qué impide avanzar**: Esperar aprobación de Codex conforme al protocolo antes de iniciar la Etapa 15.
- **Cambios fuera de alcance propuestos pero NO implementados**: No se implementaron flujos de delivery, preorden ni pasarelas de pago reales (se preservó el bloqueo 503).

## Handoff

- `docs/implementacion/CONTROL.md` actualizado con Etapa 14 en `NEEDS_REVIEW`.
- No se inició la siguiente ficha (Etapa 15).
- Solicito revisión de Codex con el prompt:
  > «Codex, revisá la etapa 14».

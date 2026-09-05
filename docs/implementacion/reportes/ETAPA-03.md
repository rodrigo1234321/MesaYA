# Reporte de etapa 03 — Desactivar pagos y split simulados

Estado: NEEDS_REVIEW  
Fecha: 2026-09-03  
Ejecutor y modelo realmente usado: Antigravity / Gemini 3.8 Flash (High)  
Ficha: docs/implementacion/etapas/03-pagos-bloqueados.md  
Predecesora aprobada: Etapa 02 — Restaurar build y contratos compartidos (APPROVED, dictamen en `docs/implementacion/revisiones/ETAPA-02.md`)  
Ruta del proyecto: C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas  
Commit de base o manifiesto: `docs/implementacion/evidencia/00-baseline.json` (223 archivos SHA-256)  
Cambios previos preservados: Todos los archivos de las etapas 00, 01 y 02 se mantuvieron intactos. El harness de tests aislados, el guard centinela, el script de build determinístico (`scripts/build.mjs`) y la base demo persistente `dev.db` se conservaron sin alteraciones.

---

## Alcance realizado

- [x] **Paso 1 — Identificación de todas las entradas al módulo de pagos y split simulados**:
  - Se inspeccionaron todas las rutas y servicios del backend en búsqueda de escrituras de `APPROVED`, `PAID`, `PaymentTransaction` y `SplitBillSession`.
  - Se identificaron 3 endpoints públicos/comensales en `packages/api/src/routes/orders.routes.ts`:
    1. `POST /v1/orders/items/claim` (reclamo de ítems individuales para división de cuenta).
    2. `POST /v1/orders/:id/split-session` (apertura o consulta de sesión de split bill en partes o ítems).
    3. `POST /v1/orders/split-session/:id/pay-part` (simulación de pago de partes con escritura de `PaymentTransaction` en `APPROVED` y transición de orden a `PAID`).
  - Se constató que la única escritura de `PaymentTransaction` en todo el repositorio ocurría en `OrderService.payEqualPart`.
  - Se diferenció la futura confirmación física/operativa del personal (`fsmService` con `TableFSMState.PAID`) de las transacciones digitales simuladas.
- [x] **Paso 2 — Bloqueo estricto en backend con 503 y `DIGITAL_PAYMENTS_UNAVAILABLE`**:
  - En `packages/api/src/services/order.service.ts`, se declaró y exportó la clase `DigitalPaymentsUnavailableError` (con `statusCode: 503` y `code: 'DIGITAL_PAYMENTS_UNAVAILABLE'`).
  - Los métodos `claimItemOptimistic`, `createOrGetSplitSession` y `payEqualPart` ahora arrojan incondicionalmente `DigitalPaymentsUnavailableError()`.
  - Se verificó que ninguna configuración de restaurante (`allowSplitBill: true` o `false`) pueda saltar o puentear este bloqueo.
  - La lógica pre-piloto fue documentada y preservada intacta en comentarios para su futura reintegración formal con pasarelas reales, sin borrar historial ni alterar tablas existentes.
  - En `packages/api/src/routes/orders.routes.ts`, los 3 endpoints rechazan de forma inmediata con status `503` y payload `{ error: 'Pagos digitales y división de cuenta no disponibles en el piloto presencial', code: 'DIGITAL_PAYMENTS_UNAVAILABLE' }`.
- [x] **Paso 3 — Ajuste del comensal en client-web y preservación del pedido de cuenta**:
  - En `apps/client-web/index.html`, en el modal de cuenta (`#modalBill`), se incorporó un aviso visible y explícito de que el cobro es presencial en mesa o caja, aclarando que los pagos digitales directos y la división de cuenta están desactivados durante el piloto.
  - Los botones de medios de pago conservan la solicitud de comprobante y aviso al mozo (`Mercado Pago QR Presencial traído por el mozo`, `Tarjeta Débito/Crédito con terminal Posnet traída por el mozo`, `Efectivo en mesa o caja`).
  - En `apps/client-web/app.js`, se añadió el manejo del error `503` / `DIGITAL_PAYMENTS_UNAVAILABLE` en `sendCall`, mostrando toast de advertencia claro.
  - Se confirmó que el comensal puede pedir la cuenta (`CallType.BILL`) normalmente sin mostrar en ningún momento falso éxito de transacción digital.
- [x] **Paso 4 — Reemplazo de assertions y pruebas de contención en suite aislada**:
  - En `packages/api/test/full-system-e2e.test.ts`, se agregó la sección `6.1 Digital Payments & Split Bill Containment (Pilot Mode)` con 5 pruebas exhaustivas:
    1. `POST /v1/orders/:id/split-session` es rechazado con 503 y `DIGITAL_PAYMENTS_UNAVAILABLE` incluso forzando `allowSplitBill=true` en DB; cero registros creados en `SplitBillSession`.
    2. `POST /v1/orders/items/claim` es rechazado con 503 y `DIGITAL_PAYMENTS_UNAVAILABLE`; el ítem permanece con `claimedByGuest === null`.
    3. `POST /v1/orders/split-session/:id/pay-part` es rechazado con 503 y `DIGITAL_PAYMENTS_UNAVAILABLE` tanto con sesión anónima como con token de sesión en headers.
    4. Repetición de `pay-part` 3 veces verifica que el contador de `PaymentTransaction` permanece inalterado (cero escrituras), no hay descalce de saldo y el estado de la orden nunca pasa a `PAID`.
    5. Solicitud de cuenta comensal (`CallType.BILL`) crea el llamado para el personal con 201 Created sin transacciones digitales ni falso estado de orden pagada.
  - Se actualizaron los scripts legacy de prueba (`packages/api/test-modules-v3.ts` y `scripts/test_waiter_shift_full.ts`) para validar el rechazo seguro 503 en lugar de esperar pagos simulados.
- [x] **Paso 5 — Build completo y runner aislado**:
  - Se ejecutó `npm run build` verificando compilación de los 6 workspaces en 31.86s con exit code 0.
  - Se ejecutó `npm run test:isolated` verificando las 4 suites en serie con 78 tests en verde (100% PASS), exit code 0 y base `dev.db` intacta.

---

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/src/services/order.service.ts` | Modificación | Exportación de `DigitalPaymentsUnavailableError` y bloqueo incondicional de `claimItemOptimistic`, `createOrGetSplitSession` y `payEqualPart` con 503 y `DIGITAL_PAYMENTS_UNAVAILABLE`. Preservación de lógica pre-piloto en comentarios. |
| `packages/api/src/routes/orders.routes.ts` | Modificación | Rechazo directo de `/orders/items/claim`, `/orders/:id/split-session` y `/orders/split-session/:id/pay-part` con HTTP 503 y error code `DIGITAL_PAYMENTS_UNAVAILABLE`. |
| `apps/client-web/index.html` | Modificación | Mensaje informativo en `#modalBill` aclarando cobro presencial en mesa o caja y medios físicos que lleva el mozo. |
| `apps/client-web/app.js` | Modificación | Manejo de respuesta 503 / `DIGITAL_PAYMENTS_UNAVAILABLE` en llamadas al backend. |
| `packages/api/test/full-system-e2e.test.ts` | Modificación | Incorporación de la sección 6.1 con 5 pruebas de aceptación de contención de pagos y split en piloto presencial. |
| `packages/api/test-modules-v3.ts` | Modificación | Actualización de expectations de split session y pay-part a 503 `DIGITAL_PAYMENTS_UNAVAILABLE`. |
| `scripts/test_waiter_shift_full.ts` | Modificación | Actualización de verificación de split bill en turno para esperar 503 `DIGITAL_PAYMENTS_UNAVAILABLE`. |
| `docs/implementacion/CONTROL.md` | Modificación | Actualización del estado de Etapa 03 a `NEEDS_REVIEW`. |

---

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `npm run build` (cwd: `.../mdpmesasvivas`) | Todos los 6 workspaces del monorepo | 0 | **Build completo exitoso en 31.86s**:<br>• `[1/6]` `@mesaya/shared`: tsc OK (1.34s)<br>• `[2/6]` `@mesaya/api`: prisma generate + tsc OK (5.81s)<br>• `[3/6]` `@mesaya/client-web`: vite build OK (2.16s)<br>• `[4/6]` `@mesaya/staff-panel`: tsc + vite build OK (8.40s)<br>• `[5/6]` `@mesaya/admin-dashboard`: tsc + vite build OK (11.01s)<br>• `[6/6]` `@mesaya/qr-generator`: tsc --noEmit OK (3.14s) |
| `npm run test:isolated` (cwd: `.../mdpmesasvivas`) | SQLite efímera por suite en `.tmp/qa/<uuid>` | 0 | **4 suites PASSED en serie (78 tests en total, 0 fallos):**<br>• `seed-guard`: 18 passed (58ms)<br>• `system-lifecycle`: 9 passed (135ms)<br>• `rtms-fsm-analytics`: 12 passed (692ms)<br>• `full-system-e2e`: 39 passed (2882ms, incluyendo 5 nuevos tests de contención de pagos)<br>• Exit code: 0<br>• Hash `dev.db`: `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff` 100% intacto. |
| `Get-FileHash packages/api/prisma/dev.db -Algorithm SHA256` | Base demo persistente | 0 | SHA-256: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (coincidencia binaria exacta contra línea base). |

---

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Con o sin token, repetir pay-part nunca crea PaymentTransaction ni cambia saldo/estado | PASS | `full-system-e2e.test.ts`: test ejecutado con 3 invocaciones sucesivas con/sin token; el conteo de `prisma.paymentTransaction.count()` se mantiene idéntico antes y después, y el estado/monto de la orden no se altera. |
| allowSplitBill=true no habilita el pago ni las claims bloqueadas | PASS | `full-system-e2e.test.ts`: con `allowSplitBill: true` explícito en `restaurantModuleConfig`, `/orders/:id/split-session` y `/orders/items/claim` responden 503 `DIGITAL_PAYMENTS_UNAVAILABLE`. Cero sesiones de split creadas y cero ítems reclamados. |
| Cliente permite pedir la cuenta y no muestra éxito de pago inexistente | PASS | `full-system-e2e.test.ts`: `POST /v1/calls` con `CallType.BILL` responde 201 PENDING sin marcar orden como pagada. En `client-web`, modal `#modalBill` indica cobro presencial en mesa/caja y toast notifica envío de pedido de cuenta al mozo. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Registro fiel de comandos ejecutados, tests aislados verificados, diffs estáticos sin tokens, contraseñas ni datos sensibles. |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión | PASS | Compilación limpia de los 6 workspaces (exit 0) y ejecución de 78 tests aislados (73 preexistentes + 5 de contención) con exit code 0. Cero tests suprimidos o relajados. |

---

## Integridad y seguridad

- **Base demo intacta**: SHA-256 verificado: `499c2f9cd68d22079429d87fea17ddc503f98069097637b22d4365c043148cff` permanece 100% idéntico.
- **Cruce tenant A/B**: El bloqueo a 503 opera a nivel de endpoint/servicio y no filtra transacciones de ningún restaurante.
- **Rechazo sin escrituras**: Validado en base de datos mediante queries antes y después de los intentos de llamada HTTP: `count` de `paymentTransaction` y `splitBillSession` no aumenta y registros permanecen inmutables.
- **Build**: Compilación limpia en 6 workspaces sin errores de tipado TypeScript ni dependencias rotas.
- **Migración/paridad**: No se modificó el schema Prisma ni se borraron columnas/tablas históricas (`PaymentTransaction` y `SplitBillSession` conservan su estructura de datos intacta).
- **Ausencia de secretos en diff/logs**: Verificado; no se expusieron claves, tokens ni configuraciones privadas.

---

## Pendientes, riesgos y decisiones

- **Qué falta**: Nada en Etapa 03. Checklist y criterios completados al 100%.
- **Qué impide avanzar**: Parada obligatoria conforme al protocolo para someter el trabajo a revisión técnica de Codex.
- **Decisiones técnicas registradas**:
  - Se implementó doble barrera: tanto el enrutador Fastify en `orders.routes.ts` como la capa de servicios en `order.service.ts` rechazan con 503 y `code: 'DIGITAL_PAYMENTS_UNAVAILABLE'`.
  - Se mantuvo intacto el código pre-piloto comentado en `order.service.ts` bajo la sección «HISTORIAL / LÓGICA PRE-PILOTO» para cuando se decida integrar una pasarela real post-piloto, respetando la regla «No borrar historial».

---

## Handoff

- `docs/implementacion/CONTROL.md` actualizado: Etapa 03 pasa a `NEEDS_REVIEW`.
- Etapa 04 permanece en estado `BLOCKED`.
- No se inició la siguiente ficha.
- Solicito revisión de Codex.

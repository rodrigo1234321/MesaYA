# E17 — Diagnóstico: carrito cliente y doble acción

Fecha de cierre local: 2026-09-15. La versión de sesión usada por el cliente
es `currentSession.expiresAt`, porque el endpoint actual expone esa versión
estable pero no el `tableSessionId`; no se usa el token como clave de
almacenamiento.

## Defecto confirmado por lectura (antes del cambio)

1. **D1 — `addDishToCart` sin mutex y con retry automático (CONFIRMADO).**
   El handler de `btnOrderSpecificDish` llamaba a `addDishToCart`, que hacía
   `fetchWithRetry(url, opts)` con defaults `(retries=2, timeoutMs=3000)` sin
   ningún bloqueo lógico. Un doble clic (o un tap + re-tap en 800 ms–2 s de
   latencia) emitía dos `POST /orders/items`. El backend no tiene clave de
   idempotencia para `/orders/items` (verificado en
   `packages/api/src/services/order.service.ts::addItem`, sin `submitReceipt`
   ni clave): dos POST = dos líneas. El `disabled` visual del botón de envío
   no cubría el botón del plato.
2. **D2 — `removeCartItem` con retry automático y sin mutex por ítem (CONFIRMADO).**
   `DELETE /orders/items/:id` también iba por `fetchWithRetry` con 2 intentos:
   tras un commit con respuesta perdida, el reintento ciego podía chocar con
   el estado ya mutado (404/409 confusos) y el doble clic emitía dos DELETE.
3. **D3 — `submitCart` con retry automático general (CONFIRMADO).**
   Tenía mutex (`isCartSubmitting`) y clave de idempotencia, pero usaba el
   retry general. El reintento no duplica por la clave pineada (SubmitReceipt),
   pero oscurece el diagnóstico y contradice la intención histórica
   `(1, 10000)`.
4. **D4 — clave auxiliar ligada al token crudo (CONFIRMADO).**
   `getCartSubmitStorageKey()` usaba `currentToken.slice(0,16)` como parte del
   nombre en `sessionStorage`: token crudo como identificador de
   almacenamiento, contra el requisito de ligar la clave a
   restaurante/mesa/sesión/versión u orden. La corrección usa slug, mesa,
   versión de sesión y orden, sin guardar el token.
5. **D5 — promesa falsa en offline (CONFIRMADO).**
   El `catch` de agregar decía `Reintentá; no se duplicó`: falso sin mecanismo
   que lo garantice para `/orders/items`.
6. **D6 — sin reseteo de la acción del plato (CONFIRMADO).**
   Tras un agregado exitoso no se reseteaba cantidad/botón (intención de
   `4c8d02f` no portada): la acción quedaba en estado ambiguo para la próxima
   unidad intencional.
7. **D7 — expiración sólo visible en el camino inicial (CONFIRMADO).**
   La sincronización del carrito podía recibir `410` sin invalidar el estado
   auxiliar. Agregar, quitar, enviar y `loadActiveOrder` ahora convergen en
   `showExpiredState`, que limpia sesión, claves y borrador local.

## Decisión

- Sólo cliente (`apps/client-web/app.js` + 2 líneas accesibles en
  `index.html`) y test focal nuevo. **Backend sin cambios**: la idempotencia
  de `/orders/submit` (SubmitReceipt pineado, replay tras borrador nuevo,
  409/410 accionables) ya existe y está cubierta por B06; no se inventa clave
  para `/orders/items` porque el backend no la soporta.
- Mutaciones del carrito en **una sola tentativa** vía `fetchMutationOnce`
  (timeout 10000). Los GET conservan `fetchWithRetry`.
- Ante red perdida post-commit no hay retry ciego: se reconcilia con el
  servidor (`loadActiveOrder`) y se pide verificación antes de reintentar.
  La única recuperación automática con reintento es el envío con la MISMA
  clave de idempotencia (contractual, B06).
- El borrador siempre se recarga desde el servidor; no hay snapshot local que
  sumar ni restaurar. `guestName` (sessionStorage), historial y cuenta se
  preservan desde la respuesta de la API.

## Ventanas cubiertas

- Segundo clic durante envío → ignorado por mutex (`dishAddInFlight`,
  `cartRemoveInFlight`, `isCartSubmitting`); botón restaurado en `finally`.
- Nueva unidad tras éxito → permitida (mutex liberado + cantidad reseteada a 1).
- Offline tras commit → sin retry ciego, mensaje accionable + reconciliación.
- Agotado/precio → 422/409 accionables al agregar; `PENDING_VALIDATION` con
  motivo persistido al enviar; precio = snapshot al agregar.
- Dos teléfonos → un borrador, líneas con `guestName`, 409 `DRAFT_CONFLICT`
  accionable ante carrera.
- Cambio de mesa/sesión o sesión vencida → `invalidateCartSubmitState()`, sin
  restaurar pedidos viejos. La sesión se distingue por la versión entregada
  en `expiresAt`, además de restaurante y mesa.

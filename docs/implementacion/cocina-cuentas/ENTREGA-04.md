# ENTREGA-04 — Etapa 04: Backend de pedidos directo/validado, tandas, participantes y alérgenos

Estado: VERIFIED_PASS
Fecha: 2026-09-05
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 04) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Base: etapa 01 aprobada (`81faaa2`), etapa 02 aprobada (`ca57b99`), etapa 03 aprobada (`2f8c578`).
Alcance: Backend de pedidos móvil, participantes de visita con hashing SHA-256 de tokens, tandas independientes (`OrderTanda`), idempotencia estricta, resolución autoritativa de precios en centavos y snapshots inmutables en servidor, arbitraje de modos (`DIRECT_KITCHEN` vs `WAITER_VALIDATED`), detección de alérgenos forzando validación humana, prevención de regresión de mesa pagada (`PAID`), revocación atómica de participantes en cierre de sesión/mesa/turno y gates de calidad sin regresiones.

---

## Archivos modificados y creados

1. `packages/shared/src/rtms-types.ts`:
   - DTOs canónicos agregados: `VisitParticipantDTO`, `JoinParticipantDTO`, `JoinParticipantResponseDTO`, `SubmitTandaItemDTO`, `SubmitTandaDTO`, `OrderTandaDTO`.
2. `packages/api/src/services/order.service.ts`:
   - Implementación de `formatOrderTandaDTO` y `hashParticipantToken`.
   - `joinParticipant(sessionToken, rawDisplayName)`: valida sesión activa, sanitiza nombre (1..60 sin caracteres de control), genera token opaco de 24 bytes base64url y almacena exclusivamente su hash SHA-256 en base de datos.
   - `validateParticipant(sessionToken, participantToken)`: verifica token hash, coincidencia de `tableSessionId` y estado `ACTIVE`.
   - `getTandasForSession(sessionToken)`: lista tandas ordenadas por secuencia `seq` ascendente con ítems y autor de visita.
   - `submitTanda(input)`:
     - Validación de clave de idempotencia (`assertValidIdempotencyKey`).
     - Verificación de mesa: rechazo con 409 `TABLE_ALREADY_PAID` si la mesa ya se encuentra pagada (impide regresar una mesa pagada o cerrada a cocina).
     - Validación de flag `allowOrdering !== false` (403 `ORDERING_DISABLED` en modo carta informativa).
     - Comprobación de idempotencia estricta: si ya existe la tanda con esa clave, valida coincidencia de sesión, autor y cantidad de ítems; retorna la tanda existente sin duplicar líneas ni mutar secuencia; clave reutilizada con carga distinta devuelve 409 `IDEMPOTENCY_CONFLICT`.
     - Detección de alérgenos: regex estricta sobre notas de tanda e ítems (`/(alerg|celiac|tacc|mani|maní|marisc|intoleran|gluten|sin tacc)/i`).
     - Resolución autoritativa de precios en servidor: busca cada `MenuItem` por tenant, verifica `isAvailable: true` (409 `ITEM_UNAVAILABLE` si está agotado), valida `modifiersSnapshot` mediante `validateModifierSnapshot`, suma deltas en centavos enteros y calcula snapshot inmutable de nombre, versión y `lineTotalCents`.
     - Arbitraje de modo: si `requireWaiterValidation === false && !hasAllergy` pasa directo a `IN_KITCHEN`; si `requireWaiterValidation === true` o se detecta alergia, pasa a `CONFIRMED` requiriendo validación humana.
     - Transacción atómica: cálculo de `seq = max(seq) + 1`, creación de `OrderTanda` y `OrderItem` vinculados a la orden unificada de mesa, deduplicación atómica de `CallRequest` para el mozo, y transición FSM sin regresión en salón.
     - Emisión de eventos SSE/WebSocket vía `eventBus.broadcast` (`tanda.created`, `order.updated`).
3. `packages/api/src/services/session.service.ts`:
   - Revocación atómica de participantes (`status: 'REVOKED'`, `revokedAt: now`) en `closeTableSession` y `createNewSessionForTable`.
4. `packages/api/src/services/shift.service.ts`:
   - Revocación atómica de participantes en `closeShift`.
5. `packages/api/src/services/fsm.service.ts`:
   - Revocación atómica de participantes cuando la mesa transiciona a `TO_CLEAN` o `AVAILABLE`.
6. `packages/api/src/routes/orders.routes.ts`:
   - `POST /v1/orders/participants/join`: endpoint para unirse a la mesa con validación de sesión activa.
   - `POST /v1/orders/tandas`: endpoint de envío y confirmación de tanda con idempotencia.
   - `GET /v1/orders/tandas`: endpoint para consultar todas las tandas de la sesión.
7. `scripts/route-matrix.json`:
   - Registro y clasificación de las 3 rutas nuevas (`ANON`, protegidas por `sessionToken` y `participantToken`). Total exacto: 79 rutas.
8. `scripts/test-isolated.mjs`:
   - Incorporación de las suites `cocina-cuentas-etapa-01`, `cocina-cuentas-etapa-02`, `cocina-cuentas-etapa-03` y `cocina-cuentas-etapa-04` a la lista `allSuites`.
9. `packages/api/test/cocina-cuentas-etapa-04.test.ts` (nueva):
   - Suite con 11 tests automatizados que cubren el ciclo completo de vida de participantes y tandas.

---

## Verificaciones ejecutadas y evidencia

1. **Matriz de Rutas**:
   - `Check.ps1 -Check routes` -> EXIT CODE 0.
   - 79 rutas descubiertas y clasificadas, 0 derivas, 0 sin clasificar.

2. **Paridad de Esquema**:
   - `Check.ps1 -Check schema` -> EXIT CODE 0.
   - Esquemas SQLite y Supabase/PostgreSQL idénticos en paridad.

3. **Compilación de Workspaces (Build)**:
   - `Check.ps1 -Check build` -> EXIT CODE 0.
   - Compilación limpia de los 6 workspaces (`@mesaya/shared`, `@mesaya/api`, `@mesaya/admin-dashboard`, `@mesaya/staff-panel`, `@mesaya/client-web`, `hardware/qr-generator`).

4. **Compilación PostgreSQL (Build PG)**:
   - `Check.ps1 -Check build-pg` -> EXIT CODE 0.
   - Generación de cliente Postgres y chequeo TypeScript sin errores.

5. **Suite de Pruebas Aisladas**:
   - `Check.ps1 -Check suite -Suite cocina-cuentas-etapa-04` -> EXIT CODE 0 (11/11 tests PASS).
   - `Check.ps1 -Check suite` (Regresión completa) -> EXIT CODE 0 (34/34 suites PASS, 0 fallidas).

---

## Siguiente etapa

- **Etapa 05 (Comensal)**: Flujo de UI en `apps/client-web`: selector de productos con customizer de modificadores (snapshots versionados), carrito colaborativo con autoría visible por participante, botones de acción según modo del local ("Enviar a Cocina" vs "Pedir al Mozo"), seguimiento de tandas en tiempo real, manejo de errores de stock/idempotencia y sin precios autoritativos en cliente.

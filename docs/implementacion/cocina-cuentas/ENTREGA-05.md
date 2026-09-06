# ENTREGA-05 — Etapa 05: Comensal Web, Carrito Borrador, Autoría y Seguimiento de Tandas

Estado: VERIFIED_PASS
Fecha: 2026-09-05
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 05) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Base: etapa 01 aprobada (`81faaa2`), etapa 02 aprobada (`ca57b99`), etapa 03 aprobada (`2f8c578`), etapa 04 aprobada (`b2e0245`).
Alcance: Experiencia del comensal móvil en `apps/client-web`: identificación de participante de visita, selector de cantidades y notas en ficha de plato, carrito borrador aislado por participante, barra flotante de comanda, drawer nativo con tabs de borrador y seguimiento de tandas, neutralización de XSS sin interpolación innerHTML, sin precios autoritativos dictados por cliente, y adaptación a los modos operativos del restaurante (`DIRECT_KITCHEN`, `WAITER_VALIDATED`, `allowOrdering: false`).

---

## Archivos modificados y creados

1. `apps/client-web/index.html`:
   - Header: botón `#btnParticipantBadge` con etiqueta `#participantDisplayNameText` para mostrar el nombre del comensal o "Unirme" en la mesa.
   - Ficha de detalle de plato (`#dishDetailSheetBackdrop`): selectores de cantidad (`#btnDishQtyMinus`, `#dishSheetQty`, `#btnDishQtyPlus`), campo para notas/alergias (`#dishSheetNotes`), botón primario para agregar a tanda (`#btnAddToTanda`) y botón secundario de llamado presencial (`#btnOrderSpecificDish`).
   - Barra flotante de carrito (`#floatingCartBar`): componente flotante en viewport inferior con insignia de cantidad (`#cartItemCountBadge`), autor del pedido (`#cartAuthorSubtitle`), total estimado (`#cartEstimatedTotal`) y botón de apertura.
   - Botón de acceso al carrito desde el pie de la carta modal (`#btnOpenCartFromMenu`) con contador en tiempo real (`#menuCartCountBadge`).
   - Drawer nativo de comanda (`#modalCartSheet`):
     - Encabezado y navegación de tabs: Tab 1 "Mi Pedido (Borrador)" (`#tabCartDraftBtn`) y Tab 2 "Tandas de Mesa" (`#tabTandasTrackingBtn`).
     - Vista de Borrador (`#viewCartDraft`): tarjeta de autor del comensal con acción de cambiar nombre, contenedor dinámico de ítems (`#cartDraftItemsContainer`), aviso de borrador vacío (`#cartDraftEmptyNotice`), campo de notas generales para cocina (`#inputTandaNotes`), total estimado y botón primario de confirmación (`#btnSubmitTanda`).
     - Vista de Seguimiento (`#viewTandasTracking`): encabezado con botón de actualización (`#btnRefreshTandas`), contenedor dinámico de historial (`#tandasTrackingListContainer`) y aviso de sin tandas (`#tandasTrackingEmptyNotice`).
   - Modal de Registro de Participante (`#modalParticipant`): campo de texto seguro (`#inputParticipantName`), botón de guardado (`#btnSaveParticipant`) y botón de cierre (`#btnCloseModalParticipant`).

2. `apps/client-web/app.js`:
   - Mapeo de elementos del DOM en el objeto central `el`.
   - Gestión de identidad de participante:
     - `initParticipantSession`: recupera credenciales locales desde `sessionStorage` (`mesaya_participant_<token>`).
     - `updateParticipantUI`: sincroniza badges del header, autor del carrito y estado de identificación.
     - `openParticipantModal` / `closeParticipantModal`: apertura y cierre con autoenfoque y bloqueo de scroll.
     - `handleSaveParticipant`: validación de nombre (1 a 40 caracteres), consumo de `POST /v1/orders/participants/join`, persistencia de `participantToken`, `participantId` y `displayName`, y actualización de sesión.
   - Gestión de Carrito Borrador:
     - `loadDraftCart`: carga ítems locales aislados por mesa y participante (`mesaya_draft_cart_<token>_<participantId>`).
     - `saveDraftCart`: persistencia de borrador y actualización de insignias.
     - `updateCartBadges`: cálculo de totales estimados y visualización de la barra flotante.
     - `addToDraftCart`: deduplicación por `id` y `notes`, incremento de cantidades y toast de confirmación.
     - `updateDraftCartItemQty` y `removeFromDraftCart`: manipulación granular de cantidades y eliminación.
     - `renderCartDraft`: renderizado seguro con nodos DOM y `textContent` (sin interpolación en `innerHTML`).
   - Confirmación y Envío de Tanda:
     - `submitCurrentTanda`: validaciones de comensal identificado, bloqueo en modo carta informativa, generación de clave de idempotencia única (`tanda_<participantId>_<timestamp>_<random>`), envío de payload limpio `{ sessionToken, participantToken, idempotencyKey, items: [{ menuItemId, quantity, notes }], notes }` sin dictar precios desde el cliente.
     - Manejo exhaustivo de códigos de error de negocio: 409 `ITEM_UNAVAILABLE`, 409 `TABLE_ALREADY_PAID`, 403 `ORDERING_DISABLED` y resiliencia ante cortes de red conservando el borrador para reintento.
     - Limpieza automática del borrador al confirmar y transición fluida a la pestaña de seguimiento de tandas.
   - Seguimiento en Vivo de Tandas:
     - `fetchAndRenderTandas`: consumo de `GET /v1/orders/tandas` con cabecera de sesión.
     - Mapeo visual de estados FSM: `CONFIRMED` (Esperando al Mozo), `IN_KITCHEN` (En Cocina), `PREPARING` (En Preparación), `READY` (Listo para Servir), `SERVED` (Servido en Mesa), `REJECTED` (Rechazado con motivo visible) y `CANCELLED` (Cancelado).
     - Renderizado protegido con `textContent` para autores, nombres de platos snapshots, notas y motivos de rechazo.
     - Polling inteligente cada 7 segundos mientras el drawer de tandas está activo (`startTandasPolling` / `stopTandasPolling`).
   - Gestos y UX móvil:
     - Habilitación de Swipe-Down nativo (`enableSheetSwipeToDismiss('modalCartSheet', closeCartSheet)`).
     - Integración con el ciclo de vida de modales (`closeAllModals`).
     - Adaptación dinámica de textos de botones según `activeRestaurantConfig` (`allowOrdering`, `requireWaiterValidation`).

3. `scripts/test-isolated.mjs`:
   - Incorporación de `cocina-cuentas-etapa-05` al array `allSuites`. Total: 35 suites aisladas.

4. `packages/api/test/cocina-cuentas-etapa-05.test.ts` (nueva):
   - Suite con 14 tests automatizados que auditan:
     1. Presencia de todos los elementos HTML requeridos en comensal.
     2. Contratos de API, tokens de participante y ausencia de precios dictados por cliente.
     3. Manejo de errores de negocio e idempotencia.
     4. Mapeo exhaustivo de estados FSM de tandas.
     5. Cumplimiento estricto de seguridad anti-XSS y renderizado DOM con `textContent`.

---

## Verificaciones ejecutadas y evidencia

1. **Matriz de Rutas**:
   - `Check.ps1 -Check routes` -> EXIT CODE 0.
   - 79 rutas descubiertas y clasificadas, 0 derivas, 0 sin clasificar.

2. **Paridad de Esquema**:
   - `Check.ps1 -Check schema` -> EXIT CODE 0.
   - Esquemas SQLite y PostgreSQL idénticos en paridad.

3. **Compilación de Workspaces (Build)**:
   - `Check.ps1 -Check build` -> EXIT CODE 0.
   - Compilación limpia de los 6 workspaces en 72.99s:
     - `@mesaya/shared`: OK
     - `@mesaya/api`: OK
     - `@mesaya/client-web`: OK (Vite production build limpio)
     - `@mesaya/staff-panel`: OK
     - `@mesaya/admin-dashboard`: OK
     - `hardware/qr-generator`: OK

4. **Compilación PostgreSQL (Build PG)**:
   - `Check.ps1 -Check build-pg` -> EXIT CODE 0.
   - Generación de cliente Postgres y chequeo TypeScript sin errores.
   - Cliente SQLite restaurado posteriormente vía `npm --workspace=@mesaya/api run prisma:generate`.

5. **Pruebas de Seguridad y XSS de Cliente**:
   - `npx vitest run packages/api/test/client-xss-security.test.ts packages/api/test/client-build-assets.test.ts` -> 26/26 tests PASS.

6. **Suite de Pruebas Aisladas**:
   - `Check.ps1 -Check suite` -> EXIT CODE 0 (35/35 suites PASS, 0 fallidas).

---

## Siguiente etapa

- **Etapa 06 (Admin Modos y KDS Operativo)**:
  - En `apps/staff-panel`: Vista operativa de KDS para cocina con visualización de tandas activas, deduplicación de alertas sonoras al detectar nuevos IDs de tanda tras interacción del operador, etiquetas claras de alérgenos y notas especiales, acciones de transición de estado FSM (`IN_KITCHEN` -> `PREPARING` -> `READY` -> `SERVED` o `REJECTED` con motivo).
  - En `apps/admin-dashboard`: Selector gerencial de modos operativos (`allowOrdering`, `requireWaiterValidation`).
  - Sin regresiones en el salón ni en la matriz de rutas.

# ENTREGA-06 — Etapa 06: Admin Modos y KDS Operativo con Sincronización de Tandas y Gestión de Agotados

Estado: VERIFIED_PASS
Fecha: 2026-09-06
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 06) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Base: etapa 01 aprobada (`81faaa2`), etapa 02 aprobada (`ca57b99`), etapa 03 aprobada (`2f8c578`), etapa 04 aprobada (`b2e0245`), etapa 05 aprobada (`e0ff9c4`).
Alcance: Vista operativa de cocina (KDS) en `apps/staff-panel`, sincronización bidireccional de FSM entre órdenes y tandas en `packages/api`, alertas sonoras deduplicadas, detección de alérgenos en cocina, gestión de stock/agotados en tiempo real (`isAvailable`), y selector gerencial de los 3 modos operativos canónicos en `apps/admin-dashboard`.

---

## Archivos modificados y creados

1. `packages/api/src/services/order.service.ts`:
   - `getKitchenOrders`: ampliado para consultar órdenes en estado `OrderStatus.CONFIRMED` además de `PENDING_VALIDATION`, `IN_KITCHEN` y `READY_TO_SERVE`.
   - Inclusión relacional en ítems de `participant` (`displayName`) y `tanda` (`seq`, `status`), mapeando `participantName`, `tandaSeq`, `productNameSnapshot` y `modifiersSnapshot`.
   - `validateOrder`: sincronización atómica de tandas asociadas en estado `DRAFT` o `CONFIRMED` hacia `IN_KITCHEN`.
   - `updateOrderStatusByStaff`: sincronización de tandas asociadas a `IN_KITCHEN`, `SERVED` o `CANCELLED` según la transición de la orden.

2. `packages/api/src/routes/staff.routes.ts`:
   - Nueva ruta `PATCH /v1/staff/restaurants/:id/menu/items/:itemId/availability`.
   - Autenticación mediante `verifyStaffToken`, validación de pertenencia multitenant y mutación segura de `menuItem.isAvailable`.

3. `scripts/route-matrix.json`:
   - Registro de la nueva ruta `PATCH /v1/staff/restaurants/:id/menu/items/:itemId/availability` bajo la categoría de acceso `STAFF`. Total de rutas: 80.

4. `apps/staff-panel/src/lib/api.ts`:
   - Método cliente `StaffApi.updateMenuItemAvailability(restaurantId, itemId, isAvailable)`.

5. `apps/staff-panel/src/components/KitchenOrdersManager.tsx`:
   - Deduplicación sonora de órdenes: uso de `knownOrderIdsRef` (`useRef<Set<string>>`) que se precarga en el primer sondeo y emite chime únicamente ante órdenes nuevas.
   - Botón de activación y toggle de audio con `Volume2` / `VolumeX` y desbloqueo de AudioContext nativo (`unlockAudio`).
   - Detección reactiva de alérgenos mediante regex `ALLERGY_REGEX = /(alerg|celiac|tacc|mani|maní|marisc|intoleran|gluten|sin tacc)/i` con banner visual prominente de advertencia en las comandas.
   - Soporte para órdenes en estado `CONFIRMED` con acción directa de validación a cocina.
   - Botón de rechazo de comanda con modal/prompt para registrar motivo y transición a `CANCELLED`.
   - Modal operativo "Gestión de Agotados (Stock 86)" agrupado por categorías con switch reactivo de disponibilidad (`isAvailable`).

6. `apps/admin-dashboard/src/components/ModuleConfigManager.tsx`:
   - Selector visual de los 3 modos operativos canónicos en la pestaña de módulos:
     1. Modo Carta Informativa (`allowOrdering: false`, `requireWaiterValidation: true`).
     2. Modo Pedido con Validación del Mozo (`allowOrdering: true`, `requireWaiterValidation: true`).
     3. Modo Cocina Directa (`allowOrdering: true`, `requireWaiterValidation: false`).
   - Aplicación reactiva de presets sobre el estado del formulario con guardado atómico.

7. `packages/api/test/cocina-cuentas-etapa-06.test.ts` (nueva):
   - Suite con 8 tests automatizados:
     1. Inclusión de órdenes `CONFIRMED` en la vista KDS de cocina.
     2. Aislamiento estricto multi-tenant en KDS.
     3. Sincronización FSM de tandas a `IN_KITCHEN` al validar una orden.
     4. Sincronización FSM de tandas a `SERVED` al marcar orden como entregada.
     5. Sincronización FSM de tandas a `CANCELLED` al cancelar/rechazar una orden.
     6. Control de stock agotado: toggle de disponibilidad por staff.
     7. Bloqueo 409 `ITEM_UNAVAILABLE` en creación de tanda cuando un ítem está agotado.
     8. Aislamiento tenant en endpoint de disponibilidad de ítems de menú.

8. `scripts/test-isolated.mjs`:
   - Registro de `cocina-cuentas-etapa-06` en `allSuites`. Total: 36 suites aisladas.

---

## Verificaciones ejecutadas y evidencia

1. **Matriz de Rutas**:
   - `Check.ps1 -Check routes` -> EXIT CODE 0.
   - 80 rutas descubiertas y clasificadas, 0 derivas, 0 sin clasificar.

2. **Paridad de Esquema**:
   - `Check.ps1 -Check schema` -> EXIT CODE 0.
   - Esquemas SQLite y PostgreSQL idénticos en paridad.

3. **Compilación de Workspaces (Build)**:
   - `Check.ps1 -Check build` -> EXIT CODE 0.
   - 6/6 workspaces compilados exitosamente (@mesaya/shared, @mesaya/api, @mesaya/client-web, @mesaya/staff-panel, @mesaya/admin-dashboard, hardware/qr-generator).

4. **Compilación PostgreSQL (Build PG)**:
   - `Check.ps1 -Check build-pg` -> EXIT CODE 0.
   - Cliente Prisma SQLite regenerado inmediatamente tras la prueba PG.

5. **Suite de Pruebas Aisladas**:
   - `Check.ps1 -Check suite` -> EXIT CODE 0 (36/36 suites PASS, 0 fallidas).

---

## Siguiente etapa

- **Etapa 07 (Cuenta y Pagos Parciales - Backend)**:
  - Cálculo de cuenta en centavos enteros (`ARS`).
  - División en partes iguales con distribución determinista de resto centavo a centavo.
  - Reclamación individual de platos/ítems por participante de visita con control de concurrencia optimista / versión.
  - Registro de pagos parciales presenciales (`MANUAL_SETTLED`) por staff con claves de idempotencia únicas.
  - Bloqueo de sobrepago y bloqueo de cierre de sesión de mesa si el balance remanente es mayor a 0.
  - Verificación de que endpoints de pagos digitales continúan deshabilitados (`503 DIGITAL_PAYMENTS_UNAVAILABLE`).

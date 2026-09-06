# ENTREGA-08 — Etapa 08: UI de Mi Parte, Caja de Staff y Flujo de 3 Personas

Estado: VERIFIED_PASS
Fecha: 2026-09-06
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 08) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Base: etapa 01 aprobada (`81faaa2`), etapa 02 aprobada (`ca57b99`), etapa 03 aprobada (`2f8c578`), etapa 04 aprobada (`b2e0245`), etapa 05 aprobada (`e0ff9c4`), etapa 06 aprobada (`355c89d`), etapa 07 aprobada (`2230896`).
Alcance: Implementación completa de las interfaces de usuario para la división de cuentas y cobros presenciales: pestaña "Mi Parte", reparto en partes iguales y comanda completa en `apps/client-web`; panel de "Caja y Cuentas" con cobros parciales presenciales, propinas, historial y reversión en `apps/staff-panel`; tipado unificado en `packages/shared`; actualización de FSM de reversión en `packages/api` y suite aislada integral de 13 pruebas que reproduce fielmente el flujo de 3 personas (Ana, Bruno, Carla).

---

## Archivos creados y modificados

1. `packages/shared/src/index.ts` y `packages/shared/src/fsm.ts`:
   - Exportación de DTOs canónicos de facturación: `TableBillDTO`, `BillItemDTO`, `SettledPaymentDTO`, `EqualPartSplitDTO`, `ManualPaymentRequestDTO`, y actualización de `ClaimItemDTO`.
   - Inclusión formal de transición autorizada `TableFSMState.PAID -> TableFSMState.EATING` en la matriz FSM para reversiones de pago presencial.

2. `apps/staff-panel/`:
   - `src/lib/api.ts`: Métodos de cliente HTTP `getTableBill(tableId)`, `settlePayment(dto)`, `revertPayment(paymentId, reason)`.
   - `src/components/TableBillingModal.tsx` (nuevo componente):
     - Modal de cobro y caja de mesa con visualización en tiempo real de Total, Cobrado y Saldo Pendiente.
     - Presets rápidos de importe: Total ($100%), 1/2 ($50%), 1/3 ($33.3%).
     - Selector de medio de pago presencial: `WAITER_CASH` (Efectivo), `WAITER_CARD` (Tarjeta / POSNet), `WAITER_MP_QR` (QR Presencial Mercado Pago).
     - Validación estricta anti-sobrepago en el cliente.
     - Generación de `idempotencyKey` única por cobro para evitar duplicaciones por doble clic o pérdida de red.
     - Historial de transacciones de pago con botón de reversión autorizada (`revertPayment`).
     - Botón de "Liberar Mesa y Cerrar Sesión" condicionado a saldo remanente $0.
   - `src/components/CallCard.tsx`: Integración de botón `"💳 Ver Cuenta y Cobro en Mesa"` que dispara el modal de cobro directo desde las tarjetas de llamado.
   - `src/App.tsx`: Incorporación de cuarta pestaña superior `"Caja y Cuentas"` con grilla de mesas activas, estado de cuenta e importes pendientes.

3. `apps/client-web/`:
   - `index.html`: Modal `#modalBill` enriquecido con resumen de saldo (Total, Pagado, Resta), navegación en 3 pestañas (`👤 Mi Parte`, `➗ Partes Iguales`, `📋 Toda la Mesa`), lista de ítems con botones interactivos de reclamación/desasignación, selector de partes ($N=2..6$), chips de método de pago y botón de pedido de cuenta con importe dinámico.
   - `app.js`: Lógica de carga autoritativa (`fetchAndRenderBill`), actualización reactiva del subtotal de "Mi Parte", toggle optimista de reclamación de platos vía `/v1/orders/bills/claim-item`, manejo de versiones de concurrencia y envío de solicitud de cobro al personal.

4. `packages/api/`:
   - `src/services/bill.service.ts`: Soporte de `isOverride: true` en `revertManualPayment` al restaurar estado de mesa a `EATING`.
   - `test/cocina-cuentas-etapa-08.test.ts` (nueva suite de pruebas):
     - 13 pruebas unitarias e integrales que validan de punta a punta el flujo de 3 personas (Ana, Bruno, Carla):
       1. Consulta autoritativa comensal vía `GET /v1/orders/bills/session/:token`.
       2. Verificación de subtotales individuales de "Mi Parte".
       3. Reclamación interactiva del plato compartido por Carla con control de versiones.
       4. Detección y respuesta `409 CLAIM_VERSION_MISMATCH` ante concurrencia optimista desactualizada.
       5. Reparto determinista en partes iguales ($N=3$) sobre $12.000 con suma 100% conservada.
       6. Consulta de cuenta de mesa por staff vía `GET /v1/staff/tables/:tableId/bill`.
       7. Cobro parcial 1: Ana ($4500) en Efectivo (`WAITER_CASH`).
       8. Cobro parcial 2: Bruno ($3800) con Tarjeta (`WAITER_CARD`).
       9. Bloqueo `409 OVERPAYMENT_NOT_ALLOWED` ante intento de sobrepago.
       10. Bloqueo `409 UNPAID_BALANCE_EXISTS` al intentar cerrar sesión con saldo pendiente.
       11. Cobro final 3: Saldo exacto ($3700) con QR Presencial (`WAITER_MP_QR`), pasando mesa a `PAID`.
       12. Reversión autorizada de cobro por staff con restauración de saldo y reapertura a `EATING`.
       13. Re-cobro final y cierre de sesión exitoso sin deuda.

5. `scripts/test-isolated.mjs`:
   - Registro de la suite `cocina-cuentas-etapa-08`. Total de suites en el runner: 38.

---

## Verificación de Gates de Calidad

- **Rutas API**: `Check.ps1 -Check routes` -> 85 rutas clasificadas, 0 novedades, 0 deriva (Exit code 0).
- **Paridad de Esquema**: `Check.ps1 -Check schema` -> Paridad exacta SQLite/PostgreSQL (Exit code 0).
- **Compilación de Workspaces**: `Check.ps1 -Check build` -> 6/6 workspaces compilados exitosamente (Exit code 0).
- **Compilación PostgreSQL**: `Check.ps1 -Check build-pg` -> Compilación exitosa contra target PostgreSQL / Supabase (Exit code 0).
- **Regeneración Prisma**: `npx prisma generate --schema=packages/api/prisma/schema.prisma` -> Cliente sincronizado.
- **Suites Aisladas**: `Check.ps1 -Check suite` -> **38/38 suites ejecutadas y aprobadas (100% PASS, Exit code 0)**.

---

## Conclusión

La Etapa 08 queda completamente implementada, verificada y aprobada. El sistema cuenta con UI completa para comensales y personal de salón, gestión de cobros parciales presenciales, soporte multi-moneda en centavos ARS enteros y flujo de 3 personas verificado con 38 suites aisladas verdes.

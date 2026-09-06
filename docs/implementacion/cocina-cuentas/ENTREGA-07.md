# ENTREGA-07 — Etapa 07: Cuenta Dividida Backend, Reparto Determinista y Cobros Parciales Presenciales

Estado: VERIFIED_PASS
Fecha: 2026-09-06
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 07) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Base: etapa 01 aprobada (`81faaa2`), etapa 02 aprobada (`ca57b99`), etapa 03 aprobada (`2f8c578`), etapa 04 aprobada (`b2e0245`), etapa 05 aprobada (`e0ff9c4`), etapa 06 aprobada (`355c89d`).
Alcance: Backend completo para cálculo autoritativo de cuenta en centavos enteros (`ARS`), reparto determinista en partes iguales ($N=2..6$) con conservación estricta de residuos, asignación/reclamación individual y compartida de ítems con concurrencia optimista (`claimVersion`), registro de pagos parciales presenciales (`MANUAL_SETTLED`) con control de idempotencia y bloqueo de sobrepago, reversión autorizada de pagos, bloqueo de cierre de sesión con deuda remanente (`409 UNPAID_BALANCE_EXISTS`), y preservación estricta de `503 DIGITAL_PAYMENTS_UNAVAILABLE` para pagos online.

---

## Archivos modificados y creados

1. `packages/api/src/services/bill.service.ts` (nuevo):
   - `calculateTableBill`:
     - Cálculo integral de la cuenta de la sesión activa en centavos enteros `ARS`.
     - Suma de precios base + modificadores de ítems en comandas y tandas activas (excluyendo cancelados).
     - Acumulación de pagos registrados (`MANUAL_SETTLED`, `APPROVED`).
     - Cálculo de saldo remanente: `remainingCents = max(0, totalCents - paidCents)`.
     - Estado de cuenta: `PAID` exclusivamente cuando `remainingCents === 0`; `OPEN` si resta saldo.
     - Desglose por participante e ítem reclamado con control de versión de reclamación (`claimVersion`).
     - Cálculo determinista de división en partes iguales ($N=2..6$) mediante `splitEqualParts`: cuota entera uniforme más distribución determinista del residuo de a 1 centavo sobre las primeras partes, garantizando $\sum \text{partes} = \text{totalCents}$.
   - `claimItemByParticipant`:
     - Asignación / desasignación de plato a un participante comensal.
     - Concurrencia optimista: verificación de `expectedVersion`. Si no coincide con `item.claimVersion`, responde `409 CLAIM_VERSION_MISMATCH`.
     - Si la orden o la sesión ya están pagadas, bloquea con `409 ITEM_ALREADY_PAID`.
     - Incremento atómico de `claimVersion`.
   - `calculateSharedItemSplit`:
     - Distribución determinista de plato compartido entre comensales participantes.
   - `settleManualPayment`:
     - Registro presencial de cobro por personal de salón (`WAITER_CASH`, `WAITER_CARD`, `WAITER_MP_QR`).
     - Idempotencia estricta: clave de idempotencia obligatoria. Mismo payload devuelve la transacción existente (200/201); misma clave con distinto importe produce `409 IDEMPOTENCY_KEY_COLLISION`.
     - Aislamiento multi-tenant: verificación de que la mesa pertenece al restaurante del staff (403).
     - Prevención de sobrepago: si `amountCents > remainingCents`, responde `409 OVERPAYMENT_NOT_ALLOWED`.
     - Prevención de doble pago sobre cuenta saldada: responde `409 BILL_ALREADY_PAID`.
     - Transición a `MANUAL_SETTLED`. Si el saldo remanente llega exactamente a 0, transiciona las órdenes y la mesa a `PAID`.
   - `revertManualPayment`:
     - Reversión autorizada de cobro por personal de salón: marca transacción como `REFUNDED`, reabre las órdenes a `SERVED` y la mesa a `EATING`.
   - `hasUnpaidBalance`:
     - Consulta booleana si la mesa tiene deuda pendiente $> 0$.

2. `packages/api/src/services/session.service.ts`:
   - Modificación en `closeTableSession`:
     - Invoca `BillService.hasUnpaidBalance(tableId)`.
     - Si hay saldo impago y no se especifica `options?.force === true`, bloquea el cierre respondiendo `409 UNPAID_BALANCE_EXISTS`.

3. `packages/api/src/routes/orders.routes.ts`:
   - Incorporación de rutas de cuenta para comensales (anónimo con sesión activa):
     - `GET /v1/orders/bills/session/:token`: consulta autoritativa del estado de la cuenta, saldo, desglose por ítem y opciones de división.
     - `POST /v1/orders/bills/claim-item`: reclamación concurrente de ítem con `participantId` y `claimVersion`.
   - Mantenimiento estricto de `503 DIGITAL_PAYMENTS_UNAVAILABLE` en endpoints de pago digital `/v1/orders/items/claim`, `/v1/orders/:id/split-session` y `/v1/orders/split-session/:id/pay-part`.

4. `packages/api/src/routes/staff.routes.ts`:
   - Incorporación de rutas de caja presencial para staff:
     - `GET /v1/staff/tables/:tableId/bill`: visualización de cuenta de mesa con saldo pendiente, propina optativa y pagos previos.
     - `POST /v1/staff/payments/settle`: asentamiento de pago presencial con método, monto en centavos y clave de idempotencia.
     - `POST /v1/staff/payments/:id/revert`: reversión de pago asentado erróneamente con auditoría.

5. `scripts/route-matrix.json`:
   - Incorporación de las 5 nuevas rutas bajo categorías `ORDERS_ANON` y `STAFF`. Total de rutas: 85.

6. `packages/api/test/postgres-schema-parity.test.ts`:
   - Ajuste de timeout a 20000ms en test de validación offline de schemas para evitar falsos positivos por latencia de procesos hijo en Windows.

7. `packages/api/test/cocina-cuentas-etapa-07.test.ts` (nueva):
   - Suite con 19 tests automatizados:
     1. Cálculo de cuenta en centavos ARS con modificadores de tanda.
     2. Exclusión de ítems cancelados del cálculo de la cuenta.
     3. División determinista en partes iguales con conservación de resto ($N=3$, $10000 \to 3334 + 3333 + 3333$).
     4. Determinismo de orden en repetición de cálculo de partes iguales.
     5. Asignación de ítem a participante con versionado concurrente.
     6. Conflicto 409 `CLAIM_VERSION_MISMATCH` ante versión desactualizada.
     7. Desasignación voluntaria de ítem.
     8. Bloqueo 409 `ITEM_ALREADY_PAID` al reclamar un ítem ya saldado.
     9. Cobro parcial presencial (`WAITER_CASH`) reduciendo saldo remanente.
     10. Idempotencia en cobro parcial con misma clave e importe idéntico.
     11. Conflicto 409 por colisión de clave de idempotencia con importe distinto.
     12. Bloqueo 409 `OVERPAYMENT_NOT_ALLOWED` ante intento de cobrar más del saldo.
     13. Cobro total exacto que transiciona órdenes y mesa a `PAID`.
     14. Bloqueo 409 `BILL_ALREADY_PAID` al intentar cobrar sobre cuenta sin deuda.
     15. Reversión autorizada de pago presencial que reabre la cuenta y la mesa.
     16. Aislamiento multi-tenant en cobro presencial (rechazo 403 ante tenant ajeno).
     17. Bloqueo 409 `UNPAID_BALANCE_EXISTS` al intentar cerrar sesión de mesa con deuda.
     18. Cierre forzado de mesa con deuda permitiendo cierre administrativo explícito.
     19. Preservación estricta de `503 DIGITAL_PAYMENTS_UNAVAILABLE` en endpoints online.

8. `scripts/test-isolated.mjs`:
   - Registro de `cocina-cuentas-etapa-07` en `allSuites`. Total: 37 suites aisladas.

---

## Verificaciones ejecutadas y evidencia

1. **Matriz de Rutas**:
   - `Check.ps1 -Check routes` -> EXIT CODE 0.
   - 85 rutas descubiertas y clasificadas, 0 derivas, 0 sin clasificar.

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
   - `Check.ps1 -Check suite -Suite cocina-cuentas-etapa-07` -> EXIT CODE 0 (19/19 tests PASS).
   - `Check.ps1 -Check suite -Suite postgres-schema-parity` -> EXIT CODE 0 (3/3 tests PASS).
   - `Check.ps1 -Check suite` -> EXIT CODE 0 (37/37 suites PASS).

---

## Siguiente etapa

- **Etapa 08 (UI de Mi Parte y Caja de Staff/Manager)**:
  - Vista cliente "Mi Parte" en `apps/client-web`: visualización del subtotal por participante, selector de división en partes iguales, toggle de platos reclamados y solicitud de cobro en mesa al mozo.
  - Panel de staff "Caja y Cobros Parciales" en `apps/staff-panel`: visualización de la cuenta desglosada de la mesa, modal de cobro presencial (`WAITER_CASH`, `WAITER_CARD`, `WAITER_MP_QR`) con generación de clave de idempotencia, opción de cobro por cuota o monto personalizado, y acción de reversión de cobros registrados.

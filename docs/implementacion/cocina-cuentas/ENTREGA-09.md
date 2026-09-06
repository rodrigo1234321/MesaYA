# ENTREGA-09 — Etapa 09: Integración de Revisión 04-06, Blindaje Concurrente de Caja, Manager Auth y FSM Atómica

Estado: VERIFIED_PASS  
Fecha: 2026-09-06  
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 09) + docs/implementacion/cocina-cuentas/REVIEW-03-06.md  
Base: commit `07074c5` integrado limpiamente (`a288b64`), etapa 08 aprobada (`12f319a`).  
Alcance: Integración exhaustiva de las correcciones de concurrencia y atomicidad de las etapas 04–06, blindaje integral de la idempotencia en cobros de caja de staff (`TableBillingModal.tsx` y `bill.service.ts`), serialización de transacciones financieras concurrentes mediante bloqueo de fila `paymentSeq`, restricción de reversión de cobros exclusivamente a personal con rol `MANAGER` con auditoría inmutable, atomicidad estricta entre operaciones financieras y transiciones de estado de mesa (`fsmService.attemptTransition(..., tx)`), unificación del detector de alérgenos en `@mesaya/shared`, contrato canónico para Mercado Pago (`CONTRATO-MERCADOPAGO.md`), runbook operativo (`RUNBOOK-OPERATIVO.md`) y suite aislada integral de 16 pruebas que valida el ciclo completo de comanda, cocina, caja y concurrencia.

---

## 1. Archivos Creados y Modificados

1. **Ecosistema de Alérgenos Compartido (`packages/shared/`)**:
   - `src/allergens.ts`: Módulo canónico `containsAllergenMention(text)` con normalización de caracteres diacríticos (NFD) y expresiones regulares robustas para variantes gastronómicas (celiaquía, frutos secos, mariscos, huevo, lácteos, etc.).
   - `src/rtms-types.ts`: Atribución de `participantId` en `SubmitTandaItemDTO` e interfaces unificadas de facturación.
   - `src/fsm.ts`: Matriz de transición canónica endurecida: las transiciones `PAID -> EATING` y `ORDER_IN_KITCHEN -> PAID` quedan restringidas exclusivamente como anulaciones de caja internas (`isOverride: true`).

2. **Capa de Persistencia y Esquemas (`packages/api/prisma/`)**:
   - `schema.prisma`:
     - Campo `paymentSeq Int @default(0)` en `TableSession` para serialización transaccional.
     - Campos de auditoría `participantId`, `reversalReason`, `reversalStaffId`, `reversalAt` en `PaymentTransaction` con relación a `VisitParticipant`.
   - `schema.supabase.prisma`: Sincronización idéntica y verificación de paridad estructural PostgreSQL.
   - `migrations-postgres/20260906010000_stage09_payments_concurrency_hardening/migration.sql`: Migración canónica SQL para despliegues en Supabase.

3. **Backend API y Servicios (`packages/api/src/`)**:
   - `services/bill.service.ts`:
     - Validación estricta de reuso de clave de idempotencia: discrepancias en sesión, restaurante, método o importes emiten `409 IDEMPOTENCY_CONFLICT`.
     - Serialización de cobros concurrentes mediante incremento atómico `paymentSeq` dentro de la transacción de base de datos.
     - Soporte de atribución por comensal (`participantId`) que marca ítems correspondientes como `isPaid: true`.
     - Reversión autorizada en `revertManualPayment`: control estricto de rol `MANAGER`, registro inmutable de auditoría y reapertura de ítems y comanda.
     - Transiciones FSM atómicas: paso directo de cliente transaccional `tx` a `fsmService.attemptTransition`; ante rechazo de la FSM, la operación contable retrocede por completo.
   - `services/fsm.service.ts`: Adaptación de `attemptTransition` y `handleOccupancySessionLifecycle` para operar dentro de un contexto transaccional `tx` opcional.
   - `services/order.service.ts`: Adopción de `containsAllergenMention` y captura de `participantId` por ítem en tandas.
   - `routes/staff.routes.ts`: Restricción estricta de autorización en `POST /staff/payments/:id/revert` a rol `MANAGER` (`403 FORBIDDEN_ROLE`).

4. **Frontend y Panel de Salón (`apps/staff-panel/`)**:
   - `src/components/TableBillingModal.tsx`: Corrección del reintento de cobro preservando la clave de idempotencia mediante referencia por huella (`pendingPaymentRef`). Selector de participante para imputación individual.
   - `src/components/KitchenOrdersManager.tsx`: Reemplazo de expresiones regulares locales por `containsAllergenMention`.

5. **Documentación de Operación y Contratos**:
   - `docs/implementacion/cocina-cuentas/RUNBOOK-OPERATIVO.md`: Guía de despliegue, monitoreo, flags de configuración y procedimientos de contingencia.
   - `docs/implementacion/cocina-cuentas/CONTRATO-MERCADOPAGO.md`: Especificación formal de integración de Mercado Pago (HMAC-SHA256, tolerancia de deriva temporal, derivación determinista de idempotencia, liquidación transaccional y reversiones).

6. **Suite Aislada E2E Integral (`packages/api/test/cocina-cuentas-etapa-09.test.ts`)**:
   - 16 pruebas que validan de forma exhaustiva:
     1. Apertura de sesión y mesa en `OCCUPIED_NO_ORDER`.
     2. Incorporación de 3 participantes de visita (Ana, Bruno, Carla).
     3. Envío de Tanda 1 con nota de alergia forzando validación humana del mozo.
     4. Validación por mozo y despacho a cocina (`IN_KITCHEN`).
     5. Cocina despacha (`READY_TO_SERVE`) y mozo sirve (`SERVED`), llevando la mesa a `EATING`.
     6. Carla solicita segunda tanda (postre); se procesa sin retroceder la FSM.
     7. Consulta autoritativa comensal: total $20.000 ARS y partes iguales conservando residuo.
     8. Reclamo concurrente de ítem compartido con detección de conflicto `409 CLAIM_VERSION_MISMATCH`.
     9. Cobro parcial 1 en efectivo con verificación de idempotencia exacta y conflicto ante payload alterado (`409 IDEMPOTENCY_CONFLICT`).
     10. Cobro parcial 2 con tarjeta, imputación a participante y marcado de `isPaid = true`.
     11. Bloqueo `409 OVERPAYMENT_NOT_ALLOWED` ante intento de sobrepago y bloqueo de cierre con deuda remanente.
     12. Reversión de cobro: rechazo a mozo `403 FORBIDDEN_ROLE`, autorización por encargada (`MANAGER`) y persistencia de campos de auditoría.
     13. Liquidación final al 100% y transición atómica de mesa a `PAID`.
     14. Cierre exitoso de sesión de mesa sin saldo deudor.
     15. Seguridad: pagos digitales online bloqueados incondicionalmente (`503 DIGITAL_PAYMENTS_UNAVAILABLE`).
     16. Concurrencia real: carreras simultáneas de cobro serializadas por `paymentSeq` evitando sobrepago.

---

## 2. Verificación de Calidad y Calificación de Gates

- **Rutas API**: `Check.ps1 -Check routes` -> 85 rutas clasificadas, 0 novedades, 0 deriva (Exit code 0).
- **Paridad de Esquema**: `Check.ps1 -Check schema` -> Paridad exacta SQLite/PostgreSQL (Exit code 0).
- **Compilación de Workspaces**: `Check.ps1 -Check build` -> 6/6 workspaces compilados exitosamente (Exit code 0).
- **Compilación PostgreSQL**: `Check.ps1 -Check build-pg` -> Compilación exitosa contra target PostgreSQL / Supabase (Exit code 0).
- **Regeneración Prisma**: Cliente SQLite regenerado y alineado.
- **Suites E2E Etapa 09**: `Check.ps1 -Check suite -Suite cocina-cuentas-etapa-09` -> 16/16 pruebas aprobadas (Exit code 0).
- **Suites Aisladas Globales**: `Check.ps1 -Check suite` -> **39/39 suites ejecutadas y aprobadas (100% PASS, Exit code 0)**.

---

## 3. Conclusión

La Etapa 09 finaliza el ciclo integral de comanda, cocina, cuentas compartidas y caja presencial de MesaYA RTMS. El sistema cuenta con resiliencia de datos probada ante concurrencia real, autoridad estricta en centavos ARS enteros, seguridad de roles con auditoría inmutable y documentación canónica completa para operar en salón y habilitar pagos digitales en el futuro.

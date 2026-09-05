# Revisión Codex — Etapa 15: Autorizar cocina y estados de pedidos

Fecha: 2026-09-04 (-03:00)  
Veredicto: **APPROVED**

## Verificación

- Los endpoints staff de validación, cocina, carga, actualización de estado y cobro presencial requieren `verifyStaffToken`; el tenant se resuelve desde la identidad vigente en base de datos y se compara contra la orden, mesa o restaurante objetivo.
- `ALLOWED_ORDER_TRANSITIONS` limita los cambios a los valores de `OrderStatus`; los estados inventados, saltos, regresiones y mutaciones desde `PAID`/`CANCELLED` se rechazan antes de escribir.
- El cobro manual sólo admite `MANAGER`, registra método presencial, actor y fecha en `PaymentTransaction` con `MANUAL_SETTLED` y `mpPaymentId: null`; no se presenta como aprobación de una pasarela digital.
- La transición de mesa al cobrar es compatible con la matriz FSM y el proyecto maestro: `EATING` o `BILL_REQUESTED` pasan a `PAID`; nunca a `EATING` tras el cobro.

## Evidencia

- Verificación independiente: `$env:MESAYA_BOUNDED_JOB = '1'; node scripts/test-isolated.mjs staff-orders-kitchen` — 27/27 pruebas HTTP reales aprobadas sobre SQLite efímera.
- Reporte de ejecución: build completo aprobado y `test:isolated` completo con 17/17 suites aprobadas.
- `dev.db` se mantiene intacta: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

No se encontraron hallazgos bloqueantes ni cambios fuera de alcance. La Etapa 15 queda **APPROVED** y se habilita exclusivamente la Etapa 16.

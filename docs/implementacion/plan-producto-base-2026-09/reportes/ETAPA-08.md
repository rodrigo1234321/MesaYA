# Reporte de etapa 08 — Comandas y KDS unificado

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- El KDS muestra en una sola bandeja pedidos QR y pedidos cargados por el mozo.
- Se preservan las transiciones `PENDING_VALIDATION → IN_KITCHEN → READY_TO_SERVE → SERVED`, con idempotencia y rechazo de regresiones.
- La carga manual valida tenant, carta, disponibilidad, cantidad, notas y recalcula precios/total en servidor.
- La pantalla compartida actualiza con polling cancelable, backoff exponencial, recuperación al volver online y menor frecuencia en segundo plano.
- La vista mantiene urgencia por antigüedad y acciones diferenciadas para validar, preparar y entregar.

## Verificación

| Verificación | Resultado |
|---|---|
| `staff-orders-kitchen.test.ts` | PASS (suite incluida) |
| `guest-orders-validation.test.ts` | PASS |
| `fsm-concurrency.test.ts` | PASS |
| Staff panel build directo | PASS |
| API build directo | PASS |

## Límite conocido

La pantalla operativa de caja y el cierre de mesa después del cobro se completan en la etapa 09. La prueba real con una pantalla física queda en la certificación de instancia de referencia.

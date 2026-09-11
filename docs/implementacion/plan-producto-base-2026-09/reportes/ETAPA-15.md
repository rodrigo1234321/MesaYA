# Reporte de etapa 15 — Opción Mercado Pago informativa

Estado: **APPROVED LOCALMENTE — ALCANCE INFORMATIVO**  
Fecha: 2026-09-07

## Decisión

Mercado Pago no forma parte del cobro autónomo de esta release. El encargado puede marcar si el local quiere ofrecerlo como opción visible al comensal (`DIGITAL_MP` o `HYBRID`), pero el pedido sólo notifica al personal y la confirmación del cobro es presencial. No se usan SDK, tokens, webhooks, credenciales ni llamadas a Mercado Pago.

## Evidencia disponible

- `digital_payment` queda `AVAILABLE` sólo como opción informativa y devuelve un mensaje explícito de cobro presencial.
- El panel de administración permite seleccionar `WAITER_ONLY`, `DIGITAL_MP` o `HYBRID` sin activar ninguna integración externa.
- El cliente sólo muestra Mercado Pago cuando la configuración lo marca; al elegirlo envía un llamado de cuenta al personal.
- `manual_payment` permanece activo en todos los modos.
- Las rutas de split siguen cerradas con `503 DIGITAL_PAYMENTS_UNAVAILABLE`; no se confunden con esta opción visual.

## Fuera de alcance futuro

- Si en el futuro se necesita cobro autónomo, deberá abrirse otra etapa con sandbox, conciliación, webhook y credenciales separadas.

No se modificaron cuentas remotas ni se guardaron secretos en el repositorio.

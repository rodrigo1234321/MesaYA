# Etapa 03 — Desactivar pagos y split simulados

Bloque: Contención.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 02 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-03.md` (NUEVO al ejecutar).

## Misión

Desactivar pagos y split simulados. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/orders.routes.ts`
- `packages/api/src/services/order.service.ts`
- `apps/client-web/app.js`
- `packages/api/test/full-system-e2e.test.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Identificar todas las entradas a payEqualPart, creación/claim de split y cualquier camino público que escriba APPROVED o PAID.
2. [ ] Para el piloto rechazar todo el módulo split/pago digital en backend con 503 y code DIGITAL_PAYMENTS_UNAVAILABLE; una bandera de restaurante no puede saltar el bloqueo. No borrar historial.
3. [ ] Ocultar/deshabilitar botones correspondientes en cliente con mensaje de pago presencial; conservar pedido de cuenta. Diferenciar futura confirmación manual de staff de transacción digital.
4. [ ] Reemplazar assertions que celebran un pago falso por tests que exigen rechazo y cero escrituras; no borrar la cobertura.

## Aceptación verificable

- [ ] Con o sin token, repetir pay-part nunca crea PaymentTransaction ni cambia saldo/estado.
- [ ] allowSplitBill=true no habilita el pago ni las claims bloqueadas.
- [ ] Cliente permite pedir la cuenta y no muestra éxito de pago inexistente.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No SDK, webhook, Mercado Pago, reparto de dinero ni credenciales reales.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 03».

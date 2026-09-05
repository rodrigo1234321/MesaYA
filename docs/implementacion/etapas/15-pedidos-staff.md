# Etapa 15 — Autorizar cocina y estados de pedidos

Bloque: Operación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 14 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-15.md` (NUEVO al ejecutar).

## Misión

Autorizar cocina y estados de pedidos. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/orders.routes.ts`
- `packages/api/src/services/order.service.ts`
- `apps/staff-panel/src/components/KitchenOrdersManager.tsx`
- `apps/staff-panel/src/lib/api.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Proteger validate/kitchen/add/status por staff del tenant; resolver pertenencia desde orderId/sessionId en DB.
2. [ ] Definir tabla pequeña de transiciones permitidas y esquema enum. Validar antes de escribir; no permitir reset arbitrario de estados finales.
3. [ ] Para piloto, confirmación manual de cobro sólo manager autenticado y diferenciada de pago digital; registrar actor, fecha y método presencial sin crear APPROVED digital.
4. [ ] Corregir PAID -> EATING: documentar transición FSM compatible con flujo de cuenta/cierre y probar; si exige decisión de negocio, detener en BLOCKED con opciones concretas.

## Aceptación verificable

- [ ] Anónimo y otro tenant no validan ni leen cocina.
- [ ] Estado inventado, regresión desde final o segundo cierre no altera pedido.
- [ ] Cobro manual queda trazable y nunca se presenta como confirmación del proveedor.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No integración financiera ni facturación.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 15».

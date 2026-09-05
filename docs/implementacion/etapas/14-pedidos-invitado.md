# Etapa 14 — Validar pedidos del comensal

Bloque: Operación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 13 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-14.md` (NUEVO al ejecutar).

## Misión

Validar pedidos del comensal. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/orders.routes.ts`
- `packages/api/src/services/order.service.ts`
- `apps/client-web/app.js`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Usar sesión activa centralizada en GET/add/remove/submit del invitado; aplicar flags en servidor, no sólo UI.
2. [ ] Resolver ítem por restaurante de la sesión, verificar disponibilidad y cantidad entera positiva con límite explícito. Precio/totales se calculan en servidor.
3. [ ] Permitir modificar sólo DRAFT propio; envío repetido no duplica pedido ni líneas. Rechazar transiciones desde estados finales.
4. [ ] Adaptar mensajes cliente y añadir pruebas de expiración, cruce de tenant, cantidades 0/-1/fraccionarias y manipulación de precio.

## Aceptación verificable

- [ ] Un plato de B jamás entra en cuenta A.
- [ ] No hay totales negativos ni modificación de pedido ya enviado.
- [ ] Enviar dos veces conserva una sola comanda lógica; pago digital sigue bloqueado.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No delivery, preorden ni reestructuración completa del dominio monetario.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 14».

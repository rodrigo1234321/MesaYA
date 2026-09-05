# Etapa 17 — Cerrar SSE público y definir snapshots

Bloque: Confiabilidad.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 16 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-17.md` (NUEVO al ejecutar).

## Misión

Cerrar SSE público y definir snapshots. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/stream.routes.ts`
- `packages/api/src/lib/eventBus.ts`
- `packages/api/src/routes/tables.routes.ts`
- `packages/api/src/routes/calls.routes.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Decisión propuesta de piloto: polling HTTP autenticado como transporte autoritativo; deshabilitar /stream con respuesta rápida explícita y sin datos. No añadir Redis/servicio externo.
2. [ ] Verificar endpoints snapshot de mesas/llamados/pedidos con tenant y DTO mínimo; completar sólo snapshot faltante necesario, documentándolo en matriz.
3. [ ] Evitar JWT permanente en query strings. No hacer de un stream abierto una condición de disponibilidad.
4. [ ] Probar que invitado no accede al salón ni a eventos/personas de otras mesas. Mantener stream bloqueado incluso si se solicita restaurantId válido.

## Aceptación verificable

- [ ] /stream anónimo/credencial en URL no expone snapshot ni queda abierto.
- [ ] Snapshots sólo accesibles por permisos previstos.
- [ ] No tokens ni teléfonos ajenos en respuestas de snapshots.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No construir SSE distribuido. Temporalmente los clientes existentes requerirán etapa 18: no desplegar esta entrega aislada.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 17».

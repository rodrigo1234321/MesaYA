# Etapa 16 — Cerrar lista de espera y módulos incompletos

Bloque: Operación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 15 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-16.md` (NUEVO al ejecutar).

## Misión

Cerrar lista de espera y módulos incompletos. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/waitlist.routes.ts`
- `packages/api/src/services/waitlist.service.ts`
- `apps/staff-panel/src/components/WaitlistManager.tsx`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Aplicar tenant/staff a list/call/seat y validar mesa destino del mismo restaurante.
2. [ ] En join público validar payload, flags y consentimiento/campos mínimos; no devolver listado de personas ni teléfonos.
3. [ ] Impedir doble asignación/seating secuencial y documentar precondiciones de concurrencia pendientes para etapa PostgreSQL.
4. [ ] Mantener preorden y recompensas desactivadas para piloto mientras no haya flujo integral aprobado; no tomar JSON almacenado como feature completa.

## Aceptación verificable

- [ ] Anónimo no lee teléfonos ni asigna mesa.
- [ ] Staff de B no llama/sienta lista A; mesa ajena se rechaza.
- [ ] Feature apagada se respeta también llamando directamente a la API.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No campañas, notificaciones externas ni habilitar preorden/recompensas.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 16».

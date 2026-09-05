# Etapa 26 — Guardar plano sin pérdidas ni sobrescrituras

Bloque: Datos.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 25 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-26.md` (NUEVO al ejecutar).

## Misión

Guardar plano sin pérdidas ni sobrescrituras. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/services/floorplan.service.ts`
- `packages/api/src/routes/floorplan.routes.ts`
- `apps/admin-dashboard/src/stores/useFloorPlanStore.ts`
- `packages/shared/src/rtms-schemas.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Validar el plano completo antes de transacción, incluidos IDs, tenant, zonas y referencias de mesas combinadas.
2. [ ] Agregar versión/precondición de layout y guardado atómico; dos ediciones sobre la misma versión producen un éxito y un 409.
3. [ ] No borrar por omisión mesas con sesión/ocupación/pedidos/historial. Para piloto rechazar eliminación peligrosa explícitamente; no inventar cascadas ni archivado amplio.
4. [ ] Preservar borrador local ante 409 y pedir recarga/reintento consciente. Crear migración/versionado si hace falta y tests de rollback.

## Aceptación verificable

- [ ] Payload parcialmente inválido no cambia ninguna posición/zona.
- [ ] Plano vacío/omisión no borra silenciosamente mesas del restaurante.
- [ ] Dos editores no pierden cambios por último escritor; conflicto visible.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No editor nuevo ni refactor gráfico.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 26».

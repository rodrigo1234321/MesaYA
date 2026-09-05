# Etapa 13 — Validar llamados, feedback y lecturas privadas

Bloque: Operación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 12 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-13.md` (NUEVO al ejecutar).

## Misión

Validar llamados, feedback y lecturas privadas. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/calls.routes.ts`
- `packages/api/src/routes/feedback.routes.ts`
- `packages/api/src/services/call.service.ts`
- `packages/api/src/services/feedback.service.ts`
- `apps/staff-panel/src/lib/api.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Aplicar validador de sesión activa a acciones de invitado y tenant/rol a lecturas/gestión de staff.
2. [ ] Impedir cancelación o feedback sobre recursos de otra sesión; validar enums, tamaños y repetición según contrato explícito.
3. [ ] Derivar staff de JWT al atender; no confiar en actor del body. Minimizar datos personales devueltos.
4. [ ] Preservar funcionamiento sin permiso GPS con controles de sesión; documentar que geofence no autoriza. Cubrir casos negativos HTTP reales con app.inject.

## Aceptación verificable

- [ ] Sesión vencida/cerrada no llama, cancela ni deja feedback autorizado por token viejo.
- [ ] Staff A no lee/atiende llamados B.
- [ ] Reintento normal no duplica feedback ni devuelve éxito sobre recurso inexistente.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

Deduplicación concurrente distribuida queda para PostgreSQL; no confundir este test con prueba multiinstancia.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 13».

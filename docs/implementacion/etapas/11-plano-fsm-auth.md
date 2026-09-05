# Etapa 11 — Autorizar plano y transiciones FSM

Bloque: Autorización.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 10 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-11.md` (NUEVO al ejecutar).

## Misión

Autorizar plano y transiciones FSM. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/floorplan.routes.ts`
- `packages/api/src/routes/tablestate.routes.ts`
- `packages/api/src/services/fsm.service.ts`
- `apps/admin-dashboard/src/lib/api.ts`
- `apps/staff-panel/src/lib/api.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Manager del tenant modifica geometría/zonas/plano; staff del tenant consulta y realiza taps operativos; override sólo manager.
2. [ ] Derivar actor desde JWT; ignorar/rechazar staffUserId ajeno del body. Verificar tenant de tableId y zoneId antes de operar.
3. [ ] Transportar expectedCurrentState hasta la comprobación atómica del servicio; un estado obsoleto da 409 sin evento de éxito.
4. [ ] Adaptar únicamente consumidores afectados y completar tests A/B y matriz.

## Aceptación verificable

- [ ] No es posible override como anónimo o mozo ni suplantar actor.
- [ ] Dos taps con la misma precondición no producen dos transiciones exitosas.
- [ ] IDs de otra mesa/zona no cruzan tenants.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No reescribir FSM ni guardado masivo del plano.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 11».

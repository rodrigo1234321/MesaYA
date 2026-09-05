# Etapa 02 — Restaurar build y contratos compartidos

Bloque: Fundación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 01 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-02.md` (NUEVO al ejecutar).

## Misión

Restaurar build y contratos compartidos. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `package.json`
- `packages/shared/src/rtms-types.ts`
- `packages/shared/src/rtms-schemas.ts`
- `packages/api/src/routes/floorplan.routes.ts`
- `packages/api/src/services/floorplan.service.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Reproducir compilación en serie y registrar diagnósticos actuales; no reutilizar dist como prueba de éxito.
2. [ ] Alinear FloorPlanUpdateItem con el schema respecto de sector, isOutdoor y mergedWithTableId; mantener contrato público y evitar any, ts-ignore o dependencias circulares.
3. [ ] Corregir success duplicado en la respuesta de floorplan sin alterar significado.
4. [ ] Ordenar build: shared antes de api, luego apps/hardware; detener con exit no-cero al primer fallo. Ejecutar build completo y test:isolated.

## Aceptación verificable

- [ ] Build limpio de todos los workspaces con exit 0.
- [ ] Contrato acepta los tres campos con sus tipos correctos y rechaza tipos inválidos.
- [ ] Sin supresión de errores TypeScript ni dependencia de artefactos viejos.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No refactor masivo del monorepo ni cambios de framework.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 02».

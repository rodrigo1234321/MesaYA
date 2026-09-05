# Etapa 09 — Proteger todas las mutaciones del menú

Bloque: Autorización.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 08 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-09.md` (NUEVO al ejecutar).

## Misión

Proteger todas las mutaciones del menú. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/menu.routes.ts`
- `apps/admin-dashboard/src/lib/api.ts`
- `apps/admin-dashboard/src/components/MenuManager.tsx`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Aplicar manager + tenant a categorías, ítems, importación, branding, template y generación IA; mantener GET de menú/upsell público con DTO explícito.
2. [ ] Resolver pertenencia de categoría/ítem por relaciones reales de DB, no sólo por slug en la URL.
3. [ ] Para replace/import validar payload completo antes de transacción y limitar tamaño/cantidad; rollback total ante fallo. Mantener autoApply IA deshabilitado.
4. [ ] Corregir envío de auth en el consumidor del módulo y documentar rutas reales en la matriz.

## Aceptación verificable

- [ ] Manager A no modifica ítem/categoría de B cambiando body, ID o slug.
- [ ] Importación inválida deja el menú anterior intacto.
- [ ] GET público funciona; mutaciones anónimas y mozo devuelven rechazo sin cambios.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No crear nuevo editor ni poblar menús reales.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 09».

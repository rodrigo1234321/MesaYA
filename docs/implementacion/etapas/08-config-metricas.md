# Etapa 08 — Proteger configuración, auditoría y métricas

Bloque: Autorización.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 07 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-08.md` (NUEVO al ejecutar).

## Misión

Proteger configuración, auditoría y métricas. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/config.routes.ts`
- `packages/api/src/routes/analytics.routes.ts`
- `packages/api/src/routes/metrics.routes.ts`
- `apps/admin-dashboard/src/lib/api.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Aplicar manager + tenant a configuración administrativa, auditoría, analítica y métricas.
2. [ ] Separar DTO público mínimo de configuración de servicio del DTO administrativo. Jamás exponer claves cifradas, PINs, teléfonos o tokens.
3. [ ] Preservar campos que necesita el menú/cliente sin exigir login administrativo a un comensal.
4. [ ] Actualizar consumidor admin compartido y pruebas de la matriz; si hay fetch directos en componentes, corregir sólo los de este módulo y listarlos.

## Aceptación verificable

- [ ] Anónimo y staff sin rol no leen ni escriben configuración administrativa.
- [ ] Manager de A obtiene sólo sus métricas, incluso manipulando IDs.
- [ ] Menú público carga con su DTO limitado y no contiene secretos.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No rediseñar analítica ni recompensas.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 08».

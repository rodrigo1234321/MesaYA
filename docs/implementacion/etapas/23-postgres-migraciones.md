# Etapa 23 — Migraciones y harness PostgreSQL desechable

Bloque: Datos.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 22 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-23.md` (NUEVO al ejecutar).

## Misión

Migraciones y harness PostgreSQL desechable. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/package.json`
- `packages/api/prisma/schema.supabase.prisma`
- `scripts/test-isolated.mjs`
- `docs/DEPLOY_VERCEL_SUPABASE.md`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Preparar historial de migraciones PG revisable en directorio diferenciado (NUEVO) y comando migrate deploy específico, sin sobrescribir historial ajeno.
2. [ ] Agregar runner PG de integración contra instancia efímera local/CI identificada explícitamente. Nunca tomar DATABASE_URL normal como fallback; si no hay motor/permiso, BLOCKED con evidencia.
3. [ ] En DB nueva aplicar migraciones desde cero y correr tests de tenant/sesión/pedido, generando cliente PG primero; restaurar generación local después.
4. [ ] Documentar estrategia para BD existente: inventario, backup, baseline/diff y aprobación previa. No aplicar automáticamente una migración inicial a datos reales.

## Aceptación verificable

- [ ] DB efímera vacía se reconstruye sólo desde migraciones.
- [ ] Tests críticos pasan en PostgreSQL real, no mock ni SQLite etiquetado PG.
- [ ] Segunda aplicación no borra datos ni repite cambios; falta de entorno no se informa como PASS.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No crear recursos cloud, enviar datos ni migrar producción.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 23».

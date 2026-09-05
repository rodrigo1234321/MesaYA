# Etapa 22 — Unificar contratos SQLite/PostgreSQL

Bloque: Datos.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 21 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-22.md` (NUEVO al ejecutar).

## Misión

Unificar contratos SQLite/PostgreSQL. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/schema.supabase.prisma`
- `scripts/sync_supabase_schema.js`
- `packages/api/package.json`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Comparar modelos/campos/índices completos; corregir divergencia mergedWithTableId y toda diferencia no explicada por proveedor.
2. [ ] Definir fuente canónica de modelos manteniendo SQLite para tests rápidos y schema PG derivado; agregar modo --check al sincronizador sin escritura.
3. [ ] Separar comandos generate:sqlite y generate:postgres y validar destino antes de ejecutarlos; no generar ambos en paralelo sobre mismo cliente Prisma.
4. [ ] Crear prueba de paridad y validar schemas con URLs ficticias de sintaxis válida, sin conexión remota. Documentar qué NO prueba prisma validate.

## Aceptación verificable

- [ ] --check detecta deriva sin modificar archivos.
- [ ] Ambos schemas validan y comparten modelos/campos equivalentes.
- [ ] Provider y directUrl son diferencias explícitas; no se toca DB externa.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No db push, migrate dev ni seed contra Supabase.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 22».

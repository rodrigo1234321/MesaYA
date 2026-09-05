# Etapa 24 — Hacer atómicos turnos y sesiones

Bloque: Datos.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 23 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-24.md` (NUEVO al ejecutar).

## Misión

Hacer atómicos turnos y sesiones. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/services/shift.service.ts`
- `packages/api/src/services/session.service.ts`
- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/schema.supabase.prisma`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Definir invariantes: un turno activo por restaurante y una sesión activa por mesa/ocupación. Expresar qué representa activo y cómo se revoca.
2. [ ] Encapsular apertura/cierre/rotación en transacción con control concurrente probado en PG; no depender de leer antes de escribir sin lock/constraint.
3. [ ] Incluir cambios de schema y migración correspondiente si se requieren; sincronizar paridad sin ejecutar contra base real.
4. [ ] Publicar efectos/avisos sólo tras commit; ante fallo intermedio rollback completo. Probar carreras desde conexiones/procesos independientes.

## Aceptación verificable

- [ ] Dos aperturas simultáneas no dejan dos turnos/sesiones activos.
- [ ] Cierre fallido no deja mitad de sesiones abiertas y mitad cerradas.
- [ ] Token anterior queda inválido después del commit de rotación.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No desarrollar outbox general ni rehacer todos los servicios.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 24».

# Etapa 10 — Proteger mesas y apertura/cierre de turno

Bloque: Autorización.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 09 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-10.md` (NUEVO al ejecutar).

## Misión

Proteger mesas y apertura/cierre de turno. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/tables.routes.ts`
- `packages/api/src/routes/shifts.routes.ts`
- `packages/api/src/services/shift.service.ts`
- `apps/admin-dashboard/src/lib/api.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Aplicar política explícita: manager del tenant administra mesas y abre/cierra turno; staff del tenant puede leer el estado operativo mínimo.
2. [ ] Eliminar activeToken y tokens de sesión de listados generales/current shift. Si un flujo autorizado necesita QR, diseñar DTO específico sin filtrar todas las credenciales.
3. [ ] Proteger nuevas sesiones/cierres contra acceso de otro restaurante y validar recursos referidos.
4. [ ] Adaptar consumidores TablesManager/ShiftManager sólo si el contrato cambió; probar ambos y registrar archivos adicionales.

## Aceptación verificable

- [ ] No se abre/cierra turno ni rota sesión sin autorización.
- [ ] Listados públicos/operativos no contienen tokens de invitado.
- [ ] Manager de otro tenant no puede actuar usando IDs conocidos.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

La atomicidad y concurrencia de turnos se resuelven en etapa 24; no prometerlas aquí.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 10».

# Etapa 07 — Cerrar altas de personal y login admin

Bloque: Identidad.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 06 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-07.md` (NUEVO al ejecutar).

## Misión

Cerrar altas de personal y login admin. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/staff.routes.ts`
- `packages/api/src/routes/auth.routes.ts`
- `packages/api/src/services/staff.service.ts`
- `apps/admin-dashboard/src/lib/api.ts`
- `apps/admin-dashboard/src/components/StaffManager.tsx`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Exigir manager del mismo restaurante para listar/crear/administrar personal; validar roles y PIN sin devolver hash ni PIN.
2. [ ] Restringir login-admin a roles habilitados de ese restaurante; comprobar todos los JWT emitidos usan la política de etapa 05.
3. [ ] Para el piloto cerrar registro público de restaurantes mediante configuración de servidor desactivada por defecto. No aceptar altas que se asocien arbitrariamente a un tenant existente.
4. [ ] Actualizar el consumidor administrativo para mandar credencial y manejar 401/403 sin falsos éxitos; cubrir manager A, mozo A y manager B.

## Aceptación verificable

- [ ] Anónimo no puede crearse manager ni listar personal.
- [ ] Mozo no consigue sesión administrativa; manager B no administra A.
- [ ] Configuración normal de piloto rechaza onboarding público sin escrituras.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No dashboard de superadmin ni sistema de invitaciones completo.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 07».

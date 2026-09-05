# Etapa 12 — Separar QR estable de sesión operativa

Bloque: Operación.
Estado: consultar [CONTROL](../CONTROL.md), no inferir por el número.
Prerequisito: etapa 11 APPROVED y esta ficha READY emitida por Codex.
Entrega: `docs/implementacion/reportes/ETAPA-12.md` (NUEVO al ejecutar).

## Misión

Separar QR estable de sesión operativa. Ejecutar únicamente esta ficha conforme al [PROTOCOLO](../PROTOCOLO.md).

## Archivos de entrada

- `packages/api/src/routes/sessions.routes.ts`
- `packages/api/src/services/session.service.ts`
- `apps/client-web/app.js`
- `hardware/qr-generator/generate.ts`

Leer sólo funciones necesarias. Se permiten tests enfocados del módulo y ajuste mínimo de consumidores/schema/migración cuando el checklist lo exige. Toda ampliación material requiere dividir y revisar la ficha.

## Checklist en orden

1. [ ] Fijar contrato de piloto: QR identifica restaurante/mesa; staff abre ocupación/sesión. Consultar QR NO crea mesa, turno ni sesión y no abre mesas cerradas.
2. [ ] Deshabilitar demo-token/latest/null/undefined como atajos fuera de test/desarrollo explícito. Mesa inexistente ->404; mesa sin sesión activa ->estado inactivo sin token.
3. [ ] Centralizar validación de guest session: restaurante, mesa, turno, expiry y closedAt. Rotar/revocar al cambiar ocupación.
4. [ ] Adaptar cliente a mesa inactiva y token vencido sin loops ni creación implícita. Confirmar QR existentes, sin reimprimir hardware automáticamente.
5. [ ] Documentar limitación: quien conserva el QR estable puede consultar una mesa activa remotamente. GPS es señal, no prueba de presencia; una admisión fuerte por visita requiere decisión separada antes de habilitar acciones sensibles.

## Aceptación verificable

- [ ] Abrir un QR desconocido no cambia counts de tablas/turnos/sesiones.
- [ ] Token de ocupación anterior no vuelve a servir al reabrir mesa.
- [ ] Cliente muestra estado inactivo y conserva acceso al menú público sin privilegios de sesión.
- [ ] Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales.
- [ ] Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión.

## Fuera de alcance

No prometer anti-fraude de presencia con QR fijo; no inventar GPS obligatorio ni PIN de visita sin revisión.

## Parada obligatoria

Completar [plantilla de reporte](../REPORTE_TEMPLATE.md), actualizar sólo esta etapa a NEEDS_REVIEW (o BLOCKED con causa) y detenerse. No marcar APPROVED, no desbloquear ni ejecutar la próxima etapa.

Prompt de seguimiento para Rodrigo: «Codex, revisá la etapa 12».

# Revisión Codex — Etapa 24

Estado: APPROVED
Fecha: 2026-09-04
Ficha: [Etapa 24](../etapas/24-atomicidad-turnos.md)
Reporte revisado: [ETAPA-24](../reportes/ETAPA-24.md)

## Verificación

- `Shift.activeKey` único representa el `restaurantId` mientras el turno está abierto; `TableSession.activeKey` único representa el `tableId` mientras la sesión está activa. El cierre/rotación los limpia en la misma transacción.
- Apertura, cierre de turno, cierre de mesa y rotación de sesión ya no exponen estados parciales; los efectos se publican después del commit.
- Las carreras simultáneas se probaron desde operaciones concurrentes en SQLite aislada y PostgreSQL `16-alpine` real; ambas dejaron un único activo y revocaron el token anterior.
- La migración PG incremental `20260904210000_add_active_keys` se aplicó desde cero junto con la inicial y el cliente SQLite se restauró después.
- Build completo: 6/6 workspaces.
- Runner aislado final: 24/24 suites, 0 fallas.
- `dev.db` mantuvo SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- No se usaron bases remotas, datos reales ni outbox/locks externos fuera de alcance.

## Decisión

No hay cambios solicitados dentro del alcance de la ficha. Etapa 24 aprobada; se habilita la Etapa 25.

# Revisión Codex — Etapa 25

Estado: APPROVED
Fecha: 2026-09-04
Ficha: [Etapa 25](../etapas/25-limites-dedup.md)
Reporte revisado: [ETAPA-25](../reportes/ETAPA-25.md)

## Verificación

- `AbuseControlService` usa un bucket persistido con clave única y operaciones `UPDATE` condicionales; la expiración y las carreras de inserción se reintentan de forma acotada. No existe un contador en memoria como autoridad de proceso.
- Login, waitlist, llamadas e IA construyen claves con el tenant/sesión correspondiente. Las rutas emiten `429` y `Retry-After`; no leen `X-Forwarded-For` sin proxy confiable.
- `CallRequest.activeKey` único representa la sesión mientras el llamado está activo y se limpia al resolver/cancelar. La creación dejó de hacer `count-then-create`; la carrera concurrente fue probada con dos conexiones.
- La cuota IA del tenant se consume antes de llamar al proveedor y no se reembolsa ante fallos; la cuota de sesión existente queda como límite adicional de producto.
- Suite focalizada: 3/3 en SQLite y 3/3 contra PostgreSQL `16-alpine` real. Build: 6/6 workspaces. Runner final: 25/25 suites, 0 fallas.
- `schema.supabase.prisma` pasó `--check`, la migración `20260904220000_add_abuse_controls` se aplicó sólo en la base PostgreSQL efímera y `dev.db` conservó SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- No se agregaron logs de PIN/token; los tokens que aparecen en la salida del seed son sintéticos de las sandboxes y pertenecen al runner preexistente.

## Decisión

No hay cambios solicitados dentro del alcance de la ficha. Etapa 25 aprobada; se habilita la Etapa 26. El flujo puede continuar con OpenCode sobre la ficha 26, manteniendo la parada obligatoria de esa ficha.

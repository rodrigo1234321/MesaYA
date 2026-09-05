# Revisión Codex — Etapa 12: Separar QR estable de sesión operativa

Fecha: 2026-09-04 (-03:00)  
Veredicto: **CHANGES_REQUESTED**

La consulta canónica `GET /sessions/:slug/:tableLabel` ya es de sólo lectura, y la nueva suite cubre correctamente la revocación/rotación por FSM en SQLite efímera. Sin embargo, la etapa no puede aprobarse aún por dos rutas que contradicen el contrato de piloto:

1. `GET /sessions/table/:label` sigue activo y llama a `getOrCreateActiveDemoSession`. Busca una mesa únicamente por etiqueta y puede devolver un token operativo sin identificar el restaurante. Esto mantiene un atajo legacy no tenant-scoped, contrario a «QR identifica restaurante/mesa» y al retiro de atajos demo.
2. `SessionService.createNewSessionForTable` ejecuta `tableSession.updateMany(... closedAt: now)` antes de verificar si existe un turno abierto. Si no hay turno, devuelve error 400 pero ya revocó sesiones previas: una operación que debía fallar sin abrir sesión produce una mutación lateral.

Corrección requerida, sin iniciar la etapa 13:

- Retirar o bloquear fuera de un entorno explícito de desarrollo/prueba la ruta legacy por etiqueta y su camino de resolución. La URL QR canónica debe seguir siendo `/r/:slug/mesa/:label` y resolver sólo mediante restaurante + mesa. Adaptar el cliente para no usar el endpoint legacy como fallback.
- Consultar y validar el turno abierto antes de cerrar sesiones en `createNewSessionForTable`; idealmente conservar esa secuencia en una unidad atómica cuando corresponda. Si no hay turno, no debe cambiar ninguna sesión existente.
- Extender la suite real SQLite: comprobar que la ruta legacy no puede resolver ni revelar un token activo de otra mesa/restaurante, y que un intento de crear sesión sin turno abierto deja intacta una sesión preexistente.
- Actualizar el reporte y ejecutar build + `test:isolated` completos, preservando `dev.db`.

La etapa 12 permanece en corrección y la 13 sigue bloqueada.

## Revisión final — 2026-09-04 (-03:00)

Veredicto: **APPROVED**

La ruta legacy quedó bloqueada salvo un flag exclusivo de test y, aun con éste, devuelve sólo estado inactivo sin token. El cliente dejó de usar ese fallback. `createNewSessionForTable` ahora comprueba el turno antes de cualquier cierre y agrupa el cierre/creación posterior en una transacción; la prueba SQLite verifica que un fallo sin turno no altera una sesión existente. La suite enfocada además cubre bloqueo legacy y no revelación de tokens. Build 6/6, 14/14 suites aisladas y el hash de `dev.db` declarado coinciden con la revisión.

La etapa 12 queda aprobada. La etapa 13 queda `READY`.

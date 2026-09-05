# Revisión Codex — Etapa 13: Validar llamados, feedback y lecturas privadas

Fecha: 2026-09-04 (-03:00)  
Veredicto: **CHANGES_REQUESTED**

Las rutas de llamados ya validan sesión, expiración, turno y propiedad; la lectura/atención de staff está aislada por tenant y la nueva suite aporta cobertura HTTP real A/B con SQLite. No obstante, queda un incumplimiento explícito en `FeedbackService.submitFeedback`:

- Para una sesión con `closedAt`, el servicio permite crear feedback durante hasta una hora si no encuentra una sesión posterior. La ficha exige validador de sesión **activa** para las acciones de invitado y su aceptación indica que una sesión cerrada no debe dejar feedback autorizado por token viejo. La ventana de gracia contradice ese contrato, aun cuando la mesa todavía no se haya reocupado.

Corrección requerida, sin iniciar la etapa 14:

- Rechazar con `410 SESSION_CLOSED` cualquier `TableSession` con `closedAt !== null`, sin ventana de gracia ni excepción por ausencia de sesiones posteriores.
- Agregar un caso HTTP real en `calls-feedback-access.test.ts` para una sesión cerrada hace segundos, verificando `410` y que no se cree ninguna fila de feedback. Mantener los casos de sesión expirada/reocupada como cobertura adicional.
- Actualizar el reporte para eliminar la decisión de permitir feedback tras el cierre; ejecutar build, `test:isolated` completo y verificar `dev.db` intacta.

La etapa 13 permanece en corrección y la 14 continúa bloqueada.

## Segunda revisión — 2026-09-04 (-03:00)

Veredicto: **CHANGES_REQUESTED**

La corrección de `FeedbackService` es correcta: una sesión con `closedAt !== null` ya recibe `410` sin excepción. Pero durante esa corrección se alteró fuera de la solicitud el ciclo de vida aprobado en la Etapa 12: `FSMService` dejó de cerrar `TableSession` al transicionar a `TO_CLEAN` y sólo la cierra al llegar a `AVAILABLE`.

Esto no es sólo una diferencia de interfaz. Con la mesa en `TO_CLEAN`, la sesión conserva `closedAt: null`; `CallService` y `FeedbackService` validan ese campo, por lo que el token podría todavía crear llamados o feedback. `SessionService.validateToken` lo oculta para la consulta QR, pero no invalida las acciones directas por token. Contradice la revocación inmediata de la Etapa 12 y el requisito de acciones de invitado con sesión activa.

Corrección requerida, sin iniciar la etapa 14:

- Restaurar el cierre de todas las sesiones activas (`closedAt: now`) al pasar a `TO_CLEAN` **y** mantenerlo idempotente en `AVAILABLE`.
- Agregar evidencia HTTP real: después de `TO_CLEAN`, el token anterior debe recibir `410` tanto en `POST /calls` como en `POST /feedback`, y no crear filas. Mantener la validación QR inactiva.
- No conservar una ventana implícita de token operativo durante limpieza. Actualizar reporte, ejecutar build y `test:isolated` completo, verificar `dev.db` y dejar la etapa en `NEEDS_REVIEW`.

## Revisión final — 2026-09-04 (-03:00)

Veredicto: **APPROVED**

`FeedbackService` rechaza ahora toda sesión cerrada, y `FSMService` vuelve a persistir el cierre de sesiones tanto en `TO_CLEAN` como, de forma idempotente, en `AVAILABLE`. La sección nueva de pruebas HTTP con SQLite acredita que el token revocado no crea llamados ni feedback, y que el QR canónico responde inactivo. El reporte declara build 6/6, 15/15 suites aisladas y `dev.db` intacta; la inspección coincide con esas garantías.

La etapa 13 queda aprobada. La etapa 14 queda `READY`.

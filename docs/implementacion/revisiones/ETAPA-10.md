# Revisión Codex — Etapa 10: Proteger mesas y apertura/cierre de turno

Fecha: 2026-09-04 (-03:00)  
Veredicto: **APPROVED**

- `tables.routes.ts` exige identidad de staff para la lectura operativa y rol MANAGER para crear, borrar, cerrar o rotar sesiones. Cada recurso se resuelve y compara contra el tenant vigente antes de mutar.
- `shifts.routes.ts` limita abrir/cerrar a MANAGER, limita el turno vigente a staff del mismo tenant y devuelve 404 para recursos de otro restaurante.
- Los DTO de listado de mesas, apertura de turno y turno vigente no incluyen tokens de invitado. `ShiftService.getCurrentShift` selecciona explícitamente los campos de sesión y omite `token`.
- La suite nueva cubre anónimo, mozo, manager propio y manager de otro tenant, además de la ausencia de tokens. El runner la incorpora al gate aislado.
- El reporte de OpenCode registra build 6/6 y 11/11 suites aisladas PASS, con `dev.db` sin cambios. La revisión estática confirmó que esas verificaciones coinciden con las rutas, el servicio y la suite entregada.

La etapa 10 queda aprobada. La etapa 11 queda READY.

# Revisión Codex — Etapa 16: Cerrar lista de espera y módulos incompletos

Fecha de revisión inicial: 2026-09-04 (-03:00)  
Veredicto final: **APPROVED**

La entrega original cubrió el aislamiento staff/tenant, la privacidad de `join`, las flags de fila/preorden y las precondiciones de concurrencia PostgreSQL. La revisión inicial encontró un bypass operativo; la corrección posterior lo resuelve y fue verificada de forma independiente.

## Hallazgo inicial (resuelto)

`WaitlistManager.handleSeat` llama `StaffApi.seatWaitlistGuest(id)` sin `tableId`. A su vez, `WaitlistService.seatGuest` sólo valida y ocupa la mesa dentro de `if (options?.tableId)`, pero después actualiza de todos modos la entrada a `SEATED`. Por lo tanto, un miembro del staff puede finalizar una espera sin mesa destino ni transición de la FSM; la misma vía evita la validación de restaurante y disponibilidad exigida por la ficha.

La suite prueba mesa ajena, ocupada y válida, pero no el caso HTTP de una entrada activa sin `tableId`, por lo que no detecta el bypass.

## Corrección solicitada (cumplida)

- Exigir `tableId` no vacío en `PATCH /v1/staff/waitlist/:id/seat` y en `WaitlistService.seatGuest`; sin él, responder `400 TABLE_ID_REQUIRED` antes de modificar la entrada o una mesa.
- Ajustar `WaitlistManager` para seleccionar explícitamente una mesa del restaurante antes de habilitar «Sentar» y enviar ese `tableId`. No mantener una acción que pueda sentar sin destino.
- Agregar prueba HTTP SQLite real: `seat` de una entrada `WAITING` o `CALLED` sin `tableId` devuelve 400 y la entrada conserva su estado; ninguna mesa cambia de estado.
- Actualizar el reporte, ejecutar build completo y `test:isolated` completo, verificar `dev.db` intacta, dejar CONTROL con Etapa 16 en `NEEDS_REVIEW` y detenerse.

## Verificación de la corrección

- `WaitlistService.seatGuest` exige un `tableId` de texto no vacío antes de cualquier lectura o mutación de la entrada o de la mesa, y devuelve `400 TABLE_ID_REQUIRED` si falta.
- `PATCH /v1/staff/waitlist/:id/seat` aplica la misma precondición y sólo remite el identificador validado al servicio.
- El panel de staff carga mesas disponibles, exige seleccionar una para cada entrada y mantiene «Sentar» deshabilitado hasta hacerlo; el cliente envía el `tableId` seleccionado.
- El endpoint de mesas que expone `currentState` y `capacity` continúa protegido por token de staff y comprueba el restaurante del solicitante, por lo que no introduce exposición pública ni cruce de tenant.
- La prueba HTTP SQLite cubre entradas `WAITING` y `CALLED` sin `tableId`: recibe `400 TABLE_ID_REQUIRED`, conserva el estado de la entrada y no modifica mesas. La ejecución independiente de `waitlist-lifecycle` finalizó con **26/26** pruebas aprobadas.
- Se revisó la evidencia de build completo y de `test:isolated` completo (**18/18** suites), y el runner independiente confirmó que `dev.db` conserva el hash canónico `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

No quedan hallazgos bloqueantes para la Etapa 16. Se aprueba y queda habilitada únicamente la Etapa 17; no se inició su ejecución.

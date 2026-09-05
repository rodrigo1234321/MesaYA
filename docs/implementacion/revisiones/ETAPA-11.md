# Revisión Codex — Etapa 11: Autorizar plano y transiciones FSM

Fecha: 2026-09-04 (-03:00)  
Veredicto inicial: **CHANGES_REQUESTED**

La revisión estática confirma que las rutas ya aplican los roles previstos, resuelven el tenant antes de operar y derivan el actor desde el JWT. También confirma que `FSMService.attemptTransition` usa `updateMany` condicionado por el estado y sólo audita/emite SSE después de una actualización exitosa.

No obstante, no queda demostrada la aceptación crítica «dos taps con la misma precondición no producen dos transiciones exitosas». La única prueba de conflicto (`floorplan-fsm-access.test.ts`, caso 5) reemplaza `fsmService.handleTapAction` por un mock que arroja manualmente `STATE_CONFLICT`; comprueba el mapeo HTTP y el transporte del parámetro, pero no ejecuta el `updateMany`, no compite por el mismo registro y no puede probar que haya una sola auditoría/SSE.

Corrección requerida, sin iniciar la etapa 12:

- Agregar una prueba enfocada con SQLite efímera y el `FSMService` real (o dos requests reales sin mock al servicio) que lance dos taps concurrentes con el mismo `expectedCurrentState`.
- Verificar exactamente un resultado exitoso y uno `409 STATE_CONFLICT`, el estado final esperado, exactamente un `TableStateEvent` y un único broadcast de estado. La prueba debe fallar si se producen dos transiciones exitosas.
- Mantener las pruebas A/B actuales y actualizar el reporte para distinguir esta evidencia ejecutada de la inspección estática. Ejecutar build y `test:isolated` completos, conservando `dev.db` intacta.

La implementación no necesita reescribirse: falta evidencia ejecutable de su propiedad de concurrencia. La etapa 11 permanece en corrección y la 12 sigue bloqueada.

## Segunda revisión — 2026-09-04 (-03:00)

Veredicto: **CHANGES_REQUESTED (documentación)**

La corrección aportó la evidencia que faltaba: `fsm-concurrency.test.ts` usa la SQLite efímera del runner, el `FSMService` y rutas reales; ejecuta dos operaciones concurrentes y verifica un único éxito, un único `409`, un único evento de auditoría y un único broadcast. La propiedad crítica de concurrencia queda acreditada.

Sólo queda ajustar el reporte antes de aprobar: `floorplan-fsm-access.test.ts` usa mocks de Prisma y de los servicios; por eso no debe presentarse como una prueba «con base de datos» ni como evidencia de punta a punta. Es una prueba de contrato de rutas A/B con JWT y mocks, válida para esas aserciones. Actualizar las filas correspondientes de la matriz metodológica y de criterios para describirla correctamente, sin cambiar código de producto ni pruebas. Mantener la etapa 11 en `NEEDS_REVIEW` y detenerse.

## Revisión final — 2026-09-04 (-03:00)

Veredicto: **APPROVED**

El reporte ya separa correctamente la prueba de concurrencia con SQLite real de las pruebas de contrato A/B respaldadas por mocks. La inspección confirma que la actualización condicional precede a la auditoría y al broadcast; la nueva suite ejecuta ambas vías concurrentes y comprueba un único éxito, un único conflicto `409`, un solo evento de auditoría y un solo SSE. Build 6/6, 13/13 suites aisladas y el hash de `dev.db` declarado permanecen correctos.

La etapa 11 queda aprobada. La etapa 12 queda `READY`.

# Revisión Codex — Etapa 18: Reconexión y avisos consistentes

Fecha de revisión inicial: 2026-09-04 (-03:00)  
Veredicto final: **APPROVED**

## Hallazgo bloqueante

En `useSSE.ts` y `useFloorPlanSSE.ts`, `scheduleNextPoll` se crea con `useCallback(..., [])` y dentro del timeout invoca `pollTick`. Esa función programadora conserva por cierre el `pollTick` del primer render. Cuando cambia `restaurantId` o `restaurantSlug`, el efecto nuevo sí hace una consulta inicial al restaurante nuevo, pero el próximo timeout puede ejecutar el tick anterior y volver a consultar el identificador previo.

En el dashboard, que ofrece selector de restaurante, esto rompe la reconciliación al cambiar de local y puede reemplazar el snapshot actual con uno obsoleto (o generar fallos 404 del tenant anterior). Incumple el polling autoritativo y consistente exigido por la ficha. Las pruebas actuales no cambian el identificador durante la vida del hook, por lo que no detectan la regresión.

## Corrección requerida, sin iniciar la Etapa 19

- Corregir ambos hooks para que cada timeout invoque el `pollTick` vigente del render actual y no una clausura inicial. Puede usarse una ref para el callback vigente o una estructura equivalente; preservar no solapamiento, `AbortController`, backoff y limpieza.
- Al cambiar de restaurante, cancelar el timeout y la petición pendiente del identificador anterior antes de comenzar el ciclo del nuevo identificador. El snapshot del restaurante anterior no debe poder actualizar el estado después del cambio.
- Agregar prueba automatizada de regresión que cambie `restaurantId`/`restaurantSlug` con un timeout ya programado y compruebe que sólo se consulta el nuevo identificador y que la respuesta anterior no actualiza el snapshot. Mantener las pruebas HTTP SQLite existentes.
- Actualizar reporte, ejecutar build completo y `test:isolated` completo, verificar el hash canónico de `dev.db`, dejar CONTROL con la Etapa 18 en `NEEDS_REVIEW` y detenerse.

## Revisión de la corrección

La implementación actual usa `pollTickRef`, cancelación y secuencia correctamente, por lo que resuelve el hallazgo en el código inspeccionado. Sin embargo, las dos pruebas nuevas de cambio de restaurante no ejecutan esos hooks: vuelven a escribir localmente un simulador de `pollTick`, `cancelPendingCycle` y `scheduleNextPoll`. La prueba puede permanecer verde aunque se rompan las referencias, el cleanup o los guards del código de producción; la inspección de strings tampoco cubre el comportamiento.

## Corrección requerida adicional, sin iniciar la Etapa 19

- Sustituir esa simulación por una prueba que ejercite el código real: montar `useSSE` y `useFloorPlanSSE` con timers/fetch controlados, o extraer el coordinador de polling a un módulo puro que ambos hooks importen y que el test invoque directamente. No duplicar la lógica bajo prueba dentro del test.
- Probar el cambio de `restaurantId`/`restaurantSlug` con una petición anterior pendiente y un timer programado: el fetch/tick siguiente debe usar sólo el identificador nuevo y la resolución atrasada no puede actualizar `calls` ni el store del plano.
- Actualizar reporte, ejecutar build completo y `test:isolated` completo, verificar hash canónico de `dev.db`, dejar CONTROL con Etapa 18 en `NEEDS_REVIEW` y detenerse.

## Verificación final de la corrección

- La lógica de scheduling, cancelación, `AbortController`, no solapamiento y descarte por secuencia vive ahora en `PollingCoordinator` de `@mesaya/shared`; ambos hooks lo importan y delegan en él, sin duplicar el scheduler.
- Las pruebas de regresión instancian el coordinador de producción contra `app.inject()` y SQLite efímera. Cubren cambio con timer activo, descarte de respuesta lenta del tenant previo y parada del ciclo.
- Verificación independiente: `polling-clients-reconnect` pasó **13/13**. Se revisó además la evidencia de build completo y de `test:isolated` completo (**20/20** suites), con `dev.db` conservando el hash canónico `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

No quedan hallazgos bloqueantes. La Etapa 18 se aprueba y queda habilitada únicamente la Etapa 19; no se inició su ejecución.

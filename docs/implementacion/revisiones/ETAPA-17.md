# Revisión Codex — Etapa 17: Cerrar SSE público y definir snapshots

Fecha de revisión inicial: 2026-09-04 (-03:00)  
Veredicto final: **APPROVED**

## Hallazgo bloqueante

La API sí cierra `/stream` y `/v1/stream` rápidamente con `410 SSE_STREAM_DISABLED`; las pruebas HTTP de snapshots y la redacción de tokens en plano/mesas cubren esa parte correctamente. Sin embargo, `apps/staff-panel/src/hooks/useSSE.ts` todavía obtiene el JWT del staff y lo incorpora a `URLSearchParams` como `token` antes de crear `new EventSource(...)`.

Aunque el servidor responda 410 sin validar ese token, el JWT ya fue enviado dentro de la URL. Puede persistir en logs del navegador, proxy, balanceador o servidor y volver a enviarse por los reintentos automáticos de `EventSource`. Eso contradice el checklist 3 de la ficha: evitar JWT permanente en query strings. La Etapa 18 reemplazará el consumo SSE por polling, pero no puede dejar esta fuga de credencial durante la transición.

## Corrección requerida, sin iniciar la Etapa 18

- En `apps/staff-panel/src/hooks/useSSE.ts`, eliminar de inmediato toda lectura y anexado del JWT a la URL de `/stream`; no enviar `token`, `authorization`, ni otro bearer credential en query string. No implementar todavía el rediseño de polling/reconexión de la Etapa 18.
- Añadir una prueba de regresión del consumidor (o un contrato automatizado equivalente) que demuestre que, aun existiendo JWT de staff, la URL construida para el endpoint legacy no lo contiene. Mantener las pruebas HTTP SQLite reales de cierre SSE y snapshots.
- Actualizar el reporte con la corrección, ejecutar build completo y `test:isolated` completo, verificar que `dev.db` conserva el hash canónico, dejar CONTROL con la Etapa 17 en `NEEDS_REVIEW` y detenerse.

## Verificación de la corrección

- `buildStaffStreamUrl` construye la URL legacy sólo con `restaurantId`; `useSSE` ya no llama `StaffApi.getAuthToken` ni anexa una credencial bearer como query parameter.
- La suite añadió contratos de regresión para la URL construida y una comprobación estática de ausencia de la lectura/anexado de token.
- Verificación independiente: `stream-closure-snapshots` pasó **23/23** sobre SQLite efímera. La base demo conserva el hash canónico `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Se revisó la evidencia de build completo y de `test:isolated` completo (**19/19** suites).

No quedan hallazgos bloqueantes. La Etapa 17 se aprueba y queda habilitada únicamente la Etapa 18; no se inició su ejecución.

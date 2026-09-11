# E04 — Reporte de proyección única de Servicio

**Estado:** `PASS_LOCAL_NEEDS_REVIEW`  
**Fecha:** 2026-09-09  
**Objetivo:** que el espacio de Servicio muestre, en un snapshot operativo único,
la tanda que debe atender con sus platos, cantidades, notas, participante legible,
total y motivo de revisión cuando corresponda.

## Cambios realizados

- Se amplió el contrato compartido de `ServiceTaskDTO` con `items`, `participants`,
  `notes`, `allergenNotes` y `reviewReason`, sin exponer `guestSessionId`, tokens ni
  `addedByGuest` a la pantalla.
- `getKitchenOrders` conserva origen, total minor-unit y precios de línea para que
  `ServiceWorkspaceService.getSnapshot()` pueda construir el contexto sin una
  segunda llamada de detalle.
- Las tareas de orden ahora resumen nombres y total, y transportan el detalle de
  cada línea, sus notas y el participante de alto nivel (`Comensal`, `Personal`,
  `Fila de espera` o `Sin identificar`).
- La pantalla de Servicio muestra el detalle de la tanda, advertencias de posibles
  restricciones declaradas y el motivo de revisión; el contexto de mesa muestra
  el detalle resumido de consumo y estados de cuenta.
- No se agregó migración ni se modificó el contrato público de historial de cuenta:
  las notas técnicas de una tanda no se exponen al comensal por esa vía.

## Evidencia

| Control | Resultado |
|---|---|
| `test/s01-s03-service-workspace.test.ts` + `test/e04-service-context.test.ts` | **5/5 PASS** |
| `test/e04-service-context.test.ts` aislado | **1/1 PASS** |
| `npm --workspace=@mesaya/shared run build` | **PASS** |
| `npm --workspace=@mesaya/api exec tsc -- --noEmit` | **PASS** |
| `npm --workspace=@mesaya/staff-panel run build` | **PASS** |
| Navegador local `http://localhost:5174` | Login, Servicio, mapa contextual y selección de Mesa 1 verificados; **PASS** |
| `git diff --check` | Sin errores de whitespace; sólo advertencias preexistentes de LF/CRLF |

La verificación visual usó el seed demo, que no tenía tareas activas. Por eso la
tarjeta con detalle no pudo observarse poblada en navegador; sus campos se verifican
con fixture persistente en el test E04 y el build de staff.

## Bloqueadores y límites

- El gate conjunto E00–E04 se cerró localmente en **77/77 tests** después de
  resolver la precedencia de deuda y las asignaciones minor-unit; la revisión
  independiente y cualquier certificación externa siguen pendientes.
- La detección de alergia/restricción es una señal informativa derivada de notas
  libres. Por decisión de producto, una restricción ya contemplada por la carta no
  agrega una confirmación humana adicional; las revisiones de E05 quedan para stock,
  umbral, modo manual u otra regla identificada.
- La identidad de participante es deliberadamente de rol; la colaboración nominal
  queda para E13.
- E04 no certifica Supabase/Vercel, restauración, dispositivos físicos, QR/NFC ni
  un GO humano de piloto.

## Decisión

Mantener E04 en `PASS_LOCAL_NEEDS_REVIEW`. La decisión explícita del ciclo
habilita E05: el stock/umbral/modo manual se revisan; la alergia ya contemplada
por la carta queda como contexto sin confirmación adicional.

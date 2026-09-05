# Revisión Codex — Etapa 26

Estado: APPROVED
Fecha: 2026-09-05
Ficha: [Etapa 26](../etapas/26-plano-atomico.md)
Reporte revisado: [ETAPA-26](../reportes/ETAPA-26.md)

## Hallazgos bloqueantes

### 1. El guardado usado por la UI evita el CAS y la preservación del borrador

En `apps/admin-dashboard/src/components/FloorPlan/FloorPlanManager.tsx:59-84`, `handleSaveLayout` llama directamente a `AdminApi.updateFloorPlan`, omite `expectedVersion` y luego ejecuta `markChangesSaved()`. El store sí tiene `saveFloorPlan`/`persistTables` con versión y captura de 409, pero el botón conectado a `FloorPlanToolbar` no los utiliza. Por lo tanto, dos editores que guardan desde la pantalla real todavía tienen comportamiento de último escritor y un 409 no conserva el borrador en ese flujo. Las pruebas `floorplan-atomic-save` invocan el servicio directamente y no detectan este bypass.

Corrección requerida: conectar el botón al action versionado del store (incluyendo canvas/layout y `mergedWithTableId` cuando corresponda), actualizar la versión devuelta y mostrar el conflicto preservando el borrador; agregar una prueba de integración del action/componente o del consumidor que demuestre que el payload lleva `expectedVersion` y que un 409 no marca los cambios como guardados.

### 2. Existe una ruta de escritura de posiciones sin precondición

`packages/api/src/routes/floorplan.routes.ts:118-153` delega `PATCH /tables/:tableId/position` a `FloorPlanService.updateTablePosition`, que en `floorplan.service.ts:597-612` hace un `update` directo. `TablePositionUpdateSchema` tampoco acepta una versión. Aunque el canvas actual mueve localmente y el reporte lo documenta como deuda, la ruta sigue expuesta para managers y puede sobrescribir la edición de otro cliente sin 409. Esto contradice la misión de guardar sin pérdidas y deja un bypass del CAS bulk.

Corrección requerida (una de estas opciones, con evidencia): incorporar `expectedVersion` y compare-and-swap atómico que incremente `FloorPlanLayout.version`, con `409 LAYOUT_VERSION_CONFLICT` y propagación de `Retry/recarga`; o retirar/deshabilitar la vía rápida y hacer que todos los consumidores usen el guardado bulk versionado. No dejar una ruta de escritura activa sin precondición.

## Verificaciones realizadas

- La suite enfocada reportada pasó 6/6 en SQLite y PostgreSQL, pero prueba principalmente `FloorPlanService.updateFloorPlan`; no cubre el `FloorPlanManager` real ni la ruta PATCH versionada.
- `sync --check`, build 6/6, runner 26/26 y la integridad de `dev.db` fueron verificados; no compensan los dos bypass anteriores.
- No se inició la Etapa 27.

## Decisión

`CHANGES_REQUESTED`: corregir la misma Etapa 26, agregar pruebas que pasen por los consumidores/rutas reales y repetir build + runner completo. Conservar este informe y el reporte existente; no aprobar ni desbloquear la Etapa 27 hasta cerrar ambos hallazgos.

## Revisión de la corrección (2026-09-05)

### Resultado

`CHANGES_REQUESTED`. El hallazgo de la UI quedó cerrado, pero la vía rápida de posición todavía conserva un bypass de último escritor.

### Verificaciones positivas

- `FloorPlanManager.handleSaveLayout` delega en `saveFloorPlan`; el banner conserva el borrador ante 409 y ofrece recarga/reintento consciente.
- `persistTables` envía canvas/layout, `expectedVersion` y `mergedWithTableId`; actualiza la versión sólo después de una respuesta exitosa.
- La ruta PATCH mapea 400/404/409 y el cliente propaga `statusCode`/`code`/`details`.
- La transacción con CAS funciona cuando se proporciona una versión: el movimiento y el bump de `FloorPlanLayout.version` son atómicos y una versión obsoleta devuelve 409 sin mover la mesa.

### Hallazgo bloqueante restante

`PATCH /tables/:tableId/position` sigue aceptando un body sin `expectedVersion` (`packages/shared/src/rtms-schemas.ts:105-111`, `rtms-types.ts:205-211`). En ese caso `updateTablePosition` entra en la rama `data.expectedVersion === undefined` (`packages/api/src/services/floorplan.service.ts:636-661`) y hace `update` de la mesa más incremento de versión sin compare-and-swap. La propia prueba `packages/api/test/floorplan-position-cas.test.ts:114-125` fija este comportamiento como “sigue funcionando (compatibilidad)” y verifica una escritura 200.

Esto contradice el hallazgo 2 de esta revisión: mientras la ruta permanezca activa, no puede existir una escritura sin precondición. Un cliente antiguo o una llamada manual todavía puede sobrescribir la posición de otro editor sin 409. Hacer el campo “opcional” no cierra el bypass.

### Corrección requerida

Elegir una única salida y cubrirla con prueba HTTP real:

1. Preferida: hacer `expectedVersion` obligatorio en schema y tipo, rechazar su ausencia antes de cualquier escritura (400 `LAYOUT_VERSION_REQUIRED` o 428 mapeado explícitamente), y conservar el CAS transaccional para la versión presente.
2. Alternativa: retirar/deshabilitar completamente `PATCH /tables/:tableId/position` y demostrar que no queda ningún consumidor de esa vía.

En ambos casos, reemplazar el test de compatibilidad por uno que demuestre ausencia de escrituras ante precondición faltante. Si se mantiene la ruta, conservar además los casos 200 con versión fresca y 409 obsoleto sin cambios.

### Evidencia ejecutada por Codex

- `node scripts/test-isolated.mjs floorplan-store-save`: 3/3 PASS.
- `node scripts/test-isolated.mjs floorplan-position-cas`: 4/4 PASS (incluye el comportamiento inseguro sin versión señalado arriba).
- `node scripts/test-isolated.mjs`: 28/28 suites PASS.
- `node scripts/build.mjs`: 6/6 workspaces PASS.
- `packages/api/prisma/dev.db` intacta; SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- El reporte implementador documenta además 4/4 en PG 16 desechable; no se repitió PG durante esta revisión porque el bloqueo es visible en el contrato y en la prueba HTTP SQLite.

La Etapa 27 permanece bloqueada y no se inició.

## Cierre de segunda corrección (2026-09-05)

### Resultado

`APPROVED`.

El contrato de posición ahora exige `expectedVersion` tanto en Zod como en TypeScript. La ruta devuelve 400 `LAYOUT_VERSION_REQUIRED` ante su ausencia y el servicio repite la guarda antes de abrir la transacción. No queda una rama que escriba sin compare-and-swap.

La suite HTTP real demuestra que un PATCH sin versión no modifica ni coordenadas ni versión de layout; también cubre la defensa directa del servicio, el éxito con versión fresca, el 409 obsoleto sin escrituras y los errores del guardado bulk. Los ajustes de `floorplan-fsm-access` y `full-system-e2e` sólo aportan la precondición exigida y preservan sus verificaciones de autorización y flujo completo.

### Evidencia ejecutada por Codex

- `node scripts/test-isolated.mjs floorplan-position-cas`: 5/5 PASS.
- `node scripts/test-isolated.mjs floorplan-fsm-access`: 5/5 PASS.
- `node scripts/test-isolated.mjs full-system-e2e`: 39/39 PASS.
- `node scripts/build.mjs`: 6/6 workspaces PASS.
- `node scripts/test-isolated.mjs`: 28/28 suites PASS.
- `packages/api/prisma/dev.db` intacta; SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.

El reporte documenta adicionalmente la misma suite 5/5 sobre PostgreSQL 16 desechable. La nota anterior que registraba PATCH como pendiente queda supersedida por la sección “Segunda corrección Codex”.

## Decisión final

Etapa 26 queda `APPROVED`. Se habilita únicamente la Etapa 27 en `READY`; no fue iniciada durante esta revisión.

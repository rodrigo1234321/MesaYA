# CONTINUAR — plan de remediación servicio (MesaYA)

## Estado coordinado

- E00–E21 están documentadas como `VERIFIED_LOCAL` para implementación y
  validación local.
- E22 está `VERIFIED_LOCAL` para el perfil fail-closed, checker, focal,
  regresión y dos corridas k6 contra una SQLite nueva y aislada, incluida una
  con flujo mutante y conciliación. Además, el subgate
  `PASS_CLOUD_EPHEMERAL` pasó en PostgreSQL 17 efímero con dos jobs CI
  independientes (run `35171261968`). Staging/proveedor real queda
  `PENDING_CLOUD` y la observación con mozos/equipos queda `PENDING_HUMAN`;
  no equivale a GO de producción ni a una capacidad de mesas certificada.
- E23 sigue `NOT_STARTED`/`PENDING_HUMAN` porque requiere personas, dispositivos
  y observación presencial. E24 quedó finalizada en su alcance: paquete,
  backup/restore temporal, migración auditada, mapping SHA→Vercel y smoke
  HTTPS/CORS/QR. No cierra los gates humanos ni la carga E22 sobre PostgreSQL.
- Ningún estado local o efímero equivale todavía a GO de producción: permanecen
  gates `PENDING_CLOUD` y `PENDING_HUMAN`.

## Última corrida: E16 (2026-09-15)

- **Ejecutor:** OpenCode con `opencode/muse-spark-1.3-contributor-free`;
  revisión independiente y verificación por Codex.
- **SHA/árbol:** HEAD `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`, sin commit; se
  preservó el árbol sucio E00–E15 y no se hicieron operaciones destructivas.
- **Resultado:** semántica única de consumo por fecha original, cobro neto,
  propina, devolución por fecha propia, saldo al corte y turno explícito
  `[desde,hasta)` en zona IANA.
- **Cambios:** tipos compartidos; servicio y rutas de ventas; CSV; PDF A4 con
  bloque de turno y columna `DEVOLUCIÓN`; Admin con selector de turno actual,
  criterio visible y error sin falso cero.
- **Corrección adicional de revisión:** devoluciones sobre settlements
  históricos aparecen como salidas negativas del período sin recobrar el
  movimiento original.
- **Pruebas:** focal 10/10; regresión de 6 archivos 62/62; build 6/6
  workspaces; todos exit 0 y los Job Objects finalizaron vacíos.
- **Residuos trazados:** matriz de rutas exit 1 por cuatro problemas previos de
  E14; `git diff --check` exit 2 por línea blanca EOF previa en
  `apps/staff-panel/src/App.tsx`. No son fallas introducidas por E16.

## E15 y pendientes externos

- E15 sigue `VERIFIED_LOCAL`; S21 PostgreSQL multi-conexión queda
  `PENDING_CLOUD` porque el host no tiene PostgreSQL/daemon Docker disponible.
- Las validaciones de navegador/tablet, equipos, dos pantallas, hardware y
  ensayo con mozos siguen `PENDING_HUMAN` en las fichas correspondientes.
- No usar datos reales, `.env`, Supabase/Vercel ni declarar certificación sin
  evidencia de esos gates.

## Última corrida: E17 (2026-09-15)

- **Ejecutor:** OpenCode con `opencode/muse-spark-1.3-contributor-free`;
  sin cambio de modelo, sin otros agentes. Revisión no independiente.
- **SHA/árbol:** entrada `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`, sin
  commit; se preservó el árbol sucio E00–E16 (sin operaciones destructivas)
  y sólo se tocaron archivos autorizados: `apps/client-web/app.js`,
  `apps/client-web/index.html` (2 líneas accesibles), test focal nuevo,
  `reportes/E17.md`, `evidencia/E17/DIAGNOSTICO.md`,
  `evidencia/E17/VERIFICACION-CODEX-20260915.md`, `CONTINUAR.md` y estado E17
  en `CONTROL.md`. Backend sin cambios (idempotencia de submit ya estable,
  verificada por lectura contra B06).
- **Resultado:** mutex por intención (agregar/quitar/enviar) con restauración
  en `finally`, mutaciones en una sola tentativa (`fetchMutationOnce`, 10000),
  clave auxiliar ligada a restaurante/mesa/versión de sesión/orden sin tokens
  crudos, reseteo de la acción del plato (intención `4c8d02f`), invalidación
  ante sesión vencida/cambio de mesa y mensajes honestos con reconciliación.
  Se agregó el tratamiento de `410` durante la sincronización del carrito.
- **Pruebas posteriores:** focal E17 exit 0 (17/17); regresión de 11 archivos
  exit 0 (124/124); build exit 0 (6/6 workspaces). Cada corrida terminó con
  Job Object vacío. La matriz de rutas exit 1 sólo por cuatro residuos de E14;
  `git diff --check` focal exit 0 y el global conserva el EOF previo de E14.
- **Gate:** `VERIFIED_LOCAL` para código, focal, regresión y build. La prueba
  física de doble tap con latencia, offline post-commit, dos teléfonos y
  cambio de mesa/sesión queda `PENDING_HUMAN`; S21 PostgreSQL de E15 queda
  `PENDING_CLOUD`.

## Última corrida: E18 (2026-09-15)

- **Ejecutor:** OpenCode con `opencode/muse-spark-1.3-contributor-free` bajo
  Job Object; la sesión terminó por `supervisor_time_gap` (exit 125) antes de
  cerrar tests/documentación. Codex revisó, corrigió y verificó de forma
  independiente; no se inventa revisión de otro agente.
- **SHA/árbol:** entrada y salida `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`,
  sin commit; se preservó el árbol dirty E00–E17 sin operaciones destructivas.
- **Resultado:** tabs/panels y navegación de teclado del Admin, estados
  accesibles, coordinación tenant-scoped/RTMS, flags/roles, Ventas/tickets/
  filtros/exportaciones preservados y QR sin fallback silencioso al host del
  Admin cuando falta `VITE_CLIENT_WEB_URL`. Se agregó test focal S25 y se dejó
  documentada la corrección mínima adicional de `TablesManager.tsx`.
- **Pruebas:** focal E18 exit 0 (9/9); regresión dirigida exit 0 (46/46);
  regresión amplia de 20 archivos exit 0 (200/200); build exit 0 (6/6).
  Matriz de rutas exit 1 sólo por cuatro residuos previos de E14. `git diff
  --check` scoped exit 0; global exit 2 sólo por EOF previo en
  `apps/staff-panel/src/App.tsx:461`.
- **Gate:** `VERIFIED_LOCAL` técnico. `PENDING_HUMAN` para navegador real,
  teclado/zoom/tablet/lector, QR en teléfono y recorrido observado del dueño;
  `PENDING_CLOUD` para variable/dominio/deployment real y S21 heredado de E15.

## Última corrida: E19 (2026-09-16)

- **Ejecutor:** OpenCode con `opencode/muse-spark-1.3-contributor-free`;
  sin cambio de modelo, sin otros agentes. Revisión no independiente
  (autorevisión estática por lectura).
- **SHA/árbol:** entrada y salida `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`,
  sin commit; se preservó el árbol sucio E00–E18 (sin operaciones
  destructivas) y sólo se tocaron archivos autorizados:
  `apps/client-web/app.js`, `apps/client-web/index.html`,
  `apps/admin-dashboard/src/components/MenuManager.tsx` (hint mínimo),
  test focal nuevo, `reportes/E19.md`, `evidencia/E19/DIAGNOSTICO.md`,
  `CONTINUAR.md` y estado E19 en `CONTROL.md`. Backend sin cambios.
- **Resultado:** filtros determinísticos Sin TACC/Vegano/Vegetariano sólo por
  tags confirmados (desconocido no es coincidencia), selector de categoría
  combinable, Todas/limpiar, estado vacío y conteo anunciado
  (`role="status"`), botones `type="button"` con `aria-pressed`, foco
  visible y teclado nativo preservado (click/Enter/Espacio). Advertencia
  honesta en barra/vacío/detalle (sin "seguro"/"libre de alérgenos") y
  desconocido explícito en detalle. Apertura de carta, pills de navegación,
  precio, disponibilidad/agotado, imágenes, carrito y restauración de
  contexto preservados. Filtros sobreviven a re-render por red/tema.
- **Pruebas posteriores por Codex:** focal E19 exit 0 (16/16); regresión
  dirigida E12/E16/E17/E18/assets exit 0 (55/55); regresión amplia de 22
  archivos exit 0 (232/232); build exit 0 (6/6 workspaces). La primera
  corrida focal falló por dos aserciones mal recortadas del test, corregidas
  sin cambiar el contrato del producto. Matriz de rutas exit 1 sólo por
  cuatro residuos previos de E14; diff-check scoped exit 0; global exit 2
  sólo por EOF previo en `apps/staff-panel/src/App.tsx:461`.
- **Gate:** `VERIFIED_LOCAL` técnico. `PENDING_HUMAN` para recorrido real
  de carta/filtros con teclado/táctil, lector de pantalla, zoom/teléfono y
  validación del contenido por el local; `PENDING_CLOUD` para
  datos/despliegue real y S21 heredado de E15.

## Última corrida: E20 (2026-09-16)

- **Ejecutor:** OpenCode con `opencode/muse-spark-1.3-contributor-free`;
  sin cambio de modelo, sin otros agentes. Codex hizo revisión de alcance y
  comportamiento; no se presenta como revisión independiente de otro agente.
- **SHA/árbol:** entrada `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`, sin
  commit; se preservó el árbol sucio E00–E19 (sin operaciones destructivas)
  y sólo se tocaron archivos autorizados:
  `apps/staff-panel/src/components/KitchenOrdersManager.tsx`,
  `apps/staff-panel/src/index.css`, test focal nuevo
  `packages/api/test/e20-kitchen-print.test.ts`, `reportes/E20.md`,
  `evidencia/E20/DIAGNOSTICO.md`, `CONTINUAR.md` y estado E20 en
  `CONTROL.md`. Backend, recibos E15, migraciones, shared, `.env` y
  despliegues sin cambios.
- **Resultado:** botón `Imprimir comanda`/`Reimprimir comanda` por orden
  activa; hoja `COMANDA DE COCINA` con ID/mesa/sector/fecha-hora/ítems/
  cantidades/notas/comensal; bloque de entrega manual (entregó, recibió,
  hora, iniciales/firma, conciliación); formatos 58/80/A4; guía de una
  pantalla con gate humano/físico pendiente. El flujo de impresión es sólo
  estado local + `window.print()`: sin `ReceiptService`, sin
  `PAYMENT_RECEIPT`/`PRE_BILL_DETAIL`, sin `updateOrderStatus`/
  `addManualOrderByStaff`, sin `onafterprint`; cancelar no cambia la orden,
  reimprimir no crea pedido y sale rotulada. E14 preservado
  (`READY_TO_SERVE` sigue esperando retiro por mozo).
- **Pruebas posteriores:** OpenCode terminó exit 0 bajo Job Object. La primera
  focal encontró dos aserciones mal recortadas; Codex corrigió sólo la suite.
  Tras una revisión adicional que marcó también las solicitudes repetidas
  desde la hoja como reimpresión local, focal E20 exit 0 (14/14); regresión
  E14/E15/staff exit 0 (46/46); build exit 0 (6/6 workspaces). La regresión
  dirigida que incluía `s07-service-shell.test.ts` quedó 48/49 por una
  expectativa previa de E07 que contradice la navegación Cocina agregada en
  E14; no fue introducida ni tocada por E20. Matriz de rutas exit 1 conserva
  cuatro residuos previos de E14. `git diff --check` scoped exit 0; global
  sólo reporta la línea blanca EOF previa en `apps/staff-panel/src/App.tsx:461`.
- **Gate:** `VERIFIED_LOCAL` técnico para código, focal, regresión relevante y
  build. No equivale a GO de producción.
  `PENDING_HUMAN` para diálogo de impresión, PDF local, legibilidad,
  escenario manual y recepción observada; `PENDING_CLOUD` sólo para gates
  externos heredados (S21 E15, despliegue).

## Última corrida: E21 (2026-09-16)

- **Ejecutor:** OpenCode con `opencode/muse-spark-1.3-contributor-free`;
  sin cambio de modelo, sin otros agentes. OpenCode hizo autorrevisión estática
  no independiente; Codex realizó la verificación posterior.
- **SHA/árbol:** entrada `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`, sin
  commit; se preservó el árbol sucio E00–E20 (sin operaciones destructivas)
  y sólo se tocaron archivos autorizados: `apps/staff-panel/src/App.tsx`
  (nav primaria Servicio+Más, Cocina secundaria en Más + `/kitchen`),
  `packages/api/test/{s07-service-shell,polling-clients-reconnect,e10-table-detail-actions,capabilities-unit,route-matrix-guard indirecto}.test.ts`,
  `scripts/check-route-matrix.mjs`, `scripts/route-matrix.json`,
  `reportes/E21.md`, `evidencia/E21/DIAGNOSTICO.md`, `CONTINUAR.md` y estado
  E21 en `CONTROL.md`. Sin cambios en API, middleware, migraciones, shared,
  `.env`, secretos, despliegues ni datos reales.
- **Resultado:** las cinco regresiones del baseline transcripto quedan
  corregidas en código/tests/manifiesto: S07 sólo mira la primaria y permite
  Cocina secundaria/directa; polling comprueba `useSSE` como adaptador y
  `useServiceSync` como dueño del `PollingCoordinator`; E10 con etiquetas
  `randomUUID` únicas; matriz reconoce `verifySettlementAuthorization` como
  `STAFF`, settle a `STAFF` y dos rutas agregadas; capacidades a 12 con
  `allowWaitersToCollectCash`.
- **Pruebas Codex:** focal posterior exit 0 (5 suites, 43/43); regresión
  completa exit 0 (87 suites, 778 tests pasados y 3 skips explícitos); build
  exit 0 (6/6); matriz exit 0 (107 rutas); `git diff --check` global y scoped
  exit 0. Cada corrida acotada terminó con Job Object vacío. La primera focal
  posterior falló sólo por una aserción sintáctica lazy de S07, corregida por
  Codex y repetida con éxito.
- **Gate:** `VERIFIED_LOCAL` técnico. `PENDING_HUMAN`/`PENDING_CLOUD`
  heredados de E15–E20 permanecen; no es GO de producción.
- **Evidencia:** `evidencia/E21/VERIFICACION-CODEX-20260916.md` y logs bajo
  `C:/Users/rodri/Desktop/AI/Projects/_orchestration/runs/mesaya-remediacion-e21-20260916-1`.

## Última corrida: E22 (2026-09-16)

- **Ejecutor:** OpenCode con `opencode/muse-spark-1.3-contributor-free`;
  sin cambio de modelo. Hubo revisión independiente de Codex y una auditoría
  adicional de OpenCode en sólo lectura que produjo dos correcciones acotadas.
- **SHA/árbol:** entrada `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`, sin
  commit; se preservó el árbol sucio E00–E21 (sin operaciones destructivas)
  y sólo se tocaron archivos autorizados:
  `tests/load/pilot-profile.js` (reescrito fail-closed),
  `tests/load/README.md`, `scripts/check-load-profile.mjs`,
  `packages/api/test/e22-load-profile.test.ts`, `reportes/E22.md`,
  `evidencia/E22/DIAGNOSTICO.md`, `CONTINUAR.md` y estado E22 en
  `CONTROL.md`. Sin cambios en backend, middleware, migraciones, shared,
  apps, `.env`, secretos, despliegues ni datos reales.
- **Resultado:** perfil k6 único y fail-closed (env exigido sin defaults,
  preflight con login mozo+manager y mismo `restaurantId`, QR canónica por
  mesa lectora, endpoints de negocio con semántica, escenarios
  parametrizados con techo 30 VUs/300 s, métricas/umbrales p50/p95/p99 como
  metas de prueba) + flujo mutante opt-in (`K6_BUSINESS_FLOW=true`, mesas
  disjuntas/AVAILABLE, crear→preparar→entregar con replay→cuenta→
  `settle-and-close` con manager→limpieza a `AVAILABLE`→conciliación) +
  checker estático sin k6 + test focal + README operativo.
- **Verificación previa:** supervisión independiente bajo Job Object: checker exit 0;
  focal 1 suite/18 tests exit 0; sintaxis exit 0; `git diff --check` exit 0;
  ambos órdenes de `full-system-e2e` + E22 exit 0 (57/57);
  `full-system-e2e` aislado exit 0 (39/39). La primera regresión completa tuvo
  17 fallos concentrados en `full-system-e2e`, pero el reintento previo pasó
  con 88 suites/795 tests y la regresión posterior a las correcciones pasó con
  88 suites/796 tests (3 omitidos). Queda clasificado como
  interferencia/flakiness del lote compartido y no se alteró E22 para
  ocultarlo.
- **Verificación k6 local:** con k6 `v1.2.3`, SQLite nueva `.tmp/e22-k6-local.db`
  y API loopback. Lectura: 95 s, 8 VUs, 239 iteraciones, 463 requests,
  450 polls, 13 no-polling, 0 errores; p50/p95/p99 de negocio
  `18.2197/46.78582/65.805098 ms`. Flujo: 95 s, 9 VUs, 240 iteraciones,
  477 requests, 450 polls, 27 no-polling, 0 errores; p50/p95/p99
  `12.301/37.804555/124.608851 ms`, `business_flow_completed=1` y
  `business_reconciliation_ok=1`. Todos los thresholds pasaron.
- Los dos summaries conservaron métricas/checks y se sanitizaron antes de
  quedar como evidencia: `setup_data` quedó marcado `redacted` para no guardar
  tokens de sesión.
- **Gate:** `VERIFIED_LOCAL` para este alcance reproducible, con subgate
  `PASS_CLOUD_EPHEMERAL` ya verificado en PostgreSQL 17 efímero. La repetición
  con proveedor PostgreSQL/staging real queda `PENDING_CLOUD`; la
  observación/ensayo con mozos y equipos queda `PENDING_HUMAN`.
  `PENDING_HUMAN`/`PENDING_CLOUD` de E15–E21 se conservan; E23 no queda
  habilitada.
- **Evidencia:** `evidencia/E22/DIAGNOSTICO.md`,
  `evidencia/E22/VERIFICACION-CODEX-20260916.md`,
  `evidencia/E22/e22-local-read-summary-20260916-v2.json`,
  `evidencia/E22/e22-local-flow-summary-20260916-v2.json`; reporte
  `reportes/E22.md`; [run CI PostgreSQL efímero 35171261968](https://github.com/rodrigo1234321/MesaYA/actions/runs/35171261968).

## Última corrida: E24 (2026-09-16, cierre de alcance)

- **Resultado:** E24 quedó finalizada en su alcance autorizado. El candidato de
  producto `9e4a4a0…` se publicó como release `163c1cc4…`, que agrega sólo la
  corrección del cliente PostgreSQL 17 para el workflow. CI `35168551177` pasó.
- **Cloud:** el backup drill `35168679754` pasó schema, digest de filas,
  relaciones y restore temporal; la migración `35168778385` pasó con `migrate
  deploy`, sin seed ni `db push`. El primer drill `35168441849` detectó y
  documentó el mismatch 17.6/16.15 antes de la corrección.
- **Vercel:** `api`, `client-web`, `staff-panel` y `admin-dashboard` quedaron
  `READY` con el mismo SHA `163c1cc4…`. Los deployment IDs y aliases están en
  `evidencia/E24/PAQUETE-RELEASE-20260916.md`.
- **Smoke:** health y las tres SPAs respondieron 200; CORS válido respondió 204
  con origin explícita/credenciales; origin inválida respondió 404 sin CORS; la
  URL y el resolver QR de `mesaya-piloto`/`Mesa 1` respondieron 200 sin token por
  ausencia correcta de sesión activa.
- **Gate:** `PASS_LOCAL` para implementación/CI/paquete y `PASS_CLOUD` para
  drill, migración, deployments y smoke. E22 PostgreSQL efímero queda como
  `PASS_CLOUD_EPHEMERAL`; continúan `PENDING_CLOUD` staging/proveedor real,
  costos/observabilidad y backup durable; y `PENDING_HUMAN` E23.
- **Evidencia:** `evidencia/E24/PAQUETE-RELEASE-20260916.md`,
  `evidencia/E24/DIAGNOSTICO.md`, `evidencia/E24/VERIFICACION-CODEX-20260916.md`,
  `evidencia/E24/DESBLOQUEO-CLOUD.md` y `reportes/E24.md`.

## Próxima acción exacta

E24 ya no tiene una acción cloud pendiente dentro de su alcance inmediato. La
continuidad segura es repetir E22 contra staging/proveedor real aislado con
datos de prueba, definir retención/RPO/RTO/costos/observabilidad y habilitar E23
con personas/equipos. No ejecutar la carga mutante contra producción ni pegar
secretos en el chat.

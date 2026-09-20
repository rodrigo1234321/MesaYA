# E22 — Diagnóstico: falsos PASS del perfil anterior

Fecha: 2026-09-16. Ficha E22 (S08/S28). Entrada: rama
`codex/servicio-remediacion`, HEAD `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`,
con árbol sucio E00–E21 preservado (sin `reset/clean/checkout/switch/merge/
rebase`, sin borrar ni revertir ediciones ajenas).

## Falsos PASS confirmados por lectura de `tests/load/pilot-profile.js` (previo)

1. **Defaults de demo:** `__ENV.API_URL || 'http://localhost:3000'`,
   `RESTAURANT_SLUG || 'trattoria-del-puerto'`, `WAITER_PIN || '1234'`,
   `MANAGER_PIN || '9999'`. Sin entorno, la corrida "pasa" contra datos de
   ejemplo en vez de abortar.
2. **Login que traga errores:** dos bloques `try { http.post(login) ...
   if 200 token } catch (_) {}` que convierten fallo de auth/red en
   `waiterToken/managerToken = null` y siguen.
3. **Health como sustituto:** ramas `if (data.waiterToken) { workspace } else {
   GET /v1/health -> check 'waiter health is 200' }` (salón y cocina) y
   `if (data.managerToken) { sales } else { GET /health -> 'liveness is 200' }`.
   Sin token, un 200 de liveness cuenta como PASS del puesto.
4. **404 como PASS:** `menu status is 200 or 404`, `session qr status is 200 or
   404`. Menú inexistente o mesa inexistente cuentan como éxito.
5. **QR no canónico y mesa asumida:** `GET /v1/sessions/<slug>/1` (etiqueta
   fija, sin variable de mesas, sin `valid/token/pertenencia`).
6. **Sin recorrido de negocio:** no crea pedido, no toca cocina/caja, no
   verifica idempotencia ni conciliación final.
7. **Sin umbrales de negocio:** sólo `http_req_duration` y `http_req_failed`
   genéricos; sin métricas de checks semánticos, errores de negocio, latencia
   de negocio ni polling.

## Contrato verificado para el perfil nuevo (lectura cruzada con código)

- Login: `POST /v1/staff/login` exige `{restaurantSlug, pin}` y responde
  `{token, staffUser}` (`staff.routes.ts`).
- Menú: `GET /v1/restaurants/:slugOrId/menu` responde `{restaurant, categories
  [{items[{id, price, isAvailable}]}]}` (`menu.routes.ts`).
- Mesas: `GET /v1/restaurants/:id/tables` con staff responde
  `[{id, label, currentState}]` (`tables.routes.ts`).
- QR canónica: `GET /v1/sessions/:slug/:tableLabel` responde `valid/token/
  restaurant/table` o 404/410 documentados (`sessions.routes.ts`,
  `session.service.ts`). La legacy `/sessions/table/:label` está 403 salvo
  test explícito: no se usa.
- Pedido presencial: `POST /v1/staff/tables/:tableId/orders` con `{lines}`
  responde OrderDTO `{id, tableSessionId, totalAmount, status: IN_KITCHEN}`
  (`orders.routes.ts`, `order.service.ts addManualOrderByStaff`).
- Tareas: `POST /v1/staff/service/tasks/:taskType/:targetId/act` con
  `{action: COMPLETE}`; `ORDER_PREPARATION` IN_KITCHEN→READY_TO_SERVE y
  `ORDER_DELIVERY` READY_TO_SERVE→SERVED, con `idempotentReplay` en replay
  (`service.routes.ts`, `service-task.service.ts`).
- Cuenta: `cash-orders` responde `{orders, accounts}` y workspace
  `{restaurantId, tasks, accounts[{tableSessionId, account{version,
  consumoMinor, saldoMinor, tandas[{orderId, status, totalMinor}]}]}`.
- Cobro y cierre: `POST /v1/staff/sessions/:sessionId/settle-and-close` exige
  `idempotencyKey + expectedAccountVersion + method presencial`, `amountMinor`
  igual al saldo; responde `{settlement{id}, account{saldoMinor: 0},
  idempotentReplay, closed: true}` y deja la mesa en `TO_CLEAN`
  (`orders.routes.ts`, `order.service.ts settleAndCloseSessionAccount`).
  Método usado: `WAITER_CASH` (presencial, válido para MANAGER).
- Limpieza: `POST /v1/tables/:tableId/state/tap` con `{action: skip_to,
  targetState: AVAILABLE, expectedCurrentState: TO_CLEAN}` responde
  `{success: true, newState: AVAILABLE}` (`tablestate.routes.ts`,
  `fsm.service.ts`, `TapStateRequestSchema` en shared).
- Ventas: `GET /v1/admin/restaurants/:id/sales/summary?period=TODAY` con
  manager responde SalesSummaryDTO `{restaurantId, period, unit: ARS_MINOR,
  consumoConfirmadoMinor, ...}` (`sales.routes.ts`).
- Cocina/caja: `kitchen-orders` responde `{orders[{id, status, items}]}`,
  `cash-orders` `{orders, accounts}` (`order.service.ts`).

## Decisión

Reescritura fail-closed del único perfil + flujo mutante opt-in + checker sin
k6 + test focal estático + README operativo. Sin cambios de backend,
middleware, migraciones, shared, apps, secretos ni despliegues. La ejecución
posterior usó sólo una fixture local nueva y archivos `.env` locales ignorados;
no tocó datos reales.

## Verificación independiente de supervisión

OpenCode ejecutó la implementación con `opencode/muse-spark-1.3-contributor-free`
y no tuvo shell para ejecutar comandos. La supervisión de Codex verificó el
resultado bajo Job Object; todas las corridas terminaron con el supervisor
vacío (`verified_empty`):

- `node scripts/check-load-profile.mjs`: exit 0.
- `node scripts/test-local.mjs test/e22-load-profile.test.ts`: exit 0, 1
  suite y 17/17 tests.
- `git diff --check`: exit 0.
- `node --check tests/load/pilot-profile.js`: exit 0.
- `full-system-e2e` + E22 en ambos órdenes: exit 0, 56/56 tests en 2 suites.
- `full-system-e2e` aislado: exit 0, 39/39 tests.
- Regresión completa, primer intento: exit 1, con 17 fallos concentrados en
  `full-system-e2e` (`findUnique where id: undefined`), 87 suites pasadas, 1
  fallida y 1 omitida.
- Regresión completa, reintento: exit 0, 88 suites pasadas y 1 omitida;
  795 tests pasados y 3 omitidos.

El aislamiento y el reintento exitosos clasifican el primer fallo como
interferencia/flakiness del lote completo, no como regresión de E22. No se
alteró la suite para forzar PASS. Posteriormente se instaló k6 `v1.2.3` y se
ejecutaron dos corridas contra una SQLite nueva y aislada en loopback, sin
usar datos reales ni publicar tokens/PINs. Los summaries y percentiles
observados quedan registrados en la verificación de E22.

El README operativo también deja explícitos `http_reqs.count`,
`polling_requests.count`, la resta de requests no-polling y la fórmula de
estimación con `tariff_per_1000_requests`; si no hay tarifa vigente se informa
`N/A`. La espera/atención humana queda fuera de la carga API y se reserva para
E23. Los umbrales están declarados como metas revisables, sin atribuirles una
aprobación humana que no está evidenciada.

## Revisión adicional y correcciones

Una auditoría de lectura de OpenCode detectó dos defectos menores concretos:

1. `guestRead` registraba el error de menú con `recordSemantic` y volvía a
   incrementar `businessErrorRate`, sesgando el error hacia arriba.
2. El checker sólo detectaba `catch` literalmente vacío y no protegía de forma
   explícita la frontera de preflight.

OpenCode eliminó el doble conteo, añadió extracción balanceada de los cuerpos
de `setup()`/`loginOrFail()` y falló el checker si allí aparece `catch`; los
lectores siguen pudiendo convertir respuestas inválidas en `ok:false`. El
test focal cubre la nueva regla. Checker, sintaxis, focal 18/18, combinación
con `full-system-e2e` 57/57 en ambos órdenes y regresión completa posterior
(88 suites, 796 tests, 3 omitidos) pasaron bajo Job Object.

## Corridas k6 locales posteriores

La corrida de lectura/polling de 95 s, con 8 VUs y 239 iteraciones, obtuvo
`http_reqs=463`, `polling_requests=450`, `business_check_pass=450/450`,
`business_error_rate=0/450`, checks `546/546` y `http_req_failed=0/463`.
La latencia de negocio observada fue p50 `18.2197 ms`, p95 `46.78582 ms` y
p99 `65.805098 ms`.

La corrida con `business_flow` de 95 s, con 9 VUs y 240 iteraciones, obtuvo
`http_reqs=477`, `polling_requests=450`, `business_check_pass=461/461`,
`business_error_rate=0/461`, checks `557/557` y `http_req_failed=0/477`.
La latencia observada fue p50 `12.301 ms`, p95 `37.804555 ms` y p99
`124.608851 ms`; `business_flow_completed=1` y
`business_reconciliation_ok=1`. Los artefactos son
`e22-local-read-summary-20260916-v2.json` y
`e22-local-flow-summary-20260916-v2.json`; ambos usaron percentiles explícitos
con `--summary-trend-stats`.

Los summaries fueron sanitizados antes de conservarse: `setup_data` quedó con
`redacted` porque la exportación nativa de k6 incluye tokens de sesión; las
métricas y checks no fueron alterados.

Esto permite marcar E22 `VERIFIED_LOCAL` para el alcance local reproducible.
La repetición PostgreSQL 17 efímera en GitHub Actions quedó además como
`PASS_CLOUD_EPHEMERAL` en el run `35171261968`: lectura `463/450` requests/polls,
checks `546/546`, p95 `27.513324 ms`; flujo `477/450`, checks `557/557`, p95
`24.301224 ms`, `business_flow_completed=1` y
`business_reconciliation_ok=1`. El workflow usa una fixture nueva por job,
guardia de URLs loopback y summary sanitizado; no apunta a Supabase ni Vercel.
Staging/proveedor real, costos, observabilidad y backup durable siguen siendo
`PENDING_CLOUD`; la observación con personas y equipos sigue `PENDING_HUMAN`.
No se infiere capacidad de producción ni cantidad de mesas soportadas.

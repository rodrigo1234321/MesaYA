# E22 — Verificación independiente de Codex

Fecha: 2026-09-16  
Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`  
Rama: `codex/servicio-remediacion`  
Ejecutor de implementación: `opencode/muse-spark-1.3-contributor-free`  
Supervisor: Codex, con Job Object y árbol existente preservado.

## Resultados

| Comprobación | Resultado observado |
|---|---|
| `node scripts/check-load-profile.mjs` | exit 0; perfil fail-closed |
| `node scripts/test-local.mjs test/e22-load-profile.test.ts` | exit 0; 1 suite, 18/18 tests |
| `git diff --check` | exit 0 |
| `node --check tests/load/pilot-profile.js` | exit 0 |
| `full-system-e2e` + E22, orden A | exit 0; 2 suites, 57/57 tests |
| `full-system-e2e` + E22, orden B | exit 0; 2 suites, 57/57 tests |
| `full-system-e2e` aislado | exit 0; 39/39 tests |
| Regresión completa, primer intento | exit 1; 17 fallos en `full-system-e2e` |
| Regresión completa, reintento | exit 0; 88 suites, 795 tests; 1 suite y 3 tests omitidos |
| Auditoría adicional OpenCode sólo lectura | exit 0; 2 defectos menores identificados |
| Regresión completa posterior a correcciones | exit 0; 88 suites, 796 tests; 1 suite y 3 tests omitidos |
| k6 lectura/polling local aislado | exit 0; 95 s, 8 VUs, 239 iteraciones, 463 requests, 450 polls, 0 errores |
| k6 flujo mutante local aislado | exit 0; 95 s, 9 VUs, 240 iteraciones, 477 requests, 450 polls, flujo y conciliación 1/1 |

El primer fallo completo mostró `findUnique where id: undefined` dentro de
`full-system-e2e`; el suite pasó aislado, en ambos órdenes junto con E22 y en
el reintento completo. Se clasifica como interferencia/flakiness del lote
compartido, no como regresión de E22. No se modificó la suite para esconderlo.

La auditoría adicional encontró y corrigió el doble conteo de errores del menú
y la cobertura insuficiente del checker para `catch` en `setup()`/`loginOrFail()`.
OpenCode editó sólo los tres artefactos E22 autorizados; la regresión posterior
confirmó 796/799 tests con 3 omitidos.

La documentación de E22 deja separado el conteo de `http_reqs` y
`polling_requests`, explicita la fórmula de costo supuesto y excluye la espera
humana de la carga API. El test focal continúa cubriendo ese contrato. Las
corridas k6 usaron `--summary-trend-stats=avg,min,med,max,p(50),p(90),p(95),p(99)`.

En lectura, `business_check_pass=450/450`, `business_error_rate=0/450`,
checks `546/546` y `http_req_failed=0/463`; p50/p95/p99 de negocio:
`18.2197/46.78582/65.805098 ms`. En el flujo mutante,
`business_check_pass=461/461`, `business_error_rate=0/461`, checks `557/557`,
`http_req_failed=0/477` y p50/p95/p99:
`12.301/37.804555/124.608851 ms`; `business_flow_completed=1` y
`business_reconciliation_ok=1`.

## Repetición PostgreSQL efímera en GitHub Actions

El workflow `.github/workflows/e22-postgres-load.yml` se verificó en el
[run 35171261968](https://github.com/rodrigo1234321/MesaYA/actions/runs/35171261968),
commit `b5beba87b3de703bf0bd57159d4964928f2841f7`. No usó Supabase, Vercel ni
secretos: cada job creó su PostgreSQL 17 efímero, aplicó las migraciones,
compiló el cliente PG y ejecutó el seed sólo con `E22_PG_EPHEMERAL=true` y
URLs loopback. La guardia rechaza cualquier destino remoto.

| Job | Evidencia sanitizada |
|---|---|
| `k6-read` | PASS; seed PASS; `463` requests, `450` polls, `546/546` checks, p95 `27.513324 ms`, pass `1`, error `0`, `http_req_failed=0/463` |
| `k6-flow` | PASS; seed PASS; `477` requests, `450` polls, `557/557` checks, p95 `24.301224 ms`, pass `1`, error `0`, flujo `1`, conciliación `1`, `http_req_failed=0/477` |

Los summaries subidos por los jobs conservan sólo agregados y tienen
`setup_data={redacted:true}`. Esto permite clasificar el subgate como
`PASS_CLOUD_EPHEMERAL`; no reemplaza staging/proveedor real, costos,
observabilidad, backup durable ni el ensayo humano E23.

## Límites del gate

La verificación cubre el perfil, sus contratos estáticos, la regresión del
repositorio, dos corridas k6 reproducibles contra SQLite aislada y dos jobs
equivalentes sobre PostgreSQL 17 efímero. Por eso E22 queda
`VERIFIED_LOCAL` con subgate `PASS_CLOUD_EPHEMERAL` para este alcance. No
certifica capacidad de producción: staging/proveedor real queda
`PENDING_CLOUD` y la observación con mozos/equipos queda `PENDING_HUMAN`.
E23 no se habilita sólo por esta evidencia.

Summaries: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion/docs/plan-remediacion-servicio-gemini/evidencia/E22/e22-local-read-summary-20260916-v2.json` y
`C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion/docs/plan-remediacion-servicio-gemini/evidencia/E22/e22-local-flow-summary-20260916-v2.json`.
Ambos summaries conservan métricas y checks, con `setup_data` sanitizado para
no guardar tokens de sesión. Logs de implementación/verificación supervisada:
`C:/Users/rodri/Desktop/AI/Projects/_orchestration/runs/mesaya-remediacion-e22-20260916-1`.

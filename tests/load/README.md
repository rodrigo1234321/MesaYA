# E22 — Perfil de carga k6 (fail-closed)

Único perfil canónico: `tests/load/pilot-profile.js`.

La corrida local de referencia ya fue ejecutada el 2026-09-16 con k6 `v1.2.3`
contra una SQLite nueva y aislada del repositorio. Quedan como gates separados
la repetición en staging/cloud aislado y la observación con personas/equipos.
Nada de este perfil certifica capacidad de producción ni cantidad de mesas.

El workflow manual `.github/workflows/e22-postgres-load.yml` repite el perfil en
dos jobs sobre PostgreSQL 17 efímero de GitHub: uno de lectura/polling y otro con
`business_flow=true`. Mientras esta remediación vive en su rama, también queda
disparado sólo por cambios relevantes de `codex/servicio-remediacion`; no usa
secretos, Supabase ni Vercel. La fixture se crea sólo con
`E22_PG_EPHEMERAL=true` y rechaza hosts remotos; los summaries se sanitizan
antes de subirlos como artefactos temporales. Esto verifica la semántica
PostgreSQL reproducible, pero no sustituye una corrida contra un
proveedor/staging aislado real ni permite inferir costos o mesas soportadas en
producción.

## Variables obligatorias (sin defaults)

| Variable | Uso |
|---|---|
| `API_URL` | Base del API a medir. Debe apuntar a staging/local aislado. Nunca producción ni datos reales. |
| `RESTAURANT_SLUG` | Slug del restaurante de prueba. |
| `WAITER_PIN` | PIN de mozo de prueba (por entorno, nunca commiteado). |
| `MANAGER_PIN` | PIN de encargado de prueba (por entorno, nunca commiteado). |

Sin las cuatro, `setup()` aborta con `E22 fail-closed`.

## Listas de mesas (coma, explícitas)

| Variable | Uso |
|---|---|
| `K6_GUEST_TABLE_LABELS` | Mesas lectoras del piloto, ej. `Mesa 1,Mesa 2,Mesa 3,Mesa 4`. Requerida si hay lectores con VUs>0. |
| `K6_FLOW_TABLE_LABELS` | Mesas mutantes del flujo, ej. `Mesa 10,Mesa 11`. Requerida con `K6_BUSINESS_FLOW=true`. Debe tener al menos una mesa por VU de flujo y estar `AVAILABLE` en preflight. |

Con flujo + lectores activos, ambas listas deben ser disjuntas. No se asume `Mesa 1`.

## Opt-in mutante (cambia datos)

- `K6_BUSINESS_FLOW=true` habilita el escenario `business_flow`. Cualquier otro
  valor (o ausente) lo omite explícitamente (VUs cero = escenario omitido).
- El flujo crea pedido presencial → prepara → entrega (con replay) → cobra y
  cierra con manager → limpia a `AVAILABLE` → concilia. Cada paso valida
  semántica y detiene la iteración ante un fallo, sin reintento ciego.
- Claves de idempotencia únicas por corrida/VU/iteración (`runId-vu-iter`) y
  repetidas sólo para verificar replay.

## Límites visibles y techo

| Variable | Default | Techo |
|---|---|---|
| `K6_GUEST_VUS` | 4 | suma total ≤ 30 |
| `K6_SALON_VUS` | 2 | suma total ≤ 30 |
| `K6_KITCHEN_VUS` | 1 | suma total ≤ 30 |
| `K6_CASH_VUS` | 1 | suma total ≤ 30 |
| `K6_FLOW_VUS` | 1 | suma total ≤ 30 |
| `K6_FLOW_ITERATIONS` | 1 | > 0; una iteración por VU reutiliza la mesa sólo después de limpiarla |
| `K6_DURATION_S` | 95 | ≤ 300 |

Si el entorno pide más que el techo, `setup()` aborta (no recorta en silencio).
Un escenario con VUs cero se omite del objeto `scenarios` (visible en el
summary exportado).

## Comando de ejecución

```bash
API_URL=https://staging-aislado.example \
RESTAURANT_SLUG=trattoria-del-puerto \
WAITER_PIN="$WAITER_PIN" MANAGER_PIN="$MANAGER_PIN" \
K6_GUEST_TABLE_LABELS="Mesa 1,Mesa 2,Mesa 3,Mesa 4" \
k6 run --summary-trend-stats='avg,min,med,max,p(50),p(90),p(95),p(99)' \
  --summary-export=e22-summary.json tests/load/pilot-profile.js
```

Con flujo mutante (destino aislado, mesas dedicadas):

```bash
K6_BUSINESS_FLOW=true K6_FLOW_TABLE_LABELS="Mesa 10,Mesa 11" \
K6_FLOW_VUS=2 \
k6 run --summary-trend-stats='avg,min,med,max,p(50),p(90),p(95),p(99)' \
  --summary-export=e22-flow-summary.json tests/load/pilot-profile.js
```

## Evidencia local de referencia

Los summaries versionados en la evidencia E22 corresponden a dos corridas de
95 s contra `http://127.0.0.1:3000` y no contienen secretos:

| Summary | VUs máx. | Iteraciones | Requests | Polls | No-polling | p50/p95/p99 negocio | Flujo/conciliación |
|---|---:|---:|---:|---:|---:|---|---|
| `e22-local-read-summary-20260916-v2.json` | 8 | 239 | 463 | 450 | 13 | 18.2197 / 46.78582 / 65.805098 ms | — |
| `e22-local-flow-summary-20260916-v2.json` | 9 | 240 | 477 | 450 | 27 | 12.301 / 37.804555 / 124.608851 ms | 1 / 1 |

La corrida de lectura tuvo `business_check_pass=450/450`, checks `546/546` y
`http_req_failed=0/463`. La corrida con `business_flow` tuvo
`business_check_pass=461/461`, checks `557/557` y `http_req_failed=0/477`;
validó replays idempotentes, cobro/cierre, mesa `AVAILABLE` y conciliación.
El costo sólo puede calcularse si el destino informa una tarifa vigente:
`(http_reqs.count / 1000) * tariff_per_1000_requests`.

## Perfil exacto

- Escenarios: `guest_readers`, `salon_poll`, `kitchen_poll`, `cash_poll` y
  opcional `business_flow` (executor `per-vu-iterations`, con
  `K6_FLOW_ITERATIONS` explícito y `maxDuration=K6_DURATION_S`).
- Lectores: menú público, QR canónico `/v1/sessions/:slug/:tableLabel`,
  orden activa, `service-workspace`, `kitchen-orders`, `cash-orders` y
  `sales/summary`. Todo con checks semánticos (estructura/tenant), nunca sólo
  status. Polling con tags `{kind:poll}` y contador `polling_requests`.
- Preflight (`setup()`): `/v1/health` sólo conectividad; login mozo+manager
  200 con mismo `restaurantId`; menú con item disponible; mesas con estructura;
  QR por mesa lectora (`valid===true`, token, pertenencia); workspace/kitchen/
  cash/ventas una vez. Cualquier desvío aborta.

## Cómo leer resultados

- `business_latency_ms`: `p(50)<500`, `p(95)<800`, `p(99)<1500` son metas de
  prueba, no capacidad certificada.
- `business_check_pass`: `rate>0.99`; `business_error_rate`: `rate<0.01`;
  `checks`: `rate>0.99`; `http_req_failed`: `rate<0.01`.
- Estas metas quedan declaradas en el perfil para que puedan revisarse antes
  del ensayo; no se presenta un acuerdo humano inexistente. Si el operador las
  cambia, debe registrar el valor final y el motivo junto al summary.
- `polling_requests`: conteo de polls (costos/requests con supuestos del
  destino; separar carga API de espera humana).
- Con flujo: `business_flow_completed` y `business_reconciliation_ok` deben ser
  `count>0`; la conciliación sólo se registra si la sesión cerrada sale de
  caja/cocina/workspace y la mesa queda `AVAILABLE`.
- Un `404`/`health` nunca es PASS: si aparece en checks semánticos, la corrida
  reprueba por diseño.

## Conteo de requests, costo y espera humana

- Reportar `http_reqs.count` del summary como total de requests de la corrida,
  incluyendo preflight; reportar también `polling_requests.count` como
  subconjunto de polls y calcular `non_polling_requests = http_reqs.count -
  polling_requests.count` sólo si ambos valores están presentes.
- El costo debe quedar expresado como supuesto, nunca inferido como capacidad:
  `cost_estimate = (http_reqs.count / 1000) * tariff_per_1000_requests`. Si el
  destino no entrega una tarifa vigente, informar `N/A` y dejar registrado el
  proveedor/entorno; no inventar precios.
- La espera o atención humana no forma parte de esta carga API. Informar por
  separado caminata, atención, cola y tiempo de operación de los puestos en
  E23; no convertir esos tiempos en requests ni en capacidad de mesas.

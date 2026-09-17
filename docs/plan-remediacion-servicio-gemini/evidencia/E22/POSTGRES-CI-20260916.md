# E22 — Evidencia PostgreSQL efímero en CI

Fecha local: 2026-09-16 (run finalizado el 2026-09-17 UTC).  
Rama: `codex/servicio-remediacion`  
Commit verificado: `b5beba87b3de703bf0bd57159d4964928f2841f7`  
Workflow: `.github/workflows/e22-postgres-load.yml`  
Run: [35171261968](https://github.com/rodrigo1234321/MesaYA/actions/runs/35171261968)

## Alcance

La matriz ejecutó dos jobs independientes sobre `postgres:17-alpine` efímero
de GitHub Actions:

- `k6-read`: lectura y polling, sin mutaciones de negocio.
- `k6-flow`: el mismo perfil con `K6_BUSINESS_FLOW=true`, pedido, cocina,
  entrega, cuenta, cobro, cierre, limpieza y conciliación.

Cada job hizo `migrate deploy`, generó el cliente PostgreSQL, compiló el API,
creó una fixture nueva y levantó la API en loopback. El seed sólo se habilita
con `NODE_ENV=test`, `E22_PG_EPHEMERAL=true`, `DATABASE_URL` y `DIRECT_URL`
PostgreSQL cuyos hosts deben ser `localhost`, `127.0.0.1` o `::1`. El workflow
no usa Supabase, Vercel ni credenciales productivas.

## Resultado

| Job | Resultado |
|---|---|
| `k6-read` | PASS; seed PASS; `463` requests, `450` polling, `546/546` checks, `business_check_pass=1`, `business_error_rate=0`, p95 `27.513324 ms`, `http_req_failed=0/463` |
| `k6-flow` | PASS; seed PASS; `477` requests, `450` polling, `557/557` checks, `business_check_pass=1`, `business_error_rate=0`, p95 `24.301224 ms`, `business_flow_completed=1`, `business_reconciliation_ok=1`, `http_req_failed=0/477` |

Los summaries se subieron como artefactos temporales con siete días de
retención. Antes de subirlos, `setup_data` se reemplazó por
`{redacted:true}`; la evidencia durable de este archivo conserva sólo
agregados, no tokens, PINs ni cuerpos de sesión.

## Clasificación

Este resultado agrega `PASS_CLOUD_EPHEMERAL` al `VERIFIED_LOCAL` de E22. No es
una certificación de staging/proveedor real, costos, límites, observabilidad,
RPO/RTO ni backup durable, y no reemplaza el gate humano E23.

La ejecución previa `35170807494` falló antes de k6 por `await` de nivel
superior bajo CommonJS y por un selector obsoleto del sanitizer; ambos defectos
quedaron corregidos de forma acotada y la corrida final terminó con los dos
jobs en verde.

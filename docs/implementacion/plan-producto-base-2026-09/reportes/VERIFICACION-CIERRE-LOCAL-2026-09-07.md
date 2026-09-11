# Verificación de cierre local — 2026-09-07

## Resultado

La línea base distribuible queda verificada localmente hasta las etapas 15 informativa y 18 Rewards. Mercado Pago no se integra ni procesa dinero: sólo se configura como opción visible y el cobro sigue siendo presencial. PostgreSQL/Supabase remoto, Vercel, backup/restauración y dispositivos físicos requieren sus gates externos.

## Evidencia ejecutada

| Área | Resultado |
|---|---|
| Suite API SQLite | 431 PASS; 3 casos PostgreSQL omitidos explícitamente |
| Rewards ledger dirigido | 27/27 PASS; saldo, idempotencia, canje, reversión y consentimiento |
| Smoke completo y fixtures repetibles | 46 PASS; fixture de mesa y buckets de rate limit aislados |
| Build API SQLite | PASS |
| Build API PostgreSQL (`build:pg`) | PASS; luego se regeneró el cliente SQLite |
| Build shared, cliente, salón y administración | PASS |
| Matriz de rutas | 86 rutas clasificadas, PASS |
| Paridad del schema Supabase | PASS |
| Manifiesto de instancia | 5/5 pruebas; validación de producción PASS |
| Plan de provisión | `PLAN_ONLY`; `remoteMutationPerformed=false` |
| Recorrido público de fila | API local config/menu 200 y pantalla `?fila=trattoria-del-puerto` visible con carta/pre-pedido, consentimiento y ticket |
| Flujo QR/NFC de mesa | PASS; QR inactivo antes de sentar, `Asignar Mesa` desde terminal staff crea sesión, QR muestra acciones de servicio y la liberación vuelve a `Disponible` |
| Higiene del diff | `git diff --check` sin errores de whitespace |

## Casos no ejecutados por dependencia

- `scripts/test-postgres.mjs`: no hay `MESAYA_PG_DATABASE_URL`/`MESAYA_PG_DIRECT_URL` autorizadas y el daemon Docker local no está disponible.
- `npm run test:isolated`: el runner confirma que en Windows requiere el adaptador Job de la jornada; no se falsificó `MESAYA_BOUNDED_JOB`.
- Mercado Pago autónomo: fuera de alcance; la opción informativa no requiere cuentas, credenciales, firma ni Preview. Las rutas de split siguen respondiendo `503 DIGITAL_PAYMENTS_UNAVAILABLE`.
- Supabase/Vercel, backup/restore y QR/NFC físicos: no se tocaron cuentas remotas ni dispositivos.
- Rewards no se prueba todavía sobre PostgreSQL remoto ni con cobros de un restaurante real; el build PG y la suite SQLite cubren el contrato local.

## Criterio de continuación

La siguiente etapa segura es preparar y ejecutar la certificación externa con credenciales efímeras, una instancia Supabase nueva y cuatro proyectos Vercel por local. Hasta completar esas pruebas, la configuración productiva conserva cobro presencial y las capacidades no verificadas permanecen `COMING_SOON` o deshabilitadas.

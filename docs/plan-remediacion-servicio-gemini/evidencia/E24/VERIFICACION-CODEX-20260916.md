# Verificación Codex — E24

Fecha: 2026-09-16
Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`
HEAD observado: `66802e642b9248b1396bb75fdc063941663c251a`

## Comandos y resultados

| Comando/consulta | Exit | Resultado |
|---|---:|---|
| `node scripts/validate-instance-manifest.mjs --production` | 0 | Manifiesto de ejemplo válido; HTTPS y secretos ausentes en el manifiesto |
| `node scripts/provision-instance-plan.mjs` | 0 | Plan `PLAN_ONLY` generado; acciones externas declaradas y `remoteMutationPerformed=false` |
| `node --test scripts/instance-manifest.test.mjs` | 0 | Validaciones de manifiesto y rechazo de secretos/HTTP/local override inválido |
| `node scripts/check-load-profile.mjs` | 0 | Perfil E22 fail-closed verificado |
| `node scripts/build.mjs` | 0 | Seis de seis workspaces compilados; warnings no bloqueantes de Rollup/Zod |
| `node scripts/build-pg.mjs` bajo Job Object | 0 | Build productivo PG completado; no conecta a una base |
| `node scripts/prisma-generate.mjs sqlite` | 0 | Cliente local restaurado después de la comprobación PG |
| `npm run test:local` | 0 | Corrida fresca: 88 archivos pasaron, 1 omitido; 796 tests pasaron, 3 omitidos; SQLite efímera y sandbox limpio |
| `npm run check:routes` | 0 | 107 rutas clasificadas, sin novedades ni deriva |
| `npm run instance:test` | 0 | 5/5 invariantes del manifiesto pasaron |
| `node scripts/check-load-profile.mjs` | 0 | Perfil E22 fail-closed y sus invariantes presentes |
| `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilidades reportadas en dependencias de producción |
| `vercel whoami` | 0 | Identidad Vercel disponible; consulta de lectura únicamente |
| `vercel project ls` | 0 | Cuatro proyectos visibles bajo `mesa-ya` |
| `vercel project inspect api/client-web/staff-panel/admin-dashboard` | 0 | Roots, framework, Node 22 y región registrados sin mutación |
| `vercel ls api/client-web/staff-panel/admin-dashboard --limit 3` | 0 | URLs/estados de deployments visibles; no se afirmó mapping SHA |
| `vercel env ls --project ...` | 0 | Nombres/tipo/ambiente; sólo representación truncada, sin valores completos guardados |
| `gh workflow list --repo rodrigo1234321/MesaYA` | 0 | `ci` y `release-migrate` activos; el release es `workflow_dispatch` |
| `gh api .../environments/Production` | 0 | Environment existente; sin reglas de protección observadas |
| `gh secret list` repo + `--env Production` | 0 | Environment con `MESAYA_PG_DATABASE_URL` y `MESAYA_PG_DIRECT_URL`; no se solicitaron valores |
| `gh api .../environments/Production/secrets` | 0 | `total_count=2`; sólo se verificaron nombres, nunca valores |
| `gh run list --workflow release-migrate.yml --limit 5` | 0 | No hay ejecuciones del workflow de migración |
| `vercel inspect <alias> --json` (API + 3 SPAs) | 0 | Deployments Ready confirmados; metadatos públicos sin `gitCommitSha` |
| `vercel env ls --project api production` | 0 | Cuatro variables `Secret` ocultas en producción; sus valores no son exportables |
| `vercel env run -e production --project api ...` | — | Vercel informó que un valor sensible no podía descargarse; no hubo consulta ni mutación PostgreSQL |
| smoke HTTP repetido `health`, SPAs y preflight CORS | 0 | Baseline remoto confirmado: health/SPAs 200, origin válida 204 con CORS/credenciales, origin no autorizada 404 sin CORS |
| comprobación de herramientas `supabase/psql/pg_dump/pg_restore` | — | No disponibles en este host; S30 queda pendiente |
| CI `35158415568` sobre `66802e642b9248b1396bb75fdc063941663c251a` | 0 | Jobs `postgres` y `build-and-test` verdes: build/smoke PG, suite PG, paridad, rutas y SQLite |

Las consultas Vercel y GitHub fueron de lectura salvo la publicación autorizada
de la rama/commit candidato. No se ejecutaron `vercel deploy`,
`vercel env add/rm`, `vercel link`, `supabase`, `migrate deploy`, `db push`,
`seed`, `gh workflow run` ni comandos de backup contra un destino remoto. El
intento de `vercel env run` no se considera acceso a la base: al no poder
descargar un valor sensible, el proceso que continuó usó el entorno local y no
se lanzó ninguna query de producción.

La primera invocación supervisada del generador SQLite terminó con código del
supervisor `125` por `unexpected_descendants`, aunque el proceso raíz informó
`0` y generó el cliente. Se repitió únicamente la invocación corta del generador
fuera de esa envoltura, que terminó `0`; no se dejó un proceso de API, k6 u
OpenCode corriendo.

## Revisión de seguridad de evidencia

- No se incluyeron valores de variables remotas, connection strings, JWT, PIN,
  tokens ni claves.
- El paquete documenta sólo nombres y estados observados.
- Los artefactos JSON de E22 quedan referenciados por su sanitización previa;
  E24 no los vuelve a exportar ni duplica sus datos sensibles.
- `evidencia/E24/DESBLOQUEO-CLOUD.md` fue agregado como guía de desbloqueo sin
  Docker; es documentación, no una ejecución de migración o backup.

## Dictamen

`PASS_LOCAL` para preparación documental y CI del candidato. `PENDING_CLOUD` para S23/S30,
deployment, dominio, variables efectivas, canal seguro de migración, backup/
restore, carga PostgreSQL y costos.
`PENDING_HUMAN` para E23 y aprobación operativa. Dictamen actual: **NO-GO**.

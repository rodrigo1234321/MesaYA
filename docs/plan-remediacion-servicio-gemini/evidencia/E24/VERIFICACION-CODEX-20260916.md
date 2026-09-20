# Verificación Codex — E24

Fecha de corte local: 2026-09-16
Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`
Rama: `codex/servicio-remediacion`
Release verificado: `163c1cc4be43afcb2f5402ac4eaaaa6698dde95a6`

## Comandos y resultados

| Comando/consulta | Exit/estado | Resultado |
|---|---:|---|
| `node scripts/validate-instance-manifest.mjs --production` | 0 | Manifiesto válido; HTTPS y secretos ausentes |
| `node scripts/provision-instance-plan.mjs` | 0 | `PLAN_ONLY`; no mutación remota |
| `node --test scripts/instance-manifest.test.mjs` | 0 | Invariantes de manifiesto y rechazo de secretos/HTTP |
| `node scripts/check-load-profile.mjs` | 0 | Perfil E22 fail-closed |
| `node scripts/build.mjs` | 0 | Seis workspaces compilados; sólo warnings Rollup/Zod no bloqueantes |
| `node scripts/build-pg.mjs` bajo Job Object | 0 | Build productivo PG completado sin conexión a una base |
| `npm run test:local` | 0 | 88 archivos, 796 tests; 1 archivo/3 tests omitidos; SQLite efímera limpia |
| `npm run check:routes` | 0 | 107 rutas clasificadas |
| `npm run instance:test` | 0 | 5/5 invariantes |
| `npm audit --omit=dev --audit-level=high` | 0 | 0 vulnerabilidades de producción reportadas |
| CI `35168551177` | success | `build-and-test` y `postgres` verdes sobre `163c1cc4…` |
| backup drill `35168441849` | failure controlado | Detectó servidor 17.6 vs cliente `pg_dump` 16.15; no alteró la base |
| backup drill `35168679754` | success | `BACKUP_RESTORE_DRILL`, schema, digest de filas y relaciones en `PASS` |
| migrate `35168778385` | success | `migrate deploy` exitoso; sin seed ni `db push` |
| `vercel ls ... --json` | 0 | Cuatro deployments `READY`, todos con SHA `163c1cc4…` |
| smoke HTTP post-deploy | 0 | Health/SPAs 200; CORS válido 204; origin inválida 404 |
| QR canónica cloud read-only | 0 | `/v1/sessions/mesaya-piloto/Mesa 1` 200, mesa existente sin sesión activa, sin token |

## Evidencia cloud detallada

### Backup/restore

Run `35168679754`:

- cliente `pg_dump`, `pg_restore` y `psql`: 17.11;
- alcance: `public`;
- `PUBLIC_SCHEMA_MATCH=PASS`;
- `CORE_ROW_DIGEST_MATCH=PASS`;
- `CORE_RELATIONS=PASS`;
- `BACKUP_RESTORE_DRILL=PASS`;
- 128697 bytes, restore en 2 s;
- SHA-256 temporal: `ddf1c69658df325fb400c451281fff025bf90f42cac040d17ba5dd74b60fbc2b`.

El dump no se retuvo. La prueba certifica la ruta de restauración aislada, no
retención durable, RPO/RTO ni una copia histórica independiente.

### Migración

Run `35168778385`, job `migrate`:

- checkout del release `163c1cc4…`;
- instalación limpia reproducible;
- `npm --workspace=@mesaya/api run prisma:postgres:migrate`;
- resultado `success`;
- jobs `preflight` y `backup_drill` omitidos porque la operación seleccionada
  fue exclusivamente `migrate`.

### Vercel

| Proyecto | Deployment ID | Estado | SHA fuente |
|---|---|---|---|
| `api` | `dpl_6isNXrvZaReuFKQaKPGaPA1sCXMd` | READY | `163c1cc4…` |
| `client-web` | `dpl_FzQeDWCkVWmN7dteFPo6VgWGczyH` | READY | `163c1cc4…` |
| `staff-panel` | `dpl_2hPtaXsncU6yPjU6MrHfr7kMTUkA` | READY | `163c1cc4…` |
| `admin-dashboard` | `dpl_5ve1SD9E9t7ohzMY3553xAr7ZW6k` | READY | `163c1cc4…` |

Aliases estables verificados: `api-mesa-ya.vercel.app`,
`client-web-mesa-ya.vercel.app`, `staff-panel-mesa-ya.vercel.app` y
`admin-dashboard-mesa-ya.vercel.app`. Vercel reportó Node 22.x y los Root
Directory configurados por proyecto.

### Smoke HTTP

- API `/health`: 200 JSON.
- API `/v1/health`: 200 JSON.
- Las tres SPAs: 200 HTML.
- Preflight CORS desde las tres origins estables: 204, origin explícita,
  `Access-Control-Allow-Credentials: true` y métodos GET/POST/PATCH/PUT/DELETE/OPTIONS.
- Preflight desde `https://example.invalid`: 404 sin origin permitida.
- Frontend `/r/mesaya-piloto/mesa/Mesa%201`: 200 HTML.
- API `/v1/sessions/mesaya-piloto/Mesa%201`: 200, `valid=false`,
  `isActive=false`, sin token. La ausencia de turno/sesión activa es el estado
  esperado y no implica error.

No se ejecutaron POST/PATCH/PUT/DELETE ni autenticaciones contra producción.

## Revisión de seguridad de evidencia

- No se incluyeron valores de variables remotas, connection strings, JWT, PINs,
  tokens ni claves.
- El workflow recibió sólo referencias de secretos ya configuradas.
- El dump temporal se eliminó en el `finally` del job.
- La carga E22 no se ejecutó contra producción: exige PostgreSQL aislado,
  credenciales de prueba y mesas dedicadas.
- La fixture `trattoria-del-puerto` pertenece a la evidencia local/histórica y no
  existe en la instancia cloud actual; el smoke cloud usó el slug observado
  `mesaya-piloto`.

## Dictamen de gates

- `PASS_LOCAL`: preparación, código ya verificado, CI y controles de release.
- `PASS_CLOUD`: drill temporal, migración, deployments trazables y smoke
  HTTPS/health/CORS/QR read-only.
- `PENDING_CLOUD`: carga E22 en destino PostgreSQL aislado, costos/observabilidad
  y backup durable/RPO/RTO.
- `PENDING_HUMAN`: E23 presencial con operadores/equipos y aprobación operativa.

E24 queda **finalizada en su alcance**; el GO global sigue condicionado a E22
cloud y E23. No se presenta un PASS total donde el plan exige evidencia humana.

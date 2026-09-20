# E24 — Paquete revisable de release y gates externos

Fecha de corte: 2026-09-16
Alcance: publicación autorizada del release, migración PostgreSQL, backup drill
aislado, smoke remoto y trazabilidad de deployments.

## Identidad del release

| Campo | Valor |
|---|---|
| Worktree | `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion` |
| Rama | `codex/servicio-remediacion` |
| Candidato de producto | `9e4a4a06152cc3c068c4b6ee07ba717fae649fe4` |
| Release ejecutado | `163c1cc4be43afcb2f5402ac4eaaaa6698dde95a6` |
| Cambio entre ambos | Corrección del workflow: cliente PostgreSQL 17 para servidor 17.6 |
| CI | `35168551177` — success |
| Datos reales modificados | Migración autorizada; sin seed ni `db push` |

El código de producto del candidato se conservó. El SHA de release añade sólo
la corrección operativa necesaria para que el backup drill use un cliente
compatible con la versión PostgreSQL del destino.

## Workflow cloud ejecutado

`.github/workflows/release-migrate.yml` mantuvo tres operaciones separadas:

- `backup-drill`: copia temporal de `public`, restore en PostgreSQL efímero,
  comparación de schema/filas/relaciones y borrado del dump;
- `migrate`: `migrate deploy` únicamente;
- `preflight`: lectura, sin mutación.

La autorización del usuario para la transferencia temporal y la migración quedó
otorgada en esta sesión. Los secretos se usaron por referencia desde el
Environment `Production`; no se leyó ni se registró ningún valor.

### Runs

| Operación | Run | Resultado |
|---|---:|---|
| Primer drill | `35168441849` | Fallo controlado por `pg_dump` 16.15 contra servidor 17.6 |
| Drill corregido | `35168679754` | Success: schema, digest de filas, relaciones y restore PASS |
| Migración | `35168778385` | Success: `migrate deploy`, sin seed/db push |

El drill corregido informó `pg_dump/pg_restore/psql 17.11`, alcance `public`,
128697 bytes, restore de 2 s y SHA-256 temporal
`ddf1c69658df325fb400c451281fff025bf90f42cac040d17ba5dd74b60fbc2b`.
El dump fue eliminado y no se conserva como backup durable.

## Vercel: mapping final

| Proyecto | Root Directory | Node | Deployment ID | Alias estable | Estado |
|---|---|---:|---|---|---|
| `api` | `.` | 22.x | `dpl_6isNXrvZaReuFKQaKPGaPA1sCXMd` | `https://api-mesa-ya.vercel.app` | READY |
| `client-web` | `apps/client-web` | 22.x | `dpl_FzQeDWCkVWmN7dteFPo6VgWGczyH` | `https://client-web-mesa-ya.vercel.app` | READY |
| `staff-panel` | `apps/staff-panel` | 22.x | `dpl_2hPtaXsncU6yPjU6MrHfr7kMTUkA` | `https://staff-panel-mesa-ya.vercel.app` | READY |
| `admin-dashboard` | `apps/admin-dashboard` | 22.x | `dpl_5ve1SD9E9t7ohzMY3553xAr7ZW6k` | `https://admin-dashboard-mesa-ya.vercel.app` | READY |

Los cuatro deployments fueron publicados desde el release y Vercel confirmó el
SHA fuente `163c1cc4be43afcb2f5402ac4eaaaa6698dde95a6` en `vercel ls --json`.

## Smoke remoto final

- `/health` y `/v1/health`: 200 JSON.
- Las tres SPAs: 200 HTML.
- Origins válidas de cliente, Staff y Admin: OPTIONS 204, CORS explícito y
  credenciales habilitadas.
- Origin no autorizada: 404 sin CORS.
- QR frontend `/r/mesaya-piloto/mesa/Mesa%201`: 200.
- QR API `/v1/sessions/mesaya-piloto/Mesa%201`: 200, mesa existente,
  `valid=false`, `isActive=false`, sin token porque no hay sesión activa.

La instancia cloud contiene `mesaya-piloto`, no la fixture histórica
`trattoria-del-puerto`; por eso se usó el slug observado en el smoke real.
Todas las peticiones fueron de lectura y no generaron pedidos/cobros.

## Rollback desacoplado

| Capa | Acción | Evidencia necesaria |
|---|---|---|
| Código | Reasignar alias al deployment N-1 | IDs N/N-1, SHA y compatibilidad |
| Variables | Restaurar snapshot del gestor seguro | nombres, ambiente y responsable; nunca valores en Git |
| Dominio | Reasignar alias/DNS | dominio verificado y TTL |
| Schema | Migración expand/contract compatible | SQL revisado y smoke N-1 |
| Datos | Detener ingreso y restaurar backup durable | checksum, restore funcional, RPO/RTO |
| Operación | Fallback manual en papel | kit, responsable y criterio de reanudación |

Un rollback Vercel no revierte SQL ni recupera datos. El drill de E24 valida la
restauración temporal, pero todavía no reemplaza el backup durable operativo.

## Gates restantes fuera del alcance cerrado

### `PENDING_CLOUD`

- Repetir el perfil E22 sobre PostgreSQL/staging aislado, nunca sobre datos
  reales de producción, con mesas/credenciales de prueba.
- Fijar costos, observabilidad, retención durable, RPO y RTO.
- Verificar variables efectivas y hardening del proyecto con el responsable de
  infraestructura, sin extraer secretos.

### `PENDING_HUMAN`

- E23 con tres operadores representativos, dos rondas, PC/tablet/puestos,
  cocina, red caída, papel, QR/NFC y caja.
- Medir mirada, interacción, caminata, espera y errores; aprobar o rechazar el
  piloto con responsable identificable.

E24 está cerrada como paquete y release ejecutado; estos gates no se borran ni
se convierten en PASS por inferencia.

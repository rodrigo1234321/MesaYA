# E24 — Paquete revisable de release y gates externos

Fecha de corte: 2026-09-16
Alcance: preparación local y relevamiento remoto de lectura.
Regla: este archivo no autoriza deploy, migración, seed, publicación ni uso de datos reales.

## Identidad del candidato

| Campo | Valor observado |
|---|---|
| Worktree | `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion` |
| Rama | `codex/servicio-remediacion` |
| Base/HEAD | `9e4a4a06152cc3c068c4b6ee07ba717fae649fe4` |
| Estado | Árbol limpio; commit de release publicado en `codex/servicio-remediacion` |
| SHA de salida desplegable | `9e4a4a06152cc3c068c4b6ee07ba717fae649fe4` |
| Datos reales modificados | No |

El SHA es reproducible y pasó la CI del repositorio en el run `35160962710`. Eso no certifica todavía
la migración cloud ni que un deployment Vercel existente sirva este candidato.

## Inventario local preparado

Se encontraron los siguientes componentes y controles ya existentes en el árbol:

- API Fastify serverless en `api/index.ts`, con `vercel.json` raíz y build
  PostgreSQL mediante `npm run vercel-build`.
- Frontends Vite en `apps/client-web`, `apps/staff-panel` y
  `apps/admin-dashboard`, cada uno con rewrite SPA.
- Schema PostgreSQL separado en `packages/api/prisma/schema.supabase.prisma`.
- 26 directorios de migración bajo `packages/api/prisma/migrations-postgres`.
- `scripts/postgres-migrate.mjs`, que exige
  `MESAYA_PG_DATABASE_URL` y `MESAYA_PG_DIRECT_URL` explícitas y ejecuta sólo
  `migrate deploy` sobre una copia temporal del schema/migrations.
- Workflow CI `.github/workflows/ci.yml`, sin seed ni migración sobre bases
  reales, y workflow manual `.github/workflows/release-migrate.yml` para el
  gate de migración.
- `scripts/supabase-hardening.sql`, `deploy/instance.example.json`,
  `scripts/validate-instance-manifest.mjs` y
  `scripts/provision-instance-plan.mjs`.
- `docs/RUNBOOK_PILOTO.md`, `docs/DEPLOY_VERCEL_SUPABASE.md`, protocolo de
  backup/restore y documentación de fallback manual en papel.
- Perfil k6 E22 fail-closed y evidencia local de lectura/flujo; la repetición
  contra PostgreSQL/staging sigue pendiente.

## Relevamiento Vercel de sólo lectura

La cuenta mostró el namespace `mesa-ya` y estos cuatro proyectos. Los nombres
históricos `mesaya-*` o `mesa-ya-*` de otros documentos no se usan como fuente
de verdad para una nueva publicación.

| Proyecto | Root Directory | Node | Región | Deployment ID visible | SHA fuente observado | Alias productivo canónico | Estado observado |
|---|---|---:|---|---|---|---|---|
| `api` | `.` | 22.x | `iad1` | `dpl_FsQYC1R8H31BnpebWCgCPoSQvir5` | `04633508b1033e6c6e7e1e671af32ffdfb45d4b0` | `https://api-mesa-ya.vercel.app` | Ready, antigüedad aproximada 5 días |
| `client-web` | `apps/client-web` | 22.x | `iad1` | `dpl_GzeaWDnXTYcBcjBRQ9SSnRiSjrDW` | `16a180d4fddc94dc246a1cce65a7d55358bc5f49` | `https://client-web-mesa-ya.vercel.app` | Ready, antigüedad aproximada 6 días |
| `staff-panel` | `apps/staff-panel` | 22.x | `iad1` | `dpl_BChQURuHagbjyk8SAGybbJNYbUzV` | `16a180d4fddc94dc246a1cce65a7d55358bc5f49` | `https://staff-panel-mesa-ya.vercel.app` | Ready, antigüedad aproximada 6 días |
| `admin-dashboard` | `apps/admin-dashboard` | 22.x | `iad1` | `dpl_8heyeWXXaXyda2FQm734FoRikpsb` | `d57d47be34f27b630cd3d83bdccdfe94517b7ab6` | `https://admin-dashboard-mesa-ya.vercel.app` | Ready, antigüedad aproximada 5 días |

También aparecen deployments históricos `Error` en las listas de Staff y Admin.
La consulta estableció el commit/SHA fuente de los deployments productivos
actuales y demostró que ninguno contiene el candidato `9e4a4a0`; por eso se
registran como infraestructura existente/baseline, no como evidencia del
candidato.

## Variables remotas observadas sin leer valores

La consulta `vercel env ls --project ...` confirmó nombres, alcance y tipo. El
CLI mostró una representación truncada/enmascarada de algunas variables de
configuración, pero no se descargó ni guardó ningún valor completo.

| Proyecto | Variables observadas |
|---|---|
| `api` | `DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `ENCRYPTION_SECRET_KEY`, `NODE_ENV`, `CORS_ORIGIN`, `MESAYA_INSTANCE_MODE`, `PUBLIC_ONBOARDING_ENABLED` |
| `client-web` | `VITE_API_URL` |
| `staff-panel` | `VITE_API_URL`, `VITE_CLIENT_URL` |
| `admin-dashboard` | `VITE_API_URL`, `VITE_CLIENT_URL`, `VITE_CLIENT_WEB_URL` |

La presencia de una variable no prueba que su valor sea correcto. Queda pendiente
verificar, con acceso autorizado y sin exponer secretos, que `NODE_ENV` sea
production, CORS sea HTTPS explícito, onboarding/IA/pagos incompletos estén
apagados y que los bundles Vite sólo contengan URLs públicas.

## Canal remoto de migración observado

`.github/workflows/release-migrate.yml` está activo y exige ejecución manual
(`workflow_dispatch`) contra el Environment GitHub `production`. Ofrece un
preflight de sólo lectura por defecto, un `backup-drill` opcional y una operación
`migrate` explícita. El job usa
únicamente estas dos referencias de secreto, cuyos valores nunca deben entrar al
repositorio ni al chat:

- `MESAYA_PG_DATABASE_URL`
- `MESAYA_PG_DIRECT_URL`

El workflow ejecuta `npm --workspace=@mesaya/api run prisma:postgres:migrate`,
que llama al script auditado de `migrate deploy`; no hace seed ni `db push`.
La consulta del Environment `Production` devolvió que no había reglas de
protección observadas. Los nombres de los dos secretos requeridos están
configurados en el Environment; sus valores nunca se leyeron ni registraron.
La CI del candidato actual pasó en el run `35160962710` y el preflight remoto de sólo
lectura pasó nuevamente en `35162520660` sobre la rama actual; el primer éxito fue
`35160057353` sobre el SHA anterior compatible. El `backup-drill`
quedó preparado para copiar sólo `public` a un PostgreSQL efímero, restaurarlo,
comparar schema/filas/relaciones y borrar el dump; no se ejecutó y no conserva un
artefacto durable. Vercel también informó que un valor sensible
no podía descargarse con `env run`; por eso no se usó como puente para consultar
la base y no se hizo ninguna mutación remota.

La autorización explícita del usuario para avanzar hacia producción queda
registrada. Los secretos están configurados y el preflight remoto confirmó el
destino y el esquema núcleo; la migración sólo puede ejecutarse después de
probar backup/restore y fijar el alcance operativo.

## Smoke HTTP remoto de baseline

Se ejecutaron únicamente peticiones de lectura contra los aliases productivos
visibles el 2026-09-16. No se les atribuye el SHA local.

- `https://api-mesa-ya.vercel.app/health` → HTTP 200.
- `https://api-mesa-ya.vercel.app/v1/health` → HTTP 200.
- Preflight CORS desde `client-web`, `staff-panel` y `admin-dashboard` → HTTP
  204, origin explícita y credenciales habilitadas.
- Preflight desde `https://example.invalid` → HTTP 404, sin origin permitida.
- Los tres aliases SPA (`client-web`, `staff-panel`, `admin-dashboard`) → HTTP
  200 y HTML.

Esto demuestra disponibilidad y una configuración CORS coherente del baseline
remoto en ese momento. No demuestra browser E2E, QR/NFC, datos, migraciones,
backup/restore, carga ni que el deployment sea el candidato de remediación.

## Procedimiento de publicación condicionado

1. Separar los cambios E00–E22 de cualquier modificación ajena, revisar diff y
   crear un commit de release reproducible.
2. Ejecutar CI sobre ese SHA y conservar sus resultados; no usar el árbol sucio
   como artefacto.
3. Crear/confirmar un proyecto Supabase PostgreSQL de staging aislado, registrar
   sus identificadores fuera de Git y aplicar sólo `migrate deploy` con las dos
   variables explícitas de migración.
4. Ejecutar bootstrap idempotente con PIN entregado por canal seguro; no usar
   seed demo ni registrar el PIN.
5. Aplicar hardening de Data API/permisos, inventariar schema y probar aislamiento.
6. Con autorización explícita para transferir temporalmente `public` al runner,
   ejecutar el `backup-drill` preparado, o aportar una evidencia externa durable;
   guardar checksum y restaurar en otra base aislada; conciliar tablas,
   relaciones, cuentas, cobros, recibos, sesiones y mesa.
7. Construir y desplegar los cuatro proyectos a staging desde el mismo SHA;
   registrar deployment ID, URL, Node/región y variables por nombre, sin valores.
8. Verificar HTTPS, CORS, QR canónica, health, login, recorrido navegador y
   repetir k6 E22 contra PostgreSQL con límites reales.
9. Completar E23 con operadores/equipos reales, fallback en papel y aprobación
   humana; sólo después evaluar una promoción limitada.

## Rollback desacoplado

| Capa | Acción | Evidencia necesaria antes del GO |
|---|---|---|
| Código | Reasignar alias Vercel al deployment N-1 ya certificado | deployment ID N y N-1, SHA y compatibilidad N/N-1 |
| Variables | Restaurar snapshot del gestor seguro | inventario de nombres, ambiente y responsable; nunca valores en Git |
| Dominio | Reasignar alias/DNS a instancia aprobada | dominio verificado, TTL y responsable operativo |
| Schema | No hacer rollback destructivo; exigir migración `expand/contract` compatible con N-1 | SQL revisado, plan de compatibilidad y smoke |
| Datos | Detener ingreso, conservar logs y restaurar backup en réplica | backup íntegro, checksum, restore funcional, RPO/RTO medidos |
| Operación | Pasar a conciliación manual en papel | kit, responsable, canal y criterio de reanudación |

Un rollback Vercel sólo cambia código; no revierte SQL ni recupera datos.

## Gate y artefactos faltantes

### PASS_LOCAL — preparación del paquete

- Inventario local y remoto de sólo lectura registrado.
- Configuración, workflows, migraciones y manifiesto versionado identificados.
- Procedimiento de migración, backup/restore, observabilidad y rollback separado.
- No se ejecutaron acciones externas mutantes.

### PENDING_CLOUD

- Publicación del candidato `9e4a4a0` y mapping SHA → cuatro deployments; el
  mapping actualmente observado corresponde a SHAs anteriores.
- Proyecto PostgreSQL staging aislado, migraciones, hardening y smoke real.
- Backup con checksum, restore en base separada, conciliación y RPO/RTO medidos.
- El `backup-drill` del workflow está preparado pero no ejecutado; sólo cubre
  `public`, usa un runner efímero y no deja un artefacto retenido.
- HTTPS/CORS/QR reales, carga k6 sobre PostgreSQL y revisión de costos/plan.
- `supabase`, `psql`, `pg_dump` y `pg_restore` no están instalados en este host;
  falta un entorno autorizado que los provea o un mecanismo equivalente.
- El preflight remoto pasó en `35160057353`; los valores de secretos no se
  solicitaron ni se registran aquí.

### PENDING_HUMAN

- E23: tres operadores representativos, dos rondas, PC/tablet/puestos reales,
  cocina, red caída, papel, QR/NFC y caja.
- S01–S20/S29 observados sin guiar cada click, con tiempos y errores.
- Responsable del local, soporte, canal operativo, límites del piloto y GO/NO-GO.

### Acciones no realizadas

No se creó ni modificó ningún proyecto o variable Vercel, no se desplegó, no se
migró, no se hizo seed, no se ejecutó el `backup-drill` ni se tomó/restauró un
backup real, no se hizo merge, no se imprimieron QR y no se usó dinero o clientela
real. La rama candidata sí se publicó en GitHub para habilitar CI y preflight.

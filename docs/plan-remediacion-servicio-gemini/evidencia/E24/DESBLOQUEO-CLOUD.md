# E24 — Desbloqueo cloud sin Docker

Fecha: 2026-09-16
Alcance: instrucciones operativas; este archivo no ejecuta migraciones, backup ni
deploy y no contiene secretos.

## Lo que debe quedar configurado

En GitHub, repositorio `rodrigo1234321/MesaYA`, abrir `Settings → Environments →
Production → Environment secrets` y crear exactamente:

- `MESAYA_PG_DATABASE_URL`
- `MESAYA_PG_DIRECT_URL`

Los valores deben corresponder al mismo proyecto Supabase que se quiere migrar.
No deben pegarse en issues, commits, logs ni en este chat. Si es posible, agregar
un reviewer requerido al Environment `Production`.

## Evidencia de backup/restore

Antes de ejecutar `release-migrate` hace falta una copia del destino real o del
staging autorizado, conservada en almacenamiento seguro fuera del repositorio.
La evidencia mínima es:

1. identificación del proyecto/base y hora de corte, sin incluir credenciales;
2. artefacto de backup y checksum calculado en el entorno remoto;
3. restauración en otra base aislada, no sobre el origen;
4. verificación de schema, relaciones, cuentas, cobros, recibos, sesiones y
   mesas, más RPO/RTO medidos;
5. responsable y criterio de abortar/restaurar.

Puede hacerse desde Supabase o desde un runner remoto con `pg_dump`/`pg_restore`;
no requiere Docker ni guardar el dump en esta PC. No usar `db push`, reset ni
seed como sustituto del backup o rollback.

## Qué se hará después

Con los secretos configurados y el backup verificable, se fijará un SHA limpio,
se ejecutará el workflow manual auditado `release-migrate`, se comprobará su
resultado, se desplegará ese mismo SHA en `api`, `client-web`, `staff-panel` y
`admin-dashboard`, y se probará el flujo con datos sintéticos. Luego se repetirá
E22 sobre PostgreSQL y se mantendrá E23 pendiente hasta contar con operadores y
equipos reales.

## Estado observado en la actualización de esta guía

La consulta autorizada de GitHub devolvió `total_count=2` para secrets de
`Production`, con los nombres requeridos configurados. La rama
`codex/servicio-remediacion` contiene el commit
`66802e642b9248b1396bb75fdc063941663c251a`, y la CI `35158415568` terminó en
éxito. No hay ejecuciones de `release-migrate`, no se realizó migración/deploy
ni backup/restore real, y Vercel muestra secretos ocultos que no permite
exportar.

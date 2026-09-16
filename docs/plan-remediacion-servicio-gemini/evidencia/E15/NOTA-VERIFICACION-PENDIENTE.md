# E15 — Gate PostgreSQL pendiente

La verificación local ya se ejecutó. El test focal pasó `6/6`, la regresión
relacionada pasó `46/46` y el build de seis workspaces terminó exit `0`.
El detalle completo está en `VERIFICACION-CODEX-20260915.md`.

Queda `PENDING_CLOUD` para S21: PostgreSQL multi-conexión con al menos 20
solicitudes, mismas y distintas claves, dos restaurantes, número preexistente,
reinicio real del proceso y PDF persistido. En este host no hay `psql` ni
`pg_isready`, y Docker Desktop no tiene daemon activo; no se abrió una base
externa ni se inventó evidencia.

Cuando exista un PostgreSQL desechable y aislado, aplicar el schema
`packages/api/prisma/schema.supabase.prisma` y las migraciones con
`scripts/postgres-migrate.mjs deploy`, usando únicamente
`MESAYA_PG_DATABASE_URL` y `MESAYA_PG_DIRECT_URL` explícitas para esa base. Luego
ejecutar una variante del focal contra ese sandbox y una prueba de reinicio de
proceso. No usar `.env`, Supabase/Vercel, datos reales, `db push` ni despliegues.

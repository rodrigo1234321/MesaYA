# E24 — Diagnóstico de release

Fecha: 2026-09-16
Release: `163c1cc4be43afcb2f5402ac4eaaaa6698dde95a6`

## Confirmado como correcto

1. La CI del release pasó el build general, el build PostgreSQL, la suite
   SQLite/PostgreSQL, la matriz de rutas y los checks de seguridad existentes.
2. El primer backup drill falló de forma segura por una incompatibilidad de
   cliente (`pg_dump 16.15`) frente al servidor PostgreSQL 17.6. Se corrigió el
   workflow para usar cliente 17; el segundo drill pasó schema, digest de filas,
   relaciones y restore.
3. La migración cloud pasó por `migrate deploy` en el workflow manual, sin seed
   ni `db push`, sobre el mismo SHA que se publicó.
4. Los cuatro proyectos Vercel están `READY` y su metadata confirma el mismo
   SHA de release: API, cliente, Staff y Admin.
5. El smoke HTTPS posterior al deploy confirma health 200, las tres SPAs 200,
   CORS explícito sólo para origins permitidas y rechazo de origin inválida.
6. La resolución QR canónica real del cloud (`mesaya-piloto` / `Mesa 1`) devuelve
   200 con mesa existente, pero sin sesión activa ni token; ese estado es válido
   y no se alteró la base.
7. No se expusieron secretos, connection strings, PINs ni tokens. El dump
   temporal se eliminó al finalizar el drill.

## Hallazgos corregidos durante E24

- **Cliente PostgreSQL desalineado:** el run `35168441849` detectó que el
  servidor era 17.6 y el cliente Ubuntu era 16.15. Se ajustó la imagen auxiliar
  a PostgreSQL 17 y se agregó instalación/verificación PGDG 17. El run
  `35168679754` terminó con `BACKUP_RESTORE_DRILL=PASS`.
- **Fixture QR histórica incorrecta para cloud:**
  `trattoria-del-puerto` no existe en la instancia productiva actual. El smoke
  se repitió con el slug observado `mesaya-piloto` y la mesa `Mesa 1`; no se
  cambió el código ni se creó un tenant artificial.
- **Raíz Vercel duplicada en el primer intento de SPA:** invocar el CLI desde
  `apps/client-web` duplicaba la Root Directory. Ese intento no produjo
  deployment; la publicación correcta se ejecutó desde el monorepo con el
  proyecto explícito.

## Riesgos todavía abiertos

1. El backup drill es temporal: demuestra recuperación, pero no retención
   durable, RPO/RTO ni política de restauración histórica.
2. E22 tiene carga semántica local contra SQLite aislada; falta repetirla sobre
   PostgreSQL/staging aislado con variables, mesas y tarifa reales. No se debe
   ejecutar el perfil mutante contra producción.
3. No se certifica que costos, observabilidad y valores efectivos de variables
   cumplan el GO operativo; se preservan como gate de infraestructura sin leer
   secretos.
4. E23 sigue `PENDING_HUMAN`: ningún smoke técnico sustituye la prueba con
   operadores, equipos, papel, red caída, QR/NFC y caja.

## Decisión

E24 se marca **FINALIZADA EN SU ALCANCE** con `PASS_LOCAL` y los subgates cloud
ejecutados en `PASS_CLOUD`. El estado global del plan sigue condicionado por
`PENDING_CLOUD` (E22 real/costos/backup durable) y `PENDING_HUMAN` (E23). No se
declara un GO operativo total ni se borra ningún pendiente.

# E24 — Desbloqueo cloud sin Docker

Fecha: 2026-09-16
Alcance: guía y registro de la ejecución autorizada; no contiene secretos.

## Configuración requerida

En GitHub, repositorio `rodrigo1234321/MesaYA`, Environment `Production`, se
mantienen exactamente estas referencias:

- `MESAYA_PG_DATABASE_URL`
- `MESAYA_PG_DIRECT_URL`

Los valores no se leyeron, imprimieron ni guardaron. Deben corresponder al mismo
proyecto PostgreSQL que se quiere migrar. No usar `db push`, reset ni seed como
sustituto de backup o rollback.

## Ejecución realizada

Con autorización explícita del usuario:

1. El primer `backup-drill` (`35168441849`) detectó servidor PostgreSQL 17.6
   frente a cliente `pg_dump` 16.15 y terminó sin mutación.
2. Se corrigió el workflow para usar imagen/cliente PostgreSQL 17.
3. El drill corregido (`35168679754`) copió temporalmente sólo `public` al
   runner, restauró a PostgreSQL efímero, comparó schema/filas/relaciones y
   borró el dump. Resultado `BACKUP_RESTORE_DRILL=PASS`.
4. La migración (`35168778385`) ejecutó sólo `migrate deploy` sobre el mismo
   release, sin seed ni `db push`, y terminó `success`.
5. Se publicaron los cuatro proyectos Vercel con SHA
   `163c1cc4be43afcb2f5402ac4eaaaa6698dde95a6` y se hizo smoke HTTPS/CORS/QR.

El checksum del dump temporal fue
`ddf1c69658df325fb400c451281fff025bf90f42cac040d17ba5dd74b60fbc2b`; el
artefacto no se conserva. Esto demuestra el procedimiento de restore, pero no
una retención durable ni RPO/RTO.

## Evidencia restante

El siguiente trabajo no bloquea el cierre de E24, pero sí el GO operativo total:

- repetir el perfil E22 en PostgreSQL/staging aislado con credenciales y mesas
  de prueba, nunca contra producción;
- fijar backup durable, RPO/RTO, costos y observabilidad;
- completar E23 con personas, dispositivos, papel, QR/NFC y caja.

No pegar secretos en el chat ni usar datos reales para la carga mutante.

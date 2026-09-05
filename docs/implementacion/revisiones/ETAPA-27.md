# Revisión Codex — Etapa 27

Estado: APPROVED
Fecha: 2026-09-06
Ficha: [Etapa 27](../etapas/27-ci-release.md)
Reporte revisado: [ETAPA-27](../reportes/ETAPA-27.md)

## Hallazgo bloqueante

El job `postgres` de `.github/workflows/ci.yml` intenta ejecutar `node scripts/smoke-serverless.mjs`, pero ese archivo no existe. La comprobación local del comando exacto falla con `MODULE_NOT_FOUND` y exit 1, por lo que la primera CI remota fallaría antes del smoke PostgreSQL.

Además, el workflow no invoca `npm run build:pg`; por tanto el build productivo PostgreSQL que se documenta como explícito sólo se verificó manualmente y no queda protegido por el pipeline.

## Corrección requerida

Corregir únicamente la Etapa 27:

1. Cambiar el job PostgreSQL para ejecutar comandos existentes y verificables: primero `npm run build:pg`, luego `npm run smoke:serverless` (o crear el script referido, con una razón clara y cobertura equivalente).
2. Verificar localmente el flujo efectivo del job contra PostgreSQL 16 efímero: build PG, smoke serverless y suite PG enfocada. El comando del workflow no puede apuntar a un archivo inexistente.
3. Mantener el alcance seguro: CI/preview no migran ni siembran una base real; el workflow manual de release conserva exclusivamente `migrate deploy`, sin seed ni `db push`.
4. Actualizar el reporte, dejar Etapa 27 en `NEEDS_REVIEW`, mantener Etapa 28 `BLOCKED` y detenerse.

## Verificaciones realizadas

- `node scripts/check-route-matrix.mjs`: PASS; 76 rutas clasificadas sin deriva.
- `node scripts/smoke-serverless.mjs`: FAIL reproducible; el módulo no existe.
- El diseño de `release-migrate.yml` separa correctamente la migración manual de preview y no invoca seed ni `db push`.
- No se inició la Etapa 28.

## Decisión

`CHANGES_REQUESTED`: la configuración CI aún no es ejecutable tal como está. No aprobar ni desbloquear la Etapa 28 hasta corregir y verificar el job PostgreSQL real.

## Cierre de corrección (2026-09-06)

### Resultado

`APPROVED`.

El job PostgreSQL ahora ejecuta sólo comandos existentes, en orden: `npm run build:pg`, `npm run smoke:serverless` y la suite PG enfocada. Ya no hay referencias activas a `scripts/smoke-serverless.mjs`.

El alias de smoke resuelve al runner PostgreSQL correcto y falla cerrado con exit 2 si faltan las dos URLs PG explícitas. El workflow de release continúa manual, separado de preview/CI y limitado a `migrate deploy`; no invoca seed ni `db push`.

### Evidencia ejecutada por Codex

- Inspección de `.github/workflows/ci.yml`: build PG, smoke y suite PG referencian comandos existentes.
- `npm run smoke:serverless` sin entorno PG: exit 2 esperado, sin fallback de credenciales.
- `node scripts/check-route-matrix.mjs`: 76 rutas clasificadas, PASS.
- `node scripts/test-isolated.mjs route-matrix-guard`: 1/1 PASS.
- `packages/api/prisma/dev.db` intacta; SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- El reporte documenta el flujo PG efímero efectivo (build PG, smoke 3/3 y guardado atómico 6/6), además de build 6/6 y runner 29/29. La CI remota permanece correctamente marcada como no ejecutada porque no existe remoto/Actions habilitado.

## Decisión final

Etapa 27 queda `APPROVED`. Se habilita únicamente la Etapa 28 en `READY`; no fue iniciada durante esta revisión.

# E16 — Nota de verificación ejecutada

Fecha: 2026-09-15. Ejecutor inicial: OpenCode con
`opencode/muse-spark-1.3-contributor-free`. Revisión independiente: Codex.

## Corridas y resultados

Todas las corridas usaron SQLite efímera propia mediante
`node scripts/test-local.mjs`; no se usó `.env`, la base demo ni servicios
locales compartidos.

```text
node scripts/test-local.mjs test/e16-sales-reports-reconciliation.test.ts
exit 0 — 10/10

node scripts/test-local.mjs test/sales-reports-settle.test.ts \
  test/monetary-convergence.test.ts test/e13-contextual-settle-flow.test.ts \
  test/e14-kitchen-second-station.test.ts \
  test/e15-receipts-atomic-recoverable.test.ts \
  test/e16-sales-reports-reconciliation.test.ts
exit 0 — 6 archivos, 62/62

node scripts/build.mjs
exit 0 — 6/6 workspaces
```

Los prefijos de evidencia son `e16-focal3`, `e16-regression2` y `e16-build`
en `C:\Users\rodri\Desktop\AI\Projects\_orchestration\runs\mesaya-remediacion-e16-codex-20260915-1`.
Cada supervisor registró `verified_empty` al finalizar.

## Cobertura S22

- fecha original de la tanda y cobro en día distinto;
- turno cruzando medianoche;
- devolución posterior sin reescritura del día de cobro;
- devolución sobre settlement histórico como salida negativa del período;
- filtros de medio, responsable y comprobante fiscal;
- oráculo SQL/aritmético y suma del detalle;
- etiquetas y semántica compartida en CSV, PDF y Admin;
- rango inválido y turno de otro restaurante sin falso cero.

## Residuos fuera de E16

- `check-route-matrix.mjs` sigue exit 1 por cuatro hallazgos previos de E14:
  dos manifiestos de auth y dos rutas sin clasificar.
- `git diff --check` sigue exit 2 por una línea blanca EOF preexistente en
  `apps/staff-panel/src/App.tsx`.
- S21 PostgreSQL de E15 queda `PENDING_CLOUD` porque este host no tiene
  PostgreSQL/daemon Docker disponible.
- La revisión de Admin en navegador/tablet real queda `PENDING_HUMAN`.

## Gate

E16 = `VERIFIED_LOCAL`. No es certificación cloud, humana ni GO de producción.

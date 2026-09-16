# E16 — Verificación independiente Codex

Fecha: 2026-09-15. HEAD: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`.

## Corridas

- `node scripts/test-local.mjs test/e16-sales-reports-reconciliation.test.ts`
  — exit 0, 10/10.
- `node scripts/test-local.mjs test/sales-reports-settle.test.ts
  test/monetary-convergence.test.ts test/e13-contextual-settle-flow.test.ts
  test/e14-kitchen-second-station.test.ts
  test/e15-receipts-atomic-recoverable.test.ts
  test/e16-sales-reports-reconciliation.test.ts` — exit 0, 6 archivos,
  62/62.
- `node scripts/build.mjs` — exit 0, 6/6 workspaces.
- Cada corrida fue encapsulada por el supervisor de Windows y terminó con
  `verified_empty`.

## Revisión que cambió el resultado

La lectura del servicio mostró que el primer cambio omitía ajustes dentro del
período cuando el settlement original era anterior. Se modificó la selección
para traer settlements con cobro o ajuste dentro del rango, se emitió la
devolución histórica como movimiento negativo y se agregó S22.10. También se
completó el PDF A4 con turno, devolución del período y columna por medio; S22.9
lo verifica.

## Resultado

E16 = `VERIFIED_LOCAL`. `check-route-matrix.mjs` conserva cuatro hallazgos
previos de E14 y `git diff --check` conserva la línea blanca EOF previa de
`apps/staff-panel/src/App.tsx`; ambos quedan fuera de E16. S21 PostgreSQL y la
revisión humana siguen pendientes en sus gates correspondientes.

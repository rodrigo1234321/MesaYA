# E15 — Verificación posterior por supervisor Codex

Fecha: 2026-09-15. Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`.
SHA: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83` antes y después; el árbol
dirty se preservó y no hubo reset/clean/checkout/switch/merge/rebase.

## Corrida del ejecutor

- OpenCode `opencode/muse-spark-1.3-contributor-free`: exit `0`.
- Runner Windows Job Object: `verified_empty`, `ActiveProcesses=0`.
- No se aceptó la salida del ejecutor como verificación funcional.

## Verificación local

Todos los comandos usaron fixtures efímeras y no tocaron `dev.db` ni servicios
locales activos:

- `node scripts/prisma-generate.mjs sqlite`: generación completada. El wrapper
  devolvió `125 unexpected_descendants` al cierre porque apareció un proceso
  descendiente durante la salida; el log terminó `verified_empty`. El build y
  el test focal confirmaron que el cliente generado contiene `ReceiptCounter`.
- `node scripts/test-local.mjs test/e15-receipts-atomic-recoverable.test.ts`:
  exit `0`, `1` archivo, `6/6` tests.
- `node scripts/test-local.mjs test/sales-reports-settle.test.ts test/monetary-convergence.test.ts test/e13-contextual-settle-flow.test.ts test/e14-kitchen-second-station.test.ts`:
  exit `0`, `4` archivos, `46/46` tests.
- `node scripts/build.mjs`: exit `0`, `6/6` workspaces compilados.
- `node scripts/sync_supabase_schema.js --check`: exit `0`, schemas
  sincronizados.
- Prisma `validate` de `schema.supabase.prisma` con URLs sintéticas en
  `127.0.0.1:1`: exit `0`, schema válido; no hubo conexión.

El test focal cubre 20 claves distintas concurrentes, la misma clave ×20,
aislamiento entre dos restaurantes, convivencia con `TK-YYYYMMDD-0042`,
reimpresión byte-idéntica tras limpiar caché y settlement intacto.

## Gates no cerrados

- `PENDING_CLOUD`: no existe PostgreSQL local (`psql`/`pg_isready`) y Docker
  Desktop no tiene daemon. S21 multi-conexión, migración aplicada en PG y
  reinicio de proceso real requieren un sandbox externo/desplegable.
- `PENDING_HUMAN`: no aplica directamente a E15.

## Hallazgos fuera de E15

- `node scripts/check-route-matrix.mjs`: exit `1` por cuatro rutas agregadas o
  modificadas en E14, fuera de los archivos E15.
- `git diff --check`: exit `1` por blanco al EOF preexistente en
  `apps/staff-panel/src/App.tsx`, fuera de E15.

## Gate

`VERIFIED_LOCAL` para la implementación, pruebas y build locales de E15;
`PENDING_CLOUD` para S21. No es certificación de producción, cloud ni datos
reales. La revisión de este documento y del diff es del supervisor Codex, no
una revisión independiente de una segunda persona.

# E21 — Verificación posterior de Codex

Fecha: 2026-09-16 01:00–01:03 (America/Argentina/Buenos_Aires).

## Alcance

Se verificó el worktree actual de
`C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`, rama
`codex/servicio-remediacion`, HEAD sin commit
`7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`. El árbol sucio E00–E20 se
preservó; E21 sólo añadió la corrección autorizada de navegación, tests,
manifiesto/scanner y documentación. No se usaron datos reales ni servicios
cloud.

## Resultados ejecutados

| Comprobación | Exit | Resultado |
|---|---:|---|
| Focal E21, 5 archivos | 0 | 5 suites, 43/43 tests |
| Regresión completa `node scripts/test-local.mjs` | 0 | 87 suites, 778/781 tests; 1 suite y 3 tests skip explícitos |
| `node scripts/build.mjs` | 0 | 6/6 workspaces |
| `node scripts/check-route-matrix.mjs` | 0 | 107 rutas clasificadas |
| `git diff --check` global | 0 | sin errores |
| `git diff --check` alcance E21 | 0 | sin errores |

La primera focal después de OpenCode tuvo `exit 1` por la sintaxis estática
vieja de S07 (`useState<ActiveTab>('service')` frente al inicializador lazy
necesario para `/kitchen`). Codex ajustó sólo esa aserción y la segunda focal
terminó `exit 0`.

## Evidencia reproducible

Los stdout/stderr y eventos del supervisor están en:

`C:/Users/rodri/Desktop/AI/Projects/_orchestration/runs/mesaya-remediacion-e21-20260916-1/`

Logs principales:

- `e21-baseline-full.stdout.log` / `.stderr.log` — baseline fallido, antes de
  la corrección.
- `e21-focal-review2.stdout.log` / `.stderr.log` — focal final `exit 0`.
- `e21-full-final.stdout.log` / `.stderr.log` — regresión completa `exit 0`.
- `e21-build-final.stdout.log` / `.stderr.log` — build `exit 0`.
- `e21-route-final.stdout.log` / `.stderr.log` — matriz `exit 0`.

Cada corrida acotada terminó con evento `verified_empty` del Job Object.

## Gate y límites

E21 queda `VERIFIED_LOCAL` para código, tests locales, build y matriz. Esto no
prueba PostgreSQL multi-conexión, navegador físico, touch, lector de pantalla,
impresora, equipos de cocina, deployment, dominio ni datos reales. Esos gates
siguen `PENDING_CLOUD` o `PENDING_HUMAN` según sus fichas dueñas.

Revisión de implementación: OpenCode hizo autorrevisión no independiente;
Codex ejecutó la verificación posterior y revisó el diff. No se presenta una
revisión humana independiente.

# Verificación independiente Codex — E18

## Identidad y seguridad de la corrida

- Entrada/salida: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`; no se creó commit.
- Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`.
- Se preservó el árbol dirty E00–E17. No se leyeron `.env`, credenciales o datos reales.
- Las pruebas usaron `scripts/test-local.mjs`, que crea una SQLite efímera propia, aplica el esquema/seed aislado y limpia sólo su sandbox.
- Las corridas se ejecutaron bajo `bounded-command.py` con Job Object; los logs completos están en `C:/Users/rodri/Desktop/AI/Projects/_orchestration/runs/mesaya-remediacion-e18-20260915-1`.

## Evidencia ejecutada

| Gate | Corrida | Resultado |
|---|---|---|
| Focal E18 | `node scripts/test-local.mjs test/e18-admin-accessibility.test.ts` (`e18-focal`) | exit 0; 1 archivo; 9/9 tests |
| Regresión dirigida | E12 + E16 + E17 + `client-build-assets` (`e18-regression`) | exit 0; 4 archivos; 46/46 tests |
| Regresión amplia | B06/C05/C06/C08, guest/history/account/security, E05–E18 y build assets (`e18-regression-full`) | exit 0; 20 archivos; 200/200 tests |
| Build monorepo | `node scripts/build.mjs` (`e18-build-final`) | exit 0; 6/6 workspaces |
| Matriz de rutas | `node scripts/check-route-matrix.mjs` (`e18-route-matrix`) | exit 1 por cuatro residuos previos de E14; ningún endpoint de E18 fue agregado |
| Diff E18 | `git diff --check --` sobre archivos E18 y QR | exit 0 |
| Diff global | `git diff --check` | exit 2 por línea blanca EOF previa en `apps/staff-panel/src/App.tsx:461`, fuera de E18 |

## Ejecutor y revisión

- OpenCode/Muse Spark 1.3 fue lanzado con permisos acotados a E18. El supervisor terminó esa sesión con `exit 125 / supervisor_time_gap` después de aplicar parte de la implementación; ese resultado no se tomó como prueba funcional.
- Codex corrigió el cierre JSX de RTMS detectado por el primer build, completó el diagnóstico QR/test focal y volvió a ejecutar focal, regresiones y build de forma independiente.
- Revisión funcional independiente por otro agente: no realizada. La revisión de este documento y de los checks es de Codex.

## Gates que siguen pendientes

- `PENDING_HUMAN`: recorrer las siete pestañas en navegador real, teclado/Tab/Shift+Tab, zoom 200%, tablet vertical, lector de pantalla si aplica y flujo de dueño sin navegar settings desde Staff; probar QR en teléfono y cambio de local.
- `PENDING_CLOUD`: confirmar en el deployment la variable `VITE_CLIENT_WEB_URL`, dominio HTTPS cliente, rutas reales, CORS y SHA desplegado.
- `PENDING_CLOUD` heredado: S21 PostgreSQL multi-conexión de E15.
- Residuo previo: cuatro filas de matriz E14 (`settle`, `settle-and-close`, `service-tasks/act`, `terminal/provision`).

La evidencia local demuestra implementación compilable y regresiones verdes; no equivale a GO de producción.

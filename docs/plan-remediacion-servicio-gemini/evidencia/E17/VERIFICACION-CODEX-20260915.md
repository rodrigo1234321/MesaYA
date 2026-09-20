# E17 — Verificación Codex — 2026-09-15

## Identidad y preservación

- Worktree: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-servicio-remediacion`.
- Rama: `codex/servicio-remediacion`.
- HEAD antes y después: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`.
- El árbol ya estaba sucio por E00–E16. El log de edición de OpenCode registra
  sólo `apps/client-web/app.js`, `apps/client-web/index.html`, el test focal y
  la documentación E17. No se limpió ni revirtió ningún cambio previo.

## Corridas posteriores a la revisión

Todas fueron comandos únicos bajo Windows Job Object, con SQLite efímera
propia de `scripts/test-local.mjs`; el Job Object terminó vacío en cada caso.

1. `e17-focal2` — `node scripts/test-local.mjs test/e17-client-cart-resilience.test.ts`
   — exit 0, 1 archivo, 17/17 tests.
2. `e17-regression2` — B06/C08/C05/C06, seguridad/build cliente y E13–E16
   — exit 0, 11 archivos, 124/124 tests.
3. `e17-build2` — `node scripts/build.mjs` — exit 0, 6/6 workspaces.
4. `e17-route-matrix` — `node scripts/check-route-matrix.mjs` — exit 1 por
   cuatro residuos conocidos de E14; no hay rutas E17.
5. `git diff --check` focal — exit 0. El control global conserva exit 2 por
   una línea blanca EOF previa en `apps/staff-panel/src/App.tsx`.

Los logs completos de supervisor están en:

`C:\Users\rodri\Desktop\AI\Projects\_orchestration\runs\mesaya-remediacion-e17-20260915-1`

## Alcance verificado

- Segundo click durante agregar/quitar/enviar: guardia lógica antes de la
  llamada y liberación en `finally`.
- Nueva unidad después de éxito: cantidad restaurada a 1 y mutex liberado.
- POST/DELETE del carrito y submit: una tentativa; sólo submit conserva clave
  estable de backend para replay consciente.
- Estado auxiliar: restaurante/mesa/versión de sesión/orden, sin token crudo;
  invalidación en cambio de contexto, expiración y `410` durante sync.
- S19/S20 dinámicos: replay de submit, dos líneas intencionales, dos
  identidades sobre un borrador, agotado, precio snapshot y sesión cerrada o
  expirada.

## Gate separado

- `VERIFIED_LOCAL`: implementación, focal, regresión y build.
- `PENDING_HUMAN`: prueba física de latencia 800 ms–2 s, offline post-commit,
  dos teléfonos y cambio de mesa/sesión.
- `PENDING_CLOUD`: S21 PostgreSQL heredado de E15.
- No es certificación de producción.

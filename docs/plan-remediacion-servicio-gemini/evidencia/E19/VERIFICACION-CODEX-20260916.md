# Verificación Codex — E19

Fecha: 2026-09-16  
Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`  
Entrada/salida: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83` / mismo SHA, sin commit

## Revisión del ejecutor

- OpenCode/Muse Spark 1.3 ejecutó el handoff E19 bajo Job Object y terminó con
  `exit 0`, `root_exit`, Job Object vacío.
- Un primer intento sólo mostró la ayuda de OpenCode (`exit 1`) por faltar la
  suborden `run`; no modificó archivos. Se relanzó correctamente con el mismo
  modelo y configuración.
- La primera corrida focal encontró dos aserciones mal recortadas en el test,
  no fallas del producto: el bloque del test incluía el detalle completo y
  una expectativa buscaba markup HTML dentro del cuerpo de la función. Codex
  corrigió esas aserciones para medir helpers/render por separado.
- La revisión final confirmó que los cambios E19 se limitan a `app.js`,
  `index.html`, un hint mínimo de `MenuManager.tsx`, el test focal y la
  documentación. Backend, Staff Panel, migraciones, `.env` y servicios
  existentes no fueron tocados por E19.

## Gates locales

| Gate | Corrida | Resultado |
|---|---|---|
| Focal E19/S26 | `node scripts/test-local.mjs test/e19-menu-filters.test.ts` (`e19-focal-final`) | exit 0; 1 archivo; 16/16 tests |
| Regresión dirigida | E12, E16, E17, E18 y `client-build-assets` (`e19-regression-directed`) | exit 0; 5 archivos; 55/55 tests |
| Regresión amplia | B06/C05/C06/C08, seguridad, guest/history/account y E05–E19 + assets (`e19-regression-full`) | exit 0; 22 archivos; 232/232 tests |
| Build monorepo | `node scripts/build.mjs` (`e19-build`) | exit 0; 6/6 workspaces |
| Matriz de rutas | `node scripts/check-route-matrix.mjs` (`e19-route-matrix`) | exit 1; exactamente 4 residuos previos de E14 |
| Diff E19 | `git diff --check -- apps/client-web/app.js apps/client-web/index.html apps/admin-dashboard/src/components/MenuManager.tsx` (`e19-diff-check-scoped`) | exit 0 |
| Diff global | `git diff --check` (`e19-diff-check-global`) | exit 2; línea blanca EOF previa en `apps/staff-panel/src/App.tsx:461` |

Todas las corridas se ejecutaron con fixtures efímeras y terminaron con el
Job Object vacío. No se reiniciaron servicios ni se usaron datos reales,
secretos, `.env`, Supabase o Vercel.

## Revisión funcional estática

- El filtro dietario sólo acepta la presencia explícita de
  `GLUTEN_FREE`, `VEGAN` o `VEGETARIAN` en `item.tags`.
- `ALL` mantiene visibles los platos sin tags; una selección dietaria no
  convierte desconocidos en coincidencias.
- El selector de categoría se combina con el filtro dietario y ofrece una
  forma determinística de volver a todas las categorías.
- La carta conserva precio, disponibilidad/agotado, detalle, imágenes,
  carrito y activación por click/Enter/Espacio.
- El detalle diferencia etiquetas declaradas de un plato sin información
  confirmada. La barra, el estado vacío y el detalle advierten que no hay
  certificación de ausencia de alérgenos ni contaminación cruzada y derivan
  al personal.
- Los textos y atributos provenientes del menú continúan escapándose; la
  lógica dietaria no usa nombre, descripción, imagen, categoría ni IA.

## Gate

`VERIFIED_LOCAL` para implementación, focal, regresión y build. Esto no
certifica el recorrido visual real: quedan `PENDING_HUMAN` para teclado físico,
táctil, lector de pantalla, zoom/teléfono y validación de las etiquetas por el
local; `PENDING_CLOUD` para datos/despliegue real y S21 heredado de E15.

La matriz de rutas conserva sin atribuir a E19 los cuatro hallazgos E14:

- `POST /v1/staff/sessions/:sessionId/settle` manifiesto MANAGER, código ANON.
- `POST /v1/staff/sessions/:sessionId/settle-and-close` manifiesto MANAGER,
  código ANON.
- `POST /v1/staff/restaurants/:id/service-tasks/act` sin clasificar, auth
  detectada STAFF.
- `POST /v1/staff/terminal/provision` sin clasificar, auth detectada ANON.

Logs de las corridas: `C:/Users/rodri/Desktop/AI/Projects/_orchestration/runs/mesaya-remediacion-e19-20260916-1`.

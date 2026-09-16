# E20 — Verificación Codex (2026-09-16)

## Revisión del cambio

- OpenCode ejecutó el handoff E20 con `opencode/muse-spark-1.3-contributor-free` bajo el runner Windows con Job Object; `opencode-e20-muse13-run` terminó `exit 0` / `root_exit` y dejó el Job Object vacío.
- El diff de E20 queda limitado a `KitchenOrdersManager.tsx`, `index.css`, el test focal y la documentación E20/continuidad/control. El árbol ya estaba dirty por E00–E19; no se hizo reset, clean, checkout, switch, merge, rebase, borrado ni reinicio de servicios.
- La hoja de cocina no importa ni invoca el recibo económico y los handlers de abrir/reimprimir sólo tocan estado React local y `window.print()`. No hay `updateOrderStatus`, `addManualOrderByStaff`, endpoint de recibo, `afterprint` ni API de hardware en ese camino.
- Se corrigió un detalle real durante la revisión: la segunda solicitud de impresión desde la hoja ahora queda marcada como reimpresión local. La primera falla focal y la corrección de sus aserciones fueron defectos de la suite, no relajaciones del producto.

## Comandos y resultados

| Evidencia | Exit | Resultado |
|---|---:|---|
| `e20-focal-final` | 0 | 1 archivo; 14/14 pruebas |
| `e20-regression-final` | 0 | 4 archivos; 46/46 pruebas |
| `e20-build-final` | 0 | shared/api/client/staff/admin/qr: 6/6 |
| `e20-route-matrix` | 1 | cuatro residuos conocidos de E14; ningún hallazgo nuevo de E20 |
| `git diff --check` focal | 0 | sin errores en alcance E20 |
| `git diff --check` global | 1 | sólo `apps/staff-panel/src/App.tsx:461`, línea blanca EOF previa |

La corrida dirigida que también incluía `test/s07-service-shell.test.ts` quedó 48/49 porque ese test espera que no exista la navegación Cocina que E14 ya agregó. La corrida final relevante excluyó esa expectativa obsoleta y pasó 46/46; E20 no tocó `App.tsx`.

## Gate

`VERIFIED_LOCAL` técnico: código, focal, regresión relevante y build verificados.  
`PENDING_HUMAN`: impresión a PDF desde navegador, cancelación/reintento observado, legibilidad real, recorrido manual y recepción por el equipo del local.  
`PENDING_CLOUD`: despliegue/dominio/datos reales y S21 PostgreSQL de E15.  
No es GO de producción.

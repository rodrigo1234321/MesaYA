# Cierre del alcance programable — MesaYA

Fecha: 2026-09-17  
Rama: `codex/servicio-remediacion`  
HEAD: `41c628e975f567612743bfda550b4499272445f8`

## Decisión de alcance

Por decisión del usuario, este cierre cubre exclusivamente lo programable:
código, contratos, pruebas automatizadas, builds, workflows y documentación
operativa preparada. La prueba presencial E23 y la validación cloud contra un
staging/proveedor real se ejecutarán más adelante por el usuario y no se
inventan ni se convierten en PASS aquí.

## Evidencia técnica

| Verificación | Resultado |
|---|---|
| `git diff --check` | exit `0` |
| `npm run build` | exit `0`; 6/6 workspaces compilados |
| `npm run check:routes` | exit `0`; 107 rutas clasificadas, sin deriva |
| `npm run instance:test` | exit `0`; 5/5 tests |
| `npm run check:supabase-schema` | exit `0`; schema Supabase sincronizado |
| `npm run test:isolated` bajo supervisor Windows Job Object | exit `0`; 30/30 suites, 0 fallas, 0 datos demo modificados |
| Job Object | `verified_empty`; `ActiveProcesses=0` |
| CI `35173262946` | `success`; build SQLite/paridad/rutas/suite aislada y PostgreSQL efímero |

El primer intento directo de `npm run test:isolated` fue rechazado por la
guarda correcta del runner (`MESAYA_BOUNDED_JOB` sin supervisor). La ejecución
válida posterior usó el supervisor oficial `bounded-command.py`; no se falsificó
la variable ni se desactivó la protección.

## Resultado

El código y el entorno de programación quedan `PROGRAMMABLE_READY` para su uso
posterior. E00–E22 tienen implementación y evidencia técnica; E24 tiene el
paquete de release y sus workflows; E23 conserva sólo su guía de aceptación
humana porque no requiere una nueva implementación de código en esta sesión.

Esto no es un `GO` operativo: permanecen explícitamente `PENDING_HUMAN` para
E23 y `PENDING_CLOUD` para staging/proveedor real, backup durable, RPO/RTO,
costos y observabilidad. Son tareas posteriores de operación/aceptación, no
fallas pendientes del código programable cerrado aquí.

## Punto de reanudación posterior

Cuando el usuario disponga de personas/equipos o un staging aislado, puede
retomar la guía E23 y el runbook E22/E24 sin reabrir el trabajo programable ni
usar la base productiva para carga mutante.

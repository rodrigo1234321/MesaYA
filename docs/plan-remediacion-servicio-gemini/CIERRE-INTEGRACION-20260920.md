# Cierre de integración local MesaYA

Fecha: 2026-09-20
Rama candidata: `codex/cierre-integracion-20260920`
Commit candidato: `64d807a0661b86ac85079d4b452b559629e5b3de`
Merge local: `a1a7b08b14caa4992d0732bb3e3aaa3ee135dc26`
Base: `codex/servicio-remediacion@97d67a598e15da47feb29f69a8085d9da0899901`

## Alcance

Este cierre deja consolidado el código, los tests, los builds y la documentación
programable en la rama canónica local. No incluye push, deploy, migraciones ni
cambios de variables en Supabase o Vercel; esos gates quedan para la siguiente
fase de sincronización de producción.

## Cambios cerrados

- La carta pública tiene un único dueño de scroll (`#menuScrollContent`), con
  footer fuera del área desplazable, pastillas sticky, safe-area móvil y
  restauración de contexto compatible con el contenedor anterior.
- La restauración conserva la posición exacta y sólo corrige el ancla cuando la
  categoría guardada queda fuera del viewport después de un rerender.
- El checker de `schema.supabase.prisma` normaliza CRLF/LF únicamente para
  comparar; las diferencias reales de contenido siguen produciendo fallo y
  detalle de líneas.
- Vite se actualizó de la rama vulnerable 5.x a 6.4.3 en las tres apps y
  `@vitejs/plugin-react` a 4.7.0 donde corresponde. El lockfile quedó
  regenerado y coherente.
- E19 incorpora regresiones estáticas para el dueño único del scroll, el footer,
  la restauración y la accesibilidad existente.

## Evidencia ejecutada

| Gate | Resultado |
| --- | --- |
| `npm ci --ignore-scripts` | PASS |
| `npm audit --json` | PASS: 0 vulnerabilidades |
| `npm audit --omit=dev --json` | PASS: 0 vulnerabilidades de producción |
| `npm ls vite @vitejs/plugin-react` | PASS: Vite 6.4.3 y plugin 4.7.0 coherentes |
| `npm run check:routes` | PASS: 107 rutas clasificadas, sin deriva |
| `npm run check:supabase-schema` | PASS: schema sincronizado |
| `npm run instance:test` | PASS: 5/5 |
| Regresión focal `test-local` | PASS: 5 archivos, 65 tests |
| Build supervisado `build-final-20260920` | PASS: 6/6 workspaces; `root_exit=0`, `verified_empty`, `ActiveProcesses=0` |
| Suite aislada supervisada `isolated-final-retry2-20260920` | PASS: 30/30 suites, 0 fallos; `root_exit=0`, `verified_empty`, `ActiveProcesses=0` |
| `npm run build:pg` y restauración SQLite | PASS |
| `git diff --cached --check` | PASS; sólo advertencias informativas de CRLF de Windows |

La suite aislada no encontró una `dev.db` previa y no tocó datos demo. Durante
la repetición final hubo un corte de infraestructura por memoria libre de
14,85% y un intento posterior bloqueado por el lock temporal huérfano que dejó
ese corte. Se verificó que no había procesos activos, se retiró sólo ese lock
generado en `.tmp` y el reintento final pasó completo.

## Revisión independiente

OpenCode (`opencode/muse-spark-1.3-contributor-free`) realizó una revisión
solo-lectura del diff y no modificó archivos. Confirmó la coherencia del scroll,
la comparación CRLF/LF y la actualización de Vite. Su observación sobre un
posible fondo blanco de las pastillas se descartó tras revisar el CSS C03
vigente: `#modalMenu` ya fuerza fondo blanco y las pastillas tienen contraste
intencional. Sí se incorporó la mejora válida de restauración condicional y la
paridad táctil del nuevo scroller.

Después del merge, una segunda revisión solo-lectura sobre `HEAD^1..HEAD`
terminó `APPROVED`. Confirmó árbol limpio, ancestría y árbol idéntico al
candidato, y no encontró bloqueadores programables. Dejó como mejoras no
bloqueantes un `.gitattributes` para LF de Prisma, un test táctil E2E y el
archivado opcional de logs temporales.

El gate JEV final (`jev-1.13.0`) evaluó la misma decisión estrecha con
`noul=0.96`: cierre programable local completo, excluyendo explícitamente los
gates cloud y físicos. Una evaluación preliminar incierta (`noul=0.60`) no se
usó como aprobación; se repitió después de la revisión final.

## Pendientes explícitos para producción

`PENDING_CLOUD`: conexión y migración contra el Supabase/PostgreSQL real,
verificación de RLS en el proyecto destino, deploy/promoción de SHA en Vercel,
smoke remoto, backup/restore y prueba RPO/RTO.

`PENDING_HUMAN`: recorrido físico con QR/NFC generado por Admin, validación en
teléfonos/tablets reales, aprobación operativa y comprobación de impresión.

Estos pendientes no bloquean el merge local de la fase programable, pero sí
mantienen el estado global de producción fuera de GO hasta que exista evidencia
externa y aprobación humana.

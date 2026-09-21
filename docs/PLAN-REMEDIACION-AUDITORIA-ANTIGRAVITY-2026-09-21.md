# MesaYA: remediación integral del informe de 11 agentes

Fecha: 2026-09-21. Entrega: plan ejecutable; implementación todavía no iniciada por este documento.
Ejecutor solicitado: AntiGravity con Gemini 3.8 Flash. Alcance: los hallazgos de las 18 secciones de `ERRORES_MESAYA_COMPLETO.md`, incluidas sus tablas y hallazgos secundarios.

## Objetivo y condición de terminación

Dejar un candidato local de MesaYA completo con todos los defectos vigentes del informe corregidos, pruebas pertinentes aprobadas y revisión independiente resuelta. Cada hallazgo debe terminar como corregido y verificado, ya resuelto en la base con evidencia, falso positivo justificado, o pendiente externo explícito. No cerrar hallazgos programables como “mejora futura” para terminar antes.

La entrega debe preservar el comportamiento de cuentas por sesión, pedidos/cocina, PIN y terminal compartida, módulos, carta Fauno, QR y CORS LAN. No ampliar el producto ni implementar todo el plan anterior de módulos. Solo Mozos es una variante separada.

Persistir entre etapas sin preguntar “¿continúo?”. Una etapa verde habilita la siguiente. Si una falla, reproducir, diagnosticar, corregir y verificar. Una dependencia externa bloqueada no detiene fichas independientes. Terminar únicamente con cierre comprobado o con un bloqueo externo que impida todo progreso útil; nunca afirmar éxito en ese segundo caso.

## 1. Lectura crítica del informe

Esta preparación hizo lectura del informe y comparación estática de código/referencias Git locales. No ejecutó pull, fetch, tests, cambios de código, inspección de valores de `.env`, ni verificación cloud. Los conteos siguientes corresponden a referencias locales, no aseguran actualidad de GitHub.

| Dato | Evidencia observada / corrección de interpretación |
|---|---|
| Checkout de origen | `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas`, rama `main`, HEAD `d932969cc85cdc96d9a037abd333a9af140a151e` |
| Estado de trabajo | Tres archivos rastreados modificados: `apps/client-web/index.html`, `apps/client-web/styles.css`, `scripts/start_dev_ip.js`; además documentos y capturas sin rastrear. Preservarlos. |
| Referencia comparada | `origin/main` local apunta a `6a1cdae`; 0 commits exclusivos locales y 66 exclusivos de esa referencia; 9 en recorrido first-parent desde HEAD. Los “8” del informe no son el conteo Git completo. |
| Diferencia de árboles | 412 archivos: 309 añadidos, 103 modificados; no 89/66. Es diferencia entre revisiones, no cantidad de archivos sucios. |
| Error handler | Existe `packages/api/src/lib/errorHandler.ts` en `origin/main`; oculta errores 5xx, pero acepta `any` y reenvía `message`, `code`, `details` en 4xx. Su existencia no demuestra cobertura ni seguridad de todos los errores. |
| ErrorBoundary / lint | Las búsquedas de `ErrorBoundary`, `componentDidCatch`, `getDerivedStateFromError` en apps de `origin/main` y nombres de configuración ESLint no encontraron resultados. Confirmar variantes equivalentes y cobertura antes de implementar. |
| Línea canónica | El manifiesto de `origin/main` declara `codex/servicio-remediacion` para MesaYA completo y `codex/solo-mozos` para la variante reducida; describe este `main` local como histórico. |
| Producción | El manifiesto registra una release `7c38bd5`; eso es evidencia documental histórica, no consulta actual de Vercel/Supabase. |
| Resto de números | 53 filtraciones, 255 `any`, 12 acciones, 19 modales, etc. son hipótesis de inventario sobre una base vieja. Recontar sobre el candidato con método reproducible. |

Correcciones a las recomendaciones del informe:

- No ejecutar `git pull origin main` sobre el checkout sucio como primer paso. Fijar base canónica y trabajar en aislamiento.
- Un error HTTP 4xx no vuelve seguro cualquier mensaje o `details`. Solo serializar información pública tipada y permitida.
- El ejemplo de ErrorBoundary muestra `error.message`: sustituir por fallback seguro. Un boundary de React no captura por sí solo errores de eventos o promesas.
- Ausencia de `aria-label` no significa falta de nombre accesible: texto visible, label envolvente y `aria-labelledby` pueden ser válidos. No añadir atributos redundantes ni sobrescribir nombres útiles.
- Contraste debe medirse sobre colores computados, opacidad, fondo y estado real; no deducirse únicamente de una clase Tailwind.
- Un `.env` local no prueba que falte una variable en producción. Claves en archivos ignorados no son automáticamente una filtración; sí requieren custodia y configuración correcta.
- No generar/reemplazar una clave de cifrado existente sin estudiar datos cifrados y compatibilidad. No copiar secretos del informe a nuevos documentos ni registros.
- Métodos sin referencias estáticas pueden ser contratos públicos o usarse dinámicamente; exports de seguridad pueden sostener compatibilidad y pruebas.
- Rama integrada no implica worktree limpio, ni ausencia de dependencias de despliegue. La eliminación queda fuera de esta ejecución.
- Las estimaciones de horas del informe no sustituyen criterios de aceptación ni justifican saltarse pruebas.

## 2. Preparación y reglas de ejecución

1. Leer `AGENTS.md` aplicables, manifiesto canónico, `CONTROL.md`/`CONTINUAR.md` existentes y planes de cierre relacionados. Resolver instrucciones históricas contra estado actual; no heredar aprobaciones de otro SHA.
2. Confirmar repositorio, remotos, ramas, HEAD, suciedad de todos los worktrees relevantes y procesos/puertos activos. Registrar solo metadatos sanitizados, nunca argumentos que puedan contener secretos.
3. Actualizar referencias mediante fetch si hay acceso; si falla, identificar explícitamente que se trabaja con referencias locales. Comparar ascendencia de `origin/main` y la línea canónica actual.
4. Crear un worktree limpio desde el SHA verificado de MesaYA completo, en una rama local libre `codex/remediacion-auditoria-20260921` o sufijo equivalente. Si ya existe una ejecución, reanudar su checkpoint. No crear otra copia por rutina.
5. Mantener `main` sucio intacto. Inventariar y preservar sus cambios. Portar únicamente comportamiento necesario y ausente, mediante cambios pequeños; no copiar versiones antiguas completas ni secretos.
6. Copiar este plan, el prompt y una referencia sanitizada al informe al candidato. El informe original contiene una cadena presentada como secreto: no versionar una copia literal sin sanearla.
7. Verificar versión de Node, lockfile, React, Fastify, Prisma, TypeScript y runners reales. Consultar documentación oficial correspondiente antes de cambios dependientes de versiones. No actualizar versiones mayores como parte incidental de linting.

### Skills y agentes

AntiGravity debe inventariar y utilizar sus skills y agentes ya disponibles. Leer la skill elegida, explicar brevemente su uso y ejecutar sus pasos; nombrarla no equivale a usarla. Priorizar herramientas para exploración, seguridad API, React, accesibilidad, pruebas de navegador y revisión independiente. No instalar skills ni proveedores al azar.

Gemini 3.8 Flash es el modelo solicitado. Registrar identificador solicitado y modelo efectivo. No sustituir silenciosamente por Codex, Claude, otro Gemini o un proveedor pago. Si no está disponible, registrar bloqueo de proveedor y checkpoint. No asumir que el identificador de una instalación anterior sigue disponible.

Puede reorganizar o subdividir las etapas manteniendo trazabilidad, dependencias y aceptación. Usar agentes existentes para tareas acotadas, con dueño explícito por archivos. Un escritor por worktree; agentes escritores paralelos usan worktrees distintos. Revisor separado, sin modificaciones. Integrar en serie y revisar el resultado combinado. No lanzar once agentes por imitar el informe.

Si no existe capacidad de subagentes, hacer implementación secuencial y dejar la revisión independiente como pendiente verificable; no inventar un revisor. Nodeterm solo si existe `NODETERM_NODE_ID` y el usuario pidió expresamente esa orquestación.

Si las instrucciones vigentes exigen JEV, leer la skill TypeSafe y aplicar el gate después de tests/build. Una probabilidad no sustituye pruebas ni revisión. Si el servicio no está disponible, registrar el gate pendiente y continuar trabajo no dependiente.

### Registro obligatorio

Crear `docs/remediacion-auditoria-20260921/` en el candidato con:

- `BASELINE.md`: SHA fuente/destino, versiones, ramas, procesos relevantes, diferencia con informe y alcance.
- `HALLAZGOS.md`: un ID por hallazgo concreto, sección/fila original, archivo/símbolo actual, reproducción, prioridad, etapa, estado y evidencia de cierre.
- `CONTROL.md`: dependencias, responsable, estado, pruebas y revisión de cada ficha.
- `CONTINUAR.md`: último estado real, siguiente acción exacta, comandos seguros y bloqueos.
- `evidencia/`: salidas sanitizadas, resultados, capturas y revisiones por etapa.
- `CIERRE.md`: diff final, cobertura del informe, verificaciones, riesgos y pendientes externos.

Estados de fichas: `PENDING`, `IN_PROGRESS`, `IMPLEMENTED_NEEDS_REVIEW`, `VERIFIED_LOCAL`, `BLOCKED_EXTERNAL`. Estados de hallazgos: `CONFIRMED`, `ALREADY_FIXED_VERIFIED`, `FALSE_POSITIVE_EVIDENCED`, `FIXED_VERIFIED`, `PENDING_EXTERNAL`. Un pendiente externo no cuenta como aprobado.

Cada ficha registra: objetivo, IDs cubiertos, base y diff evaluados, archivos, reproducción antes/después, comandos/cwd/exit code, resultados, revisión y siguiente ficha. No guardar secretos ni dumps de entorno. Ante cambio de contexto, actualizar primero el checkpoint y reanudar desde él.

## 3. Etapas y aceptación

Orden recomendado: R00 → R01 → R02 → R03 → R04 → R05 → R06 → R07 → R08 → R09 → R10 → R11 → R12 → R13. Tras R01 pueden explorarse ramas independientes del trabajo; no ejecutar gates pesados en paralelo.

### R00 — Base segura y preservación

Aplicar la preparación anterior; comparar manifiesto y referencias actuales. Resolver destino local sin cambiar la rama productiva ni fusionar variantes. Inventariar worktrees y cambios; conservar originales y registrar hashes de material que se porte.

**Aceptación:** candidato aislado identificado por SHA completo, fuente intacta, un escritor, destino justificado. Si hay ambigüedad real de producto, continuar lectura y solicitar únicamente la decisión imprescindible.

### R01 — Reauditoría de las 18 secciones

Descomponer cada tabla/lista del informe en IDs individuales. Reproducir sobre el candidato y actualizar rutas/líneas. Separar respuestas HTTP de logs, `any` de código vs tests/generados y nombre accesible de presencia literal de ARIA. Añadir hallazgos nuevos directamente relacionados.

Ejecutar baseline de checks seguros después de inspeccionar sus scripts y destino de DB. Clasificar fallos previos; una suite rota antes del cambio no demuestra una regresión, pero tampoco puede desaparecer del cierre.

**Aceptación:** 100% de secciones y filas con disposición inicial, método de conteo y etapa; sin valores sensibles. No exigir que los conteos coincidan con el documento antiguo.

### R02 — Errores API seguros y tipados

Depende de R01. Auditar `errorHandler.ts`, handler global, rutas y errores de dominio. Reutilizar el mecanismo existente y corregir bypasses. Definir errores públicos tipados y guardas para `unknown`; conservar códigos/forma de respuesta que consumen los clientes.

5xx opacos con identificador de correlación; 4xx solo con códigos, mensajes y detalles públicos permitidos. Validar estatus y fallbacks. Redactar logs de tokens, PIN, credenciales, URLs de DB, cabeceras y cuerpos sensibles. No convertir todas las fallas a 200 o esconder fallas de autorización.

**Pruebas:** inyección de fallo Prisma/SQL y error inesperado; 401/403/404/409/422/429 cuando correspondan; error de proveedor; mensajes y detalles sensibles; rutas que capturan localmente; contrato frontend. Usar inyección HTTP real del framework, además de unidades del serializador.

**Aceptación:** ningún camino confirmado filtra errores internos; cobertura por familia de rutas y revisión de todos los bypasses. Buscar `err.message` es apoyo estático, no prueba suficiente.

### R03 — Entorno y hallazgos de seguridad secundarios

Depende de R02 para mensajes de configuración. Mapear precedencia de dotenv, cwd, scripts locales y serverless. Comparar nombres/requisitos entre `.env.example`, loader y documentación sin volcar valores. Probar dev/test/production con fixtures aislados.

Validar secretos requeridos en producción, separación JWT/cifrado, URLs y configuración por módulo. Una IA deshabilitada no debe inutilizar toda la API porque no haya Gemini key. Documentar `DIRECT_URL` según herramienta y proveedor; nunca ejecutar migraciones para comprobar su presencia.

Investigar PIN por defecto, botones de login rápido, generación de QR por terceros y exposición de claves reportados en sección 10. Eliminar accesos inseguros reales o acotarlos a demo explícita sin afectar login normal. Usar generación local de QR si persiste el envío innecesario. Verificar ignorados y bundle cliente. Si aparece evidencia de secreto comprometido, redactar reporte y preparar rotación, sin ejecutarla externamente.

**Aceptación:** ejemplos consistentes, errores de configuración seguros y pruebas de arranque/política. Configuración cloud y rotación reales quedan `PENDING_CLOUD` si necesitan autorización; no falsificar que un `.env` local equivale a producción.

### R04 — Contención de fallos React

Depende de R01 y contrato R02. Añadir boundaries en raíces Staff/Admin y límites por área donde preserve navegación útil. Fallback en español, accesible, sin stack/error interno, con recuperación controlada. No repetir cobros, pedidos u otras mutaciones al recuperar.

**Pruebas:** componente que falla al renderizar, fallback y recuperación; una sección aislada no derriba innecesariamente todo el panel. Tratar errores de eventos/async en R05. No añadir React al cliente vanilla para resolver este punto.

**Aceptación:** ninguna raíz React queda sin contención; fallback verificado en DOM/navegador y mensajes técnicos ausentes.

### R05 — Acciones con feedback y recuperación

Depende de R02/R04. Cubrir todas las acciones de sección 5 y sus equivalentes actuales en ServiceWorkspace/Admin. Mostrar error en contexto visible, dentro del modal cuando corresponda, con anuncio accesible. Manejar pending/disabled, éxito, error, reintento seguro y rollback de UI optimista.

**Pruebas:** API 4xx/5xx, offline, timeout y doble clic; conservar formulario y desbloquear botones al fallar. Para mutaciones cuyo resultado sea incierto tras timeout, consultar estado antes de repetir; proteger idempotencia existente. Fallos de carga deben distinguir datos vacíos de error.

**Aceptación:** cada acción inventariada informa resultado sin depender de consola, no produce duplicados y permite recuperación.

### R06 — Linting reproducible y deuda acotada

Depende de R01 y baseline. Configurar ESLint compatible con versiones reales, TypeScript, hooks React y accesibilidad JSX, scripts por workspace y gate raíz/CI. Incluir JS vanilla apropiadamente y excluir generados por motivo explícito.

No desactivar reglas globalmente, ignorar aplicaciones completas ni aplicar formato masivo. El baseline temporal debe identificar ocurrencias, dueño y etapa; antes de R13 resolver toda deuda de este informe. Activar `noUnusedLocals`/`noUnusedParameters` por workspace cuando el código esté listo y sin romper herramientas legítimas.

**Aceptación:** lint reproducible, sin errores; cualquier advertencia residual está individualmente justificada y no encubre un hallazgo vigente. Lockfile consistente y CI localmente comprobable.

### R07 — Tipado de contratos y reducción completa del inventario

Depende de R02/R06. Reutilizar tipos compartidos, Prisma y schemas de validación. Priorizar clientes API, DTOs de Shift/Restaurant/Order/MenuItem/StaffUser, estado/props, servicios y catches. Usar `unknown` con narrowing; tipos distintos para entrada, persistencia y datos públicos.

No sustituir `any` por casts dobles, `@ts-ignore`, `Record<string, any>` ni interfaces duplicadas sin fundamento. Tipar JSON y respuestas realmente validadas; no asumir que un cast valida datos externos.

**Pruebas:** typecheck de workspaces, contratos inválidos/válidos y regresiones funcionales de rutas afectadas.

**Aceptación:** todas las ocurrencias del inventario resueltas o justificadas por frontera externa inevitable y revisada; cero nuevo `any` injustificado. Documentar conteos comparables antes/después, incluyendo tests por separado.

### R08 — Hooks, código muerto y seguridad duplicada

Depende de R05/R07. Renombrar hooks según comportamiento real (`useCallsPolling`, `useFloorPlanPolling` si siguen siendo correctos), actualizar imports/tests/documentación. Revisar `buildStaffStreamUrl`, endpoints retirados y consumidores externos antes de retirar contratos.

Comprobar los siete métodos, seis exports y tres dependencias del informe mediante referencias, usos dinámicos, paquetes, tests, entrypoints y build. Quitar solo lo demostrado innecesario; regenerar lockfile y verificar instalación. Inspeccionar Fastify del root y entrada serverless antes de eliminarlo.

En sanitizadores client-web/shared, elegir la solución mínima compatible con vanilla y su despliegue. Si no hay carga compartida segura sin refactor amplio, conservar duplicación intencional con mismos vectores de pruebas y guard de paridad. No debilitar XSS ni borrar tests porque estorben al refactor.

**Pruebas:** polling sin intervalos duplicados, cleanup/unmount, cambio de restaurante, reconexión y estado obsoleto; vectores XSS/URL y smoke de entradas afectadas.

**Aceptación:** semántica de nombres correcta, ausencia de referencias rotas y cada candidato a eliminación con evidencia; duplicación de seguridad resuelta o controlada justificadamente.

### R09 — Nombres, formularios y controles accesibles

Depende de R05 y coordinada con R10. Auditar árbol accesible de las tres apps: botones icon-only, labels, tarjetas clickeables, acordeones, switches, SVG, imágenes y links. Preferir controles nativos; evitar botones anidados. Labels asociados por `for`/`htmlFor`, envoltura o mecanismo válido; estados `aria-expanded`/`aria-controls`, switch/check y foco visibles.

Actualizar alt de plato, retirar bloqueo de zoom y asegurar nombres que incluyan contexto útil. No limitarse a regex o agregar `aria-label` a todo.

**Aceptación:** cada control del inventario operable por teclado y con nombre/estado correcto en DOM accesible; verificaciones automáticas más navegación real, sin fallos nuevos de interacción.

### R10 — Todos los diálogos y gestión del foco

Depende de R04/R05; puede compartir primitiva con R09. Inventariar modales reales, drawers y sheets, incluidos los nuevos de la base. Reutilizar una implementación apropiada para React y otra compatible con vanilla, sin migración de framework.

Nombre accesible, semántica modal correcta, foco inicial, Tab/Shift+Tab contenidos, fondo no interactivo, Escape/cancelación segura y retorno de foco. Diálogos anidados deben restaurar al nivel correcto. No cerrar sesiones ni confirmar acciones destructivas mediante Escape.

**Pruebas:** abrir/cerrar cada diálogo, ciclo de teclado, validación con error, rerender async, anidación, scroll y retorno de foco. No basta con probar solo login.

**Aceptación:** inventario completo verificado, sin trampas de foco permanentes, sin interacción accidental detrás y sin regresión del scroll de carta.

### R11 — Contraste, zoom y regresión visual

Depende de R09/R10. Medir pares reales en estados FSM, textos secundarios, focus, errores, disabled aplicable y temas/plantillas. Conservar significado de estados mediante texto/icono además del color.

Para texto normal exigir 4.5:1; texto grande 3:1 según definición WCAG; considerar criterios de contraste no textual por separado. Registrar ratios y estados, sin afirmar conformidad completa de WCAG solo por pasar una herramienta. [Criterio oficial de contraste](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

**Pruebas:** móvil 390/430 px, tablet vertical y PC; zoom 200%, teclado y scroll; capturas comparables. Verificar carta Fauno y plantillas realmente soportadas.

**Aceptación:** todos los pares confirmados corregidos, contenido/acciones legibles y accesibles sin recortes que impidan uso.

### R12 — Regresión integrada y revisión independiente

Depende de R02–R11. Revisor independiente evalúa diff y evidencia contra la base exacta: seguridad, correctitud, regresiones y alcance. Resolver hallazgos y repetir solo comprobaciones afectadas, más gate final del candidato.

Flujos mínimos: acceso QR/mesa y carta; llamado de mozo y resolución; PIN/terminal compartida; comanda validada/cocina; cuenta por sesión, pagos parciales/saldo y cierre a limpieza; mesa lista/nueva ocupación; administración de carta/precio/disponibilidad/personal; módulos habilitados/deshabilitados; offline/reconexión/error. Respetar variantes soportadas, no encender módulos cloud por pruebas.

**Aceptación:** resultados ligados al mismo SHA/diff, sin hallazgos P0/P1 abiertos ni fallos programables del alcance. Simulación local no se declara prueba física de tablet, impresora o red del restaurante.

### R13 — Entrega, continuidad y disposición de worktrees

Reconciliar todos los IDs con evidencias. Revisar diff, secretos y lockfile. Preparar commits locales pequeños si las instrucciones lo permiten y registrar SHA final; no hacer push/merge/deploy. Inventariar ramas/worktrees históricos y su estado/dependencias; proponer disposición sin eliminarlos.

Entregar `CIERRE.md`, tabla antes/después, pruebas y revisiones, archivos principales, riesgo residual, pendientes humanos/cloud con siguiente acción precisa y checkpoint reanudable. No reescribir el manifiesto como si existiera una release nueva.

**Aceptación:** `PROGRAMMABLE_READY` solo si todos los gates programables del alcance están aprobados y revisión cerrada; `PASS_LOCAL` describe exclusivamente verificación local. Pruebas físicas pendientes → `PENDING_HUMAN`; cloud/rotaciones/backup → `PENDING_CLOUD`. Si falta un gate local obligatorio o revisión, estado `INCOMPLETE`/`BLOCKED_EXTERNAL`, nunca cierre simulado.

## 4. Matriz de cobertura del informe

| Sección original | Etapas |
|---|---|
| 1 Git y sincronización | R00, R01, R13 |
| 2 Filtración de errores | R02, R12 |
| 3 TypeScript/any | R02, R07 |
| 4 ErrorBoundary | R04 |
| 5 Acciones silenciosas | R05 |
| 6 ESLint/tsconfig | R06, R07 |
| 7 Hooks | R08 |
| 8 Código/dependencias muertos | R08 |
| 9 Seguridad duplicada | R08 |
| 10 ENV, PIN, QR y secretos | R03 |
| 11 Botones | R09 |
| 12 Modales | R10 |
| 13 Labels | R09 |
| 14 Contraste | R11 |
| 15 Interactivos/switches | R09 |
| 16 Alt, zoom, SVG, links, acordeón | R09, R11 |
| 17 Worktrees | R00, R13; eliminación excluida |
| 18 Plan propuesto | Sustituido por este plan con evidencia y dependencias |

## 5. Gates y límites operativos

Inspeccionar cada script antes de correrlo. Comandos observados en la referencia de preparación, a confirmar en el candidato:

```powershell
git diff --check
npm run check:routes
npm run check:supabase-schema
npm run instance:test
npm run test:local
npm run build
```

Añadir `npm run lint` y typechecks cuando R06 cree o conecte sus scripts. Ejecutar pruebas focalizadas con Vitest/`node:test` existentes. No introducir Jest innecesariamente. Verificar instalación reproducible en candidato aislado después de revisar lifecycle scripts.

`npm run test:isolated` exige el supervisor Windows Job Object real cuando el runner así lo indique. No falsificar variables como `MESAYA_BOUNDED_JOB` ni remover guards. Prisma generate/build/tests se ejecutan secuencialmente para evitar bloqueos de engine. No matar procesos ajenos ni reiniciar servicios que el usuario mantiene activos.

`build:pg`, `smoke:serverless` y tests PostgreSQL se ejecutan solo tras verificar que no se conectan a DB compartida/productiva; preferir instancia efímera aislada. No usar SQLite como prueba de equivalencia PostgreSQL. Registrar gate pendiente si falta infraestructura, sin afirmar PASS.

Prohibido para esta ejecución: reset/clean destructivo, borrado de worktrees/ramas, push, merge a ramas compartidas/canónicas, deploy, migración/seed/reset de DB compartida, rotación de secretos reales o mensajes a terceros. Preparar resultados revisables y pedir autorización solo para la acción externa concreta si llega a ser necesaria, tras completar todo el trabajo local posible.

Persistencia con diagnóstico: ante dos intentos fallidos idénticos, cambiar estrategia y buscar causa; no entrar en bucles de reintento sin nueva evidencia. Ante cuota/proveedor bloqueado, guardar checkpoint y continuar solo tareas que no dependan de él. Un prompt no garantiza ejecución infinita si la plataforma termina la sesión: checkpoint permite reanudación exacta.

Referencia para R10: [WAI-ARIA APG: diálogos modales](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). La implementación debe probar comportamiento, no solamente atributos.

# Orden de continuación: corregir pendientes y acreditar el cierre

Fecha: 2026-09-21. Destinatario: AntiGravity, Gemini 3.8 Flash.
Estado de entrada: IMPLEMENTACIÓN PARCIAL; CIERRE ANTERIOR NO ACEPTADO.

## Objetivo

Continuar el trabajo existente, corregir los defectos y vacíos de verificación señalados por la revisión y entregar un candidato local verificable. No empezar de cero ni declarar nuevamente 100% por haber compilado o pasado suites antiguas. Este documento complementa el plan R00–R13 y tiene prioridad sobre el cierre prematuro y las recomendaciones de merge/limpieza de la ejecución anterior.

## Candidato exacto y límites

- Worktree: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-remediacion-20260921`.
- Rama: `codex/remediacion-auditoria-20260921`.
- HEAD comprobado al preparar esta orden: `667b8a000769987cc2c23a4545a526d218cb1bf9`.
- Antes de agregar este documento, el candidato estaba limpio. Este archivo es una nueva instrucción del usuario; preservarlo.
- Mantener intacto el checkout original `mdpmesasvivas`, su trabajo local y las variantes de producto.
- No hacer pull, reset, clean, push, merge a ramas compartidas/canónicas, deploy, eliminación de worktrees/ramas, ni cambios en datos o secretos reales.
- Si HEAD avanzó, inspeccionar los cambios y adaptar la continuación sin sobrescribir otro trabajo. Un único escritor por worktree.
- Esta orden autoriza remediación y validación locales seguras; no ejecutar migraciones, seeds o tests contra una DB compartida/productiva. No reiniciar ni matar servicios ajenos.

## Hechos de la revisión anterior

La revisión inspeccionó el commit y la documentación. No repitió la suite completa de 803 tests ni realizó una auditoría exhaustiva de todos los archivos. Los siguientes hallazgos sí tienen evidencia concreta:

1. `packages/api/src/lib/errorHandler.ts` sigue serializando información no autorizada en 4xx. Una ejecución directa del helper, con un reply simulado y datos completamente ficticios, devolvió los valores siguientes:

   ```ts
   // Reproducción A: se devolvieron message/error y details tal como entraron.
   { statusCode: 400, message: 'api_key=FAKE_REVIEW_ONLY',
     details: { authorization: 'Bearer FAKE_REVIEW_ONLY' } }

   // Reproducción B: se devolvió error aunque message fuera seguro.
   { statusCode: 400, message: 'Solicitud incorrecta',
     error: 'password=FAKE_REVIEW_ONLY' }
   ```

   Esto demuestra un defecto del helper; todavía hay que trazar los productores reales y cubrir rutas HTTP. No implica haber observado una filtración real en producción.
2. `apps/admin-dashboard/tsconfig.json` y `apps/staff-panel/tsconfig.json` mantienen `noUnusedLocals: false` y `noUnusedParameters: false`; HALLAZGOS afirma lo contrario.
3. El reporte admite 1.492 advertencias de lint. `eslint.config.mjs` configura las reglas de unused y explicit-any como advertencias y no incorpora reglas de hooks React/accesibilidad. El exit code 0 no demuestra cierre de la deuda.
4. Persisten `any` en clientes API y servicios, sin disposición individual de todos los casos que el plan exigía inventariar.
5. En los modales inspeccionados se añadieron atributos ARIA y algunos listeners de Escape, pero no se acreditó gestión completa del foco, retorno, fondo inerte o navegación real por teclado.
6. `ErrorBoundary.test.tsx` instancia la clase y llama métodos; no monta un árbol React con un hijo que falle ni demuestra recuperación real.
7. Los archivos de evidencia no acreditan revisión independiente, sesiones de navegador ni mediciones visuales reproducibles. Build y TypeScript no sustituyen esas verificaciones.
8. `CONTINUAR.md` todavía afirma que npm ci está en progreso. El cierre y el checkpoint se contradicen.

Estos hechos obligan a reabrir las fichas afectadas; no descartar las mejoras válidas del commit.

## Ejecución obligatoria

Lee las instrucciones AGENTS.md aplicables, el plan original y esta orden. Usa Gemini 3.8 Flash y registra modelo efectivo; no cambies silenciosamente de proveedor. Inventaría y utiliza skills/agentes existentes de seguridad, React, accesibilidad, navegador y revisión. Lee cada skill que apliques. No afirmes haber usado herramientas o agentes que no ejecutaste.

Elige tareas acotadas para agentes disponibles, con propiedad de archivos y revisión en lectura. No hay obligación de multiplicar escritores. Si falta capacidad de revisión independiente, sigue con implementación y pruebas, pero deja ese gate pendiente. Respeta JEV si las instrucciones aplicables lo exigen; no sustituye tests ni revisión.

Avanza C00 → C01 → C02 → C03 → C04 → C05 → C06. Puedes subdividir y explorar tareas independientes, pero no saltar criterios de aceptación. Cada ficha debe tener evidencia y checkpoint actualizado antes de pasar a la siguiente.

### C00 — Rectificar estado y establecer baseline de continuación

- Registrar rama, SHA, diff, procesos relevantes y destino de pruebas sin exponer secretos.
- Actualizar CONTROL, HALLAZGOS, CIERRE y CONTINUAR: retirar la afirmación global de cierre y reabrir R02, R06, R07, R09–R13 según corresponda; R04/R05 quedan pendientes de verificación funcional suficiente.
- Distinguir implementado, comprobado y declarado sin evidencia. Conservar historia; no borrar reportes para ocultar contradicciones.
- Asociar cada hallazgo de esta orden a un ID y reproducción. Reconciliar también cada fila del informe original, no solamente sus categorías generales.

Aceptación: estado honesto y siguiente acción C01, sin volver a instalar o inicializar bases por seguir el checkpoint viejo.

### C01 — Primero: reparar el contrato de errores públicos

- Añadir pruebas rojas para las dos reproducciones con datos ficticios.
- Sustituir el enfoque de lista negra de palabras por reconocimiento explícito de errores de dominio públicos y serialización por campos/códigos permitidos. Un objeto que declara statusCode 400 no es confiable por ese hecho.
- Mantener la forma de respuesta y los códigos públicos que necesitan los clientes; mapear errores conocidos a mensajes seguros. Error desconocido: fallback seguro, conservando el estado apropiado solo cuando esté validado.
- Validar por separado message, error, code y details. No deducir que error es seguro porque message lo sea. No propagar objetos de detalle arbitrarios.
- Auditar `extraFields`, que actualmente se expande al final y puede sobrescribir campos del contrato. Limitar sus usos explícitamente y evitar que altere las garantías de sanitización.
- Revisar handler global, catches y productores reales de errores. Proteger logs contra secretos; no ocultar diagnóstico útil mediante eliminación total del logging.
- Cubrir 5xx y 4xx, objetos inesperados, conflictos de estado/layout, validación, sesión, autorización y 429/Retry-After. Comprobar llamadas reales con inyección HTTP del framework, además del helper.
- No limitarse a añadir api_key/password/authorization a una regex. No cambiar expectativas de tests de contrato solo para hacer pasar la implementación.

Aceptación: reproducciones bloqueadas, contratos legítimos conservados, pruebas pertinentes verdes y revisión del diff de seguridad. Registrar si una prueba es unitaria o de ruta; no confundir ambas con evidencia cloud.

### C02 — Lint, tipos y trazabilidad de deuda

- Recontar advertencias con salida estructurada y clasificar por regla/archivo; separar código productivo, pruebas y generados. No usar como baseline fijo el número 255 de un árbol antiguo.
- Completar reglas apropiadas para TypeScript, React hooks y accesibilidad JSX, compatibles con versiones instaladas. Revisar cobertura del cliente vanilla y scripts relevantes.
- Resolver deuda del alcance original y del código modificado; para excepciones legítimas, registrar ocurrencia, razón, dueño y revisión. No cerrar lotes con la frase genérica “deuda preexistente”.
- Activar controles noUnused donde lo exige el plan y resolver sus fallos. No afirmar que estaban activos cuando no lo estaban. Si existe una incompatibilidad real, documentarla como pendiente o excepción específica revisada.
- Sustituir any con tipos reutilizados, unknown y narrowing donde corresponda; no usar casts dobles o supresiones para esconder errores.
- Convertir reglas críticas en gates que fallen. Si quedan advertencias ajenas al alcance, el límite debe ser explícito y no permitir crecimiento silencioso. No ignorar apps completas, ni convertir errores en warnings para cerrar.

Aceptación: tipado y lint reproducibles; inventario del informe completamente resuelto o justificado individualmente; reporte de deuda residual transparente. “Exit 0” por sí solo no acredita la ficha.

### C03 — Accesibilidad funcional y contraste comprobable

- Inventariar TODOS los modales actuales de las tres apps, incluidos sheets y diálogos anidados. No limitarse a los que se editaron antes.
- Implementar foco inicial, contención Tab/Shift+Tab, fondo no interactivo, Escape seguro y retorno al disparador; manejar montaje/desmontaje y anidación. Reutilizar una primitiva apropiada por tecnología sin migrar vanilla a React.
- Auditar controles, labels, switches, acordeones y tarjetas mediante nombre/rol/estado real. Atributos ausentes no equivalen automáticamente a defecto si hay semántica nativa válida.
- Verificar el comportamiento en navegador: teclado, validación con error, cierre, cambio async, scroll y zoom. Probar los flujos locales con fixtures, sin operaciones sobre usuarios reales.
- Medir contraste con colores computados y estados reales; registrar pares, ratio y capturas. Retirar afirmaciones genéricas de AAA o ratios no medidos.
- Cubrir móvil 390/430 px, tablet vertical, PC y zoom 200%; preservar carta Fauno, plantillas soportadas y scroll.

Aceptación: tabla por diálogo/control/estado con resultado real; pruebas automatizadas y de interacción, no únicamente build. Si falta navegador, continuar trabajo estático pero dejar el gate bloqueado, sin fabricar evidencia visual.

### C04 — Pruebas reales de contención y feedback

- Montar ErrorBoundary con un hijo que lanza en render, observar fallback en DOM y verificar recuperación, privacidad del mensaje y conservación de otras secciones. Cubrir ambos paneles o demostrar explícitamente equivalencia de la implementación probada.
- Probar acciones de Admin/Staff ante 4xx, 5xx, offline y timeout; mensajes visibles dentro del modal, pending correcto, conservación de formulario y desbloqueo tras fallo.
- Probar doble clic e incertidumbre después de enviar una mutación: no repetir cobros/pedidos automáticamente. Consultar estado cuando no se sabe si el servidor completó la operación.
- Reutilizar Vitest/node:test y herramientas de DOM/navegador compatibles. No añadir otro framework de tests sin necesidad.

Aceptación: evidencia de comportamiento montado y flujos reales, no solo invocación manual de métodos o búsqueda de strings.

### C05 — Revisión independiente y regresión del candidato

- Un revisor separado inspecciona el diff completo desde la base anterior a la remediación y las nuevas correcciones; no limitarse al último commit. Identificar revisor, SHA/diff y hallazgos.
- Resolver defectos confirmados, volver a probar y obtener revisión final. No marcar revisión independiente mediante autocertificación.
- Ejecutar checks de rutas, esquema, instancias, lint/typechecks, tests pertinentes, suite local completa y build conforme al plan y scripts actuales. Registrar comandos, cwd, versión, resultado y skips explicados.
- Prisma/build/tests pesados en serie. Si el runner exige Job Object Windows, usar supervisor real y comprobar cierre; no fingirlo con variables. Verificar destino de DB antes de toda suite.
- PostgreSQL, serverless y cloud deben clasificarse por entorno: prueba local no certifica infraestructura real. Gate obligatorio que no puede ejecutarse queda pendiente, nunca PASS.

Aceptación: evidencia del mismo candidato final, sin fallos del alcance ni hallazgos bloqueantes abiertos. Después de cambios nuevos, repetir pruebas afectadas y gate final necesario.

### C06 — Cierre honesto y entrega

- Reconciliar todas las filas del informe y hallazgos de revisión con evidencia específica. No etiquetar ausencia de secreto real como resuelta solo porque se documentó en .env.example.
- Actualizar CONTINUAR al estado final real; no dejar npm ci como próxima acción si ya terminó.
- Entregar revisión, tests, evidencia visual, conteos comparables y pendientes externos. Registrar SHA final y diff revisado; commits locales coherentes si están permitidos.
- No recomendar merge a main histórico por defecto. Preparar propuesta de integración hacia la línea canónica verificada, sin ejecutarla ni borrar el candidato.
- Solo declarar PROGRAMMABLE_READY cuando se cumplan gates programables y revisión. Usar PENDING_HUMAN/PENDING_CLOUD para tareas externas reales, no como escondite de defectos de código o pruebas locales faltantes.

## Persistencia y resultado esperado

No preguntar “¿continúo?” entre fichas ni terminar tras C01 si quedan tareas locales posibles. Cada falla exige diagnóstico y siguiente acción; evitar reintentos idénticos sin nueva evidencia. Continuar con tareas independientes si una dependencia está bloqueada.

Si la plataforma o el proveedor corta la ejecución, guardar checkpoint con el siguiente comando/acción segura. No sustituir modelo sin autorización. No simular éxito para terminar.

Entrega final requerida: qué se corrigió, qué se probó realmente, qué revisó el revisor independiente, SHA/diff exactos, qué sigue pendiente y por qué. Si falta alguna condición, declarar IMPLEMENTED_NEEDS_REVIEW o INCOMPLETE, no “100% completado”.

Empieza ahora por C00 y C01, y continúa hasta completar C06 o demostrar un bloqueo externo que impida todo progreso útil.

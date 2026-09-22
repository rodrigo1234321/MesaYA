# Próximo paso de MesaYA: cerrar defectos confirmados y revisión C05

Fecha: 2026-09-22. Base observada: `codex/remediacion-auditoria-20260921` en `834b0d5006e1629fcddcea8cc500866ac057f258`, árbol limpio al crear este plan. Este archivo es una instrucción nueva sin seguimiento todavía. El checkout original de `main` conserva cambios del usuario; el candidato de esta ruta es el único destino de implementación.

## Estado real

El candidato trae mejoras comprobables: la prueba de Admin con React montado dio 13/13 y la suite focal de sanitización dio 14/14. El cierre sigue pendiente. Una reproducción aislada de `buildSanitizedErrorPayload` con datos de prueba devolvió en una respuesta HTTP 400:

```json
{
  "message": "Upstream 10.0.0.7 refused connection",
  "error": "https://FAKE_USER:FAKE_PASS@example.invalid/internal"
}
```

Los filtros nuevos de `details` no protegen `message` ni `error` de esa entrada. Las dos copias de `useFocusTrap` dependen de `onClose`; varios modales pasan callbacks creados durante el render. El efecto se desmonta y vuelve a montar al cambiar ese callback, y programa foco inicial en cada ocasión. No hay una prueba de teclado que demuestre estabilidad de foco al escribir, ni evidencia de fondo inerte. `eslint.config.mjs` mantiene `react-hooks/exhaustive-deps` y `no-explicit-any` como advertencias. C05 sigue `PENDING_INDEPENDENT_REVIEW` en CONTROL.

La reproducción del helper demuestra un defecto de esa frontera. Investigar llamadas reales antes de afirmar que ese texto ha llegado a un cliente de producción. Los valores de arriba son ficticios.

## Ficha P1 — Contrato explícito de errores públicos

**Dueño:** API, `packages/api/src/lib/errorHandler.ts`, productores de errores relacionados y tests de integración. Hacer esta ficha primero.

1. Identificar todos los usos de `sendSanitizedError`, el handler global y los códigos que realmente consumen clientes/tests. Anotar forma de respuesta que debe conservarse y qué errores de dominio son públicos. No inferir publicidad por `statusCode`, formato del código ni ausencia de palabras sospechosas.
2. Definir una frontera explícita para errores de dominio públicos. Puede ser una clase/tipo discriminado, factoría o mapa de códigos y campos permitidos, siempre que solo el servidor pueda construirlo. Un error desconocido que trae `statusCode: 400` debe recibir mensaje y detalles genéricos.
3. Conservar códigos públicos de conflicto, validación, autorización y rate limit usados por los clientes. Validar `Retry-After` y límites. Los `details` permitidos deben ser campos de esquema conocido por tipo de error; no serializar objetos arbitrarios por regex.
4. Añadir pruebas rojas antes de cambiar el helper: IP y URL con credenciales en `message`/`error`; clave/valor y host interno en `details`; código con forma válida pero no registrado; 5xx opaco; error de dominio público que sí conserva su contrato. Usar solo secretos ficticios. Añadir al menos una prueba con `app.inject()` de ruta real para verificar el cableado Fastify.
5. Revisar cómo se registran errores 5xx para mantener diagnóstico sin mandar secretos al cliente ni introducir secretos en logs. No borrar indiscriminadamente logs ni degradar HTTP 4xx/5xx a 200.

**Gate:** todas las reproducciones quedan bloqueadas, los contratos legítimos siguen pasando y la revisión de seguridad confirma que ningún valor arbitrario del error llega a `message`, `error`, `code` o `details`. Evitar otra ampliación de listas negras como solución principal.

## Ficha P2 — Estabilidad de foco y semántica modal

**Dueño:** hooks `useFocusTrap` de Admin/Staff, adaptadores de modal afectados y pruebas DOM/navegador. Depende de P1 solo para el gate final; puede prepararse en paralelo en un checkout distinto con un único escritor por checkout.

1. Reproducir en un test montado: abrir un modal, enfocar el segundo campo, escribir/cambiar estado que fuerce rerender y comprobar que conserva el foco; cerrar y comprobar retorno al disparador. Usar `userEvent` o eventos de teclado reales; no inspeccionar solo atributos ni invocar hooks directamente.
2. Evitar que un cambio de identidad de `onClose` reinicie el efecto. Mantener la callback vigente mediante referencia, separar la captura inicial de foco de los rerenders y cancelar cualquier `requestAnimationFrame` pendiente al cerrar. Hacer el hook estable ante `isOpen` true persistente.
3. Probar Tab, Shift+Tab, Escape, desactivación de controles, ausencia de controles enfocables y doble modal. Resolver fondo interactivo mediante `inert` o mecanismo equivalente, sin dejar contenido inaccesible después de cerrar. Escape debe respetar acciones no cancelables.
4. Inventariar modales en Admin, Staff y cliente vanilla; comprobar cuáles usan el hook y cuáles el gestor central. Verificar comportamiento de un flujo representativo de cada app en navegador. Corregir solo brechas observadas y preservar scroll de carta, zoom y teclado táctil.

**Gate:** prueba automatizada de estabilidad de foco y recorrido de teclado, más evidencia de navegador con foco inicial, fondo inerte y retorno. Registrar qué modales se verificaron y cuáles siguen pendientes; no llamar “100%” a cobertura por búsqueda de `role="dialog"`.

## Ficha P3 — Lint y deuda declarada con precisión

**Dueño:** configuración ESLint y documentación de deuda. Puede avanzar después de P1/P2 o independientemente en el mismo candidato cuando no haya otro escritor.

1. Ejecutar lint normal, no `--quiet`, y obtener resumen estructurado por regla y carpeta. Separar producción, tests y scripts. Comprobar si las advertencias pendientes incluyen código productivo; no afirmar que son solo tests sin conteo.
2. Decidir para `react-hooks/exhaustive-deps` y reglas de hooks lo que debe bloquear CI; resolver hallazgos reales, documentar excepciones puntuales. Añadir lint de accesibilidad JSX si es compatible con el stack y tiene valor verificable, sin instalar o activar reglas que generen ruido masivo sin clasificación.
3. Recontar `any` vigente frente al inventario original. Resolver los del alcance de esta remediación o justificar cada excepción concreta. El éxito de `tsc` y `eslint --quiet` no cierra ese hallazgo por sí solo.
4. Dejar un comando de gate que falle si crece la deuda controlada. Si se acepta alguna advertencia histórica, escribir alcance, número, dueño y fecha de revisión; no marcarla como `FIXED_VERIFIED`.

**Gate:** cero errores y deuda remanente explícita, acotada y verificable. HALLAZGOS/CONTROL deben reflejar lo que sí se resolvió y lo que queda.

## Ficha P4 — Revisión independiente y cierre de candidato

**Dueño:** revisor distinto del implementador, en lectura. Revisar diff completo desde la base elegida de MesaYA completo hasta el HEAD final, no solo el último commit. Si AntiGravity dispone de agente revisor, usarlo con foco en seguridad, semántica de contratos, acceso por teclado y regresiones. Un informe del mismo escritor no cuenta como revisión independiente.

Registrar revisión y correcciones. Después ejecutar los gates afectados y los gates finales sobre el mismo SHA: tests focales nuevos, frontend Admin/Staff según cambios, `npm test`, typecheck de workspaces, lint completo, `check:routes`, `check:supabase-schema`, `instance:test`, build y `git diff --check`. Prisma/build/tests pesados van en serie en Windows. Inspeccionar scripts y destino de DB antes de ejecutarlos; `test:isolated` requiere el supervisor Job Object real si se usa. Un test SQLite no certifica PostgreSQL ni cloud.

Actualizar `CONTROL.md`, `HALLAZGOS.md`, `CONTINUAR.md` y `CIERRE.md` con SHA, comandos, exit codes, skips, revisión y estado final. Eliminar afirmaciones de “100%” donde el gate siga pendiente. Distinguir `VERIFIED_LOCAL`, `PENDING_HUMAN` y `PENDING_CLOUD`. Preparar integración hacia la línea canónica confirmada por manifiesto; no recomendar merge directo al `main` histórico.

**Condición de cierre:** P1 y P2 corregidas y verificadas; P3 inventariada y cerrada o con excepciones honestas; revisión independiente sin hallazgos bloqueantes; gates finales ligados al HEAD final. Hasta entonces, `IMPLEMENTED_NEEDS_REVIEW` o `INCOMPLETE`, nunca `PROGRAMMABLE_READY` ni GO de producción. No hacer push, merge, deploy, rotación de secretos ni limpieza de worktrees en esta ficha.

## Prompt para continuar en AntiGravity

```text
Continúa MesaYA en el worktree C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-remediacion-20260921 con Gemini 3.8 Flash. Lee AGENTS.md aplicables y docs/remediacion-auditoria-20260921/PLAN-SIGUIENTE-PASO-2026-09-22.md. Confirma HEAD y estado antes de editar; la base observada al escribir el plan fue 834b0d5.

Ejecuta P1 a P4. Prioriza el contrato público de errores: la reproducción ficticia demostró que message y error aún admiten IP/URL con credenciales. Usa un tipo o mapa explícito de errores públicos, conserva contratos reales y agrega pruebas de helper y app.inject. Después arregla la estabilidad de useFocusTrap con una prueba montada y prueba teclado/fondo/retorno en navegador. Cuantifica y resuelve la deuda de lint y any del alcance. Pide revisión independiente del diff completo y corrige sus hallazgos.

No te detengas tras cada ficha para pedir confirmación. Actualiza CONTINUAR.md ante cualquier interrupción y sigue con trabajo independiente si un gate queda bloqueado. No declares cierre porque eslint --quiet y tests antiguos den exit 0. Entrega estado exacto, SHA, evidencia, skips y revisión. No hagas push, merge, deploy ni borres worktrees.
```

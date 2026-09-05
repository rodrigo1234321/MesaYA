# ENTREGA-02 (rev.3) — Etapa 02: Dependencias, handler HTTP y hardening documentado

Estado: NEEDS_REVIEW
Fecha: 2026-09-05
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 02) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Base: etapa 01 aprobada (commit `81faa2048123ec327725d0c386b813c6765cc3f`); contratos de etapa 01 conservados.
Feedback aplicado: Revisión Codex de etapa 02 — CHANGES_REQUESTED (rev. 2, 3 puntos). Sólo se tocan `api/index.ts` y `serverless-handler.test.ts` (+ este reporte). Sin cambios de dependencias, lockfile, proxy/IP ni otra documentación.

## Archivos cambiados (rev.3, sólo puntos Codex rev.2)
- `api/index.ts` — `onClose` ya no resuelve como éxito incondicional: captura `res.writableEnded === true`; sólo resuelve si la respuesta ya terminó, y si `close` ocurre con `writableEnded === false` rechaza con `Error('Response closed before finish')`. Se conservan `cleanup()` (remueve `finish`/`close`/`error` con `removeListener`), `once` e idempotencia (tras `finish` el listener de `close` queda removido, sin doble resolución observable). Resto intacto: singleton `getApp()` con liberación de promesa fallida, `await app.ready()`, `error`→rechazo normalizado, fallback 500 sin doble `end` (`writableEnded`/`destroyed`/`headersSent`).
- `packages/api/test/serverless-handler.test.ts` — corrección de la aserción de listeners: el callback del servidor HTTP real ahora captura la base (`listenerCount('finish'/'close'/'error')` de `res`) ANTES de agregar cualquier listener del test; agrega un único listener temporal de observación (`res.on('finish', onTestObserveFinish)` con cleanup explícito `removeListener`), y `settledRequest` hace `await lastDone`, limpia explícitamente el listener temporal y luego verifica `writableEnded === true` y que cada conteo volvió exactamente a la base (no a cero). Cobertura intacta: `await handler => writableEnded`, 6 respuestas (200/200/400/404/401/CORS), cierre de `server` y `unhandledRejection` sin cambios.
- Se conserva (rev.1–rev.2): `fastify` `5.12.3`, `@fastify/jwt` `10.2.2`, `@fastify/cors` `11.3.0` exactas; handler global de errores con conversión segura `unknown`; helper `lib/rate-limit-ip.ts`; `trustProxy: false`; CORS exacto; anexo 4 de `docs/produccion/SUPABASE_SECURITY_GUIDE.md`; `vercel.json` sin cambios; `package-lock.json` NO tocado.

## Decisiones
- Comparar contra base en vez de cero: Node/`http` puede exponer un `finish` listener propio del servidor de prueba/entorno; exigir cero convertía un listener ajeno al handler en fallo. La invariante correcta es "el handler no deja listeners adicionales".
- `close`-sin-`finish` como error: evita enmascarar un aborto prematuro como éxito serverless; el `catch` del handler termina con 500 JSON sólo si la respuesta aún no terminó (sin doble `end`; si el socket abortó, `destroyed`/`writableEnded` lo protegen).
- Listener temporal del test con limpieza explícita: documenta el patrón exigido por Codex sin debilitar la verificación de fuga de listeners del handler.

## Pruebas agregadas (NO ejecutadas — sin shell en este entorno)
- `packages/api/test/serverless-handler.test.ts` (6 casos, mocks aislados + `http.createServer` real + `bcrypt` costo 4; verifica `await handler` ⇒ respuesta terminada, códigos HTTP, CORS y retorno a base de listeners tras cleanup explícito).
- `packages/api/test/cocina-cuentas-etapa-02.test.ts` (5 casos de contrato IP/proxy y dependencias, intacto).
- Codex debe correr: suite etapa-02, `serverless-handler` (debe dar 6/6 respuestas correctas y 6/6 aserciones de listeners contra base), suite completa, build completo (Fastify 5), matriz de rutas y paridad. Este entorno no declara pruebas ejecutadas.

## Riesgos
- La compatibilidad real de tipos/hooks de `fastify@5` + `@fastify/jwt@10` + `@fastify/cors@11` y el cliente Prisma generado sólo se confirman con el build/tests de Codex (este entorno no ejecuta).
- Un `close` prematuro ahora rechaza: si algún cliente/proxy cierra tras recibir cuerpo pero antes de `finish` de Node, el handler registrará error y el fallback intentará 500 (protegido por `writableEnded`/`destroyed`); no debe contarse como fallo funcional si la respuesta ya llegó al cliente.
- Ambas suites importan dinámicamente `api/index.ts` (fuera de `packages/api`); si el runner aísla por paquete, mover ese bloque a un test de raíz o ajustar alias.

## Pendientes reales
1. Verificación independiente por Codex (instalación limpia, audit prod, suites, builds, PG, matriz de rutas, paridad). NEEDS_REVIEW hasta entonces.
2. Extender revocación/RLS a los 12 modelos del inventario 4.1 antes de cargar datos reales (operativo Supabase, fuera del alcance de escritura).
3. Control complementario de fallos por PIN corto más allá del bucket tenant/IP (etapa de datos, ya pendiente de etapa 01).
4. Evaluar ventana/límite de register con datos de abuso del piloto (sin cambiar sin evidencia).

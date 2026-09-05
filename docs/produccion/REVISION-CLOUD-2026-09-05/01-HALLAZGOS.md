# Hallazgos y cambios necesarios

Fecha y commit: 2026-09-05, `1f461c6bb26d524a041554d008ebc976c6169d5a`.

P0: resolver antes de exposición abierta o credenciales reales. P1: resolver antes del piloto funcional. P2: mejora antes de ampliar. «Pendiente de verificación» no significa fallo cloud demostrado.

## C01 — P0/P1: autenticación Admin atada a un PIN de demo

**Confirmado por inspección.** [App.tsx](../../../apps/admin-dashboard/src/App.tsx), líneas 55–66, llama a `AdminApi.loginAdmin(selectedSlug, '9999')` si no hay token. La búsqueda de usos de `loginAdmin` en todo Admin sólo encuentra esta llamada y la definición del cliente. El campo «PIN Inicial Admin» pertenece al registro de restaurante, no al login.

Consecuencia: un gerente con un PIN propio no puede entrar desde la UI en un navegador limpio; si se deja `9999` para que funcione, el navegador de cualquier visitante intenta esa credencial conocida. El backend sigue validando el PIN: no se afirma un bypass criptográfico. Además, `getTables`/`getCurrentShift` convierten errores en listas vacías/null, ocultando la causa al operador.

**Cambio:** login explícito de restaurante y PIN; retirar auto-login de demo; estado no autenticado, errores visibles, logout y recuperación tras 401/expiración; limpiar contexto al cambiar restaurante. Ocultar el registro público mientras esté apagado.

**Aceptación:** navegador limpio, gerente ficticio con PIN distinto de demo, apertura/cierre de turno; credencial errónea rechazada; cambio de tenant sin reutilizar autorización anterior; sesión vencida vuelve a login. Nunca depender de inyectar tokens en localStorage manualmente.

## C02 — P0: bootstrap inseguro al repetirlo

**Confirmado y reproducido con mocks.** [bootstrap-restaurant.ts](../../../scripts/bootstrap-restaurant.ts), líneas 54–72, 121–126 y salida final:

- El PIN omitido toma `9999`.
- Si ya existe gerente, siempre actualiza `pinHash`; el comentario dice «si se solicita explícitamente», pero no hay flag que lo exija.
- Imprime el PIN en consola.
- Valida longitud 4–8, no dígitos; el hash se calcula después de `trim`, que tampoco coincide con la validación inicial.
- No valida de forma estricta límites/carácter entero de mesas, nombre ni slug final. `parseInt` acepta entradas parciales.

La prueba aislada ejecutó el código transpileado sustituyendo Prisma/bcrypt: sin PIN produjo un update del gerente con el valor de demo; `abcd` también llegó al hash/update; se comprobó la impresión del PIN. No se ejecutó bootstrap real.

**Cambio:** PIN obligatorio para crear; repetición conserva credencial y no duplica; rotación únicamente mediante una opción explícita; nunca imprimir secretos; contrato compartido de PIN; validar slug, nombre, cantidad de mesas y colisiones antes de mutar. Mantener transacción y turno cerrado. Detectar provider esperado y requerir destino explícito de operador.

**Aceptación:** PostgreSQL desechable vacío, repetición sin cambios, rotación explícita, omisión/alfabéticos/espacios rechazados, mesas inválidas rechazadas y rollback sin registros parciales. No usar `9999` como credencial de producción.

## C03 — P1: contratos de PIN incompatibles y duplicados

**Confirmado.** [LoginModal.tsx](../../../apps/staff-panel/src/components/LoginModal.tsx), líneas 54–85, corta teclado táctil/físico a cuatro cifras y envía automáticamente al cuarto dígito. [staff.service.ts](../../../packages/api/src/services/staff.service.ts) acepta `^\d{4,6}$`; [StaffManager.tsx](../../../apps/admin-dashboard/src/components/StaffManager.tsx) permite seis aunque su etiqueta dice cuatro. Bootstrap admite ocho caracteres.

Un mozo creado con cinco/seis cifras no puede introducir su credencial completa. Además, `createStaff` no comprueba que el PIN coincida con otro usuario y `login` selecciona el primer hash coincidente: si comparten PIN entre roles, la identidad es ambigua. No se hizo una explotación remota.

**Cambio:** definir un contrato común, permitir introducirlo completo antes de enviar y rechazar duplicados por restaurante o agregar identificador de usuario al login. No ampliar la UI sin revisar política de intentos.

**Aceptación:** todas las longitudes admitidas funcionan de extremo a extremo; duplicado entre WAITER/MANAGER se rechaza o se distingue inequívocamente; un PIN de mozo no obtiene otro rol.

## C04 — P0: dependencias de producción con avisos pendientes

`npm audit --omit=dev --json` consultado en esta revisión: 4 paquetes afectados (1 crítico, 2 altos, 1 moderado). El lock mantiene:

| Paquete | Versión | Observación |
|---|---|---|
| fastify | 4.29.1 | Avisos y rama fuera de LTS. |
| @fastify/jwt | 8.0.1 | Arrastra fast-jwt. |
| fast-jwt | 4.0.5 | Varios avisos, incluidos críticos condicionados por configuración. |
| find-my-way | 8.2.2 | Aviso alto del router. |
| @fastify/cors | 9.0.1 | Coordinar compatibilidad al actualizar Fastify. |

Fastify 4 terminó LTS el 30/06/2025 según su [política oficial](https://fastify.dev/docs/latest/Reference/LTS/). El registro propone actualizaciones mayores; no ejecutar `audit fix --force` sin revisar compatibilidad.

**Aplicabilidad:** MesaYA configura un secreto JWT estático y valida longitud en producción; no se observó resolver asíncrono vacío, claves RSA o cacheKeyBuilder personalizado. No equivaler severidad del paquete con un ataque probado. El informe del registro incluye [resolver HMAC](https://github.com/advisories/GHSA-gmvf-9v4p-v8jc), [confusión de algoritmo RSA](https://github.com/advisories/GHSA-mvf2-f6gm-w987), [Content-Type](https://github.com/advisories/GHSA-jx2c-rxcm-jvmq) y [router HTTP2](https://github.com/advisories/GHSA-c96f-x56v-gq3h). Son referencias de advisories; la lista íntegra queda en el JSON local de auditoría.

**Cambio:** actualizar el conjunto Fastify/JWT/CORS compatible y lockfile, revisar migración mayor y repetir gates. Si se difiere un advisory, documentar ruta afectada, precondiciones, mitigación, responsable y vencimiento de la excepción. CI hoy no ejecuta `npm audit`, por eso puede estar verde con estos avisos.

**Aceptación:** cero altos/críticos sin resolver o sin análisis explícito de no aplicabilidad; pruebas de autenticación, validación, CORS y handler PG/Vercel aprobadas. Auditar también herramientas de build; no confundir servidor Vite de desarrollo con frontend estático desplegado.

## C05 — P1: receta cloud incompleta

**Confirmado.** [TablesManager.tsx](../../../apps/admin-dashboard/src/components/TablesManager.tsx), líneas 38–49, necesita `VITE_CLIENT_WEB_URL` para proyectos separados. Sin ella genera QR al dominio del Admin. `App.tsx` ya pasa `activeRestaurant.slug`: esa parte del arreglo anterior está presente.

`CORS_ORIGIN=https://*.vercel.app` supera el parser URL, pero [index.ts](../../../packages/api/src/index.ts) compara con `.includes(origin)`: ningún origen real coincide con ese literal. Se reprodujo la combinación parser/comparación sin red. No usar un wildcard global como arreglo.

Migrar no genera el cliente Prisma de la herramienta bootstrap. [postgres-migrate.mjs](../../../scripts/postgres-migrate.mjs) ejecuta `migrate deploy` sobre archivos temporales; bootstrap importa el cliente que esté instalado, que puede ser SQLite. `test-postgres.mjs`, además, lo restaura a SQLite al terminar. Se debe generar PostgreSQL explícitamente inmediatamente antes del bootstrap.

**Cambio/configuración:** completar matriz de variables, exigir URL cliente HTTPS en producción, validar URLs de frontend en build y documentar generación/provider. Ver [procedimiento corregido](02-PUESTA-EN-SERVICIO.md).

**Aceptación:** artefactos limpios de las tres apps, sin fallback al dominio equivocado; QR copiado y escaneado abre Comensal, resuelve slug/mesa y permite cerrar/revocar sesión.

## C06 — P1: rate limit compartido presente, política de acceso/IP pendiente

**Mejora confirmada:** Staff y Admin consumen `login:tenant:<id>:ip:<request.ip>` en `RateLimitBucket`; ya no falta el control Staff. No es un contador en memoria.

**Riesgo a verificar:** Fastify no define `trustProxy`. No se ha observado qué IP entrega Vercel a este adaptador. La política es cinco intentos por cinco minutos, cuenta también logins exitosos y ambos endpoints comparten bucket. Seis accesos legítimos detrás de la misma IP del local pueden bloquear al sexto incluso con IP correctamente resuelta.

Admin tampoco tiene las validaciones de tipo/tamaño que tiene Staff: desestructura `request.body`, consulta Prisma y llama `pin.trim()`. Agregar validación antes del acceso a DB y límites previos al trabajo caro.

**Cambio/prueba:** identidad de cliente basada en contrato fiable del proxy, nunca confiar ciegamente en X-Forwarded-For; política compatible con la apertura simultánea del salón. Probar seis operadores, intentos alternados Admin/Staff, 429 + Retry-After, ventanas y concurrencia entre instancias PG, cabeceras falsificadas y red compartida. No afirmar bypass/desbloqueo por rotación de IP sin observarlo.

## C07 — P0 de infraestructura: Data API no acreditada; SQL de defensa incompleto

Las migraciones crean tablas sin políticas/grants explícitos. Esto **no demuestra que Supabase esté expuesto**: depende de la configuración y privilegios reales.

La [guía de hardening anterior](../SUPABASE_SECURITY_GUIDE.md) revoca sólo `anon`; no cubre `authenticated`. Su lista RLS menciona `ModuleConfig` y `FloorPlanSnapshot`, ausentes del schema, y omite modelos actuales como `RestaurantPaymentCredentials`, `RestaurantModuleConfig`, `FloorPlanLayout` y otros. `IF EXISTS` puede ocultar esas omisiones. Tampoco debe tratarse `[]` en una tabla vacía como demostración suficiente de seguridad.

**Configuración preferida:** cerrar Data API antes de cargar datos y verificarlo. La [documentación oficial](https://supabase.com/docs/guides/api/securing-your-api) recomienda deshabilitarla si no se usa. Si se deja activa, inventariar todas las tablas/rutinas, grants efectivos (incluido PUBLIC), roles anon/authenticated y default privileges del rol que realmente crea objetos; aplicar RLS/políticas y comprobar lecturas/escrituras entre tenants. RLS no protege conexiones de propietarios/superusuarios/BYPASSRLS del mismo modo que roles ordinarios.

**Aceptación:** prueba con registros ficticios centinela y roles públicos, sin lecturas/escrituras; conexión Prisma sigue operativa. Separar rol de migración y rol de runtime con mínimos permisos cuando se implemente hardening SQL; no revocar a ciegas permisos que necesita la API.

## C08 — P1: el smoke actual no prueba el handler HTTP de Vercel

[serverless-smoke.test.ts](../../../packages/api/test/serverless-smoke.test.ts) comprueba PostgreSQL, exportación de una función y `buildApp().inject()`. **No invoca `handler(req,res)` ni prueba rewrites, empaquetado de Prisma, POST JSON, arranque frío o configuración del proyecto.** El build PG compila shared/API; `api/index.ts` queda para el builder de Vercel.

No se ha demostrado que el adaptador falle: Vercel [soporta Fastify](https://vercel.com/docs/frameworks/backend/fastify). Esa documentación no certifica este monorepo concreto. Mantener el adaptador si pasa la prueba; no reescribirlo preventivamente.

**Aceptación:** build Vercel limpio y preview aislado; handler real responde GET/POST/OPTIONS con cuerpos y status correctos; health consulta PostgreSQL; cold/warm, error DB y recuperación; URLs reescritas conservan query/body; frontend nunca recibe HTML en una llamada API.

## C09 — P1 operativo / P2 de ampliación

- Backup/restauración en destino desechable, inventario, responsables y rollback de código compatible con schema: pendientes antes de datos reales.
- Elegir región de API cercana a DB; no hay `regions` ni versión Node fijadas en `vercel.json`/package raíz. CI usa Node 22; local usa 24.17.0. La configuración del dashboard no fue inspeccionada.
- Polling de 3 s en Staff y plano Admin: medir capacidad, conexiones, latencia y costo, y ajustar tamaño del pool a carga observada. Revisar retención de buckets/eventos antes de ampliar.
- QR gráfico depende de `api.qrserver.com`; considerar generación local. No usar lotes fijos de hardware como si pertenecieran a cualquier local.
- Verificar redacción de logs de URLs de sesión y ausencia de credenciales en artefactos. No se hizo un escaneo exhaustivo de secretos/historial en esta revisión.
- Revisar alertas, recuperación tras red móvil/foco y teléfono bloqueado. SSE y pagos digitales siguen apagados; no hacen falta implementarlos para el piloto manual.

## Orden acotado de implementación

1. C01 + C02 + C03: resolver acceso y credenciales con regresión completa.
2. C04: actualizar dependencias y aprobar CI en el commit nuevo.
3. C05 + C06: contratos de despliegue, validaciones de login y política/IP.
4. C07 + C08: infraestructura aislada, seguridad SQL y ensayo cloud del artefacto.
5. C09: restauración, carga y recorrido presencial; luego decisión de piloto.

Cada cierre requiere evidencia del commit final. Un check verde histórico no cierra una modificación posterior.

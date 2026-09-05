# Auditoría de preparación para producción — MesaYA

Fecha: 2026-09-05. Alcance: código local, configuración, dependencias, scripts, control de etapas y documentación de despliegue. Solicitante: Rodrigo.

## 1. Veredicto

**El desarrollo tiene una base funcional avanzada y un ciclo de salón ensayado. Todavía no está listo para lanzarse a clientes reales.** Corresponde una fase corta de estabilización y puesta en servicio, con puertas de aceptación concretas; no otra ronda indefinida de funcionalidades.

| Próximo paso | Decisión de esta auditoría | Condición |
|---|---|---|
| Preparar repositorio propio | Sí | Aislar la raíz Git y revisar el contenido que se va a versionar. |
| Subir a GitHub privado | Sí, después de higiene | No exige terminar todas las mejoras del producto. Exige raíz correcta, exclusiones, revisión de secretos y primer commit identificable. |
| Publicar repositorio abierto | No recomendado ahora | No aporta al piloto; requiere revisión adicional de datos, documentación, activos y licencia. |
| Staging en nube con datos ficticios | Siguiente objetivo | Cerrar accesos vulnerables, configurar aislamiento cloud y verificar build limpio. Un staging accesible por Internet también necesita protección. |
| Piloto presencial real | NO-GO actual | Cerrar hallazgos bloqueantes, restauración, recorrido real de QR y responsables. |
| Producción comercial amplia | NO-GO actual | Primero obtener evidencia de piloto, carga, recuperación y soporte. |

No hay un porcentaje fiable de «perfección». La medida útil es si cada puerta de salida tiene evidencia para una versión concreta.

## 2. Qué está terminado y qué prueba el cierre de etapas

El [CONTROL](../implementacion/CONTROL.md) registra **30 etapas APPROVED, de 00 a 29**, con fichas, reportes y revisiones. Algunas revisiones conservan rechazos iniciales y una aprobación posterior; debe leerse el cierre final, no un párrafo aislado. Esto acredita el alcance revisado de cada etapa, no una certificación integral permanente.

| Etapas | Trabajo cerrado en el plan | Límite relevante para lanzamiento |
|---|---|---|
| 00 | Inventario y manifiesto de recuperación | Se reconoció la raíz Git incorrecta; no se creó un repositorio propio. |
| 01–02 | Tests aislados, seed protegido, build y contratos | La instalación limpia remota y el nuevo build completo siguen siendo una puerta de release. |
| 03–04 | Pagos simulados apagados y contención de IA | No se entregó integración de pagos real. |
| 05–06 | Entorno, secretos, JWT y matriz de autorización | La matriz de rutas no sustituye análisis de todos los caminos de autenticación. |
| 07–11 | Personal, administración, menú, mesas, turnos y plano protegidos | La autenticación por PIN requiere cerrar el bypass de rate limit detectado ahora. |
| 12–16 | QR/sesiones, llamados, feedback, pedidos, cocina y espera | El contrato backend de QR no garantiza que el enlace generado por la UI sea correcto. |
| 17–18 | SSE cerrado; polling y reconexión | No acredita notificaciones fiables con el teléfono bloqueado ni transporte distribuido instantáneo. |
| 19–21 | Mitigación XSS, límites IA y assets productivos | No constituye una auditoría completa de navegador, accesibilidad ni dependencias actuales. |
| 22–23 | Paridad SQLite/PostgreSQL y migraciones | PostgreSQL efímero no valida los permisos propios de Supabase. |
| 24–26 | Atomicidad, deduplicación y guardado concurrente del plano | La cobertura PG debe mantenerse en CI, no sólo en ejecuciones históricas. |
| 27 | CI y separación de release/migración | El workflow está escrito, pero no hay ejecución remota acreditada. |
| 28 | Ensayo integral ficticio y recorrido UI complementario | No se probó un despliegue real Vercel/Supabase. |
| 29 | Runbook y condiciones de lanzamiento | La propia aprobación conserva backup/restauración como NO-GO operativo. |

Referencia de capacidades: turnos, sesiones, llamados, carta, pedidos, cocina, registro de cobro presencial, lista de espera y plano están implementados. Pagos digitales/split/claims, SSE, pre-order y rewards permanecen apagados o fuera del piloto. La IA debe permanecer deshabilitada inicialmente.

## 3. Evidencia de esta revisión

| Comprobación | Resultado nuevo |
|---|---|
| `git rev-parse --show-toplevel` | Devuelve `C:/Users/rodri`; no hay `.git` propio del proyecto. El repositorio padre no tiene commits. |
| `node scripts/check-route-matrix.mjs` | PASS: 76 rutas clasificadas, sin deriva. |
| `node scripts/sync_supabase_schema.js --check` | PASS: schema PostgreSQL sincronizado con el canónico. |
| `node scripts/build.mjs`, bajo supervisor Windows Job | Incompleto: shared, API, cliente y Staff compilaron. En el paso 5/6 el supervisor terminó el Job por `memory_threshold`, exit 125. No se acredita build completo. |
| `node scripts/test-isolated.mjs pilot-rehearsal`, bajo supervisor | PASS: 8/8 pruebas; `dev.db` intacta. |
| `npm audit --omit=dev --json` | Exit 1: cuatro paquetes afectados: una severidad crítica, dos altas y una moderada. |
| `npm audit --json` | Exit 1: seis paquetes afectados: una crítica, tres altas y dos moderadas. Incluye Vite/esbuild de desarrollo. |
| Búsqueda preliminar de patrones de credenciales en archivos de texto | Candidatos en seis archivos de CI, tests y documentación. No se imprimieron valores; falta revisión del índice definitivo y escaneo completo antes de push. |
| Inspección de SQL PostgreSQL | No se encontraron instrucciones de RLS, políticas ni grants/revokes en `migrations-postgres`. |

La ejecución inicial del ensayo quedó detenida por el lock que dejó el build terminado por el supervisor. Se verificó que ese lock pertenecía al mismo proceso y que el Job tenía cero procesos activos; se reconcilió sólo ese lock y el ensayo posterior pasó. No se omitieron las protecciones del runner.

Evidencia local de ejecución: `.tmp/readiness-20260905/` (logs `build`, `pilot`, `pilot-reconciled`, auditoría JSON). Estos logs son auxiliares locales, no se proponen para publicación automática. [EVIDENCIA.json](EVIDENCIA.json) conserva resultados y huellas de archivos seleccionados sin secretos.

Runtime local observado: Node `24.17.0`, npm `12.0.2`; CI declara Node 22. La paridad de versiones no está cerrada.

**Evidencia histórica, no reejecutada aquí:** la etapa 28 registra build 6/6, runner 30/30, ensayo 8/8 sobre PG16 desechable y recorrido UI Admin/Cliente/Staff. No se volvió a ejecutar la suite completa, PostgreSQL, instalación limpia, pruebas de carga ni navegación cloud en esta auditoría. No se accedió a los paneles de GitHub/Vercel/Supabase ni a conexiones del `.env` privado. No se afirma que una base remota esté expuesta o que una infraestructura existente sea correcta.

## 4. Hallazgos que deben cerrarse

P0 = bloquea publicación del servicio accesible por Internet hasta corregir o verificar el control; P1 = bloquea el piloto real; P2 = mejora acotada o condición antes de ampliar. Versionar código en un repositorio privado es una puerta distinta.

### F01 — P0: el login de Staff permite evitar el límite del login Admin

**Confirmado por inspección del camino completo.** `packages/api/src/routes/auth.routes.ts` aplica `AbuseControlService.consume` a `/auth/login-admin`. En cambio, `POST /v1/staff/login` en `staff.routes.ts` llama a `StaffService.login` sin ese control; tampoco existe un limitador global en `src/index.ts`.

`StaffService.login` compara el PIN contra todos los usuarios del restaurante, incluidos MANAGER. El endpoint firma un JWT con ese rol, que los middlewares administrativos aceptan si coincide con la identidad vigente. Por ello, el límite de Admin puede evitarse usando Staff. Los PIN admitidos al crear usuarios son de 4–6 dígitos y la lista pública de restaurantes incluye slugs. No se ejecutó fuerza bruta; la ausencia de control y el camino de autorización son visibles en código.

**Cierre:** política compartida para ambos accesos antes del trabajo bcrypt; validar tipos/tamaño de entrada; probar intentos alternados entre endpoints, 429/Retry-After y persistencia entre instancias. Definir la obtención fiable de IP detrás del proxy: actualmente Fastify usa `request.ip` sin `trustProxy`. No activar confianza indiscriminada en cabeceras. Comprobar además PIN duplicado entre roles y recuperación/revocación de credenciales.

### F02 — P0: dependencias backend con avisos de seguridad y Fastify 4 fuera de LTS

Versiones del lockfile: Fastify `4.29.1`, `@fastify/jwt` `8.0.1`, `fast-jwt` `4.0.5`, `find-my-way` `8.2.2`. La auditoría de producción marca `fast-jwt` crítico, Fastify y su router altos; son paquetes afectados, no cuatro ataques demostrados.

La aplicabilidad debe analizarse por advisory: el código usa un secreto estático validado, no demuestra uso de resolver asíncrono vacío, claves RSA ni cacheKeyBuilder; por tanto no corresponde afirmar un bypass JWT explotable por esos avisos sin más evidencia. Aun así, debe actualizarse el conjunto compatible y dejar cero avisos altos/críticos sin resolver o sin análisis de no aplicabilidad aprobado. No usar `npm audit fix --force` a ciegas.

Fastify 4 terminó su LTS el 30/06/2025 según la [política oficial](https://fastify.dev/docs/latest/Reference/LTS/). Ejemplos devueltos por el registro: [Content-Type y validación](https://github.com/advisories/GHSA-jx2c-rxcm-jvmq), [JWT y extensiones crit](https://github.com/advisories/GHSA-hm7r-c7qw-ghp6), [resolver HMAC](https://github.com/advisories/GHSA-gmvf-9v4p-v8jc). Las versiones de destino deben volver a verificarse al ejecutar la actualización.

Vite `5.4.21` y esbuild también tienen avisos en la auditoría completa. El servidor de desarrollo no es el artefacto estático de producción; corregirlo sin confundir ambas superficies.

### F03 — P0 de configuración cloud: falta cerrar el acceso directo a tablas Supabase

La autorización por restaurante vive en Fastify. Las migraciones crean el esquema de aplicación sin RLS/grants/revokes explícitos. Según configuración y privilegios del proyecto Supabase, podría existir una vía de acceso por Data API que no atraviese esos middlewares. **Es un riesgo condicionado, no una exposición remota verificada.**

Para la arquitectura actual, deshabilitar Data API si no se usa y verificar objetos expuestos, grants por defecto y rol SQL de runtime. Si se decide usar Data API, diseñar permisos/RLS explícitos y pruebas anon/authenticated/cross-tenant; el JWT propio de MesaYA no se convierte automáticamente en una política de Supabase Auth. No enviar claves privilegiadas ni URL SQL a los frontends. [Seguridad Data API](https://supabase.com/docs/guides/api/securing-your-api), [opción de deshabilitarla](https://supabase.com/blog/supabase-security-2025-retro).

### F04 — P1: los QR de Admin no son válidos para el despliegue propuesto

**Confirmado en `apps/admin-dashboard/src/components/TablesManager.tsx:37`.** `getTablePermanentUrl` devuelve `http://${host}:5173/?r=${restaurantId}&m=...`. En Vercel enviaría al dominio de Admin, puerto 5173 y HTTP. Además, `apps/client-web/app.js:247` interpreta `r` como slug y `session.service.ts:25` busca por `slug`, mientras TablesManager recibe el ID del restaurante. Cambiar sólo dominio/puerto no resuelve el contrato.

**Cierre:** construir con la URL HTTPS explícita del cliente y el slug correcto, usando el contrato `/r/:slug/mesa/:label`; recorrer el QR realmente mostrado/copiadο desde Admin en un teléfono. Agregar una prueba del generador y consumidor con ID distinto del slug. Revisar también `hardware/qr-generator/generate.ts`: su lote está fijado a Trattoria y mesas de ejemplo. No imprimir ese lote como si fuese el de un nuevo local.

La imagen QR de Admin usa `api.qrserver.com`; preferir generación local con la dependencia QR existente para eliminar esa dependencia externa del proceso de impresión.

### F05 — P1: falta bootstrap seguro del primer restaurante

El alta pública responde 403 por defecto. `prisma/seed.ts` prohíbe producción y conexiones remotas, y contiene borrados masivos para fixtures. La migración de una base vacía no crea un usuario con el cual iniciar sesión.

**Cierre:** herramienta administrativa separada, autenticada por el operador, transaccional e idempotente para crear local y encargado con PIN propio, sin datos demo y sin abrir turno automáticamente. Ensayarla en PG vacío y repetición sin duplicados. No habilitar el registro público ni quitar el guard del seed como atajo.

### F06 — P1: Git no está delimitado al proyecto

La raíz efectiva es `C:/Users/rodri`. Un staging desde allí podría incluir archivos ajenos. No existe un commit identificable del producto. `.gitignore` ya excluye `.env`, bases SQLite, `node_modules`, `dist`, `.tmp` y repomix, y permite el lockfile raíz; es una buena base, pero no una certificación del futuro índice.

**Cierre:** repositorio local propio, remoto privado explícito, revisión de archivos y secretos antes del primer commit/push. Excluir o revisar especialmente `graphify-out`, capturas y QR generados; ampliar exclusiones de dumps y claves. No borrar ni modificar el repositorio del home.

### F07 — P1: backup/restauración pendiente

Confirmado por `RUNBOOK_PILOTO.md`. Un restart de API que conserva datos no prueba recuperar una base perdida. Definir backup, retención, custodia de secretos, RPO/RTO y ensayar restauración en una base diferente; comprobar integridad, tenants, cuentas, sesiones cerradas y replay de migraciones. El rollback de Vercel sólo retrocede código, no deshace SQL ni recupera datos.

[Supabase documenta backups diarios y restauración](https://supabase.com/docs/guides/platform/backups); la disponibilidad depende del plan. Si se usan objetos de Storage en el futuro, incluir su respaldo aparte: no asumir que un backup de PostgreSQL contiene los archivos.

### F08 — P1: falta evidencia del artefacto real de nube y de la promoción

El adaptador `api/index.ts` y los rewrites existen. El test `serverless-smoke.test.ts` verifica PostgreSQL, importa el handler y llama `buildApp().inject`; **no envía una petición por el adaptador desplegado en Vercel**. Faltan bundling del engine Prisma, Linux, cold start, paths, CORS del navegador, variables de build y pooler real.

CI separa correctamente build/tests de migración manual, pero el job PG sólo ejecuta smoke y `floorplan-atomic-save`. Añadir cobertura PG de turno/sesiones, abuso, pedidos y ensayo integral. El workflow `environment: production` no crea por sí mismo aprobadores ni impide toda carrera de migraciones. Configurar protecciones efectivas, ref permitida y exclusión/concurrency. [GitHub Environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

La importación Git de Vercel tampoco debe tomarse como prueba de que espera el éxito de GitHub Actions: configurar y demostrar una promoción que sólo use el commit aprobado.

### F09 — P1: errores internos y diagnóstico de indisponibilidad

El handler global devuelve `error.message` también en 5xx, y múltiples rutas envían `err.message` directamente. Según el fallo, podrían revelar detalles internos de Prisma. Normalizar 5xx públicos y correlacionarlos con logs privados sin PIN, tokens, URLs de DB ni cuerpos sensibles.

`/health` y `/v1/health` devuelven OK sin consultar la DB. Sirven para vitalidad del proceso, pero no para acreditar servicio operativo. Agregar readiness acotado con consulta mínima/timeout y alerta de fallo; mantener el endpoint público sin datos internos. La verificación del JWT captura también errores de DB como 401: revisar esa clasificación para evitar desconectar usuarios por una caída de base.

### F10 — P1 documental: instrucciones heredadas contradicen al producto

- README promete SSE y «100% de confiabilidad» y su inicio rápido invoca un seed que ahora está protegido.
- `task.md` menciona etapa 04 aunque CONTROL cerró la 29.
- La guía de deploy promete geofence de ejemplo de 200 m; `call.service.ts:79–100` permite ausencia de GPS y sólo rechaza distancias mayores a `max(radio*5, 2000)`.
- Los dos `.env.example` divergen. El de API omite cifrado/CORS y contiene un secreto JWT fijo de ejemplo que no debe copiarse; el de raíz presenta un host/puerto de pooler que debe sustituirse por la cadena real del dashboard.
- La guía llama «directa» a una URL de pooler en modo sesión; son conexiones distintas, aunque ambas pueden servir en contextos apropiados. [Conexiones Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).
- La revisión 27 contiene fecha 2026-09-06, posterior a esta auditoría y al cierre 28–29. Conservar la historia y aclarar el error de fecha, sin inventar una cronología nueva.

**Cierre:** una guía canónica de instalación/release, ejemplos coherentes, sin secretos utilizables, y referencias claras al estado vigente. Esta auditoría no borra aprobaciones previas.

## 5. Mejoras que deben tener alcance limitado

| Mejora | Prioridad / condición |
|---|---|
| Carga y coste de polling | Antes del piloto, medir concurrencia acordada; antes de ampliar, establecer capacidad máxima. Hay ciclos de 3 s: un consumidor activo equivale aproximadamente a 1.200 ciclos/hora, sin contar duración de petición, backoff, pestañas ocultas ni otras llamadas. No es una estimación de factura. |
| PIN, baja y recuperación de operadores | Antes del piloto, procedimiento verificable para pérdida de PIN, duplicados y retiro de acceso. Las rutas Staff actuales ofrecen login/listado/alta; no asumir autoservicio de recuperación. |
| Móvil y audio | Antes del piloto, Safari/Chrome, permiso de audio, regreso de segundo plano, bloqueo de pantalla y pérdida de Wi-Fi. Mantener dispositivo de salón atendido y fallback manual. No prometer push/offline: no se encontró registro de service worker en el código fuente revisado. |
| Headers de seguridad y privacidad | Definir CSP compatible, frame-ancestors, referrer policy y no-cache donde corresponda; verificar URL QR y tokens en logs. |
| Datos acumulados | Definir retención y limpieza revisada de RateLimitBucket/sesiones/eventos; no se observa limpieza periódica en el servicio de abuso. |
| Accesibilidad y experiencia | Recorrido de login, carta, pedido y atención: teclado, foco, contraste, errores, carga y texto legible; no abrir un rediseño general. |
| Activos y mensajes comerciales | Revisar derechos de imágenes y descripciones; no anunciar pagos, recompensas o disponibilidad instantánea que el piloto no entrega. |

## 6. Arquitectura recomendada

**Conservar Vercel + Supabase para el primer staging/piloto**, condicionado a F01–F10 y a mediciones. GitHub almacena y revisa el código; Vercel ejecuta API y sirve frontends; Supabase provee PostgreSQL. Son funciones complementarias.

| Pieza | Destino propuesto | Motivo |
|---|---|---|
| Código y CI | Repositorio privado GitHub | Trazabilidad, checks y release por commit. |
| Backend | Proyecto Vercel en raíz, runtime Node | Ya existe Fastify + adaptador; no usar Edge con este diseño. |
| Cliente, Staff, Admin | Tres proyectos Vercel Vite | Ya existen apps y configuraciones SPA separadas. |
| Persistencia | Supabase PostgreSQL separado por ambiente | Historial Prisma PG ya preparado; pooling para funciones. |
| IA, realtime externo, Redis | No agregar inicialmente | IA y SSE apagados; abuso y snapshots se apoyan en PostgreSQL. |

[Vercel soporta múltiples proyectos desde un monorepo](https://vercel.com/docs/monorepos). Habilitar acceso a fuentes fuera del root en los frontends por `@mesaya/shared` y revisar los comandos desde cada directorio. [Configuración de monorepos](https://vercel.com/docs/monorepos/monorepo-faq).

No migrar ahora a Next.js, Supabase Auth o Supabase Realtime sólo por desplegar. Si el ensayo muestra costes inadecuados por polling, problemas del adaptador o necesidad de conexiones persistentes, evaluar una API Node persistente conservando Fastify/Prisma y los frontends. Esa alternativa necesita su propio empaquetado, operación y verificación; no está implementada ni presupuestada aquí.

Para uso comercial, presupuestar un plan Vercel apto: Hobby se limita a uso personal no comercial según [su documentación](https://vercel.com/docs/plans/hobby). Incluir PostgreSQL, backups/PITR si se requiere, compute del segundo ambiente, dominio, logs y consumo. No se estima un importe cerrado sin carga, cuentas ni plan escogido.

## 7. Qué significa terminar desarrollo para este piloto

Cerrar F01–F10 con evidencia, preparar un commit reproducible, recorrer el flujo real en staging, restaurar un backup y asignar responsables. Después operar un local con límites medidos y registrar incidentes. No hace falta habilitar capacidades fuera del piloto; sí hace falta que los errores iniciales puedan detectarse, contenerse y recuperarse sin perder pedidos ni acceso.

El siguiente documento convierte este diagnóstico en tareas: [PLAN-SALIDA.md](PLAN-SALIDA.md).

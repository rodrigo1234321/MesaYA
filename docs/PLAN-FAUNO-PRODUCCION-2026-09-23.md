# Fauno Olavarría — plan de integración y publicación

Fecha: 2026-09-23. Estado: **plan verificable; producción Fauno pendiente**.

## Evidencia y frontera

- Código canónico de MesaYA completo: `main` en `7c024fa6e9aa724c58dfd52cb31ff134ab639797`. Los worktrees históricos de Fauno (`codex/fauno-table-integration` en `6c2bc74` y `codex/fauno-olavarria-demo` en `e9b4384`) ya son ancestros de `main`; no se vuelven a fusionar.
- El manifiesto `deploy/mesaya-canonical-manifest.json` registra la producción **MesaYA piloto** en `475e9870fef3985613cb9f8df6ac89d61f814e06`. Ese SHA no certifica el despliegue Fauno.
- Carta estable existente: <https://fauno-olavarria-menu-demo.vercel.app/>. Proyecto Vercel comprobado: `prj_fam5JBiRiP0krL3ssH5e6vY5Qpxx`; despliegue observado: `dpl_8aToDadxnG5vD2oqbDU7rrzx8Tkk`. La URL y `/carta/fauno-olavarria` responden HTTP 200. <https://fauno-olavarria-demo.vercel.app/> responde 404; no se usa como destino de publicación.
- El JSON servido por la carta estable contiene 26 categorías y 144 ítems; sus nombres coinciden con el catálogo local `data/fauno/catalog.json`. Esta coincidencia no demuestra disponibilidad, precios vigentes ni importación a base de datos.
- La API canónica responde 404 a `/v1/restaurants/fauno-olavarria/menu`. `/v1/restaurants/mesaya-piloto/menu` sirve 3 categorías y 5 ítems piloto. No se debe renombrar ni reemplazar ese restaurante para habilitar Fauno.
- `apps/client-web/app.js` usa JSON estático y IDs sintéticos sólo para la carta pública Fauno; esos IDs bloquean pedidos. La mesa activa obtiene catálogo e IDs desde la API. `TableSession` es dueño del borrador compartido; `syncSocialCart` no admite apagado. Ya existen endpoints de liquidación por sesión con split y una vista de servicio para el mozo.
- No hay token de autenticación Supabase disponible en este hilo ni está verificado el proyecto Supabase exclusivo de Fauno. No se registra ni solicita un secreto en este documento. La autorización para desplegar a Supabase y Vercel ya fue dada, pero la ejecución en nube requiere credenciales y mapeo exacto disponibles en el entorno autorizado.

### Inventario F0 de Vercel (verificado en esta ejecución)

| Función | Proyecto | Estado |
| --- | --- | --- |
| Carta/client Fauno existente | `prj_fam5JBiRiP0krL3ssH5e6vY5Qpxx` | Framework Vite, Node 22.x, raíz `apps/client-web`; alias estable activo, despliegue observado `dpl_8aToDadxnG5vD2oqbDU7rrzx8Tkk`; sólo carta estática comprobada |
| API Fauno | `prj_cPUkJFneEYrUP0hvOgEOe1ssqRPW` | Framework Fastify, Node 22.x, raíz del repositorio; proyecto configurado pero sin despliegue ni variables de entorno Fauno |
| Staff Fauno | `prj_JtU0iQNYGR8U2xXBmcJWHhV6gALy` | Framework Vite, Node 22.x, raíz `apps/staff-panel`; proyecto configurado pero sin despliegue ni variables de entorno Fauno |
| Admin Fauno | `prj_9032FFCVRIGwLnBkwA2NVlZVAZXn` | Framework Vite, Node 22.x, raíz `apps/admin-dashboard`; proyecto configurado pero sin despliegue ni variables de entorno Fauno |

La lista de proyectos de Supabase CLI falló con `LegacyPlatformAuthRequiredError`: no hay sesión CLI ni `SUPABASE_ACCESS_TOKEN`. El navegador CUA tampoco estuvo disponible. Por eso no se identificó una base Fauno ni se pudo comprobar respaldo, migraciones o separación real de datos. OpenCode produjo un manifiesto provisional sin secretos, con etiqueta de release `fauno-olavarria-preflight-2026-09-23` y `parentRelease=7c024fa` como base. El SHA de despliegue se registrará después del commit, externamente al manifiesto provisional. OpenCode corrigió en el plan de provisión una dependencia falsa: el split de cuenta no exige integrar Mercado Pago. La revisión posterior de Sol confirmó el límite operativo del catálogo descrito abajo. Estas revisiones y el manifiesto son evidencia de código/plan, no de instalación ni funcionamiento en nube.

### Evidencia local del preflight

- Pruebas de catálogo: **24/24**; pruebas de instancia: **7/7**; API enfocada: **59/59**.
- Suite completa: **1009 pasaron, 3 omitidas**. Builds de cliente y staff pasaron; matriz de rutas: **115**; paridad de esquema y build PostgreSQL pasaron.
- El esquema Prisma SQLite local quedó restaurado tras la verificación. Estos resultados no prueban el esquema Supabase remoto ni los flujos de dispositivos reales.
- Revisión OpenCode y revisión Sol: **14 ítems conservan elecciones o precio sin resolver**. Deben permanecer visibles para consulta, pero no se pueden pedir ni desde cliente ni desde staff hasta que el local defina el producto y exista el flujo de variante/cotización que represente el precio real. No asignar un precio ficticio para hacer pasar una prueba.

**Decisión de arquitectura:** Fauno es una instalación por local, con base Supabase y configuración/proyectos Vercel propios. Se reutiliza el código MesaYA completo en un SHA trazable. No se modifica la base, proyecto, alias ni datos de `mesaya-piloto`. La carta estable se conserva durante toda la transición; su contenido informativo sigue disponible aunque falle la API operativa.

## Fichas y dependencias

Cada ficha produce un commit o acta de evidencia pequeña. Un solo escritor por área y worktree aislado desde el SHA canónico; el arquitecto revisa los diffs y las pruebas sin escribir simultáneamente en esos archivos. Los agentes GPT-6 Luna pueden ejecutar F1–F3. OpenCode/Muse Spark 1.3 sólo si está disponible y su salida se puede inspeccionar con el mismo gate. JEV es señal auxiliar, nunca prueba de funcionamiento.

### F0 — Identidad, inventario y recuperación

**Estado: PARCIAL. Dueño:** arquitecto; inventario, provisión acotada y evidencias. **Depende de:** nada. **Salida:** mapa de proyecto Supabase Fauno, proyectos Vercel API/client/staff/admin Fauno, alias, deployment IDs, SHA de origen, variables por nombre, migraciones aplicadas, restaurante, mesas, usuarios y estado de datos. Los cuatro proyectos Vercel tienen framework, Node y raíz configurados; API, staff y admin aún no tienen despliegue ni variables de entorno Fauno. El proyecto client existente no se actualiza antes de cerrar los gates.

Obtener backup verificable de la base Fauno, registrar tamaño, hash, fecha y alcance; restaurarlo en una base aislada y ejecutar una consulta de integridad/contadores. Ensayar allí la migración pendiente y su recuperación. Nunca usar `seed`, `db push`, borrado ni reset sobre datos reales. Si Fauno aún no tiene base/proyecto, registrar esa ausencia y provisionar únicamente recursos Fauno cuando estén disponibles las credenciales.

**Próximos gates exactos:** (1) autenticar un canal autorizado de Supabase sin exponer credenciales y obtener el `projectRef` Fauno; si no existe, crear una base Fauno separada; (2) comprobar que ninguna variable `DATABASE_URL`/`DIRECT_URL` de los proyectos Fauno apunta al proyecto piloto, sin mostrar valores; (3) inspeccionar esquema, migraciones, restaurante y conteos; (4) generar backup Fauno con hash y ejecutar restore y migración en aislamiento; (5) integrar el manifiesto provisional sólo tras revisión de diff y registrar su SHA de commit; (6) cargar y comprobar variables por nombre y dominios de API/staff/admin antes del primer despliegue. Sin esos gates no hay importación ni despliegue operativo. Framework y raíz configurados no equivalen a servicios Fauno activos.

### F1 — Catálogo y módulos en base Fauno

**Dueño:** Luna de datos/API; único escritor de `scripts/import-fauno-catalog.mjs`, archivos de catálogo Fauno y pruebas de importación; cambios en `packages/api` sólo si una prueba reproduce un defecto. **Depende de:** F0.

Conciliar categoría, nombre, precio, disponibilidad, imagen y `externalId` de los 144 ítems con la carta existente y decisiones confirmadas por el local. Los 14 ítems con precio o elección pendiente permanecen visibles y no ordenables en cliente ni staff; necesitan decisiones de producto y flujo de variante/cotización antes de activarse. No activar promociones de condiciones no confirmadas. Ejecutar importación seca y luego real en la copia restaurada, repetirla para demostrar idempotencia y revisar altas, actualizaciones y bajas. Configurar `allowOrdering`, `allowSplitBill`, validación de comandas y permisos del mozo para Fauno; `syncSocialCart` permanece canónico. Probar migraciones en la copia antes de producción.

**Gate:** API Fauno devuelve 26 categorías/144 ítems con IDs reales y configuración esperada; ninguna fila piloto cambió; diff de datos y rollback ensayados. Sólo entonces aplicar migración/importación a Supabase Fauno y guardar conteos antes/después.

### F2 — Carta estable y dos comensales

**Dueño:** Luna cliente; único escritor de `apps/client-web` y sus pruebas. **Depende de:** F1 en entorno aislado. **Salida:** carta pública accesible en los links actuales y rutas de mesa que usan API Fauno con sesión real, sin fallback sintético para pedidos.

Probar con dos clientes independientes en la misma mesa: ambos ven el mismo borrador, agregan y quitan sin perder cambios, reciben el mismo total, envían una sola tanda con clave de idempotencia y ven la cuenta acumulada. Cubrir sesión cerrada/expirada, menú temporalmente inaccesible y recarga. La carta pública permanece informativa cuando no hay sesión válida.

**Gate:** pruebas API y navegador de dos clientes con evidencia de IDs, versiones/estados y ausencia de duplicados; el enlace estable y sus rutas siguen dando 200. No publicar un botón de pedido si la API Fauno aún da 404.

### F3 — Mozo, split y cierre de mesa

**Dueño:** Luna staff; único escritor de `apps/staff-panel`. Un defecto probado en API se asigna a un segundo escritor dueño exclusivo de los archivos afectados en `packages/api`; nunca edición simultánea. **Depende de:** F1 y F2.

Verificar que el mozo ve mesa, llamada, borrador/tanda, estado de cocina, cuenta y saldo; puede validar o rechazar según configuración, cobrar partes de la cuenta y continuar servicio. Probar split fijo, porcentual y en partes iguales, pagos parciales, reintentos idempotentes y rechazo de cierre con saldo o borrador pendiente. No usar el endpoint legado de pago por pedido para un flujo nuevo.

**Gate:** cuenta antes/después y liquidaciones reconciliadas en centavos, sin cobro duplicado ni cierre prematuro; pruebas automatizadas relevantes y recorrido de navegador del panel.

### F4 — Revisión independiente y publicación

**Dueño:** arquitecto/revisor independiente; único integrador. **Depende de:** F0–F3 aprobadas. Revisar commits, seguridad, aislamiento por restaurante, diffs de datos, pruebas y backup/restore. Ejecutar en orden los checks enfocados y `npm run build:pg` (las tareas Prisma se ejecutan secuencialmente en Windows). Guardar SHA exacto, comandos, resultados y límites.

Publicar primero API y frontends Fauno en preview, probar navegador → API → Supabase → mozo → split. Luego aplicar migración/importación Fauno y promover despliegues verificados preservando los alias existentes. Registrar proyecto/deployment ID, URL, SHA, hora, variables por nombre, respuestas HTTP y conteos de base. Observar errores y capacidad de revertir antes de declarar servicio disponible.

**Rollback:** conservar deployment anterior y backup previo. Si falla un flujo, retirar la funcionalidad operativa o volver al deployment anterior de Fauno; restaurar datos únicamente con el procedimiento ensayado y tras comparar escrituras posteriores para no perder pedidos reales. Mantener la carta informativa estable. Nunca apuntar un alias Fauno a piloto.

## Estado de evidencia requerido

| Capa | Evidencia para cerrar | Estado actual |
| --- | --- | --- |
| Código local | SHA, tests enfocados, build, revisión independiente y diff | Preflight local: catálogo 24/24, instancia 7/7, API 59/59, suite 1009 pasaron/3 omitidas, builds, rutas 115, esquema y PG build; SHA de release posterior al commit pendiente |
| Nube Fauno | Proyecto Supabase exacto, backup/restore, migraciones, menú API, despliegues y alias | F0 parcial: cuatro proyectos Vercel configurados; API/staff/admin sin despliegue ni variables Fauno; Supabase no autenticado; API Fauno devuelve 404 |
| Operación humana/física | QR/NFC real, dos teléfonos en mesa, red del local, mozo, cocina, cobro y aceptación del local | Pendiente; ninguna prueba local o HTTP la sustituye |

La publicación sólo se declara terminada cuando las tres capas tienen evidencia identificable. Un HTTP 200 de la carta estática y las pruebas sobre MesaYA piloto no certifican Fauno operativo.

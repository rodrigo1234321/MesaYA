# Contexto técnico de partida

Fecha del plan: 2026-09-03. No es un certificado de producción. Revalidar cada hallazgo al iniciar su ficha; el código puede cambiar entre revisiones.

## Producto y arquitectura observados

Monorepo npm: API Fastify/Prisma, contratos y FSM en shared, cliente web JS, paneles staff/admin React, generación QR y documentación NFC. Persistencia local SQLite y schema alternativo PostgreSQL/Supabase. SSE usa un bus en memoria de proceso.

Hay flujos reales de menú, llamados, personal, mesas, turnos, pedidos/cocina, plano/FSM, lista de espera y analítica. Su existencia no implica aislamiento, atomicidad o readiness operacional. Pagos/split y recomendaciones IA tienen comportamientos que deben restringirse.

## Evidencia de la revisión previa

- La carpeta no tenía .git propio; Git resolvía C:/Users/rodri. No se debe versionar indiscriminadamente el home.
- Build de API presentaba 12 diagnósticos TypeScript asociados principalmente a campos faltantes del tipo FloorPlanUpdateItem y success duplicado. Builds frontend no prueban build de API.
- Se observaron 52 tests pasando en 3 archivos en la revisión previa; posteriormente se detectó que las fixtures modifican datos demo. NO representan 52 pruebas de seguridad ni un gate seguro reutilizable.
- SQLite validaba. Validación PG quedaba impedida por DIRECT_URL ausente: eso no prueba que el schema PG sea inválido, ni que producción funcione.
- No se encontró historial de migraciones ni CI propio del proyecto. package-lock.json existe pero estaba ignorado.
- schema.supabase.prisma carecía de mergedWithTableId presente en SQLite.

Estos resultados son antecedentes, NO ejecuciones nuevas de este turno de planificación. En este turno sólo se inspeccionaron archivos y se crearon documentos.

## Riesgos y correspondencia con fichas

| Hallazgo | Evidencia de entrada | Fichas |
|---|---|---|
| Tests/seed pueden modificar la demo | packages/api/test/full-system-e2e.test.ts; prisma/seed.ts | 00–01 |
| Contratos y orden build inconsistentes | shared/rtms-types.ts; rtms-schemas.ts; floorplan.routes.ts; package.json | 02 |
| payEqualPart crea APPROVED sin proveedor | order.service.ts; orders.routes.ts | 03, 15 |
| IA usa credenciales ajenas como fallback y recomienda sin respaldo | ai.service.ts | 04, 20 |
| Fallback de secretos, JWT sin vencimiento, CORS abierto | index.ts; lib/crypto.ts; auth.routes.ts; staff.routes.ts | 05 |
| Alta staff y rutas sensibles sin guard/tenant homogéneo | middlewares/auth.middleware.ts; routes | 06–11 |
| QR/GET puede crear mesa, turno y sesión; aliases demo | session.service.ts; sessions.routes.ts | 12 |
| Permisos/sesión de llamadas y feedback a unificar | calls.routes.ts; feedback.routes.ts | 13 |
| Pedidos aceptan referencias/cambios sin invariantes suficientes | order.service.ts; orders.routes.ts | 14–15 |
| Lista de espera y flags requieren cierre | waitlist.routes.ts; waitlist.service.ts | 16 |
| Stream no valida token y difunde datos del restaurante; bus sólo local | stream.routes.ts; eventBus.ts | 17–18 |
| Datos de menú/IA se interpolan en innerHTML | apps/client-web/app.js | 19 |
| Runtime Tailwind CDN, recursos externos y selector demo | apps/client-web/index.html; styles.css | 21 |
| PG y build deployment sin camino reproducible completo | schemas Prisma; vercel.json; api/index.ts | 22–23, 27 |
| Apertura/rotación multioperación y carreras de llamados | shift.service.ts; session.service.ts; call.service.ts | 24–25 |
| Plano masivo puede perder/eliminar datos y sobrescribir cambios | floorplan.service.ts | 26 |

Rutas abreviadas de API en esta tabla se resuelven bajo packages/api/src salvo Prisma y package.json raíz.

## Diferencias con el informe pegado y la documentación

El informe del usuario es un insumo de diagnóstico, no una orden de ejecutar sus fixes literalmente ni una fuente más actual que el código.

- «Sólo agregar middleware» no alcanza: hacen falta tenant, ownership, expiración, roles y transiciones de negocio.
- Capturas/demo no certifican recorrido real. Las pruebas que esperan pago simulado deben cambiar su contrato.
- XSS en contenido de menú/IA no debe clasificarse automáticamente como self-XSS.
- 52 tests verdes no implica cobertura de permisos ni de PostgreSQL distribuido.
- «Menos de 100 KB» del núcleo no implica ese peso total incluyendo CDN/fuentes/imágenes.
- QR fijo y geofence no prueban presencia física.
- Modelos de datos para pagos/rewards/preorden no prueban implementación integral.

## Incertidumbres que siguen abiertas

Estado del despliegue remoto, datos reales existentes, credenciales/infraestructura, carga esperada, política de cobro presencial y grado de riesgo aceptable del QR fijo. No se accedió a producción para resolverlas.

El roadmap propone decisiones de piloto. Rodrigo/Codex las revisan antes de desbloquear cada ficha; si el supuesto resulta falso, corregir la ficha antes de pedir ejecución.

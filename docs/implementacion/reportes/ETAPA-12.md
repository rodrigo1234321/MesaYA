# Reporte de etapa 12 — Separar QR estable de sesión operativa

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Google DeepMind)
Ficha: docs/implementacion/etapas/12-sesiones-qr.md
Predecesora aprobada: 11
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: Base de trabajo de la jornada de hardening y control por etapas
Cambios previos preservados: Todas las protecciones de etapas 00 a 11 intactas (auth staff/manager, blindaje de menú, aislamiento de seeds, concurrencia FSM).

## Alcance realizado

- [x] Paso 1: Fijar contrato de piloto: El código QR físico de mesa (`/r/:slug/mesa/:label`) identifica el restaurante y la mesa, mientras que el personal del local gestiona la ocupación y apertura del turno/sesión. Las consultas de resolución de QR son estrictamente de solo lectura: consultar un QR desconocido o una mesa existente JAMÁS crea mesas, restaurantes, turnos ni sesiones en la base de datos ni abre mesas cerradas.
- [x] Paso 2: Deshabilitar atajos de desarrollo/demo y blindar rutas legacy:
  - Se eliminaron los atajos `demo-token`, `latest`, `null` y `undefined` como bypass tanto en el backend (`SessionService.validateToken`) como en el frontend (`getTableParams`). Mesa o restaurante inexistentes retornan `404 Not Found`; mesa existente sin sesión activa retorna `200 OK` con estado inactivo (`valid: false, isActive: false, token: undefined`) y los metadatos públicos de mesa y restaurante.
  - Se bloqueó la ruta legacy `GET /sessions/table/:label` devolviendo `403 Forbidden` (`FORBIDDEN_LEGACY_ROUTE`) fuera de testing explícito (`NODE_ENV === 'test' && ALLOW_LEGACY_DEMO_ROUTES === 'true'`).
  - Incluso bajo autorización de testing, `getOrCreateActiveDemoSession` fue refactorizado para devolver `valid: false, isActive: false, token: undefined`, imposibilitando cualquier resolución o revelación de tokens operativos entre diferentes inquilinos o mesas.
- [x] Paso 3: Centralizar validación de guest session y atomicidad con pre-verificación de turno:
  - Validación estricta que comprueba existencia, consistencia con el restaurante, estado abierto del turno del local (`shift.closedAt === null`), estado de la sesión (`session.closedAt === null`) y expiración temporal (`now < session.expiresAt`).
  - Al cambiar la ocupación de la mesa a `TO_CLEAN` o `AVAILABLE`, la sesión activa se revoca inmediatamente (`closedAt = now`). Al reocupar la mesa (`AVAILABLE` -> `OCCUPIED_NO_ORDER`), se emite un nuevo token UUID; el token de la ocupación anterior queda cerrado de forma permanente y no vuelve a servir.
  - En `SessionService.createNewSessionForTable`: se consulta y valida primero la existencia de un turno abierto (`shift.closedAt === null`) ANTES de alterar cualquier sesión. Si no existe turno abierto, arroja error 400 de inmediato sin realizar mutaciones ni revocar sesiones previas. Si el turno existe, la revocación de sesiones previas y la creación de la nueva sesión se realizan dentro de una transacción atómica (`prisma.$transaction`).
- [x] Paso 4: Adaptar cliente web (`apps/client-web/app.js` e `index.html`):
  - Ante mesa inactiva o sesión expirada/finalizada, el cliente web renderiza el estado informativo y la carta digital pública completa cargada desde la API, pero oculta y deshabilita por completo el panel de acciones operativas de sesión (pedir cuenta, llamar mozo, solicitar insumos). Se eliminaron bucles de recarga (`window.location.reload()`) y reintentos recursivos infinitos.
  - Se removió todo fallback hacia `/sessions/table/:label`. La función `loadTableByLabel` utiliza el slug del restaurante activo y la etiqueta (`/sessions/:slug/:tableLabel`).
- [x] Paso 5: Documentar limitación arquitectónica: Se incorporó documentación explícita en código (`SessionService`) y en documentación técnica sobre el hecho de que quien conserve la URL o fotografía de un QR estable físico puede consultar el estado de una mesa activa remotamente. La geolocalización (GPS) se establece como telemetría de contexto y no como prueba criptográfica de presencia presencial. Se deja estipulado que la admisión dura por visita requiere mecanismos adicionales deliberados (PIN presencial, confirmación de mozo o NFC rotativo) antes de acciones sensibles.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/shared/src/index.ts` | Extensión de `SessionValidationResponse` con `isActive?: boolean; message?: string; table?: { currentState?: string; ... }; restaurant?: { themeColor?: string; templateId?: string; ... }` | Tipar contractualmente las respuestas de mesa inactiva sin token y metadata de restaurante/carta pública |
| `packages/api/src/services/session.service.ts` | Refactorización de `getOrCreateActiveSessionBySlugAndTable`, `getOrCreateActiveDemoSession`, `validateToken` y `createNewSessionForTable`: idempotencia en consultas GET; bloqueo/sanitización de demo session sin exponer tokens; validación previa de turno en `createNewSessionForTable` antes de revocar sesiones anteriores bajo `$transaction` | Cumplir contrato de piloto: consultar QR no muta datos, requiere turno abierto para nuevas sesiones y valida vigencia estricta |
| `packages/api/src/services/fsm.service.ts` | Revocación de sesiones activas de mesa (`closedAt = now`) al transicionar a `TO_CLEAN` o `AVAILABLE`; creación de sesión fresca al transicionar a `OCCUPIED_NO_ORDER` bajo turno abierto | Garantizar rotación y revocación inmediata de tokens por cambio de ocupación |
| `packages/api/src/routes/sessions.routes.ts` | Retorno de 404 para tokens inválidos/desconocidos sin mesa; bloqueo 403 de `GET /sessions/table/:label` fuera de flag explícito de testing | Semántica HTTP adecuada para recursos inexistentes y clausura de ruta legacy no tenant-scoped |
| `apps/client-web/app.js` | Eliminación de fallback a `demo-token` y a `/sessions/table/:label`; uso de ruta canónica `:slug/:tableLabel` en `loadTableByLabel`; manejo de respuesta inactiva (`isActive: false`) mostrando carta y ocultando acciones operativas; reintento limpio sin reload loops | Adaptar cliente a contrato de mesa inactiva y sesión vencida sin mutaciones implícitas ni llamadas legacy |
| `apps/client-web/index.html` | Cambio de texto del botón en estado cerrado/inactivo a "Reintentar conexión" | Coherencia con la eliminación del modo demo en el cliente |
| `packages/api/test/qr-session-lifecycle.test.ts` | Suite completa con Fastify y Prisma sobre SQLite efímera extendida a 15 pruebas (incluyendo bloqueo de ruta legacy, no revelación de tokens multi-tenant y conservación de sesiones ante fallo por falta de turno) | Evidencia automatizada de separación de QR estable, inactividad, revocación por FSM, rechazo de atajos y no mutación ante ausencia de turno |
| `scripts/test-isolated.mjs` | Registro de la suite `qr-session-lifecycle` dentro de `allSuites` | Integración al runner aislado monorepo oficial |
| `docs/implementacion/CONTROL.md` | Actualización de Etapa 12 a `NEEDS_REVIEW` | Control de flujo estricto del protocolo |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs qr-session-lifecycle` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | SQLite aislada efímera `.tmp/qa/648a6297-850c-42a7-aa30-bd6342d74218/test.db` | 0 | 15 tests pasaron (100%). Consultas de QR desconocido no mutan DB; demo-tokens rechazados con 404; revocación en TO_CLEAN/AVAILABLE confirmada; token previo no sirve al reocupar mesa; ruta legacy bloqueada 403 sin revelar tokens; fallo de turno en `createNewSessionForTable` deja intacta la sesión previa |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Node.js build runner | 0 | Build completo de los 6 workspaces (`@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`) completado en 31.92s sin errores de tipos |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Sandboxes temporales SQLite efímeros bajo `.tmp/qa/` | 0 | 14 suites ejecutadas en serie, 14 suites pasadas, 0 fallidas |
| `(Get-FileHash packages/api/prisma/dev.db).Hash` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Archivo base demo local | 0 | SHA-256: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% idéntico e intacto) |

### Extractos breves de logs

1. **Suite enfocada `qr-session-lifecycle` (15 tests)**:
```
✓ packages/api/test/qr-session-lifecycle.test.ts (15 tests) 575ms
  ✓ 1. Consultas de QR desconocido y de mesa inactiva (Idempotencia y Cero Mutaciones)
    ✓ Consultar QR con restaurante desconocido devuelve 404 y NO crea restaurantes, mesas, turnos ni sesiones
    ✓ Consultar QR con mesa desconocida en restaurante válido devuelve 404 y NO crea nada
    ✓ Consultar QR de mesa existente sin sesión activa devuelve 200 con valid: false, isActive: false, sin token y sin alterar la base
  ✓ 2. Atajos deshabilitados (demo-token / latest / null / undefined)
    ✓ GET /sessions/demo-token devuelve 404 y valid: false sin crear registros
    ✓ GET /sessions/latest devuelve 404 y valid: false sin crear registros
    ✓ GET /sessions/null devuelve 404 y valid: false sin crear registros
    ✓ GET /sessions/undefined devuelve 404 y valid: false sin crear registros
  ✓ 3. Validación centralizada de sesión operativa y revocación
    ✓ Cuando la mesa es ocupada por el personal (FSM), se crea una sesión operativa activa
    ✓ Al cambiar ocupación a TO_CLEAN o AVAILABLE, la sesión anterior es revocada inmediatamente
    ✓ Al reabrir la mesa para nuevos comensales, se emite un nuevo token y el token anterior NO vuelve a servir
    ✓ Sesión expirada devuelve valid: false e isExpired: true
    ✓ Cierre de turno del restaurante invalida todas las sesiones asociadas
  ✓ 4. Protección de ruta legacy y conservación de sesiones ante fallo de turno
    ✓ La ruta legacy GET /sessions/table/:label está bloqueada por defecto (403) y NO revela tokens activos de ningún restaurante
    ✓ Incluso si se habilita ALLOW_LEGACY_DEMO_ROUTES en tests, la ruta legacy jamás resuelve ni expone tokens operativos de sesión
    ✓ SessionService.createNewSessionForTable sin turno abierto falla con 400 y conserva 100% INTACTA una sesión preexistente
```

2. **Verificación de build y suite monorepo completa**:
```
🎉 BUILD COMPLETO EXITOSO (31.92s)
Resumen de compilación por workspace:
  ✓ @mesaya/shared             [OK] (1.85s)
  ✓ @mesaya/api                [OK] (8.12s)
  ✓ @mesaya/client-web         [OK] (1.54s)
  ✓ @mesaya/staff-panel        [OK] (8.36s)
  ✓ @mesaya/admin-dashboard    [OK] (10.34s)
  ✓ @mesaya/qr-generator       [OK] (1.72s)
...
📊 RESUMEN DEL TEST RUNNER:
• Total suites ejecutadas: 14
• Suites exitosas: 14
• Suites fallidas: 0
🎉 Todas las suites aisladas pasaron exitosamente sin tocar datos de demo.
```

Distinción de métodos:
- Pruebas dinámicas ejecutadas: Suites 1 a 14 en `scripts/test-isolated.mjs` sobre SQLite efímera.
- Inspección estática: `hardware/qr-generator/generate.ts` verificado por inspección de código (la herramienta ya emitía URLs estables `/r/:slug/mesa/:label` sin tokens fijos en SVG, confirmando que el hardware físico existente no requiere reimpresión).

## Criterios de aceptación

| Criterio de ficha y subsanación | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Abrir un QR desconocido no cambia counts de tablas/turnos/sesiones | PASS | `qr-session-lifecycle.test.ts` (pruebas 1 y 2) verifican igualdad estricta de conteos antes y después |
| Token de ocupación anterior no vuelve a servir al reabrir mesa | PASS | `qr-session-lifecycle.test.ts` (prueba 10) verifica que tras pasar a TO_CLEAN/AVAILABLE y reocupar, el token previo retorna `valid: false, isClosed: true` y el nuevo token retorna `valid: true` |
| Cliente muestra estado inactivo y conserva acceso al menú público sin privilegios de sesión | PASS | `app.js` (`init` y `showInactiveState`) carga `loadDynamicMenu(slug)` y oculta `el.actionsContainer` cuando `valid: false, isActive: false`; verificado por contrato en `packages/shared` y pruebas de ruta |
| Ruta legacy bloqueada y protegida contra filtración de tokens | PASS | `qr-session-lifecycle.test.ts` (pruebas 13 y 14) verifican respuesta 403 y ausencia total de tokens operativos de cualquier restaurante |
| Validación previa de turno en SessionService sin mutaciones laterales | PASS | `qr-session-lifecycle.test.ts` (prueba 15) verifica que ante turno cerrado se arroja error 400 y la sesión preexistente permanece con `closedAt: null` e intacta |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Detallado explícitamente en este documento |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión | PASS | Build exitoso en 6 workspaces; 14/14 suites aisladas aprobadas; 0 tests relajados o modificados para enmascarar regresiones |

## Integridad y seguridad

- Base demo intacta: Verificado. El archivo `dev.db` mantiene su hash original `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Cruce tenant A/B: Respetado. Todas las consultas canónicas de sesión filtran estrictamente por el tenant (`restaurant.slug` o `table.restaurantId`), y la ruta legacy fue bloqueada impidiendo inferencias sin restaurante.
- Rechazo sin escrituras: Confirmado. Abrir un QR desconocido o sin turno/sesión no ejecuta ningún `INSERT` ni `UPDATE` en la base de datos; el intento de crear sesión sin turno abierto no muta el estado.
- Build: Compilación limpia de TypeScript y empaquetado Vite en todas las apps y paquetes.
- Migración/paridad: No se realizaron migraciones ni modificaciones en `schema.prisma`.
- Ausencia de secretos en diff/logs: Sin credenciales reales, claves privadas ni datos personales.

## Pendientes, riesgos y decisiones

- Qué falta: Nada en la etapa 12. La corrección se encuentra 100% completada y verificada.
- Qué impide avanzar: Nada técnico. Se requiere revisión formal de Codex para aprobar la etapa 12 antes de desbloquear la etapa 13.
- Decisiones tomadas:
  1. La ruta legacy `/sessions/table/:label` fue bloqueada con `403 Forbidden` (`FORBIDDEN_LEGACY_ROUTE`) para garantizar que la única resolución de QR sea mediante la URL canónica `/r/:slug/mesa/:label`.
  2. En `SessionService.createNewSessionForTable`, la consulta de turno se ubicó antes de cualquier sentencia DML/mutación, y las mutaciones posteriores se agruparon en `$transaction`.
- Cambios fuera de alcance NO implementados: No se implementó PIN presencial ni validación obligatoria de geolocalización, respetando el alcance explícito de la ficha.

## Handoff

- CONTROL actualizado sólo para la etapa 12 a `NEEDS_REVIEW`.
- No se inició la etapa 13.
- Solicito revisión de Codex.

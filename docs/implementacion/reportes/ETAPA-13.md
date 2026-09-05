# Reporte de etapa 13 — Validar llamados, feedback y lecturas privadas

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (Google DeepMind)
Ficha: docs/implementacion/etapas/13-llamados-feedback.md
Predecesora aprobada: 12
Ruta del proyecto: C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas
Commit de base o manifiesto: Base de trabajo de la jornada de hardening y control por etapas
Cambios previos preservados: Todas las protecciones de etapas 00 a 12 intactas (auth staff/manager, blindaje de menú, aislamiento de seeds, concurrencia FSM, separación QR/sesión).

## Alcance realizado y subsanaciones de revisión Codex

- [x] Paso 1: Validación de sesión activa para acciones de comensal/invitado:
  - En `POST /v1/calls`, se comprueba que el `sessionToken` pertenezca a una sesión de mesa existente, no cerrada (`closedAt === null`), no expirada (`now < expiresAt`) y con turno del restaurante abierto (`shift.closedAt === null`). De lo contrario se rechaza con 404 (inexistente) o 410 (sesión cerrada, vencida o turno cerrado) sin crear filas.
  - En `POST /v1/calls/:id/cancel`, se comprueba la vigencia de la sesión y que el llamado pertenezca indefectiblemente a la sesión que solicita la cancelación. Sesiones ajenas reciben 404 (`Llamado no encontrado para esta sesión`) y sesiones cerradas/expiradas reciben 410.
  - En `POST /v1/feedback`, se comprueba la validez de la sesión activa y se rechaza de forma estricta con `410 SESSION_CLOSED` toda sesión con `closedAt !== null`, **sin ventana de gracia ni excepciones por ausencia de sesiones posteriores**, sin crear filas en base de datos.
- [x] Paso 2: Restauración de revocación inmediata en FSM (`TO_CLEAN` y `AVAILABLE`):
  - En `FSMService.attemptTransition`, se restauró el cierre inmediato de todas las `TableSession` activas (`closedAt: now`) al transicionar a `TO_CLEAN`.
  - La revocación se mantiene de forma **idempotente** también al transicionar a `AVAILABLE`, asegurando que ninguna sesión quede abierta tras el cambio de ocupación.
- [x] Paso 3: Aislamiento tenant y rol en lecturas y gestión de staff:
  - En `GET /v1/calls`, la ruta quedó protegida con el middleware `verifyStaffToken`. Se verifica que el `restaurantId` (o slug) solicitado pertenezca al mismo restaurante que el usuario staff en el JWT; cualquier intento de lectura cruzada (Staff A consultando llamados de Restaurante B) es rechazado con `403 Forbidden`.
  - En `PATCH /v1/calls/:id`, se verifica la pertenencia del llamado a la misma entidad del staff autenticado, rechazando intentos de modificación cruzada con `403 Forbidden`.
- [x] Paso 4: Derivación de actor staff desde JWT y minimización de datos:
  - En `PATCH /v1/calls/:id`, el actor se deriva estrictamente del claim `request.staffUser.sub`, descartando cualquier `staffUserId` o actor adulterado en el body de la petición.
  - Se minimizan los datos personales en respuestas de llamados y feedback: `CallEventData` y `Feedback` retornan únicamente identificadores operativos, mesa, sector, estado y marcas temporales, sin exponer números de teléfono, correos ni tokens de sesión de comensales.
- [x] Paso 5: Validación de enums, tamaños y repetición/deduplicación:
  - Validación de enums: `CallType` (`BILL`, `WAITER`, `SUPPLIES`, `CUSTOM`), `PaymentMethod` (`CASH`, `MERCADO_PAGO`, `CARD`, `NOT_APPLICABLE`), `CallOrigin` (`WEB_DIRECT`, `WHATSAPP_FALLBACK`) y `CallStatus` (`PENDING`, `IN_PROGRESS`, `RESOLVED`, `CANCELLED`). Los valores fuera de contrato retornan 400.
  - Validación de `rating` en feedback: se exige un número entero entre 1 y 5 (`Number.isInteger(rating) && rating >= 1 && rating <= 5`); cualquier otro valor retorna 400 (`INVALID_RATING`).
  - Restricción de longitud: nota de llamado limitada a 500 caracteres y comentario de feedback limitado a 1000 caracteres (retornan 400 si se exceden).
  - Deduplicación y reintentos: el feedback está indexado de forma única por sesión de mesa (`@unique`). Reintentar el envío con el mismo token devuelve `409 Conflict` (`FEEDBACK_ALREADY_EXISTS`) sin duplicar registros en la base de datos ni devolver éxito sobre recursos inexistentes.
- [x] Paso 6: Geolocalización como telemetría contextual no autorizante:
  - Si el comensal no otorga permisos GPS o el navegador no envía coordenadas (`latitude` / `longitude` omitidos), el llamado se procesa con total normalidad basándose en la sesión de mesa activa.
  - El geofence actúa únicamente como mitigación heurística de spam remoto para distancias excesivas (> 2 km) devolviendo 403 `GEOFENCE_EXCEEDED`.
  - Se documentó y comprobó mediante tests que enviar coordenadas GPS válidas NUNCA autoriza una sesión vencida ni cerrada (responde 410).

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/src/services/fsm.service.ts` | Restauración del cierre de todas las `TableSession` activas (`closedAt: now`) al transicionar a `TO_CLEAN`, manteniéndolo de forma idempotente en `AVAILABLE` | Subsanación de segunda revisión Codex: cumplimiento de la revocación inmediata de la Etapa 12 |
| `packages/api/src/services/feedback.service.ts` | Eliminación de ventana de gracia de 1 hora y de comprobación de sesiones posteriores; rechazo incondicional con `410 SESSION_CLOSED` cuando `session.closedAt !== null` | Subsanación de primera revisión Codex: contrato estricto de sesión activa para feedback |
| `packages/api/src/routes/calls.routes.ts` | Protección de `GET /calls` con `verifyStaffToken` y validación de tenant; validación de enums y límites de nota en `POST /calls`; derivación de actor staff en `PATCH /calls/:id`; validación de token en cancelación | Privacidad staff, tenant isolation y validación de inputs de llamados |
| `packages/api/src/services/call.service.ts` | Verificación de sesión activa y turno abierto en creación y cancelación; telemetría no bloqueante de geofence; prohibición de mutación de llamados entre tenants | Aislamiento estricto de sesión de comensal y personal |
| `packages/api/src/routes/feedback.routes.ts` | Validación de cuerpo, token de sesión y manejo de errores estandarizados con códigos | Tipado de contrato y respuestas HTTP de feedback |
| `packages/api/test/calls-feedback-access.test.ts` | Suite con 37 pruebas HTTP reales con `app.inject` y SQLite efímera; incluye la sección 7 que prueba que tras `TO_CLEAN`, el token anterior recibe 410 tanto en `POST /calls` como en `POST /feedback` con 0 filas creadas, consulta QR inactiva, e idempotencia en `AVAILABLE` | Evidencia automatizada A/B de validaciones, tenant isolation y rechazo estricto de sesiones cerradas tras `TO_CLEAN` |
| `packages/api/test/full-system-e2e.test.ts` | Secuenciación de comensal para emitir feedback durante su sesión activa antes del retiro y avance a `TO_CLEAN` por el mozo | Coherencia del flujo end-to-end con la revocación inmediata de tokens en `TO_CLEAN` |
| `scripts/test-isolated.mjs` | Registro de la suite `calls-feedback-access` dentro de `allSuites` | Integración al runner aislado monorepo oficial |
| `docs/implementacion/CONTROL.md` | Actualización de Etapa 13 a `NEEDS_REVIEW` | Control estricto de flujo del protocolo |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs calls-feedback-access` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | SQLite aislada efímera `.tmp/qa/b82b3c96-f268-49a8-854c-efa03c9a98f9/test.db` | 0 | 37 tests pasaron (100%). Token inexistente 404; sesión cerrada/expirada 410; sesión cerrada hace segundos (5s) rechazada con 410 SESSION_CLOSED y 0 filas creadas; token expirado rechazado con 410 SESSION_EXPIRED y 0 filas creadas; mesa reocupada 410; turno cerrado 410; llamado duplicado 429; enums y tamaños inválidos 400; cancelación cruzada impedida 404; GET /calls sin token 401; lectura/mutación staff cruzada 403; feedback duplicado 409; funcionamiento sin GPS 201; GPS > 2km 403; GPS no autoriza sesión vencida 410; **tras TO_CLEAN, POST /calls responde 410 sin filas; tras TO_CLEAN, POST /feedback responde 410 sin filas; consulta QR canónica devuelve inactivo sin token; idempotencia en AVAILABLE confirmada** |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/build.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Node.js build runner | 0 | Build completo de los 6 workspaces (`@mesaya/shared`, `@mesaya/api`, `@mesaya/client-web`, `@mesaya/staff-panel`, `@mesaya/admin-dashboard`, `@mesaya/qr-generator`) completado en 30.80s sin errores de tipos |
| `$env:MESAYA_BOUNDED_JOB = "1"; node scripts/test-isolated.mjs` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Sandboxes temporales SQLite efímeros bajo `.tmp/qa/` | 0 | 15 suites ejecutadas en serie, 15 suites pasadas, 0 fallidas (incluyendo `full-system-e2e` con 39 tests y `calls-feedback-access` con 37 tests) |
| `(Get-FileHash packages/api/prisma/dev.db).Hash` en `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas` | Archivo base demo local | 0 | SHA-256: `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` (100% idéntico e intacto) |

### Extractos breves de logs

1. **Suite enfocada `calls-feedback-access` (37 tests)**:
```
✓ packages/api/test/calls-feedback-access.test.ts (37 tests) 1942ms
  ✓ 1. Validación de sesión activa para creación de llamados
    ✓ Rechaza llamado con sessionToken inexistente o inválido (404)
    ✓ Rechaza llamado cuando la sesión ya fue cerrada (closedAt !== null) (410)
    ✓ Rechaza llamado cuando la sesión ha expirado (now > expiresAt) (410)
    ✓ Rechaza llamado si el turno del restaurante está cerrado (410)
    ✓ Permite llamado legítimo con sesión activa (201)
    ✓ Rechaza llamado duplicado concurrente sobre la misma mesa (429)
  ✓ 2. Validación de enums, tamaños y parámetros
    ✓ Rechaza tipo de llamado no reconocido en el enum (400)
    ✓ Rechaza pedido de cuenta (BILL) sin seleccionar medio de pago (400)
    ✓ Rechaza medio de pago inexistente en el enum (400)
    ✓ Rechaza nota de comensal que exceda 500 caracteres (400)
  ✓ 3. Cancelación de llamados y propiedad de sesión
    ✓ Imposibilita cancelar el llamado usando el token de OTRA sesión (404)
    ✓ Permite cancelar legítimamente el llamado con su sessionToken propietario (200)
    ✓ Cancelar un llamado ya cancelado responde de forma idempotente (200)
  ✓ 4. Aislamiento tenant y rol de staff en llamadas
    ✓ GET /v1/calls sin JWT de staff devuelve 401 Unauthorized
    ✓ Staff de Restaurante A NO puede leer llamados de Restaurante B (403 Forbidden)
    ✓ Staff de Restaurante B lee únicamente los llamados de su restaurante (200)
    ✓ Staff de Restaurante A NO puede modificar o atender llamados de Restaurante B (403 Forbidden)
    ✓ Staff de Restaurante B atiende su propio llamado (200) e ignora actor inyectado en body
    ✓ No se puede resucitar un llamado cancelado o resuelto (409 Conflict)
  ✓ 5. Feedback privado y protección contra duplicados y sesiones cerradas
    ✓ Rechaza feedback sobre sesión inexistente (404) y NUNCA devuelve éxito
    ✓ Rechaza feedback sobre sesión cerrada recientemente (hace segundos) con 410 SESSION_CLOSED y cero filas creadas
    ✓ Rechaza feedback sobre sesión con token expirado con 410 SESSION_EXPIRED y cero filas creadas
    ✓ Rechaza feedback con sesión cerrada antigua o token viejo (410)
    ✓ Rechaza feedback con token viejo cuando la mesa ya fue reocupada por nuevos comensales (410)
    ✓ Rechaza calificaciones no válidas (números menores a 1, mayores a 5 o no enteros) (400)
    ✓ Rechaza comentario que exceda 1000 caracteres (400)
    ✓ Acepta feedback válido con sesión activa y minimiza datos personales (201)
    ✓ Reintento normal NO duplica feedback y devuelve 409 Conflict
  ✓ 6. Geofence como señal no autorizante y funcionamiento sin GPS
    ✓ Preserva funcionamiento sin permiso GPS (coordenadas omitidas) (201)
    ✓ Permite llamado con coordenadas GPS dentro del radio del restaurante (201)
    ✓ Rechaza con 403 GEOFENCE_EXCEEDED cuando el GPS reporta distancia remota excesiva (> 2 km)
    ✓ Coordenadas GPS legítimas NUNCA autorizan una sesión vencida (410)
  ✓ 7. Revocación inmediata por transición FSM a TO_CLEAN y comprobación de QR
    ✓ Transicionar a TO_CLEAN revoca inmediatamente la TableSession activa con closedAt !== null
    ✓ Después de TO_CLEAN, POST /v1/calls con el token anterior responde 410 y no crea filas en base de datos
    ✓ Después de TO_CLEAN, POST /v1/feedback con el token anterior responde 410 y no crea filas en base de datos
    ✓ Después de TO_CLEAN, la consulta canónica de QR físico responde estado inactivo sin token
    ✓ Transición posterior a AVAILABLE es idempotente: closedAt permanece cerrado y QR inactivo
```

2. **Verificación de build y runner completo de 15 suites**:
```
🎉 BUILD COMPLETO EXITOSO (30.80s)
Resumen de compilación por workspace:
  ✓ @mesaya/shared             [OK] (1.95s)
  ✓ @mesaya/api                [OK] (6.77s)
  ✓ @mesaya/client-web         [OK] (1.56s)
  ✓ @mesaya/staff-panel        [OK] (8.20s)
  ✓ @mesaya/admin-dashboard    [OK] (10.73s)
  ✓ @mesaya/qr-generator       [OK] (1.60s)
...
📊 RESUMEN DEL TEST RUNNER:
• Total suites ejecutadas: 15
• Suites exitosas: 15
• Suites fallidas: 0
🎉 Todas las suites aisladas pasaron exitosamente sin tocar datos de demo.
```

Distinción de métodos:
- Pruebas dinámicas ejecutadas: Suites 1 a 15 en `scripts/test-isolated.mjs` sobre SQLite efímera con Fastify y Prisma.
- Inspección estática: Verificación de firmas de `StaffApi` en `apps/staff-panel/src/lib/api.ts` asegurando que envía cabeceras de autorización Bearer en `getActiveCalls` y `updateCallStatus`.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| Sesión vencida/cerrada no llama, cancela ni deja feedback autorizado por token viejo | PASS | `calls-feedback-access.test.ts` (pruebas 1.2, 1.3, 3.1, 5.2, 5.3, 5.4, 5.5, 7.2, 7.3, 7.5) verifican rechazo estricto con 410 o 404 sin ventana de gracia y con 0 filas creadas |
| FSM revoca sesiones activas en TO_CLEAN e idempotente en AVAILABLE | PASS | `calls-feedback-access.test.ts` (pruebas 7.1 a 7.5) y `qr-session-lifecycle.test.ts` confirman `closedAt !== null` inmediato en `TO_CLEAN` e idempotente en `AVAILABLE` |
| Staff A no lee/atiende llamados B | PASS | `calls-feedback-access.test.ts` (pruebas 4.2 y 4.4) verifican respuesta 403 Forbidden y cero mutación |
| Reintento normal no duplica feedback ni devuelve éxito sobre recurso inexistente | PASS | `calls-feedback-access.test.ts` (pruebas 5.1 y 5.9) comprueban 404 para sesión inexistente y 409 Conflict en reintento, con conteo invariable de filas en DB (exactamente 1 fila) |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Detallado explícitamente en este documento |
| Build completo y suite aislada aprobada ejecutados; no modificar tests para ocultar una regresión | PASS | Compilación limpia de 6 workspaces; 15/15 suites pasadas; `full-system-e2e` respeta el ciclo de vida de sesión activa |

## Integridad y seguridad

- Base demo intacta: Verificado. El archivo `dev.db` mantiene su hash SHA-256 `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Cruce tenant A/B: Respetado. Se configuraron dos restaurantes distintos (`restA` y `restB`); lecturas y mutaciones cruzadas son rechazadas con 403 Forbidden.
- Rechazo sin escrituras: Confirmado. Peticiones con tokens vencidos, llamadas duplicadas, sesiones cerradas hace segundos o cancelaciones ajenas no alteran registros en base de datos.
- Build: Compilación limpia sin errores de tipos en los 6 workspaces del monorepo.
- Migración/paridad: No se realizaron migraciones ni cambios en `schema.prisma`.
- Ausencia de secretos en diff/logs: Sin credenciales reales, secretos de JWT ni datos personales en logs.

## Pendientes, riesgos y decisiones

- Qué falta: Nada en la etapa 13. La ficha y las subsanaciones requeridas en la segunda revisión Codex se encuentran 100% implementadas y verificadas.
- Qué impide avanzar: Nada técnico. Se requiere revisión formal de Codex para aprobar la etapa 13 antes de desbloquear la etapa 14.
- Decisiones tomadas:
  1. En `FSMService.attemptTransition`, al transicionar a `TO_CLEAN`, se cierran inmediatamente todas las sesiones activas (`closedAt: now`) y se repite la operación de forma idempotente en `AVAILABLE`.
  2. En `FeedbackService.submitFeedback`, cualquier sesión con `closedAt !== null` queda terminantemente invalidada con `410 SESSION_CLOSED`, sin ninguna ventana de gracia y sin importar si existe o no una sesión posterior.
  3. Tras `TO_CLEAN`, tanto `POST /v1/calls` como `POST /v1/feedback` son rechazados con 410 sin mutar la base de datos (0 filas creadas), y la consulta canónica de QR físico resuelve a estado inactivo sin token.
- Cambios fuera de alcance NO implementados: Deduplicación concurrente distribuida con Redis o locks a nivel PostgreSQL, respetando el alcance de SQLite efímera para esta etapa.

## Handoff

- CONTROL actualizado sólo para la etapa 13 a `NEEDS_REVIEW`.
- No se inició la etapa 14.
- Solicito revisión de Codex.

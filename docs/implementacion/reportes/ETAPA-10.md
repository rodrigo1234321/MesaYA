# Reporte de etapa 10 — Proteger mesas y apertura/cierre de turno

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Antigravity (antigravity-gemini-3-flash)
Ficha: docs/implementacion/etapas/10-mesas-turnos.md
Predecesora aprobada: Etapa 09
Ruta del proyecto: C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas
Commit de base o manifiesto: N/A (directorio de trabajo local)
Cambios previos preservados: Etapas 00-09 intactas.

## Alcance realizado

- [x] Paso 1: Aplicar política explícita de autorización (manager del tenant administra mesas y abre/cierra turno; staff del tenant puede leer el estado operativo mínimo).
- [x] Paso 2: Eliminar activeToken y tokens de sesión de invitado en respuestas de listado general de mesas (`GET /restaurants/:id/tables`) y turno actual (`GET /shifts/current` / `ShiftService.getCurrentShift`).
- [x] Paso 3: Proteger creación/cierre de sesiones, mesas y turnos validando que pertenezcan al tenant del manager actuante (404 NOT_FOUND si pertenece a otro restaurante o ID desconocido).
- [x] Paso 4: Adaptar API client / consumidores (`AdminApi.getTables`, `createTable`, `getCurrentShift`, `openShift`, `closeShift`) usando `requireAuthorized` para manejo consistente de credenciales y errores 401/403.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/src/routes/tables.routes.ts` | Aplicación de `verifyStaffToken` en GET y `verifyManagerRole` + tenant check en mutaciones de mesa/sesión. Ocultamiento de `activeToken`. | Proteger gestión de mesas por manager/tenant y eliminar fuga de tokens de sesión. |
| `packages/api/src/routes/shifts.routes.ts` | Aplicación de `verifyManagerRole` + tenant check en apertura/cierre de turno y `verifyStaffToken` + tenant check en GET /shifts/current. Omitir array de tokens en /shifts/open. | Proteger apertura/cierre de turno por manager del tenant. |
| `packages/api/src/services/shift.service.ts` | Excluir campo `token` de `TableSession` en `getCurrentShift` y eliminar array `sessions` con tokens en `openShift`. | Evitar fuga de credenciales de invitado en consultas/aperturas de turno. |
| `apps/admin-dashboard/src/lib/api.ts` | Usar `requireAuthorized` en llamadas de mesas y turnos para manejar errores 401/403. | Sincronizar cliente gerencial con políticas de autorización. |
| `packages/api/test/tables-shifts-access.test.ts` | Creación de suite aislada de pruebas de mesas y turnos. | Verificación de reglas de autorización, aislamiento multi-tenant y no filtrado de tokens. |
| `scripts/test-isolated.mjs` | Registro de suite `tables-shifts-access`. | Integración en runner aislado de QA. |
| `packages/api/test/full-system-e2e.test.ts` | Actualización de token para cierre de sesión de mesa (requiere `adminToken` / MANAGER). | Reflejar nueva política de cierre de sesión por manager. |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---|---|
| `$env:MESAYA_BOUNDED_JOB="1"; node scripts/build.mjs` (`C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | Production build | 0 | 6/6 workspaces compilados exitosamente sin errores de tipos o sintaxis. |
| `$env:MESAYA_BOUNDED_JOB="1"; npm run test:isolated` (`C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`) | SQLite efímera en `.tmp/qa/<uuid>` | 0 | 11/11 suites exitosas (incluyendo `tables-shifts-access` y `full-system-e2e`). dev.db SHA-256 intacto (`499c2f9cd68d2207...`). |

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| No se abre/cierra turno ni rota sesión sin autorización | PASS | Test `tables-shifts-access.test.ts` confirma 401 para anónimo y 403 para mozo en `/shifts/open`, `/shifts/:id/close`, `/tables/:id/close-session`, `/tables/:id/new-session`. |
| Listados públicos/operativos no contienen tokens de invitado | PASS | Test confirma `activeToken: null` en `GET /restaurants/:id/tables` y ausencia de `token` en `GET /shifts/current` y `POST /shifts/open`. |
| Manager de otro tenant no puede actuar usando IDs conocidos | PASS | Test confirma 404 NOT_FOUND cuando manager B intenta actuar en restaurante A o sobre mesas/turnos de A. |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Reporte documentado con evidencia real y sin secretos. |
| Build completo y suite aislada aprobada ejecutados | PASS | Build completo exitoso (0) y suite aislada aprobada (11/11 PASSED). |

## Integridad y seguridad

- Base demo intacta: Sí (`dev.db` SHA-256 no cambió: `499c2f9cd68d2207...`).
- Cruce tenant A/B: Probado y rechazado con 404 NOT_FOUND.
- Rechazo sin escrituras: Confirmado en tests de rol y tenant.
- Build: Exitoso sin warnings críticos.
- Migración/paridad si corresponde: N/A.
- Ausencia de secretos en diff/logs: Confirmada.

## Pendientes, riesgos y decisiones

- Qué falta: Nada para la Etapa 10.
- Qué impide avanzar: Pausa obligatoria para revisión de Codex antes de habilitar la Etapa 11.
- Cambios fuera de alcance propuestos pero NO implementados: Ninguno.

## Handoff

CONTROL actualizado sólo para esta etapa a NEEDS_REVIEW.
No se inició siguiente ficha.
Solicito revisión de Codex.

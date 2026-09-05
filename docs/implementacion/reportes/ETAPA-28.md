# Reporte de etapa 28 — Ensayo integral del piloto con datos ficticios

Estado: NEEDS_REVIEW
Fecha: 2026-09-05
Ejecutor y modelo realmente usado: OpenCode (preparación) + Codex (verificación y cierre)
Ficha: [Etapa 28](../etapas/28-ensayo.md)
Predecesora aprobada: Etapa 27 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git local utilizable; cambios previos preservados

## Alcance realizado

- [x] Inventario sólo de lectura de los scripts legacy indicados por la ficha. No se ejecutaron contra ninguna conexión habitual. El recorrido útil se portó a la suite aislada `pilot-rehearsal`.
- [x] Recorrido técnico completo con fixtures ficticias: apertura de turno, QR/sesión, llamado y atención, pedido, cocina, pedido de cuenta, bloqueo de pago digital, cobro presencial autorizado, reinicio y cierre/revocación.
- [x] Aislamiento A/B, dos clientes simultáneos, rechazo cross-tenant, corte/reinicio sobre la misma base y registro de tiempos por fase dentro de la suite.
- [x] PostgreSQL 16 desechable ejecutado y eliminado al finalizar. No se tocó `dev.db`, seed productivo ni una base remota.
- [x] Captura UI real contra el PostgreSQL 16 efímero y la API local. Admin abrió turno; el QR canónico de Mesa 1 activó la sesión de cliente; el cliente generó llamados; Staff los recibió, los pasó a `En camino` y `Atendido`; Admin cerró turno y el cliente confirmó `Mesa Sin Sesión Activa`. Las tres aplicaciones fueron los bundles construidos en `127.0.0.1:5173` (cliente), `:5174` (staff) y `:5175` (admin), contra API en `:3000`.

## Archivos de la etapa

| Archivo | Cambio | Motivo |
|---|---|---|
| `packages/api/test/pilot-rehearsal.test.ts` | Nueva suite de 8 escenarios | Ensayo aislado SQLite/PG del recorrido y resiliencia |
| `scripts/test-isolated.mjs` | Registro `pilot-rehearsal` | Gate aislado de la etapa |
| `docs/implementacion/reportes/ETAPA-28.md` | Nuevo | Evidencia y bloqueo honesto |
| `docs/implementacion/CONTROL.md` | Etapa 28 `NEEDS_REVIEW` | Entrega lista para revisión de Codex |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado |
|---|---|---:|---|
| `node scripts/test-isolated.mjs pilot-rehearsal` | SQLite efímera | 0 | 8/8 PASS |
| `node scripts/test-postgres.mjs packages/api/test/pilot-rehearsal.test.ts` | PostgreSQL 16 desechable | 0 | 8/8 PASS; cliente SQLite restaurado |
| `node scripts/build.mjs` | Local | 0 | 6/6 workspaces PASS |
| `node scripts/test-isolated.mjs` | 30 sandboxes SQLite efímeras | 0 | 30/30 suites PASS |
| Health + preflight del entorno UI | API temporal/local | 0 | health 200; CORS 204 para `127.0.0.1:5175` |
| Recorrido visual CUA real | PostgreSQL 16 efímero + API local + builds en `:5173/:5174/:5175` | 0 | Turno activo, QR válido, llamado visible/atendido en Staff, cierre y revocación visibles |
| `Get-FileHash packages/api/prisma/dev.db` | Base demo | — | `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` |

El contenedor PostgreSQL `mesaya-pg-ensayo` se eliminó después de la prueba. No se ejecutó CI remota, push, deploy, cobro real ni Etapa 29.

## Criterios de aceptación

| Criterio | Estado | Evidencia |
|---|---|---|
| Recorrido completo observable sin editar DB manualmente entre pasos | PASS técnico | 8 escenarios aislados con fixtures sólo en `beforeAll` |
| Sin fuga A/B ni pago digital simulado | PASS | Rechazo cross-tenant, dos clientes y 503 `DIGITAL_PAYMENTS_UNAVAILABLE` |
| Corte/reinicio recupera estado persistido | PASS | Cierre de instancia, nueva instancia sobre misma DB y continuidad comprobada |
| UI real como evidencia complementaria | PASS | Evidencia visual sin mocks: Admin, cliente y Staff operaron contra el entorno efímero |
| Build y runner aislado completos | PASS | Build 6/6; runner 30/30; `dev.db` intacta |

## Pendientes, riesgos y decisión

No quedan bloqueos de la ficha. La UI se capturó sin retocar y contra el entorno efímero real. El recorrido de pedido, cocina, cuenta, cobro presencial autorizado, rechazo de pago digital, dos clientes, aislamiento A/B y reinicio se mantiene cubierto por la suite `pilot-rehearsal` que pasó en PostgreSQL 16; el recorrido UI complementario verificó los límites visibles entre Admin, cliente y Staff.

La Etapa 29 no se inició durante la ejecución de esta ficha. La siguiente acción queda sujeta a la revisión formal de Codex.

## Handoff

CONTROL actualizado sólo para esta etapa. Etapa 28 queda `NEEDS_REVIEW`; Etapa 29 permanece `BLOCKED`.

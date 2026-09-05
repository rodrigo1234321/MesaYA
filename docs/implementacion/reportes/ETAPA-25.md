# Reporte de etapa 25 — Controles compartidos de abuso y llamados duplicados

Estado: NEEDS_REVIEW
Fecha: 2026-09-04
Ejecutor y modelo realmente usado: Codex (GPT-5)
Ficha: [Etapa 25](../etapas/25-limites-dedup.md)
Predecesora aprobada: Etapa 24 (`APPROVED`)
Ruta del proyecto: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas`
Commit de base o manifiesto: sin repositorio Git local utilizable; cambios previos preservados

## Alcance realizado

- [x] Se definieron políticas explícitas compartidas: login por IP+tenant (5/5 min), llamados por sesión (10/min), waitlist por IP+tenant (3/10 min) e IA por tenant (10/hora).
- [x] Se agregó `RateLimitBucket` a ambos schemas y `AbuseControlService`, con incrementos condicionales atómicos, expiración y carrera de creación protegida por clave única; SQLite y PostgreSQL usan el mismo contrato.
- [x] Las rutas públicas devuelven `429` con `Retry-After`; no se confía en `X-Forwarded-For` porque no hay proxy confiable configurado.
- [x] Se reemplazó el `count-then-create` de llamados por `CallRequest.activeKey` único por sesión; la clave se libera al resolver/cancelar y los reintentos devuelven `429` coherente.
- [x] La cuota IA por tenant se consume antes del proveedor y se conserva la cuota de producto por sesión; un fallo del proveedor no reembolsa ni habilita uso ilimitado.
- [x] Se agregaron pruebas con dos conexiones Prisma, carrera de llamados y aserción HTTP de `Retry-After`; se registró la suite en el runner aislado.

## Archivos modificados

| Archivo | Cambio | Motivo dentro de esta ficha |
|---|---|---|
| `packages/api/prisma/schema.prisma` | `CallRequest.activeKey` único y modelo `RateLimitBucket` | Invariantes y almacenamiento compartido SQLite |
| `packages/api/prisma/schema.supabase.prisma` | Paridad de los mismos modelos/campos | Contrato PostgreSQL |
| `packages/api/prisma/migrations-postgres/20260904220000_add_abuse_controls/migration.sql` | Columna/índice de `activeKey` y tabla de buckets | Migración PG incremental |
| `packages/api/src/services/abuse-control.service.ts` | Políticas y consumo atómico con expiración/reintentos | Límite cross-process |
| `packages/api/src/services/call.service.ts` | Límite por sesión y creación protegida por clave única | Deduplicación sin count-then-create |
| `packages/api/src/routes/calls.routes.ts` | Cabecera `Retry-After` en 429 | Contrato HTTP |
| `packages/api/src/routes/auth.routes.ts` | Login limitado por IP+tenant | Protección de PIN sin confiar en XFF |
| `packages/api/src/routes/waitlist.routes.ts` | Eliminación del mapa en memoria y bucket IP+tenant canónico | Límite compartido de join |
| `packages/api/src/routes/menu.routes.ts` | Cuota IA compartida por tenant y 429 | Contención de coste entre instancias |
| `packages/api/test/abuse-controls.test.ts` | Dos conexiones, carrera y Retry-After HTTP | Evidencia ejecutable |
| `scripts/test-isolated.mjs` | Registro de suite `abuse-controls` | Gate aislado |

## Evidencia de pruebas

| Comando exacto y cwd | Entorno/DB aislada | Exit code | Resultado/assertions |
|---|---|---:|---|
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs abuse-controls` | SQLite efímera | 0 | 3/3: dos conexiones comparten límite (2 permitidas/2 rechazadas), carrera deja 1 llamado activo y HTTP devuelve 429 + `Retry-After: 1` |
| `$env:MESAYA_PG_DATABASE_URL='postgresql://postgres:postgres@localhost:55435/mesaya?schema=public'; $env:MESAYA_PG_DIRECT_URL=$env:MESAYA_PG_DATABASE_URL; node scripts/test-postgres.mjs packages/api/test/abuse-controls.test.ts` | PostgreSQL 16-alpine desechable; 3 migraciones aplicadas | 0 | 3/3 con dos clientes Prisma y restauración del cliente SQLite |
| `node scripts/sync_supabase_schema.js --check` | Inspección local, sin escritura | 0 | Schemas SQLite/PG sincronizados |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/build.mjs` | Build local | 0 | 6/6 workspaces PASS (36.34 s) |
| `$env:MESAYA_BOUNDED_JOB='1'; node scripts/test-isolated.mjs` | 25 sandboxes SQLite efímeras | 0 | 25/25 suites PASS, 0 fallas |

No se usaron bases remotas, datos reales ni proveedores externos. El contenedor PostgreSQL fue local, sintético y se eliminó al terminar.

## Criterios de aceptación

| Criterio de ficha | PASS / FAIL / NO EJECUTADO | Evidencia |
|---|---|---|
| El límite se comparte entre procesos y devuelve 429 de forma verificable | PASS | `abuse-controls`: dos conexiones Prisma, bucket único y aserción HTTP de `Retry-After` |
| Carrera de llamados deja como máximo un llamado activo por sesión | PASS | `CallRequest.activeKey` único; carrera concurrente SQLite/PG deja exactamente uno |
| Fallo del control IA no habilita llamadas pagas ilimitadas; PINs/tokens ausentes en logs | PASS (inspección + regresión) | Cuota tenant se consume antes del proveedor; `ai-containment` 23/23; los cambios de esta etapa no agregan logs de secretos (el seed existente sólo muestra tokens sintéticos de sandbox) |
| Reporte distingue ejecutado, no ejecutado e inspección; sin secretos ni datos reales | PASS | Tabla de evidencia y límites explícitos; sólo fixtures/PG local |
| Build completo y suite aislada aprobada | PASS | Build 6/6; runner 25/25 |

## Integridad y seguridad

- Base demo intacta: SHA-256 antes/después `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF`.
- Cruce tenant A/B: claves de login/waitlist/IA incluyen tenant canónico; llamados se identifican por sesión; suites existentes sin regresión.
- Rechazo sin escrituras: un conflicto de `activeKey` no crea segundo `CallRequest`; un bucket agotado no invoca el proveedor IA.
- Build: 6/6 workspaces exitosos.
- Migración/paridad: `schema.supabase.prisma` sincronizado; migración incremental aplicada en PostgreSQL efímero.
- Ausencia de secretos en cambios: verificada; esta etapa no imprime PINs, tokens ni URLs de producción. El runner de seed preexistente muestra únicamente URLs/tokens sintéticos de sandboxes efímeras.

## Pendientes, riesgos y decisiones

Qué falta: revisión formal de Codex.
Qué impide avanzar: ninguna dentro de la ficha.
Pregunta concreta si hace falta: ninguna.
Cambios fuera de alcance propuestos pero NO implementados: bloqueo DDoS/GPS, proveedor externo de rate limit, outbox distribuido y reescritura amplia de servicios.

## Handoff

CONTROL actualizado sólo para esta etapa.
No se inició la Etapa 26.
Solicito revisión de Codex.

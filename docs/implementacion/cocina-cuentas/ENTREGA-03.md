# ENTREGA-03 (rev.3) — Etapa 03: Contratos/datos (participantes, modificadores, tandas, centavos e idempotencia)

Estado: VERIFIED_PASS
Fecha: 2026-09-05
Plan: docs/implementacion/COCINA-CUENTAS-2026-09-05.md (etapa 03) + docs/implementacion/COCINA-CUENTAS-ACEPTACION.md
Base: etapa 01 aprobada (`81faa2048123ec327725d0c386b813c6765cc3f`), etapa 02 aprobada (`ca57b995f8ed101f8f3e1d32f059ec74487c98da`).
Alcance: SÓLO datos y contratos aditivos cocina/cuentas. Sin endpoints/UI de etapas 04–08. Sin despliegues, cobros ni credenciales.

## Archivos cambiados
- `packages/api/prisma/schema.prisma` — aditivo: 4 modelos nuevos (`VisitParticipant`, `OrderTanda`, `ModifierGroup`, `ModifierOption`); campos nuevos nullable o con default seguro en `MenuItem`, `Order`, `OrderItem`, `SplitBillSession`, `PaymentTransaction`, `StaffUser.pinDigest` + `@@unique([restaurantId, pinDigest])`. Floats y `addedByGuest` legacy conservados como lectura.
- `packages/api/prisma/schema.supabase.prisma` — espejo exacto (sólo difiere datasource PG); `sync_supabase_schema.js --check` queda limpio por construcción (test lo afirma sin shell).
- `packages/api/prisma/migrations-postgres/20260905120000_cocina_cuentas_etapa03/migration.sql` — migración PG aditiva y revisable: sólo `ADD COLUMN`/`CREATE TABLE`/`CREATE INDEX`/`ADD CONSTRAINT`. Sin `DROP`/`DELETE`/`UPDATE` de datos.
- `packages/api/src/lib/money.ts` (nuevo) — autoridad en centavos: `isValidCents`/`assertValidCents`, `toCentsFromFloatPrice` (una sola conversión explícita legacy), `sumCents` con overflow, `lineTotalCents` (qty 1..50), `splitEqualParts` (residuo determinista, suma exacta).
- `packages/api/src/lib/pin-digest.ts` (nuevo) — digest HMAC-SHA256 con secreto del servidor sobre `pin-digest-v1:<restaurantId>:<pin>`; `isUniqueViolation`/`toDuplicatePinError` (P2002→409). No reemplaza bcrypt, no almacena PIN.
- `packages/api/src/lib/order-contracts.ts` (nuevo) — snapshot `mesaya.modifiers/v1` con validación de servidor, `sumModifierDeltas`, etiqueta legible cocina, FSM de tanda sin retroceso, `assertValidIdempotencyKey`, nombre de participante, moneda ARS estricta.
- `packages/api/src/services/staff.service.ts` — `createStaff` calcula `pinDigest` y traduce P2002 a 409; conserva chequeo bcrypt secuencial para filas legacy con digest NULL. Login intacto (bcrypt autoridad).
- `packages/api/test/cocina-cuentas-etapa-03.test.ts` (nuevo; rev.2 sólo corrección de aserciones Codex) — 10 casos (ver abajo). No toca `.env`/DB: mocks de prisma + libs puras + lectura de archivos.
- `docs/implementacion/cocina-cuentas/ENTREGA-03.md` — este reporte (rev.2 explica la corrección).

## Decisiones
- Participantes ligados a visita: `VisitParticipant` FK a `TableSession` con `tokenHash` único (el token plano viaja una sola vez al unirse); estado `ACTIVE`/`REVOKED`. La revocación al cerrar visita/turno la ejecuta etapa 04; el dato ya lo permite. Ningún UUID de navegador es autoría válida.
- Tandas independientes por visita (`OrderTanda`, `seq` por visita SIN default para que una colisión sea ruidosa, `idempotencyKey` única, `status` DRAFT→… sin retroceso). `OrderItem.tandaId`/`participantId` nullable: líneas previas quedan huérfanas-válidas, no se reescriben.
- Snapshots versionados: `productNameSnapshot`, `unitPriceCents`, `lineTotalCents`, `priceVersion`/`modifierVersion`, `modifiersSnapshot` JSON `mesaya.modifiers/v1`. Notas libres siguen como texto cocina, nunca fuente de precio (el validador ignora extras y la etiqueta legible no los lee).
- Modificadores POR PRODUCTO y versionados (`ModifierGroup` unique por producto+nombre+versión); nada global por defecto.
- Dinero: `Int` centavos + `currency ARS` en menú, líneas, pagos y split; `revision` en `SplitBillSession` prepara congelar/revisar reparto (etapa 07). Floats legacy intactos para compatibilidad de lectura.
- PIN concurrente: HMAC con `ENCRYPTION_SECRET_KEY` (ya exigida en prod) en vez de SHA simple — una filtración de tabla sin el secreto no permite diccionario offline de PINs cortos. bcrypt sigue autenticando.
- Migración legacy sin PIN conocido: `pinDigest` NULL (no colisiona en SQLite ni PG), login bcrypt sin cambios, digest hacia adelante en creación/rotación. NO hay backfill: derivarlo exigiría el PIN en claro. La rotación con `--rotate-pin` de etapa 01 completará digests al rotar (pendiente operativo, no código).
- `Order.idempotencyKey` única nullable: prepara creación idempotente de comandas (etapa 04) sin tocar `PaymentTransaction.idempotencyKey` existente.

## Corrección Codex rev.2 (sólo tests/contratos, sin endpoints/UI)
Feedback: `check-suite-20260905-173046-34be68`, 5/10 PASS; 4 fallos por aserciones de `error.code` buscado dentro de `error.message` y 1 por regex `UPDATE` que tomaba un comentario descriptivo.
1. Contrato consistente conservado: los helpers (`money.ts`, `order-contracts.ts`) mantienen mensajes humanos en `error.message` y exponen el código estructurado en `error.code` (`MONEY_INVALID`, `MONEY_OVERFLOW`, `INVALID_QUANTITY`, `CURRENCY_INVALID`, `MODIFIERS_INVALID`, `IDEMPOTENCY_KEY_INVALID`, `PARTICIPANT_NAME_INVALID`). Sin cambios de contratos/datos/migración: la corrección es sólo de aserciones.
2. Tests ahora usan helper `expectErrorCode(fn, code)` que captura la excepción y afirma `error.code === code`, fallando si no lanza (sin asserts triviales: cada caso inválido sigue debiendo lanzar). Aplica a dinero/overflow/cantidad/moneda (casos 2–3), snapshot modificadores (caso 7), idempotencia y nombre participante (caso 8, incluido código exacto `PARTICIPANT_NAME_INVALID`).
3. Migración (caso 9): se filtran líneas de comentario (`trimStart().startsWith('--')`) antes de prohibir destructivos, y se usan patrones de sentencia real (`/^\s*DROP\s+(TABLE|COLUMN)\b/im`, `/^\s*DELETE\s+FROM\b/im`, `/^\s*TRUNCATE\b/im`, `/^\s*UPDATE\s+/im`). Pasa con los comentarios descriptivos actuales y sigue fallando ante un UPDATE/DELETE/DROP/TRUNCATE real.
4. Conservado intacto: datos/migración SQL, verificaciones de centavos, digest, constraint compuesto (`PIN_DUPLICATE`/409), snapshot v1, FSM/idempotencia, paridad schemas y legacy.

## Pruebas agregadas (NO ejecutadas — sin shell en este entorno)
`packages/api/test/cocina-cuentas-etapa-03.test.ts`, 10 casos:
1. Reparto 10.000/3 → [3334,3333,3333], suma exacta, estable entre lecturas.
2. Invariantes dinero: NaN/Infinity/floats/negativos/overflow/cantidades fuera de 1..50/moneda no-ARS rechazados (afirma `error.code`: `MONEY_INVALID`/`MONEY_OVERFLOW`/`INVALID_QUANTITY`/`CURRENCY_INVALID`).
3. Compat legacy float→centavos (14500→1450000) y rechazos (`MONEY_INVALID` en `code`).
4. Digest: determinista, aísla por restaurante+PIN+secreto, formato PIN validado antes de cómputo, sin PIN en salida.
5. Carrera realista: dos `createStaff` concurrentes (mock con ventana + constraint emulado) → exactamente un éxito y un 409 `PIN_DUPLICATE`; mismo digest, distintos bcrypt.
6. Legacy: duplicado bcrypt previo → 409 sin crear; PIN distinto convive y crea con digest nuevo.
7. Snapshot modificadores v1 válido; extras/notas no alteran precio; 7 variantes inválidas rechazadas (`MODIFIERS_INVALID` en `code`).
8. FSM tanda sin retroceso + claves idempotencia estrictas + nombre participante (`IDEMPOTENCY_KEY_INVALID` / `PARTICIPANT_NAME_INVALID` en `code`).
9. Migración SQL: contiene las 4 tablas y 11 columnas clave; prohíbe sentencias reales `DROP`/`DELETE`/`TRUNCATE`/`UPDATE` ignorando comentarios `--`.
10. Paridad: ambos schemas con nuevos modelos + legacy intacto + `@@unique([restaurantId, pinDigest])`; `buildPostgresSchema` == supabase normalizado (`--check` limpio).
## Verificación Ejecutada y Evidencia
- Tipado TS2322 en `packages/api/src/lib/order-contracts.ts` resuelto tipando los literales de `TANDA_TRANSITIONS` como arrays `as const`.
- Build TypeScript de los 6 workspaces limpio:
  - `npm run build:shared`: OK
  - `npm --workspace=@mesaya/api run build`: OK
  - `npm --workspace=@mesaya/client-web run build`: OK
  - `npm --workspace=@mesaya/staff-panel run build`: OK
  - `npm --workspace=@mesaya/admin-dashboard run build`: OK
  - `hardware/qr-generator`: OK
- Suite específica de etapa 03: `packages/api/test/cocina-cuentas-etapa-03.test.ts` — 10/10 PASS.
- Paridad de schema Postgres/Supabase: `scripts/sync_supabase_schema.js --check` — PASS.
- Matriz de rutas: `scripts/check-route-matrix.mjs` — 76 rutas clasificadas, 0 deriva — PASS.
- Build completo monorepo bajo supervisor: `Check.ps1 -Check build` (exit code 0) — PASS.
- Build PG monorepo bajo supervisor: `Check.ps1 -Check build-pg` (exit code 0) — PASS.
- Regeneración limpia de cliente Prisma SQLite (`prisma:generate`).
- Suite integral de regresión bajo supervisor: `Check.ps1 -Check suite` — 30/30 suites PASS, 0 fallidas.

## Pendientes reales para Etapa 04
1. Etapa 04: emisión de participantes (`VisitParticipant`), endpoints backend de pedidos directo a cocina (`IN_KITCHEN`) y con mozo (`PENDING_VALIDATION`), FSM sin retroceso de tandas y disponibilidad.
2. Rotación operativa de PINs legacy para completar `pinDigest` (con `--rotate-pin` existente).
3. Backfill de `priceCents`/`totalCents` desde floats legacy con aceptación de redondeo en etapa 04.

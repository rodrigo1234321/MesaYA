# Informe de Ejecución E05 — División de cuenta presencial

- **Etapa**: E05 — División de cuenta (split bill)
- **Fecha**: 2026-09-21 (corrección loop 2026-09-21; corrección acotada post-PASS_E05 2026-09-21)
- **Branch**: `codex/plan-modulos-20260920` (worktree actual)
- **Estado**: `VERIFICADO_LOCAL` (post-revisión independiente Antigravity Pro PASS_E05 read-only + corrección contractual UI/API verificada local)
- **Autor/Ejecutor**: Agente Muse Spark (escritor exclusivo de E05, sin Codex)
- **Revisión independiente**: Antigravity Pro — PASS_E05 (read-only, cuota/CLI ya recuperado) — ver §6

---

## 1. Alcance y Objetivos

E05 habilita la división presencial de cuenta en tres modos (FIXED, PERCENTAGE, EQUAL_PARTS) sobre el camino canónico `POST /v1/staff/sessions/:id/settle` y `settle-and-close`, con firma normalizada persistida, validación estricta sin 500, reparto determinista del resto **sobre consumo total** y sin cierre parcial ni overpayment. Loop de corrección exige: no aceptar EQUAL_PARTS sobre saldo remanente; requiere tres pagadores y saldo cero exacto; partIndex explícito.

### Matriz de Contraste Operativo

| # | Escenario | Comportamiento Verificado | Evidencia |
|---|---|---|---|
| 1 | **FIXED** | `split: {FIXED, amountMinor: 4000}` sobre saldo 10000 liquida 4000 y deja 6000 | e05-split-bill §FIXED |
| 2 | **PERCENTAGE** | 33% sobre saldo 10000 => 3300 (round saldo) | e05 §PERCENTAGE |
| 3 | **EQUAL_PARTS 3 partes misma sesión** | consumo 10000 => p1=3334 (floor 3333 +1 por remainder 1), p2=3333, p3=3333, saldo final 0 | e05 §EQUAL_PARTS misma sesión |
| 4 | **EQUAL_PARTS partIndex requerido** | sin partIndex => 422; pIdx fuera 1..N => 422 | e05 §validaciones + validateSplitInput |
| 5 | **Repetir misma parte, clave distinta** | misma N+partIndex ya liquidada => 409 SPLIT_PART_ALREADY_SETTLED sin fila nueva | e05 §EQUAL_PARTS duplicado + order.service settlements.find |
| 6 | **Idempotent replay misma key/body** | misma key + mismo body/versión => 200 idempotentReplay:true antes del check SPLIT_PART_ALREADY_SETTLED | e05 §idempotencia + isSameSettleIntent |
| 7 | **Partial mantiene sesión abierta** | settle parcial reduce saldo, sesión `closedAt=null`, mesa no TO_CLEAN | e05 §FIXED + freshAccount |
| 8 | **settle-and-close parcial rechaza** | FIXED 5000 sobre saldo 10000 => 422 CLOSE_REQUIRES_FULL_SETTLEMENT, sin mutación | e05 §settle-and-close parcial |
| 9 | **Módulo apagado** | `allowSplitBill=false` => 403 SPLIT_BILL_DISABLED, 0 settlements nuevos | e05 §módulo apagado |
| 10 | **Validaciones invalid modes/ranges/parts** | modo desconocido, FIXED 0, PERCENTAGE 0/101/50.5, EQUAL_PARTS parts 1/0, sin partIndex, partIndex fuera de rango => 400/422, sin 500, sin mutación | e05 §validaciones |
| 11 | **Misma clave con split diferente => 409** | FIXED 5000 vs PERCENTAGE 50 (mismo monto 5000) => 409 IDEMPOTENCY_KEY_REUSED; EQUAL_PARTS p1 vs p2 misma clave => 409 | e05 §409 por split distinto |
| 12 | **Tenant/scope** | token de restaurante B sobre sesión de A => 403 STAFF_TENANT_MISMATCH | e05 §tenant |
| 13 | **Legacy/no-split compatible** | settle sin split sigue idempotente, splitSignature null | e05 §legacy |
| 14 | **Persistencia firma** | `splitSignature` TEXT nullable en AccountSettlement, migración aditiva | prisma + migración |

---

## 2. Diagnóstico y Hallazgos de Código

1. **Persistencia de firma**:
   - `packages/api/prisma/schema.prisma` y `schema.supabase.prisma`: `AccountSettlement.splitSignature String?` (nullable, aditiva, sin backfill rompedor). Formato canónico `FIXED:<amount> | PERCENTAGE:<pct> | EQUAL_PARTS:<parts>:<partIndex>`.
   - `packages/api/prisma/migrations-postgres/20260921120000_e05_split_signature/migration.sql`: `ALTER TABLE "AccountSettlement" ADD COLUMN IF NOT EXISTS "splitSignature" TEXT;`
   - `packages/api/src/services/order.service.ts`: `normalizeSplitSignature()` exige partIndex para EQUAL_PARTS; `splitSignature` en `create` de ambos caminos; `isSameSettleIntent` compara `existing.splitSignature` vs firma normalizada esperada antes de monto/allocations y recomputa EQUAL_PARTS sobre consumoMinor.

2. **Validación y cálculo**:
   - `validateSplitInput`: null/undefined => legacy; FIXED exige enteros >0 y consistencia con `amountMinor`; PERCENTAGE exige entero 1..100; EQUAL_PARTS exige `parts` entero >=2 y `partIndex` explícito 1..parts; todo error 400/422 vía `settleError`, nunca 500.
   - `calculateSplitAmount(split, inputAmountMinor, consumoMinor, saldoMinor)`: FIXED devuelve amountMinor; PERCENTAGE `round(saldoMinor*pct/100)` (saldo pendiente); EQUAL_PARTS `base=floor(consumoMinor/parts)`, `remainder=consumoMinor%parts`, `calc=base+(index<=remainder?1:0)` determinista sobre consumo total, 422 si <1 centavo y check de consistencia.
   - Llamadas actualizadas a usar `fresh.consumoMinor` y `fresh.saldoMinor`; nunca overpayment (`amountMinor > saldoMinor => 422 OVERPAYMENT`).

3. **Guard SPLIT_PART_ALREADY_SETTLED**:
   - Tras check de idempotencia (replay 200 antes), en `settleSessionAccount` y `settleAndCloseSessionAccount`: si `split.mode===EQUAL_PARTS` y `settlements.find(s=>s.splitSignature===normalizeSplitSignature(...))` => `409 SPLIT_PART_ALREADY_SETTLED` sin crear fila.

4. **Cierre**:
   - `settleAndClose` mantiene guarda `amountMinor !== saldoMinor => 422 CLOSE_REQUIRES_FULL_SETTLEMENT`; split parcial nunca alcanza total, por lo que settle-and-close parcial siempre rechaza. Dup check también previo a saldo.

5. **UI Staff**:
   - `apps/staff-panel/src/components/ServiceWorkspace.tsx`: estados `splitModeBySession`, `splitValueBySession`, `splitPartIndexBySession`; `runSettlement` calcula EQUAL_PARTS sobre `account.account.consumoMinor` con mismo redondeo floor+remainder y valida `preview <= saldo`; `TableContextPanel` exige elegir parte 1..N (select dinámico) cuando EQUAL_PARTS, preview sobre consumo y validación no supera saldo; mantiene FIXED/EQUAL_PARTS y —tras corrección acotada post-PASS_E05— `PERCENTAGE` validado como **entero 1..100** tanto en preview (`TableContextPanel: Number.isInteger`) como en pre-envío (`runSettlement: Number.isInteger`) con mensajes accesibles coherentes con API (`Porcentaje debe ser un entero entre 1 y 100.` / `Porcentaje inválido: debe ser entero entre 1 y 100.` + `aria-live`/`aria-invalid`), preservando cálculo `round(saldo*pct/100)`.

6. **Capacidades**:
   - `packages/api/src/services/config.service.ts`: `split_bill` AVAILABLE con `effectiveEnabled = allowSplitBill`.

---

## 3. Archivos Involucrados y Creados

- **Migración y esquema**:
  - `packages/api/prisma/schema.prisma`
  - `packages/api/prisma/schema.supabase.prisma`
  - `packages/api/prisma/migrations-postgres/20260921120000_e05_split_signature/migration.sql`

- **Lógica**:
  - `packages/api/src/services/order.service.ts` (validateSplitInput, calculateSplitAmount, normalizeSplitSignature, isSameSettleIntent, SPLIT_PART_ALREADY_SETTLED)
  - `packages/api/src/routes/orders.routes.ts` (expone `split?: SplitOperation`)
  - `apps/staff-panel/src/components/ServiceWorkspace.tsx` (partIndex UI, preview consumoMinor)

- **Tests**:
  - `packages/api/test/e05-split-bill.test.ts` (21 tests: fija, pct, EQUAL_PARTS misma sesión 3334/3333/3333 saldo 0 + 409 duplicado, etc.)
  - capabilities/unit/contract/policy + e02-module-config-behavior (46 tests)

---

## 4. Evidencia de Ejecución

### Pruebas Automatizadas (Vitest vía `scripts/test-local.mjs`)

1. **Suite focal E05**:
   ```
   node scripts/test-local.mjs e05-split-bill.test.ts
   Test Files  1 passed (1)
        Tests  21 passed (21)
   ```

2. **Capabilities relevantes**:
   ```
   node scripts/test-local.mjs capabilities-unit.test.ts capabilities-contract.test.ts capability-update-policy.test.ts e02-module-config-behavior.test.ts
   Test Files  4 passed (4)
        Tests  46 passed (46)
   ```

### Verificaciones de Integridad

- **Prisma generate** (`npm run prisma:generate`):
  ```
  ✔ Generated Prisma Client (v5.22.0) to .\node_modules\@prisma\client
  ```

- **Esquema Supabase** (`npm run check:supabase-schema`):
  ```
  ✅ schema.supabase.prisma está sincronizado con el schema canónico.
  ```

- **Matriz de rutas** (`npm run check:routes`):
  ```
  Matriz de rutas OK: 107 rutas clasificadas, sin novedades ni deriva.
  ```

- **Compilación Shared/API** (`npm run build:shared`, `npm run build:api`):
  ```
  tsc — sin errores; prisma generate ok
  ```

- **Compilación Staff** (`npm run build --workspace=apps/staff-panel`):
  ```
  vite v6.4.3 — 1609 modules transformed — built in ~4.5s
  ```

- **Higiene diff** (`git diff --check`):
  ```
  warning: LF will be replaced by CRLF (schema.supabase.prisma, scripts/fauno-catalog.test.mjs)
  exit 0; sin trailing whitespace ni líneas vacías extra.
  ```

---

## 5. Tareas Pendientes y Riesgos

### `PENDING_CLOUD`
- No declarar producción/cloud: despliegue a Vercel/Supabase y seed se coordinan fuera de E05 (hito integración).

### `PENDING_HUMAN`
- Validación en salón con tablet: flujo con 3 comensales alternando partes 1/2/3 en misma sesión, comprobando que preview coincide con backend y que parte duplicada muestra 409.

### Riesgos y Mitigaciones
- **Colisión de clave con split distinto pero mismo monto**: mitigado por `splitSignature` persistida (409 aunque monto coincida).
- **Legacy sin firma**: filas previas con `splitSignature=null` siguen idempotentes para no-split; split nuevo sobre misma clave legada => 409.
- **EQUAL_PARTS sobre consumo total**: reparto determinista `floor(total/N)+1` hasta remainder garantiza suma exacta = consumo y saldo 0 tras N partes; evita drift sobre saldo remanente.
- **Replay vs duplicado**: idempotencia por clave exacta devuelve 200 antes del guard `SPLIT_PART_ALREADY_SETTLED`; otra clave con misma parte => 409 sin fila.

---

## 6. Revisión Independiente Antigravity Pro y Corrección Acotada Contractual (2026-09-21 post-PASS_E05)

- **Revisión independiente**: Antigravity Pro — **PASS_E05**, modalidad **read-only**, sin mutaciones en esa pasada. Cuota/CLI ya recuperado al momento de esta corrección local.
- **Alcance de esta corrección acotada** (worktree actual, sin tocar E06+, sin commit/push/deploy):
  1. **Contrato PERCENTAGE entero 1..100**: backend `packages/api/src/services/order.service.ts:validateSplitInput` ya validaba `Number.isSafeInteger(pct) 1..100` (422). La UI `apps/staff-panel/src/components/ServiceWorkspace.tsx` permitía decimales en `TableContextPanel` y `runSettlement`. **Corrección**: UI rechaza porcentajes no enteros **antes de enviar**, con mensaje accesible coherente con API — `TableContextPanel`: `Porcentaje debe ser un entero entre 1 y 100.` (error + `aria-live`/`aria-invalid`/`aria-describedby`); `runSettlement`: `Porcentaje inválido: debe ser entero entre 1 y 100.` — preservando cálculo `Math.round(saldoMinor * pct / 100)` y modos `FIXED`/`EQUAL_PARTS` sin cambios.
  2. **Higiene código muerto**: eliminada variable local muerta/expresión vacía `consumo` en `packages/api/src/services/order.service.ts:isSameSettleIntent` (`const consumo = consumoMinor ?? priorSaldo + (existing.amountMinor ? 0 : 0)` nunca leída; `total` ya resolvía `typeof consumoMinor === 'number' ? consumoMinor : priorSaldo`). Sin cambio semántico; `SPLIT_PART_ALREADY_SETTLED` e idempotencia intactos.
  3. **Trazabilidad documental**: este §6 deja constancia explícita de la revisión PASS_E05 read-only y de la corrección de alineación UI↔API exigida en el hallazgo 1 y 2.
- **Verificación post-corrección**: re-ejecutados en el mismo worktree `npm run build:shared`, `npm run build:api`, `npm run build --workspace=apps/staff-panel`, `node scripts/test-local.mjs e05-split-bill.test.ts`, `npm run check:supabase-schema`, `npm run check:routes`, `git diff --check` (exit 0; sólo warnings de conversión LF→CRLF; no se relajan pruebas).

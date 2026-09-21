# Informe de Ejecución E06 — Propinas y reseñas honestas

- **Etapa**: E06 — Propinas y reseñas
- **Fecha**: 2026-09-21
- **Branch**: `codex/plan-modulos-20260920` (worktree actual)
- **Estado**: `VERIFICADO_LOCAL` (post-corrección acotada + suite focal, sin declarar cloud/producción)
- **Autor/Ejecutor**: Agente Muse Spark (escritor exclusivo de E06, fallback OpenCode tras intento Antigravity ~13 min sin diff)
- **Revisión independiente**: Antigravity/Codex pendiente (no se declara PASS hasta revisión read-only externa)

---

## 1. Alcance y Objetivos

Propinas y reseñas honestas end-to-end con mínimo cambio coherente, respetando módulos `enableSmartTips` y `enableReviews` en backend (no sólo ocultar UI) y sin doble contabilidad:

- **Cliente** (`apps/client-web`): ya ofrece cero/porcentaje/monto y envía `tipMinor` sólo como solicitud `BILL` (`CallRequest.tipMinor`). El cobro canónico posterior es `AccountSettlement.tipMinor`. La proyección contable `OrderService.buildSessionAccount` suma sólo `settlements` (+ `PaymentTransaction` legado), nunca `CallRequest.tipMinor`. `consumoMinor` es base del porcentaje (`round(consumoMinor * pct /100)`). No hay login de cliente ni perfil.
- **Staff**: puede confirmar/cambiar `tipMinor` antes del cobro vía input `tipBySession` en `ServiceWorkspace`, incluido split por pagador (tip por `AccountSettlement` independiente). Cálculo de porcentaje mantiene `consumoMinor` como base; `FIXED` y `PERCENTAGE` (sobre saldo) y `EQUAL_PARTS` (sobre consumo total) coexisten sin doble suma.
- **Política backend**: `tipMinor>0` con `enableSmartTips=false` => `403 SMART_TIPS_DISABLED` accionable tanto al pedir `BILL` (`CallService.createCall`) como al liquidar (`settleSessionAccount` y `settleAndCloseSessionAccount`); `tip 0` sigue permitido. `Feedback` con `enableReviews=false` => `403 REVIEWS_DISABLED` sin insertar.
- **Feedback privado/interno**: sesión válida/no expirada/no cerrada/turno abierto, `rating` entero `1..5`, `comment` string `<=1000`, una fila por visita (`Feedback.tableSessionId` único), duplicado/concurrencia `409 FEEDBACK_ALREADY_EXISTS`, sin exponer `token`/PII en respuesta. No condicionar enlace Google a rating positivo; sólo mostrar si `Place ID` válido/sanitizado (`^[A-Za-z0-9_-]{1,128}$`). Admin/config no construye enlace con input peligroso (sanitizado + `encodeURIComponent`).
- **Sugerencias**: `suggestedTipPercentages` enteros `0..100`, máx 5, validados en `ConfigService.validateCapabilityUpdate`.
- **Sin regresión**: recarga posterior (otra ronda) no duplica tip; `BILL` solicitado no se duplica al cobrar.

Criterios de aceptación cubiertos: cero/porcentaje/monto, cambio antes de cobro, BILL no duplica en cuenta, tip de settlements/split por pagador, recarga sin duplicar, smartTips off, reviews off, feedback válido/inválido, duplicado/concurrente, Place ID ausente/inválido.

---

## 2. Diagnóstico y Hallazgos de Código

1. **Propina como solicitud vs cobro canónico**:
   - `packages/api/src/services/call.service.ts:156-181`: `tipMinor` sólo para `BILL`, validado entero `0..MAX`, y si `>0` con `enableSmartTips===false` => `403 SMART_TIPS_DISABLED`. `apps/client-web/app.js:3547` retorna `0` cuando `enableSmartTips===false`; `getSelectedTipMinor` calcula `round(consumoMinor * pct/100)` o monto fijo, nunca sobre `totalDue`.
   - `packages/api/src/services/order.service.ts:buildSessionAccount:803-821`: `tipMinor = sum(settlements.tipMinor - ajustesTip)`, sumando sólo `AccountSettlement.tipMinor` (vía nueva) + `PaymentTransaction.tipAmountMinor` legado; `CallRequest.tipMinor` no se lee. `calculateSessionBalance` mantiene `saldoMinor = max(0, consumoMinor - paidMinor)` sin incluir tip (tip es extra).
   - `packages/api/src/services/receipt.service.ts:345-346`: `PRE_BILL_DETAIL` muestra `requestedTipMinor` sólo como informativo si `tipMinor===0`.

2. **Staff confirma/cambia tip antes del cobro, split por pagador**:
   - `apps/staff-panel/src/components/ServiceWorkspace.tsx:727-728`: `tipMinor = round(tipInput*100)` (editable, default `requestedTipMinor`); `runSettlement:766-791` incluye `tipMinor` en payload y en `keyId` idempotente. Split preview valida sobre `consumoMinor`/`saldoMinor` sin mezclar tip.
   - `packages/api/src/services/order.service.ts:settleSessionAccount:1006-1008` y `settleAndClose:1303-1305`: rechazan `tipMinor>0` con `enableSmartTips===false`; `tipMinor` persiste por `AccountSettlement` individual, sumando por pagador sin doble conteo.

3. **Feedback**:
   - `packages/api/src/services/feedback.service.ts:33-45` valida `rating` entero `1..5`, `comment` `<=1000` y tipo; `81-90` rechaza si `enableReviews===false`; `93-114` rechaza expirada/cerrada; `117-122` + `142-148` `P2002` => `409 FEEDBACK_ALREADY_EXISTS`; retorna sólo `id/rating/comment/createdAt`.
   - `packages/shared/src/security.ts:144-151` sanitiza `Place ID`; `packages/api/src/services/config.service.ts:96-110` valida `googlePlaceId` con `sanitizeGooglePlaceId` => `400 INVALID_GOOGLE_PLACE_ID` si `>128` o chars inválidos; `buildCapabilities:604-614` usa sanitizado para `REVIEWS_INTERNAL_*`.

4. **Corrección E06 aplicada (único cambio de código)**:
   - `apps/admin-dashboard/src/components/ModuleConfigManager.tsx:1-11,536-546`: el enlace “Probar enlace de reseña” ya no interpola `config.googlePlaceId` crudo. Ahora importa `sanitizeGooglePlaceId` y renderiza `href` sólo si `sanitizeGooglePlaceId(placeId)` no es `null` y `enableReviews===true`, con `encodeURIComponent(safePlaceId)`. Evita XSS/construcción con input peligroso. `apps/client-web/app.js:3615-3623` ya sanitizaba (`sanitizeGooglePlaceId` + `encodeURIComponent`).

5. **Sugerencias 0..100**:
   - `packages/api/src/services/config.service.ts:73-94`: `suggestedTipPercentages` debe ser array `0..100` enteros, máx 5.

---

## 3. Archivos Involucrados y Creados

- **Corregido**:
  - `apps/admin-dashboard/src/components/ModuleConfigManager.tsx` (import `sanitizeGooglePlaceId` + sanitización/encode del deep link Google)

- **Sin cambios de esquema** (E06 reutiliza columnas existentes):
  - `packages/api/prisma/schema.prisma` y `schema.supabase.prisma` ya contenían `CallRequest.tipMinor`, `AccountSettlement.tipMinor`, `RestaurantModuleConfig.{enableSmartTips,suggestedTipPercentages,enableReviews,googlePlaceId}`, `Feedback.rating/comment` único por sesión.

- **Tests (sin relajar invariantes)**:
  - `packages/api/test/e06-tips-reviews.test.ts` (nuevo, 22 tests focales; ver §4)
  - Regresiones verificadas sin modificar: `calls-feedback-access`, `b03-session-account`, `b04-account-settle`, `e05-split-bill`, `capabilities-contract/unit`, `capability-update-policy`, `cash-contract`, `e04-service-context`, `sales-reports-settle`, `monetary-convergence`

- **Docs**:
  - `docs/ejecucion-plan-modulos/E06-PROPINAS-Y-RESENAS-2026-09-21.md` (este archivo)

No se tocó `E07+`, no hay `commit/push/deploy`, no se usaron producción/secretos.

---

## 4. Evidencia de Ejecución

### 4.1 Suite focal E06

```
node scripts/test-local.mjs e06-tips-reviews.test.ts
Test Files  1 passed (1)
     Tests  22 passed (22)
```

Cobertura del archivo focal (22 tests, fixtures efímeras en SQLite `test-local`):

| Grupo | Escenario | Criterio |
|---|---|---|
| tip 0 / pct / monto | BILL `tip 0` OK y no altera cuenta; BILL con monto fijo `tipMinor` aceptado como solicitud; `pct` 15% sobre `consumoMinor` 10000 => `tip 1500` liquidado por staff | E06 §tip |
| cambio antes de cobro | BILL `1000` + settle `2000` => sólo `2000` cuenta, no `3000` | sin doble suma |
| BILL no duplica | BILL `5000` => `account.tipMinor 0`; settle `0` => sigue `0` | sólo settlements suman |
| split por pagador | FIXED/PERCENTAGE/EQUAL_PARTS por pagador con tips `500/200/100` => `tipMinor 800` y `paid 10000 saldo 0`; EQUAL_PARTS 3×`3000` con `tip 300` c/u => `tip 900` | split tip |
| recarga sin duplicar | parcial `3000+tip400` saldo `3000`, agregar ronda `4000` => `consumo 10000 tip 400 saldo 7000`, liquidar resto `tip100` => `tip 500 saldo 0` | no duplicación |
| smartTips off | BILL `tip>0` => `403 SMART_TIPS_DISABLED`, `tip0` OK; settle `tip>0` => `403` (también `settle-and-close`), `tip0` OK | backend 4xx |
| reviews off | `POST /feedback` => `403 REVIEWS_DISABLED` 0 filas | sin insert |
| feedback válido | `rating 5 + comment` => `201` sin `token/PII`, 1 fila | privado |
| rating inválido | `0,6,3.5,"5",null,undefined` => `400 INVALID_RATING` | validación |
| comentario inválido | `>1000` => `400 COMMENT_TOO_LONG`; no string => `400 INVALID_COMMENT`; `1000` OK | límite |
| sesión inválida | `404 SESSION_NOT_FOUND`, `410 SESSION_EXPIRED/CLOSED` 0 filas | vigencia |
| duplicado/concurrente | segundo `feedback` => `409 FEEDBACK_ALREADY_EXISTS` 1 fila; `Promise.all` => `201+409` 1 fila | 409 |
| Place ID ausente/inválido | `null` => `REVIEWS_INTERNAL_ACTIVE_GOOGLE_UNCONFIGURED` y feedback interno OK; `PATCH` con `"<script>"`/`"; DROP`/`>128`/`spaces` => `400 INVALID_GOOGLE_PLACE_ID` sin persistir; sanitizado no expone XSS | Place ID |

### 4.2 Regresiones (Vitest vía `scripts/test-local.mjs`)

```
node scripts/test-local.mjs calls-feedback-access.test.ts b03-session-account.test.ts b04-account-settle.test.ts e05-split-bill.test.ts capabilities-contract.test.ts capabilities-unit.test.ts capability-update-policy.test.ts cash-contract.test.ts
Test Files  8 passed (8)
     Tests  115 passed (115)
```

```
node scripts/test-local.mjs e04-service-context.test.ts sales-reports-settle.test.ts monetary-convergence.test.ts
Test Files  3 passed (3)
     Tests  28 passed (28)
```

No se relajaron pruebas; invariantes de `B03/B04/E05` intactos (saldo, tip por settlements, idempotencia, fingerprint).

### 4.3 Verificaciones de integridad

- **Prisma generate** (`npm run prisma:generate`): `Generated Prisma Client (v5.22.0)` sin errores.
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
- **Compilación cliente/staff/admin** (`npm run build --workspace=apps/client-web|staff-panel|admin-dashboard`):
  ```
  client-web: vite v6.4.3 — 4 modules — built in ~1.6s
  staff-panel: vite v6.4.3 — 1609 modules — built in ~4s
  admin-dashboard: vite v6.4.3 — 1807 modules — built in ~6s
  ```
- **Higiene diff** (`git diff --check`): sólo warnings `LF will be replaced by CRLF` (schema.supabase.prisma, fauno-catalog.test.mjs), `exit 0` sin trailing whitespace.
- **Contrato existente**: no requirió adaptar tests previos; se conserva validación `suggestedTipPercentages 0..100` y `sanitizeGooglePlaceId`.

---

## 5. Tareas Pendientes y Riesgos

### `PENDING_CLOUD`
- No declarar producción/cloud: despliegue a Vercel/Supabase, seed y verificación SHA/alias se coordinan fuera de E06 (hito integración). No se ejecutó `deploy:supabase:push`, `vercel-build` ni migraciones en instancia compartida.

### `PENDING_HUMAN`
- Validación en salón con dos dispositivos: comensal elige `10/15/20%` y monto fijo (incluido `0`) y staff edita `tipMinor` antes de cobrar por pagador (split `FIXED/PERCENTAGE/EQUAL_PARTS`), verificando que la cuenta muestra `consumoMinor` como base y que `requestedTipMinor` no se duplica al liquidar.
- Probar con módulos apagados: `enableSmartTips=false` debe ocultar/ignorar propina en cliente y rechazar `tip>0` en `BILL`/`settle` con `403`; `enableReviews=false` debe ocultar formulario y rechazar `POST /feedback` con `403`.
- Comprobar reseña interna `1..5` y `<=1000` con duplicado intencional (doble tap) => `409` y Place ID válido/inválido muestra/oculta enlace Google sanitizado sin depender de rating.

### Revisión independiente
- **`PASS_E06`**: revisión independiente read-only de Antigravity, conversación `e9ad51dc-29ce-4ae2-a030-edc2b61993e7`, sobre el mismo worktree y sin modificar archivos.
- El informe externo verificó los contratos `SMART_TIPS_DISABLED`/`REVIEWS_DISABLED`, la separación `CallRequest.tipMinor` versus `AccountSettlement.tipMinor`, split/recarga, sanitización de Place ID y builds/tests focales. Artefacto: `C:\Users\rodri\.gemini\antigravity-cli\brain\e9ad51dc-29ce-4ae2-a030-edc2b61993e7\E06-INDEPENDENT-REVIEW.md`.

### Riesgos y mitigaciones
- **Doble suma BILL + settlement**: mitigado por proyección que suma sólo `AccountSettlement.tipMinor`; test `BILL no duplica` lo verifica.
- **Tip por pagador duplicado tras otra ronda**: `buildSessionAccount` recalcula `consumoMinor` y suma `tipMinor` sólo de settlements existentes; test `recarga sin duplicar` lo cubre.
- **Bypass UI con smartTips/reviews apagados**: backend responde `403 SMART_TIPS_DISABLED`/`REVIEWS_DISABLED`; cliente/staff/admin sanitizan/ocultan pero no confían sólo en UI.
- **Place ID peligroso**: validación `sanitizeGooglePlaceId` + `INVALID_GOOGLE_PLACE_ID` y admin sanitiza + `encodeURIComponent`; test de inyección lo cubre.
- **Comentario largo / rating no entero**: validación `400` sin `500`; feedback único por `tableSessionId` evita duplicados aun con concurrencia.

---

## 6. Notas de contrato

- Si el contrato existente requiere adaptar tests previos, se conservaron sus invariantes y se documenta aquí: no se requirió adaptación (sólo adición de `e06-tips-reviews.test.ts` y corrección de sanitización admin, sin cambiar semántica de `buildSessionAccount`/`calculateSessionBalance`).
- No se agregó login de cliente ni perfil.
- No se tocaron `E07+`, no hay `commit/push/deploy`, no se leyeron producción/secretos.

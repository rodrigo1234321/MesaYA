# E00 — Baseline reproducible (plan simplificación operativa)

Fecha: 2026-09-09
Alcance: únicamente bloque E00-E03. No modifica etapas E04-E15.

## 1. Checkout y estado preexistente

- Repo: `mdpmesasvivas` (MesaYA). Rama de trabajo con cambios preexistentes sin commitear
  (checkout compartido). Regla: no revertir ni commitear esos cambios; el diff de E00-E03
  es aditivo sobre ellos.
- Verificación:
  - `git status --short` (muestra ~60 ficheros M/?? preexistentes del checkout compartido)
  - `git log --oneline -10` (HEAD `0773ca6 feat(core): add pilot capabilities contract...`)
- Cambios preexistentes preservados: no se toca `deploy/`, screenshots, ni planes
  `plan-integral-piloto-2026-09/`, `plan-producto-*`, `plan-ux-servicio-2026-09-08/`.

## 2. Base efímera y comandos de prueba

- API: SQLite efímera en tests (`packages/api/test/*.test.ts` con `buildApp()` + `app.inject()`).
- No usar base real ni URL PostgreSQL ficticia como evidencia de runtime.
- Comandos:
  - `npm --workspace=@mesaya/api run test` → `node ../../scripts/test-local.mjs` (suite local)
  - Focales G-A: `b05-safe-release`, `b04-account-settle`, `qr-session-lifecycle`,
    `cash-contract`, `e00-e03-gate-a` (nuevo), `route-matrix-guard`
  - `npm --workspace=@mesaya/api run build` (prisma generate + tsc)
  - `node scripts/check-route-matrix.mjs` (gate Etapa 27)

## 3. Inventario de flujos heredados `payOrder` / `getCashOrders`

Reauditado 2026-09-09 (bloque E00-E03): números de línea actualizados; verificar por `grep`, no sólo por número.

| Símbolo | Ubicación | Rol actual |
|---|---|---|
| `POST /v1/staff/orders/:id/pay` → `OrderService.registerManualPayment` | `packages/api/src/routes/orders.routes.ts:401` + `order.service.ts:registerManualPayment` | **Cobro legado por comanda.** Se conserva sólo por compatibilidad; E01 lo deprecó como camino normal (`Deprecation: true`). |
| `StaffApi.payOrder` | `apps/staff-panel/src/lib/api.ts` | Llamado sólo desde flujo Caja heredado. |
| `CashManager.tsx` | `apps/staff-panel/src/components/CashManager.tsx` | Cadena frágil `payOrder` + `closeTableSession` que E03 reemplaza por `settle-and-close`. |
| `GET /v1/staff/restaurants/:id/cash-orders` → `getCashOrders` + `getCashAccounts` | `orders.routes.ts:177` + `order.service.ts:getCashOrders/getCashAccounts` | `orders` = filas legadas por comanda (compat); `accounts` = cuenta agregada por sesión B03 (canónica). |
| `POST /v1/staff/sessions/:sessionId/settle` → `settleSessionAccount` | `orders.routes.ts:211` + `order.service.ts:settleSessionAccount` | **Camino canónico de cobro por cuenta de sesión.** No marca PAID ni libera mesa. |
| `getSessionAccountTx / getSessionAccount` | `order.service.ts:getSessionAccount` | Verdad de cuenta: `saldo = consumo confirmado − pagos asignados`. |

## 4. Inventario de rutas que crean / resuelven / cierran sesiones

| Ruta / método | Ubicación | Comportamiento |
|---|---|---|
| `GET /v1/sessions/:slug/:tableLabel` (QR físico, read-only) | `sessions.routes.ts:29` + `session.service.ts:getOrCreateActiveSessionBySlugAndTable` | Nunca crea ni muta nada. Sin turno/sesión → `200 valid:false isActive:false` sin token. Con sesión → token vigente. QR = slug+mesa estables, nunca token. Durante `TO_CLEAN` → inactivo sin token ni cuenta anterior; después de `Mesa lista` la FSM ya dejó preparada una sesión nueva y el QR la resuelve. |
| `GET /v1/sessions/:token` | `sessions.routes.ts:5` + `session.service.ts:validateToken` | E02: `404` desconocido, **`410` cerrado/expirado/TO_CLEAN**, `200` vigente. |
| `GET /v1/sessions/table/:label` (legacy) | `sessions.routes.ts:45` | `403` por defecto; con flag de test nunca expone tokens operativos. |
| `POST /v1/tables/:id/close-session` | `tables.routes.ts:85` + `session.service.ts:closeTableSession` | Cierre explícito atómico: deuda/borrador/validación/llamados → `409` con `code`; `force` exige MANAGER+motivo y nunca salta deuda; lleva a `TO_CLEAN`, nunca `AVAILABLE` directo. Ruta devuelve `code/details`. |
| `POST /v1/tables/:id/new-session` | `tables.routes.ts:117` + `session.service.ts:createNewSessionForTable` | **E02 endurecido:** mismos guardas que el cierre (409 si hay deuda/borrador/revisión/llamado) + `409 TABLE_NEEDS_CLEANING` si `TO_CLEAN` hasta `Mesa lista`; carrera → una sola ocupación vía `activeKey` única. Ruta devuelve `code/details`. |
| `POST /v1/staff/sessions/:sessionId/settle` | `orders.routes.ts:211` | Cobro canónico idempotente por cuenta (B04). |
| `POST /v1/staff/sessions/:sessionId/settle-and-close` (E03) | `orders.routes.ts:255` + `order.service.ts:settleAndCloseSessionAccount` | Comando atómico: revalida versión, registra pago total, cierra sesión (`closedAt` + `activeKey null`), revoca token, `TO_CLEAN`. Reintento con misma clave no duplica. `TO_CLEAN` es la señal de limpieza en plano/Servicio (sin fila extra en este bloque). |
| FSM `TO_CLEAN → AVAILABLE` (`Mesa lista`) | `fsm.service.ts:resolveNextState` + `tablestate.routes.ts` | Única vía para habilitar la siguiente ocupación tras limpieza física. Revocación FSM limpia `closedAt` + `activeKey` y deja preparada una `TableSession` nueva, vacía y con token rotativo. El GET del QR sigue siendo read-only. |
| `getOrCreateOperationalSession(Tx)` | `session.service.ts:getOrCreateOperationalSessionTx` | Selección/saneamiento/alta atómica usada por FSM y pedido presencial; cierra sólo sesiones resueltas, `409 STALE_SESSION_UNRESOLVED` si hay pendientes; `409 TABLE_NEEDS_CLEANING` si `TO_CLEAN`. |

## 5. Recorrido y conteo de clics antes del cambio (baseline)

- Mozo cobraba por Caja heredada: abrir Caja → `payOrder` por comanda → volver → `closeTableSession`
  (mínimo 2 intenciones + navegación entre pantallas).
- Objetivo E03/E10 (fuera de este bloque, sólo se deja la base): `Cobrar y cerrar`
  en 1 acción primaria + PIN si aplica, sin abrir Caja ni Admin.
- Cliente/staff/ledger ya coinciden vía `getSessionAccount`; el problema era orquestación,
  no los controles (versión, idempotencia, ledger, reautorización se conservan).

## 6. Decisión PASS / NEEDS_REVIEW / BLOCKED

- `PASS` para E00 una vez creados `E00-BASELINE.md`, `04-CONTRATO-CANONICO-E01.md` y el
  inventario verificable por `grep` sobre las rutas de §3-§4.
- Riesgo residual: el checkout compartido tiene muchos ficheros M/??; el diff de E00-E03
  debe revisarse con `git diff --check` y `git diff --stat` para no arrastrar cambios ajenos.

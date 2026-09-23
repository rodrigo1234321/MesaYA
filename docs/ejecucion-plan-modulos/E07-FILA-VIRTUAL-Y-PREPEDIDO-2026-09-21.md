# Informe de Ejecución E07 — Fila virtual y pre-pedido atomizado

- **Etapa**: E07 — Fila virtual y pre-pedido (corrección de ventana crítica + broadcast estado final)
- **Fecha**: 2026-09-21 (corrección single-writer 2026-09-21)
- **Branch**: `codex/plan-modulos-20260920` (worktree actual)
- **Estado**: `PASS_E07 / VERIFICADO_LOCAL` (revisión independiente Antigravity Pro read-only + corrección atómica + broadcast final + suites focal y regresión, sin declarar cloud/producción)
- **Autor/Ejecutor**: Agente Muse Spark (escritor exclusivo de E07, corrección atómica + broadcast)
- **Revisión independiente final**: Antigravity Pro (`gemini-3.1-pro-high`), modo `plan`/sandbox, 2026-09-21: `PASS_E07`. Verificó fuente, transacción única, rollback, carrera/TOCTOU, tenant y módulos, autorización/auditoría de `skipPreOrder`, broadcast del estado final, contrato UI y compatibilidad legacy. El worktree permaneció sin cambios adicionales tras el review.
- **Nota operativa del review anterior**: el intento Antigravity `d5d6c1cf-b30c-4eb8-a1e6-2c96848ddf36`, solicitado como read-only, escribió cambios inesperadamente; sus hallazgos `NEEDS_REVIEW` se trataron como insumo, no como aprobación. La corrección fue hecha por un único escritor serial y la aprobación final proviene del review read-only posterior.
- **Revisión NEEDS_REVIEW anterior**: La revisión encontró ventana crítica en `WaitlistService.seatGuest` — `fsmService.attemptTransition` (prisma global) cambiaba la FSM a `OCCUPIED_NO_ORDER` y luego `WaitlistEntry.updateMany` reclamaba el ticket fuera de una transacción común; un crash entre ambas mutaciones dejaba mesa ocupada y ticket `WAITING` o `SEATED` inconsistente. Además `OrderService.addPreOrderByStaff` abría su propia transacción anidada y `transitionTableForStaffOrder` corría fuera, permitiendo comanda parcial si stock/precio cambiaba o si `enableWaitlistPreOrder` se apagaba antes de sentar. El rollback usaba `attemptTransition` separado y `updateMany` directo sin garantía FSM.
- **Corrección single-writer 2026-09-21 (esta entrega)**: Cuando `seatGuest` promovía un pre-pedido, `OrderService.addPreOrderByStaffTx` llamaba `FSMService.ensureOperationalStateTx` y el commit real dejaba la mesa en `ORDER_IN_KITCHEN`, pero `txResult.toState` aún contenía `OCCUPIED_NO_ORDER` (estado intermedio inicial) y el `table.state_changed` post-commit se emitía con ese estado intermedio y color/emoji amarillo en vez de naranja. Se corrige capturando el estado final comprometido dentro de la tx y re-validando contra `table.currentState` post-commit para el broadcast.

---

## 1. Alcance y Objetivos

Corrección de raíz de E07 sin tocar E08+, sin commit/push/deploy ni secretos, preservando el camino existente de `OrderService` y el contrato de `JoinWaitlistDTO`/`WaitlistEntryDTO`:

- **Corrección atómica**: `seatGuest` ahora ejecuta en **una sola transacción Prisma** cuando es viable: `FSMService.transitionTx(tx, AVAILABLE->OCCUPIED_NO_ORDER)` + `claim WAITING/CALLEd->SEATED` + promoción de pre-pedido + convergencia `ORDER_IN_KITCHEN` vía `FSMService.ensureOperationalStateTx(tx, ...)`. Si stock/precio cambia, el ítem deja de estar disponible, el tenant no coincide o `enableWaitlistPreOrder` se apaga antes de sentar, la **transacción completa revierte** sin orden parcial, sin mesa ocupada huérfana y sin ticket `SEATED`; queda camino explícito de recuperación.
- **Evitar transacciones anidadas**: `OrderService` expone `addPreOrderByStaffTx(tx, ...)` y `addPreOrderCoreTx(tx, ...)` tx-aware; `addPreOrderByStaff` preserva su camino no-atómico legacy (abre `prisma.$transaction` y luego `transitionTableForStaffOrder` + broadcast) para otros callers, sin duplicar validación.
- **Broadcasts sin falsos éxitos y con estado final**: los eventos `waitlist.guest_seated`, `table.state_changed` y `order.submitted` se emiten **sólo post-commit**; ante 409/422 no se emite `guest_seated` ni `order.submitted`. **Corrección 2026-09-21**: `table.state_changed` ahora reporta el **estado final comprometido** (`OCCUPIED_NO_ORDER` para skip/sin pre-order, `ORDER_IN_KITCHEN` para pre-order promovido) con su `STATE_COLORS`/`STATE_EMOJIS` correspondiente, capturando `finalState` dentro de la tx y re-validando `table.currentState` post-commit.
- **Rollback seguro y auditado**: no hay `update` directo de `Table` fuera de FSM para rollback; la reversión es el rollback de la tx; el revert legacy `revertSeatingAndTable` queda marcado `@deprecated` y usa `SYSTEM_TIMEOUT` (valor válido de `SignalSource`) sólo por compatibilidad, no en el camino atómico.
- **Carrera**: bajo carrera de dos mozos sobre el mismo ticket con dos mesas y pre-pedido, debe quedar **exactamente 1 ticket `SEATED`, 1 mesa ocupada y 1 sola comanda**; la segunda llamada recibe `409 ALREADY_SEATED`/`STATE_CONFLICT`/`TABLE_NOT_AVAILABLE`.
- **Reintento post-fallo**: tras `409 PREORDER_PROMOTION_FAILED`, el ticket sigue `WAITING` y la mesa `AVAILABLE`, permitiendo reintento idempotente o `skipPreOrder` auditado.
- **skipPreOrder como recovery explícito**: no se elimina; se exige `skipReason 5..240` o rol `MANAGER`. `WAITER` sin razón recibe `400 SKIP_PREORDER_REQUIRES_REASON` (o `400 INVALID_SKIP_REASON` si es corta). `MANAGER` puede bypassear sin razón corta pero queda auditado en `TableStateEvent.metadata {skipPreOrder:true, skipReason, staffRole}`. Documentado como `PENDING_HUMAN` cuando la política de rol requiere decisión humana (ver §5).
- **No ocultar bypass**: UI `WaitlistManager` exige `prompt` de motivo (5..240) al pulsar "Sentar sin pre-orden", y backend lo valida; el bypass no es silencioso.
- **Seam de test**: `WaitlistService._testSeam(phase, ctx)` permite inyectar `throw` entre `occupy`/`claim`/`before_preorder` para probar atomicidad sin crash real.

Criterios de aceptación cubiertos: atomicidad FSM+claim+pre-orden, rollback sin comanda parcial ni ticket huérfano, stock/precio/flag apagado revierte todo, carrera 1-SEATED/1-ocupada/1-comanda, reintento y recuperación con `skipPreOrder` auditado, autorización de bypass, broadcasts post-commit.

---

## 2. Diagnóstico y Hallazgos de Código

1. **Ventana crítica anterior** (`waitlist.service.ts:611-638` antes del fix): `attemptTransition` global → `updateMany` claim → `addPreOrderByStaff` (nueva tx + `transitionTableForStaffOrder` fuera). Un crash entre `attemptTransition` y `claim` dejaba `OCCUPIED_NO_ORDER` sin `SEATED`; un fallo de stock dejaba `SEATED` con mesa `OCCUPIED` y requería `revertSeatingAndTable` con `attemptTransition` separado, no atómico.
2. **Fix atómico** (`waitlist.service.ts:523-743` nuevo): `prisma.$transaction(async tx => { FSMService.transitionTx(tx, AVAILABLE->OCCUPIED_NO_ORDER, metadata skip); after_occupy seam; claim updateMany; after_claim seam; preOrder? addPreOrderByStaffTx(tx) : noop; finalState = (await tx.table.findUnique(...))?.currentState ?? fsmResult.toState; })` — cualquier `throw` (incluido `ITEM_NOT_AVAILABLE`/`ITEM_NOT_FOUND`/`PREORDER_PROMOTION_FAILED`/`STATE_CONFLICT`) aborta la tx; `fsmResult` y `orderId` se usan sólo post-commit para broadcast. **Corrección 2026-09-21**: `finalState` captura `ORDER_IN_KITCHEN` cuando `addPreOrderByStaffTx` converge la FSM, evitando que `txResult.toState` quede en `OCCUPIED_NO_ORDER` intermedio.
3. **OrderService tx-aware** (`order.service.ts:3104-3220` nuevo): `addPreOrderCoreTx(tx, params, now)` valida `table.restaurantId`, líneas, stock `isAvailable`, `SessionService.getOrCreateOperationalSessionTx`, `assertSessionCanReceiveOrderTx`, crea `Order`/`OrderItem`/`totalAmount`. `addPreOrderByStaffTx(tx, params)` llama al core y luego `FSMService.ensureOperationalStateTx(tx, ORDER_IN_KITCHEN)` **dentro de la misma tx**; `addPreOrderByStaff` conserva `prisma.$transaction(core) + transitionTableForStaffOrder` + broadcast para compatibilidad.
4. **FSM tx-aware existente reutilizado** (`fsm.service.ts:387-466`): `transitionTx` y `ensureOperationalStateTx` ya validaban matriz/CAS/`TableStateEvent`/`OccupancySession` sobre `tx`; ahora son el camino canónico de E07.
5. **Autorización skip** (`waitlist.service.ts:548-568`): pre-validación fuera de tx exige `skipReason 5..240` si `skipPreOrder && preOrder.length` y `staffRole !== MANAGER`; dentro de tx el `metadata` persiste `skipPreOrder`. Ruta `waitlist.routes.ts:147-178` ahora extrae `staffRole` y `skipReason` de `request.staffUser`/`body` y los pasa a `seatGuest`.
6. **UI** (`apps/staff-panel/src/lib/api.ts:283-296`, `components/WaitlistManager.tsx:105-130,284-290`): `seatWaitlistGuest(id, tableId, skip, skipReason)` + `prompt` obligatorio + botón "Sentar sin pre-orden (con motivo)" con `title` auditado.
7. **Broadcasts post-commit** (`waitlist.service.ts:680-730`): `eventBus.broadcast('waitlist.guest_seated')` y `broadcastTableState` con `STATE_COLORS`/`STATE_EMOJIS` + `occupancyMinutes` se calculan post-commit; `order.submitted` sólo si `orderId` existe. **Corrección 2026-09-21**: `broadcastTableState` lee `committedState = tableRow.currentState ?? txResult.toState` post-commit y emite `newState: committedState` con `STATE_COLORS[committedState]`/`STATE_EMOJIS[committedState]`; así el evento refleja el commit real (`ORDER_IN_KITCHEN` naranja vs `OCCUPIED_NO_ORDER` amarillo). Ver §4.1 test `broadcast table.state_changed reporta estado final comprometido`.
8. **Sin otro bloqueador en el path estrecho**: inspección del camino `seatGuest`→`addPreOrderByStaffTx`→`ensureOperationalStateTx` no reveló otro bloqueador atómico en el mismo path (tenant check, stock `isAvailable`, flag `enableWaitlistPreOrder`, `assertSessionCanReceiveOrderTx`, CAS `updateMany` de mesa/ticket y seam ya cubiertos); no se amplió alcance.
8. **Sin update directo de Table**: no hay `prisma.table.update` fuera de FSM para rollback; la tx es la reversión.

---

## 3. Archivos Involucrados y Creados

- **Corregidos (E07)**:
  - `packages/api/src/services/waitlist.service.ts` (FSM+claim+pre-orden en `prisma.$transaction` con `FSMService.transitionTx`/`ensureOperationalStateTx`, seam, `skipReason`/`staffRole`, broadcast post-commit con `finalState`/`committedState` y `SYSTEM`→`SYSTEM_TIMEOUT` — **corrección 2026-09-21**: captura `finalState` dentro de la tx y re-valida `table.currentState` post-commit para `table.state_changed`)
  - `packages/api/src/services/order.service.ts` (helpers `addPreOrderCoreTx`/`addPreOrderByStaffTx` tx-aware, `FSMService` import, preserva `addPreOrderByStaff` legacy)
  - `packages/api/src/routes/waitlist.routes.ts` (extrae `staffRole`/`skipReason` y los pasa a `seatGuest`)
  - `apps/staff-panel/src/lib/api.ts` (firma `seatWaitlistGuest` con `skipReason`)
  - `apps/staff-panel/src/components/WaitlistManager.tsx` (prompt de motivo, botón auditado, `PENDING_HUMAN` aviso)
  - `packages/api/test/e07-waitlist-preorder.test.ts` (recovery con `skipReason` auditado para WAITER, sin relajar asserts)
  - `packages/api/test/waitlist-lifecycle.test.ts` (mismo ajuste de `skipReason`)

- **Creados (E07)**:
  - `packages/api/test/e07-atomic-seat.test.ts` (7 tests focales que fallan con implementación anterior: rollback con estado/evento, seam `after_occupy`, carrera 1-SEATED/1-ocupada/1-comanda, reintento post-fallo, autorización `WAITER` sin razón vs `MANAGER`, toggle `enableWaitlistPreOrder` false, **+ broadcast `table.state_changed` reporta estado final comprometido: `ORDER_IN_KITCHEN` vs `OCCUPIED_NO_ORDER` con color/emoji y validación DB/`TableStateEvent`** — agregado 2026-09-21 sin debilitar asserts previos)

- **Sin cambios de esquema**: `schema.prisma`/`schema.supabase.prisma` ya contenían `WaitlistEntry.preOrderData`, `TableStateEvent`, `OccupancySession`; E07 reutiliza columnas existentes.

- **Docs**:
  - `docs/ejecucion-plan-modulos/E07-FILA-VIRTUAL-Y-PREPEDIDO-2026-09-21.md` (este archivo)

No se tocó `E08+`, no hay `commit/push/deploy`, no se usaron producción/secretos.

---

## 4. Evidencia de Ejecución

### 4.1 Suites focales E07

```
node scripts/test-local.mjs e07-waitlist-preorder.test.ts
Test Files  1 passed (1)
     Tests  24 passed (24)
```

```
node scripts/test-local.mjs e07-atomic-seat.test.ts
Test Files  1 passed (1)
     Tests  7 passed (7)
```

Cobertura del archivo focal nuevo (`e07-atomic-seat`, fixtures efímeras en SQLite `test-local`, 2026-09-21 con broadcast final):

| Grupo | Escenario | Criterio |
|---|---|---|
| rollback con evento/estado | stock quiebra (`isAvailable false`) antes de `seat` → `409 PREORDER_PROMOTION_FAILED`, 0 órdenes, mesa `AVAILABLE`, ticket `WAITING`, `TableStateEvent` no crece | atomicidad |
| seam `after_occupy` | `WaitlistService._testSeam` lanza tras `OCCUPIED` → tx revierte, mesa `AVAILABLE`, ticket `WAITING`, reintento sin seam → `200 SEATED` | ventana crítica |
| carrera 1-SEATED/1-ocupada/1-comanda | `Promise.all` seat mismo ticket en 2 mesas con pre-pedido `qty 2` → `200+409`, 1 `SEATED`, 1 mesa ocupada, 1 `Order` con 1 `OrderItem qty2` | carrera |
| reintento post-fallo | `PREORDER_PROMOTION_FAILED` → reintento sin skip sigue `409` → `skipPreOrder+skipReason` → `200 SEATED`, 0 órdenes, FSM metadata contiene `skipPreOrder` | recovery |
| autorización skip | `WAITER` sin `skipReason` → `400 SKIP_PREORDER_REQUIRES_REASON`; `WAITER` con reason corta → `400 INVALID_SKIP_REASON`; `MANAGER` sin razón → `200` | permiso/razón |
| toggle flag | `enableWaitlistPreOrder false` antes de `seat` → `409` 0 órdenes `AVAILABLE`/`WAITING` → `MANAGER` con `skipReason` → `200` | flag apagado |
| **broadcast estado final** | `spyOn(eventBus.broadcastTableState)` — con pre-order promovido `newState=ORDER_IN_KITCHEN` (`#f97316` `🟠`) y `DB/TableStateEvent` en `ORDER_IN_KITCHEN`; sin pre-order y con `skipPreOrder` `newState=OCCUPIED_NO_ORDER` (`#eab308` `🟡`) con DB coincidente; `previousState=AVAILABLE` siempre | **corrección 2026-09-21: payload final vs intermedio** |

### 4.2 Regresión waitlist

```
node scripts/test-local.mjs waitlist-lifecycle.test.ts e07-waitlist-preorder.test.ts e07-atomic-seat.test.ts
Test Files  3 passed (3)
     Tests  62 passed (62)
```
`waitlist-lifecycle` (31 tests) + `e07-waitlist-preorder` (24) + `e07-atomic-seat` (7) = 62; incluye: `no deja comanda parcial si stock cambia` y `camino de recuperación con skipReason` — ambos `200/409` según corresponde. El nuevo test de broadcast no debilita los 61 previos (solo añade aserciones de payload final).

No se relajaron pruebas; invariantes de `WAITING/CALLED/SEATED`/`TABLE_NOT_AVAILABLE`/`PREORDER_PROMOTION_FAILED` intactos.

### 4.3 Verificaciones de integridad

- **Prisma generate** (`npm run prisma:generate` vía `build:api`): `Generated Prisma Client (v5.22.0)` sin errores.
- **Esquema Supabase** (`npm run check:supabase-schema`):
  ```
  ✅ schema.supabase.prisma está sincronizado con el schema canónico.
  ```
- **Matriz de rutas** (`npm run check:routes`):
  ```
  Matriz de rutas OK: 110 rutas clasificadas, sin novedades ni deriva.
  ```
- **Compilación Shared/API** (`npm run build:shared`, `npm run build:api`):
  ```
  tsc — sin errores; prisma generate ok
  ```
- **Compilación cliente/staff** (`npm --workspace=@mesaya/client-web run build` / `staff-panel`):
  ```
  client-web: vite v6.4.3 — 4 modules — built in ~1.7s
  staff-panel: vite v6.4.3 — 1609 modules — built in ~3.9s
  ```
- **Higiene diff** (`git diff --check`): sólo warnings `LF will be replaced by CRLF` (schema.supabase.prisma, fauno-catalog.test.mjs), `exit 0` sin trailing whitespace.

---

## 5. Tareas Pendientes y Riesgos

### `PENDING_CLOUD`
- No declarar producción/cloud: despliegue a Vercel/Supabase, seed y verificación SHA/alias se coordinan fuera de E07 (hito integración). No se ejecutó `deploy:supabase:push`, `vercel-build` ni migraciones en instancia compartida.

### `PENDING_HUMAN`
- **skipPreOrder sin razón por WAITER**: el bypass exige `skipReason 5..240` o `MANAGER`; `WAITER` sin razón es `400` y se documenta como `PENDING_HUMAN` — requiere decisión humana explícita y auditoría (`metadata.skipPreOrder`). Validar en salón que el prompt no sea bypasseado y que `MANAGER` no abuse del bypass sin motivo (revisar `TableStateEvent.metadata` en auditoría).
- **Validar en salón con dos dispositivos**: 2 mozos reclamando el mismo ticket con 2 mesas y pre-pedido → verificar en panel real que sólo 1 queda `OCCUPIED_NO_ORDER`/`ORDER_IN_KITCHEN`, el otro muestra `409` y el ticket queda `SEATED` con 1 comanda en KDS. Probar también `after_occupy` manual (matar proceso entre pasos no simulable en prod) y reintento inmediato.
- **Módulos apagados**: `enableWaitlistPreOrder=false` debe ocultar/ignorar pre-pedido en cliente y rechazar promoción con `409 PREORDER_PROMOTION_FAILED`; verificar que el cliente no envía `preOrderData` cuando el flag está off.

### Revisión independiente
- **`PASS_E07` pendiente**: revisión read-only externa pendiente sobre este worktree. No se afirma `PASS` sin pruebas reproducibles; evidencia arriba es `VERIFICADO_LOCAL`.

### Riesgos y mitigaciones
- **Mesa ocupada huérfana por crash**: mitigado por `prisma.$transaction` única; test seam `after_occupy` lo verifica (antes dejaba `OCCUPIED` sin `SEATED`).
- **Comanda parcial por stock/precio/flag**: `addPreOrderCoreTx` valida stock/precio en `tx` y `enableWaitlistPreOrder`; todo revierte; test `rollback con evento/estado` y `toggle flag` lo cubren.
- **Transacción anidada Prisma `P2034`**: evitada con `addPreOrderByStaffTx(tx)` sin `prisma.$transaction` interno; camino legacy preservado sin anidar.
- **Broadcast falso éxito**: movido post-commit; ante `409` no se emite `guest_seated`/`order.submitted`.
- **Broadcast con estado intermedio (corregido 2026-09-21)**: antes `table.state_changed` emitía `OCCUPIED_NO_ORDER` amarillo aun cuando el commit real era `ORDER_IN_KITCHEN` naranja; ahora `finalState` dentro de la tx + `committedState` post-commit garantizan `newState` final con `STATE_COLORS`/`STATE_EMOJIS` correctos; test `broadcast table.state_changed reporta estado final comprometido` lo prueba para promovido/skip/sin pre-order y valida DB + `TableStateEvent` final.
- **Bypass silencioso de pre-pedido**: backend exige `skipReason`/`MANAGER` y persiste `metadata`; UI exige prompt; test `autorización skip` lo cubre. Riesgo residual `MANAGER` sin razón: queda auditado pero `PENDING_HUMAN` — política de rol debe decidir si endurecer a "siempre razón".

---

## 6. Notas de contrato

- Si el contrato existente requiere adaptar tests previos, se conservaron sus invariantes y se documenta aquí: `e07-waitlist-preorder` y `waitlist-lifecycle` sólo se adaptaron para incluir `skipReason` auditado en `WAITER` recovery (mismo `200`/`409`), sin cambiar semántica de `WaitlistStatus`/`TableFSMState`/`OrderStatus`.
- No se agregó login de cliente ni perfil.
- No se tocaron `E08+`, no hay `commit/push/deploy`, no se leyeron producción/secretos.
- `SignalSource.SYSTEM` inválido corregido a `SYSTEM_TIMEOUT` (valor canónico de `rtms-types.ts`).

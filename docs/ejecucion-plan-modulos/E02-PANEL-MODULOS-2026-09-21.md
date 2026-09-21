# E02 — Panel de Módulos Coherente

- **Fecha de ejecución:** 2026-09-21
- **Agente escritor:** Antigravity (único agente escritor en worktree local)
- **Worktree:** `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-plan-20260920`
- **Rama:** `codex/plan-modulos-20260920` (rastreada a `origin/main`)
- **HEAD SHA base:** `6a1cdaead105750dfc6808cac1383018bb58ee15`
- **Documento rector:** `docs/PLAN-MODULOS-Y-BASE-POR-LOCAL-2026-09-20.md`
- **Etapa previa:** `docs/ejecucion-plan-modulos/E01-CATALOGO-UNICO-2026-09-21.md` (VERIFICADO_LOCAL)
- **Estado de etapa E02:** `VERIFICADO_LOCAL`

---

## 1. Resumen Ejecutivo y Diagnóstico Resuelto

El objetivo de la etapa **E02** es asegurar la **honestidad y coherencia operativa total** del panel administrativo de módulos (`ModuleConfigManager.tsx`), el servicio de capacidades de la API (`config.service.ts`) y su propagación autoritativa hacia el cliente web del comensal (`apps/client-web/app.js`) y el personal de salón (`apps/staff-panel/src/components/ServiceWorkspace.tsx`).

### Problemas Diagnosticados y Resueltos

1. **Bug Bloqueante de Toggles en Admin (`ModuleConfigManager.tsx`)**:
   - *Diagnóstico previo:* La función `capabilityBlocked(key)` evaluaba `Boolean(capability && !capability.effectiveEnabled && !capability.configuredEnabled)`. Si un módulo disponible venía apagado de fábrica o por configuración (ej. `enableRewards: false`, `enableWaitlist: false`, `allowWaitersToCollectCash: false`), tanto `configuredEnabled` como `effectiveEnabled` eran `false`. En consecuencia, `capabilityBlocked` devolvía `true` y colocaba el switch en `disabled={true}`. Simultáneamente, `handleToggle` evaluaba `if (capability && !capability.effectiveEnabled && !config[key])` e interrumpía con un mensaje de error espurio.
   - *Corrección aplicada:* Se corrigió la lógica en ambos métodos. Una capacidad solo se bloquea para el encargado si su estado de plataforma **no es disponible**: `capability.state !== CapabilityState.AVAILABLE` (como `COMING_SOON` o `MISCONFIGURED`). Los módulos en estado `AVAILABLE` que estén apagados pueden encenderse y guardarse sin ningún obstáculo.

2. **Toggle Faltante y Estado Erróneo de Reseñas (`enableReviews`)**:
   - *Diagnóstico previo:* `ModuleConfigManager.tsx` exponía el campo de texto `googlePlaceId`, pero **no incluía ningún interruptor** para activar/desactivar `enableReviews`. Adicionalmente, en `config.service.ts`, si `enableReviews` era `false`, se asignaba erróneamente `state: CapabilityState.COMING_SOON`.
   - *Corrección aplicada:*
     - En `config.service.ts`, `reviews` mantiene siempre `state: CapabilityState.AVAILABLE`, con `configuredEnabled: false`, `effectiveEnabled: false` y `reasonCode: 'REVIEWS_DISABLED'` cuando está apagado.
     - En `ModuleConfigManager.tsx`, se añadió el switch visible `enableReviews` ("Permitir Reseñas y Feedback") en el Módulo 4, subordinando la edición y prueba del deep link de Google a que el módulo de reseñas esté encendido.

3. **Honestidad en División de Cuenta (`allowSplitBill`)**:
   - *Diagnóstico previo:* En Admin figuraba un toggle interactivo de "Dividir Cuenta (Split Bill)" sugiriendo que estaba operativo, pero la API rechazaba su activación con HTTP 409 (`validateCapabilityUpdate`), y los endpoints de división de comanda devolvían HTTP 503 (`DIGITAL_PAYMENTS_UNAVAILABLE`), dado que este circuito pertenece formalmente a la etapa **E05**.
   - *Corrección aplicada:* El switch se rotuló con un badge visible `Próximamente (E05)`, se deshabilitó preventivamente para evitar confusión en el encargado (`disabled={true}`) y se incluyó una leyenda explicativa clara: *"Función en desarrollo para la etapa E05. No está disponible para activación en esta versión."* El backend conserva su validación estricta y rechazo autoritativo.

4. **Honestidad en Smart Upselling (`enableUpsell`)**:
   - *Diagnóstico previo:* La capacidad `upsell` declaraba `reasonCode: 'UPSELL_CLIENT_CONSUMED'` y prometía recomendaciones automáticas en la carta y carrito. Sin embargo, la carta web no renderiza sugerencias automáticas sobre el producto seleccionado luego de que el usuario descartara ofertas invasivas (Decisión de Producto #5).
   - *Corrección aplicada:* Se ajustó la descripción en `ModuleConfigManager.tsx` para reflejar la realidad: *"Módulo base disponible en API. Las sugerencias automáticas invasivas sobre el producto seleccionado están desactivadas en la carta web para priorizar la rapidez y fluidez de atención."* En `config.service.ts` se sincronizó el mensaje de la capacidad manteniendo la estabilidad del `reasonCode` para integraciones existentes.

5. **Consumo de Modo de Pago (`paymentMode`) en Cliente Web**:
   - *Diagnóstico previo:* `apps/client-web/index.html` exponía estáticamente el botón `#btnPayMethodMercadoPago` ("QR / Mercado Pago") en el modal de cobro (`BILL`), sin consultar si el restaurante operaba en modo `WAITER_ONLY`.
   - *Corrección aplicada:* En `apps/client-web/app.js`, tanto al inicializar (`loadRestaurantModuleConfig`) como al recalcular el modal de cuenta (`updateBillTipSummary`), se evalúa `activeRestaurantConfig?.paymentMode !== 'WAITER_ONLY'`. Si el local opera en `WAITER_ONLY`, el botón de Mercado Pago se oculta automáticamente (`hidden`), impidiendo que el comensal solicite un medio digital que el restaurante no acepta.

6. **Propagación Reactiva de `allowOrdering: false` en Vuelo**:
   - *Diagnóstico previo:* Si un administrador desactivaba `allowOrdering` en el Admin durante un turno con comensales activos, el backend rechazaba de inmediato las peticiones con `403 ORDERING_DISABLED`, pero el cliente web no actualizaba su política local, manteniendo botones de "Agregar al pedido" activos.
   - *Corrección aplicada:* Se implementó la función `adaptUiToOrderingPolicy(allowOrdering)` en `apps/client-web/app.js`. Al capturar una respuesta HTTP 403 con `code: 'ORDERING_DISABLED'` o mensaje equivalente en `addDishToCart` o en `submitDraftOrder`, el cliente:
     - Actualiza inmediatamente `activeOrderPolicy.allowOrdering = false` y `activeRestaurantConfig.allowOrdering = false`.
     - Ejecuta `adaptUiToOrderingPolicy(false)`, que transforma los botones a *"📖 Modo Carta • Llamar al Mozo"* y *"🛎️ Solicitar plato al Mozo (Modo Carta)"*.
     - Oculta el drawer/modal de agregar plato y renderiza el carrito con el aviso correspondiente, sin necesidad de recargar la página (`F5`).

7. **Exclusión Justificada de `syncSocialCart` en Admin**:
   - En estricto cumplimiento con la directriz de producto, **no se agregó ningún toggle de `syncSocialCart` en el Admin Dashboard**. MesaYA opera de forma canónica con comandas y borradores compartidos por mesa (`tableSession`). Exponer un interruptor de "carrito individual" sería engañoso para el encargado mientras no exista un modelo operativo de cuentas divididas por comensal (reservado para E03/E05).

---

## 2. Archivos Modificados y Creados

### Modificados:
1. `packages/api/src/services/config.service.ts`:
   - Corregido `buildCapabilities`: `reviews.state` se define siempre como `CapabilityState.AVAILABLE`, asignando `configuredEnabled: false`, `effectiveEnabled: false` y `reasonCode: 'REVIEWS_DISABLED'` cuando `enableReviews === false`.
   - Ajustado mensaje honesto de `upsell` en API.
2. `apps/admin-dashboard/src/components/ModuleConfigManager.tsx`:
   - `handleToggle`: desbloquea módulos con `capability.state === CapabilityState.AVAILABLE`, añade mapeo para `enableReviews` y `enableWaitlist`, y bloquea preventivamente `allowSplitBill` informando su disponibilidad en E05.
   - `capabilityBlocked`: evalúa `capability.state !== CapabilityState.AVAILABLE`.
   - Módulo 1: `allowSplitBill` con badge `"Próximamente (E05)"`, switch deshabilitado y texto explicativo.
   - Módulo 3: descripción transparente sobre la desactivación de popups invasivos de upsell en la carta web.
   - Módulo 4: agregado switch interactivo `enableReviews` ("Permitir Reseñas y Feedback"), subordinando el campo `googlePlaceId`.
3. `apps/client-web/app.js`:
   - Creada función centralizada `adaptUiToOrderingPolicy(allowOrdering)` que ajusta textos de botones y renderizado del carrito.
   - `loadRestaurantModuleConfig`: invoca `adaptUiToOrderingPolicy` y oculta `#btnPayMethodMercadoPago` si `paymentMode === 'WAITER_ONLY'`.
   - `updateBillTipSummary`: sincroniza la visibilidad de `#btnPayMethodMercadoPago` según `paymentMode`.
   - `loadActiveOrder`: invoca `adaptUiToOrderingPolicy` con el valor retornado por `/orders/session/:token`.
   - `addDishToCart` y `submitDraftOrder`: manejo reactivo de error HTTP 403 `ORDERING_DISABLED` actualizando la política en vuelo y transicionando la UI a modo informativo sin recarga.
4. `packages/api/test/capabilities-unit.test.ts`:
   - Actualizado test unitario para reflejar que `reviews` con `enableReviews: false` entrega `state: CapabilityState.AVAILABLE` con `effectiveEnabled: false` y `reasonCode: 'REVIEWS_DISABLED'`.
5. `packages/api/test/capability-update-policy.test.ts`:
   - Agregada prueba para la activación/desactivación libre de `enableReviews` de forma transaccional.
6. `packages/api/test/e18-admin-accessibility.test.ts`:
   - Incluida la validación del atributo `enableReviews` en el panel de configuración de módulos.

### Creados:
7. `packages/api/test/e02-module-config-behavior.test.ts`:
   - Suite de 15 pruebas de comportamiento centradas en:
     - Distinción entre módulo apagado (`AVAILABLE` + inactivo) vs no implementado (`COMING_SOON`).
     - Validación transaccional de transiciones en `validateCapabilityUpdate`.
     - Comportamiento de `paymentMode` y su reflejo como opción informativa.
     - Lógica de desbloqueo de `capabilityBlocked` en Admin Dashboard.
     - Reglas de visibilidad de Mercado Pago en cliente web y transición reactiva ante 403 `ORDERING_DISABLED`.

---

## 3. Evidencia de Ejecución y Pruebas Automatizadas

Todas las suites de prueba fueron ejecutadas localmente en este worktree:

### 3.1. Pruebas Focalizadas de Módulos y Capacidades (Vitest)
```
$ npx vitest run test/capabilities-unit.test.ts test/capabilities-contract.test.ts test/capability-update-policy.test.ts test/admin-boundary.test.ts test/e18-admin-accessibility.test.ts test/e02-module-config-behavior.test.ts

 Test Files  6 passed (6)
      Tests  58 passed (58)
   Duration  8.63s
```
- `capabilities-unit.test.ts` (18/18 tests pass): Verifica 12 claves canónicas, estados efectivos, códigos en mayúsculas y ausencia de fragmentos en inglés.
- `capabilities-contract.test.ts` (6/6 tests pass): Verifica endpoints públicos `/capabilities` y contratos de seguridad.
- `capability-update-policy.test.ts` (6/6 tests pass): Verifica bloqueo de `allowSplitBill` y habilitación libre de `enableReviews`, `enableWaitlist`, `enableRewards`, etc.
- `admin-boundary.test.ts` (7/7 tests pass): Verifica aislamiento de autenticación y límites por local.
- `e18-admin-accessibility.test.ts` (6/6 tests pass): Verifica controles de accesibilidad, switches, tabs y presencia de todas las claves de módulos (incluyendo `enableReviews`).
- `e02-module-config-behavior.test.ts` (15/15 tests pass): Valida el comportamiento integral de la etapa E02.

### 3.2. Pruebas de Integridad E01 y Catálogo Invariante (Node Test Runner)
```
$ node --test scripts/fauno-catalog.test.mjs scripts/e01-catalog-invariants.test.mjs

✔ E01-1 a E01-15: Sincronización, idempotencia, preservación de IDs, COMING_SOON
✔ Fauno catalog invariants (5 tests)
ℹ tests 20 | pass 20 | fail 0 | duration_ms 95.8ms
```
La funcionalidad y contratos de la etapa **E01 se mantienen 100% intactos**.

### 3.3. Chequeos de Rutas y Esquema Supabase
```
$ npm run check:routes
Matriz de rutas OK: 107 rutas clasificadas, sin novedades ni deriva.

$ npm run check:supabase-schema
✅ schema.supabase.prisma está sincronizado con el schema canónico.
```

### 3.4. Compilación y Build de Workspaces Afectados
- `@mesaya/shared`: `npm run build:shared` → `tsc` completado sin errores (EXIT_CODE=0).
- `@mesaya/api`: `npm run build:api` → Prisma generate + `tsc` completado sin errores (EXIT_CODE=0).
- `@mesaya/admin-dashboard`: `npm --workspace=@mesaya/admin-dashboard run build` → `tsc && vite build` completado en 3.31s (EXIT_CODE=0).
- `@mesaya/client-web`: `npm --workspace=@mesaya/client-web run build` → `vite build` completado en 1.04s (EXIT_CODE=0).

---

## 4. Estado de la Lista de Aceptación E02

- [x] **A01 — Lógica de Toggles Desbloqueada**: Un administrador puede encender libremente cualquier módulo disponible que esté apagado (`waitlist`, `rewards`, `smart_tips`, `allowWaitersToCollectCash`, `enableReviews`, `enableUpsell`) sin recibir bloqueos espurios.
- [x] **A02 — Honestidad en División de Cuenta**: `allowSplitBill` en Admin está rotulado claramente como `"Próximamente (E05)"`, deshabilitado para activación y respaldado por el rechazo 409/503 en backend.
- [x] **A03 — Toggle Explícito de Reseñas**: El módulo de Feedback cuenta con switch propio para `enableReviews` en Admin, y su capacidad en API refleja `AVAILABLE` con `REVIEWS_DISABLED` cuando está apagado.
- [x] **A04 — Consumo de `paymentMode` en Cliente**: Cuando el restaurante opera en `paymentMode: 'WAITER_ONLY'`, el botón de Mercado Pago se oculta dinámicamente en el modal de cuenta del comensal.
- [x] **A05 — Propagación Reactiva de `allowOrdering`**: Ante un rechazo HTTP 403 `ORDERING_DISABLED` en vuelo, el cliente web actualiza su política local y adapta los botones a modo carta informativa sin recargar el navegador.
- [x] **A06 — Enforce Autoritativo en Backend**: La API rechaza de forma estricta (403/409) operaciones incompatibles con la configuración guardada, validando permisos en cada comanda y liquidación.
- [x] **A07 — Pruebas Automatizadas Verdes**: 58 pruebas de Vitest, 20 pruebas de Node runner, chequeo de rutas y builds de los 4 paquetes/apps pasando limpiamente (0 errores).

---

## 5. Tareas Pendientes Fuera del Entorno Local

### PENDING_CLOUD
1. **Despliegue Vercel:** Los cambios en `apps/admin-dashboard`, `apps/client-web` y `packages/api` deben ser desplegados en staging/producción tras la aprobación de la tanda correspondiente.
2. **Sincronización en Base Remota Supabase:** La base de datos de producción hereda la configuración persistida sin requerir nuevas migraciones DDL para E02 (los campos ya formaban parte del schema).

### PENDING_HUMAN
1. **Google Place ID de Producción:** Para los locales que deseen activar la redirección a Google Maps en el módulo de reseñas, el encargado debe ingresar el Place ID correspondiente en el Admin Dashboard.
2. **Definición Comercial de Fila Virtual y Pre-orden:** Confirmar qué locales piloto activarán Fila Virtual Inteligente en puerta (manteniéndose desactivada por defecto).

---

## 6. Riesgos Residuales y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación Implementada |
|---|---|---|---|
| Comensal con app abierta mientras el local apaga comandas | Media | Bajo | El cliente captura el 403 `ORDERING_DISABLED` en el intento de agregado o envío, transiciona de inmediato a modo carta informativa y muestra una notificación explicativa sin pérdida de datos. |
| Intento de activar división de cuentas antes de E05 | Baja | Nulo | El switch de Admin está bloqueado (`disabled`) con badge informativo y el backend rechaza con 409 `CapabilityConfigurationError`. |
| Inconsistencia de caché entre múltiples mozos cobrando en efectivo | Baja | Bajo | `ServiceWorkspace` refresca el snapshot vía polling cada 5-15s y `settleSessionAccount` valida el permiso `allowWaitersToCollectCash` atómicamente en base de datos al momento de liquidar. |

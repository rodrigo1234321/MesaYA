# E00 — Fijar base, despliegues y matriz de módulos MesaYA

- **Fecha de ejecución:** 2026-09-21
- **Agente escritor:** Antigravity (único agente escritor en worktree local)
- **Worktree:** `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-plan-20260920`
- **Rama:** `codex/plan-modulos-20260920` (rastreada a `origin/main`)
- **HEAD SHA:** `6a1cdaead105750dfc6808cac1383018bb58ee15`
- **Commit base:** `Merge: 5691912 6c2bc74 — feat: integrar carta Fauno en rutas de mesa`
- **Documento rector:** `docs/PLAN-MODULOS-Y-BASE-POR-LOCAL-2026-09-20.md`
- **Estado de etapa E00:** `VERIFICADO_LOCAL`

---

## 1. Alcance y Fuentes de Verificación

### Alcance Exclusivo de E00
1. Confirmación de SHA, rama y estado de git en el worktree actual, diferenciando evidencia de este checkout de evidencia histórica.
2. Inventario de proyectos, aliases, SHAs y configuración efectiva de Cliente, Staff, Admin y API mediante archivos locales y consulta de sólo lectura a la URL pública.
3. Clasificación de dependencias en `PENDING_CLOUD` o `PENDING_HUMAN` con causa técnica concreta.
4. Matriz completa de cada control del Admin: persistencia en base de datos, dependencias, endpoints, efecto en cliente/staff, pruebas existentes y diferenciación técnica rigurosa de cuatro estados: **Configurado**, **Disponible**, **Efectivo** y **Probado** (un booleano nunca basta).
5. Diagnóstico temprano de **E10 (Sommelier / Asistente IA)**: presencia de flags y variables de entorno (`ENABLE_AI_FEATURES`, `AI_FEATURE_ENABLED`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `AI_TIMEOUT_MS`) sin leer ni registrar valores secretos, clasificando la causa como **no confirmada** al no existir comprobación en vivo de activación, modelo, permisos y cuota.
6. Ejecución de checks locales seguros y pertinentes, reportando checks omitidos y su justificación.

### Fuentes Consultadas
- **Repositorio local:** `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-plan-20260920`
- **Manifiesto canónico de despliegue:** `deploy/mesaya-canonical-manifest.json`
- **Esquema de datos:** `packages/api/prisma/schema.prisma` y `packages/api/prisma/schema.supabase.prisma`
- **Servicios y contratos:** `packages/api/src/services/config.service.ts`, `ai.service.ts`, `order.service.ts`, `rewards.service.ts`
- **Interfaces de usuario:**
  - Admin: `apps/admin-dashboard/src/components/ModuleConfigManager.tsx`, `AIChefAssistantModal.tsx`, `TemplateSelector.tsx`
  - Staff: `apps/staff-panel/src/components/ServiceWorkspace.tsx`, `CashManager.tsx`, `RewardsManager.tsx`
  - Cliente: `apps/client-web/app.js`
- **Configuración pública en vivo:** `https://api-mesa-ya.vercel.app/v1/restaurants/mesaya-piloto/config` (consultada el 21/09/2026).

---

## 2. Diferenciación de Evidencia: Checkout Actual vs. Evidencia Histórica

| Dimensión | Evidencia Histórica (`mesaya-canonical-manifest.json` - 20/09/2026) | Evidencia Verificada en este Checkout (`6a1cdae` - 21/09/2026) | Estado de Certificación |
|---|---|---|---|
| **Rama de trabajo** | `codex/servicio-remediacion` | `codex/plan-modulos-20260920` | Verificado localmente en Git |
| **Commit SHA** | `7c38bd526cf39c2162f399160f6aa12792eccd50` | `6a1cdaead105750dfc6808cac1383018bb58ee15` | Verificado localmente en Git |
| **API en Vercel** | Desplegado con SHA `7c38bd5` (`prj_nVkzgzJM...`, alias `https://api-mesa-ya.vercel.app`) | SHA `6a1cdae` no desplegado aún a producción Vercel | `PENDING_CLOUD` (el despliegue productivo tiene versión previa) |
| **Client-Web en Vercel** | Desplegado con SHA `7c38bd5` (`prj_LyPH2aVP...`, alias `https://client-web-mesa-ya.vercel.app`) | SHA `6a1cdae` no desplegado aún a producción Vercel | `PENDING_CLOUD` |
| **Staff-Panel en Vercel** | Desplegado con SHA `7c38bd5` (`prj_vGS7soLN...`, alias `https://staff-panel-mesa-ya.vercel.app`) | SHA `6a1cdae` no desplegado aún a producción Vercel | `PENDING_CLOUD` |
| **Admin-Dashboard en Vercel**| Desplegado con SHA `7c38bd5` (`prj_VmjItJar...`, alias `https://admin-dashboard-mesa-ya.vercel.app`)| SHA `6a1cdae` no desplegado aún a producción Vercel | `PENDING_CLOUD` |
| **Supabase DB** | 26 migraciones aplicadas; logicalInstance `mesaya-piloto`; exact projectRef pendiente | `schema.supabase.prisma` verificado idéntico a `schema.prisma` local | Esquema local alineado (`check:supabase-schema` PASS); hardening/backup en Supabase: `PENDING_CLOUD` |

---

## 3. Configuración Pública Efectiva (`mesaya-piloto`)

Datos obtenidos en vivo desde `https://api-mesa-ya.vercel.app/v1/restaurants/mesaya-piloto/config`:
- **ID de configuración:** `cmtq6fac60002qnp8tq3sreus`
- **Restaurant ID:** `842098da-8691-4dc4-90eb-789f3fef3149`
- **Valores crudos de flags:**
  - `paymentMode`: `"DIGITAL_MP"`
  - `allowSplitBill`: `true` (en DB, pero bloqueado en capacidades operativas)
  - `allowWaitersToCollectCash`: `false`
  - `allowOrdering`: `true`
  - `syncSocialCart`: `true`
  - `requireWaiterValidation`: `true`
  - `reviewQuantityThreshold`: `6`
  - `enableUpsell`: `true`
  - `enableSmartTips`: `true`
  - `suggestedTipPercentages`: `[10, 15, 20]`
  - `enableReviews`: `true`
  - `googlePlaceId`: `null`
  - `enableWaitlist`: `true`
  - `enableWaitlistPreOrder`: `true`
  - `enableRewards`: `true`
  - `pointsPerHundredPesos`: `1`

---

## 4. Matriz Completa de Controles y Módulos MesaYA

Definiciones operativas:
- **Configurado:** Valor almacenado en base de datos (`RestaurantModuleConfig`) o variable de entorno.
- **Disponible:** Capacidad expuesta por el backend en el contrato de capacidades (`state: AVAILABLE` vs `COMING_SOON`).
- **Efectivo:** Comportamiento real ejecutable de punta a punta en la experiencia del comensal y del personal sin bloqueos de catálogo, overlays ni stubs.
- **Probado:** Existencia de tests unitarios, de integración o suites que validan el comportamiento frente a fallos, concurrencia y límites.

| # | Módulo / Control | Control Admin & Persistencia | Endpoints Involucrados | Efecto en Cliente (`client-web`) | Efecto en Staff (`staff-panel`) | Pruebas Existentes | Estado: C / D / E / P |
|---|---|---|---|---|---|---|---|
| **1** | **Comandas Digitales (Ordering)** | Toggle `allowOrdering` en `ModuleConfigManager`. Persiste en `RestaurantModuleConfig.allowOrdering` (Boolean, default `true`). | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/guest/orders`. | Si está en `true` pero `staticMenuOnly` es `true` (Fauno), se bloquea el pedido y la carta es Food-First informativa. | No se reciben comandas digitales si está apagado o en carta estática. | `guest-orders-validation.test.ts`, `b06-submit-cart-races.test.ts`, `staff-orders-kitchen.test.ts`. | **C:** `true`<br>**D:** `true`<br>**E:** `false` (bloqueado por Fauno)<br>**P:** `true` (backend) |
| **2** | **Revisión Manual y Excepciones** | Toggle `requireWaiterValidation` e Input `reviewQuantityThreshold` (2-50, def 6). Persiste en `RestaurantModuleConfig`. | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/guest/orders`. | Las comandas quedan en estado pendiente si el modo manual está activo o si superan el umbral. | Mozo revisa comandas en `ServiceWorkspace` (`PENDING_APPROVAL`) antes de derivar a cocina. | `e05-validation-exceptions.test.ts`, `guest-orders-validation.test.ts`. | **C:** `true` (modo manual, umbral 6)<br>**D:** `true`<br>**E:** `true` (en API/Staff)<br>**P:** `true` |
| **3** | **Cobro Presencial, Efectivo y PIN** | Toggle `allowWaitersToCollectCash`. Persiste en `RestaurantModuleConfig.allowWaitersToCollectCash` (Boolean, default `false`). | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/service/workspaces/:tableId/settle`, `POST /v1/orders/:id/pay`, `POST /v1/staff/verify-pin`. | Comensal pide la cuenta ("BILL"); no interviene en PIN ni en roles. | Si está en `false`: mozo requiere PIN temporal de Encargado (`MANAGER`) para liquidar en efectivo. Si está en `true`: mozo cobra directo. Tarjeta siempre exige autorización. | `cash-contract.test.ts`, `e12-waiter-cash-permission.test.ts`, `e06-terminal-operator-temporal-auth.test.ts`, `e10-e11-service-settle-clean.test.ts`. | **C:** `false`<br>**D:** `true`<br>**E:** `false` (exige PIN siempre)<br>**P:** `true` |
| **4** | **División de Cuenta (Split Bill)** | Toggle `allowSplitBill`. Persiste en `RestaurantModuleConfig.allowSplitBill` (Boolean, guardado `true` en piloto). | `GET/PATCH /v1/restaurants/:id/config` (`validateCapabilityUpdate` bloquea activaciones). | Sin UI de división de cuenta en `app.js`. No permite pagar por plato ni partes iguales. | Sin soporte en `ServiceWorkspace` para cobro parcial por comensal. Operaciones bloqueadas en `order.service.ts`. | `capabilities-unit.test.ts`, `capability-update-policy.test.ts`, `b02-partial-bill-repro.test.ts`. | **C:** `true`<br>**D:** `false` (`COMING_SOON`)<br>**E:** `false`<br>**P:** `false` (solo probado rechazo) |
| **5** | **Pago Digital Informativo (Mercado Pago)** | Selector `paymentMode` (`WAITER_ONLY`, `DIGITAL_MP`, `HYBRID`). Persiste en `RestaurantModuleConfig.paymentMode`. | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/guest/calls` (tipo `BILL`). | Informa preferencia del comensal (Mercado Pago vs Efectivo). No realiza checkout online directo. | Mozo visualiza el medio preferido y cobra presencialmente con terminal/QR del local. | `capabilities-unit.test.ts`, `capabilities-contract.test.ts`, `calls-feedback-access.test.ts`. | **C:** `DIGITAL_MP`<br>**D:** `true` (informativo)<br>**E:** `true` (como preferencia)<br>**P:** `true` |
| **6** | **Carrito Sincronizado (`syncSocialCart`)** | No tiene toggle visual en `ModuleConfigManager`. Persiste en `RestaurantModuleConfig.syncSocialCart` (Boolean, default `true`). | `GET/PATCH /v1/restaurants/:id/config`. | No hay consumidores en `apps/client-web/app.js`. El cliente opera con carrito puramente local. | Sin diferenciación entre carrito individual y de mesa. | `e13-collaboration.test.ts`, `b06-submit-cart-races.test.ts`. | **C:** `true`<br>**D:** `false` (en cliente)<br>**E:** `false`<br>**P:** `false` (flujo conjunto) |
| **7** | **Upsell Inteligente (Retirado de Producto)** | Toggle `enableUpsell`. Persiste en `RestaurantModuleConfig.enableUpsell` (Boolean, default `true`). | `GET/PATCH /v1/restaurants/:id/config`, `upsell.service.ts`. | Retirado del producto seleccionado por decisión del usuario; no se muestran popups intrusivos. | No altera comandas del personal. | `upsell-contract.test.ts`, `e14-upsell-session.test.ts`. | **C:** `true`<br>**D:** `true` (en API)<br>**E:** `false` (retirado en cliente)<br>**P:** `true` (API) |
| **8** | **Propinas Sugeridas (Smart Tips)** | Toggle `enableSmartTips`. Persiste en `RestaurantModuleConfig.enableSmartTips` y `suggestedTipPercentages` (`[10, 15, 20]`). | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/guest/calls`, `POST /v1/service/workspaces/:tableId/settle`. | Permite seleccionar 10%, 15%, 20% o valor cero al solicitar la cuenta. | Se muestra en `ServiceWorkspace` y `CashManager` desglosada del consumo y se suma al cobro. | `capabilities-unit.test.ts`, `calls-feedback-access.test.ts`, `monetary-convergence.test.ts`. | **C:** `true` (`[10,15,20]`)<br>**D:** `true`<br>**E:** `true`<br>**P:** `true` |
| **9** | **Reseñas & Feedback (Google Maps)** | Toggle `enableReviews` y campo `googlePlaceId`. Persiste en `RestaurantModuleConfig`. En piloto: `googlePlaceId: null`. | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/feedback`. | Rating privado interno (1 a 5 estrellas). Deep link a Google solo si `googlePlaceId` existe. | Feedback privado visible en analíticas de Admin. | `calls-feedback-access.test.ts`, `feedback.service.ts`. | **C:** `true` (`googlePlaceId: null`)<br>**D:** `true` (interno) / `false` (Google)<br>**E:** `true` (interno)<br>**P:** `true` |
| **10** | **Fila Virtual Inteligente (Waitlist)** | Toggle `enableWaitlist`. Persiste en `RestaurantModuleConfig.enableWaitlist` (Boolean, default `false`, piloto `true`). | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/waitlist/join`, `GET /v1/waitlist/status/:id`. | Permite anotarse en lista de espera y monitorear turno en tiempo real. | Pestaña `WaitlistManager` en Staff para llamar comensales y sentar grupos. | `waitlist-lifecycle.test.ts`. | **C:** `true`<br>**D:** `true`<br>**E:** `true` (operativo en código)<br>**P:** `true` (unitario) |
| **11** | **Pre-pedido en Fila Virtual** | Toggle `enableWaitlistPreOrder`. Requiere `enableWaitlist === true`. Persiste en `RestaurantModuleConfig`. | `GET/PATCH /v1/restaurants/:id/config`, `POST /v1/waitlist/:id/preorder`. | Comensal en fila puede armar borrador de comanda mientras espera en vereda. | Al sentar al grupo se debe transferir la comanda a la mesa asignada. | `waitlist-lifecycle.test.ts`. | **C:** `true`<br>**D:** `true`<br>**E:** `false` (desconectado de carta Fauno)<br>**P:** `true` (sintético) |
| **12** | **Fidelización MesaYA Rewards** | Toggle `enableRewards`, input `pointsPerHundredPesos` (def 1) y catálogo `RewardItem`. Persiste en DB. | `GET/PATCH /v1/restaurants/:id/config`, `GET/POST /v1/rewards/items`, `GET /v1/rewards/customers/:phone`, `POST /v1/rewards/redeem`. | Asistido: no requiere cuenta con clave. Mozo consulta saldo e informa al cliente. | `RewardsManager` y `CashManager`: consulta saldo por teléfono, canjea premios y acredita puntos al cobrar. | `rewards-ledger.test.ts`. | **C:** `true` (1 pt/$100)<br>**D:** `true` (asistido)<br>**E:** `true` (en staff)<br>**P:** `true` |
| **13** | **Sommelier IA & Asistente Administrativo** | Modal `AIChefAssistantModal` en Admin; Drawer `sommelierSheetBackdrop` en cliente. Gobernado por variables de entorno API. | `POST /v1/menu/ai-generate`, `POST /v1/restaurants/:slug/ai-sommelier`. | Chat gastronómico en mesa. En piloto: recomienda ítems de Prisma mientras la carta muestra Fauno. | Asistente administrativo genera sugerencias de menú para revisión humana antes de aplicar. | `ai-containment.test.ts`. | **C:** Reglas locales activas; Gemini inactivo en flags<br>**D:** Heurístico local `true`; Gemini `false`<br>**E:** `false` (desacople de catálogo)<br>**P:** `true` (contención local) |
| **14** | **Personalización por Local (Templates)** | Selector `TemplateSelector` en Admin (`MenuTemplateId`). Persiste en `Restaurant.templateId` y `themeColor`. | `PATCH /v1/restaurants/:slug/template`, `GET /v1/restaurants/:slug/menu`. | Aplica estilos en cartas estándar. En Fauno no tiene efecto por diseño artesanal propio. | No interviene en la operativa del personal. | `e19-menu-filters.test.ts`, `instance-manifest.test.mjs`. | **C:** `GOURMET_OBSIDIAN`<br>**D:** `true`<br>**E:** `false` (anulado por carta Fauno artesanal)<br>**P:** `true` |

---

## 5. Diagnóstico Temprano E10 — Sommelier / Asistente IA

Comprobación realizada en el entorno de ejecución mediante comandos directos de PowerShell (`Test-Path Env:...`), sin leer ni imprimir valores de credenciales:

| Variable de Entorno | Estado en Proceso Local | Estado en Manifiesto Producción Vercel API | Consecuencia Técnica |
|---|---|---|---|
| `ENABLE_AI_FEATURES` | **ABSENT** (`False`) | **ABSENT** (no listada en `productionEnvironmentVariableNames.api`) | `AIService.isAiFeatureEnabled()` evalúa a `false`. No se invocan llamadas externas al proveedor. |
| `AI_FEATURE_ENABLED` | **ABSENT** (`False`) | **ABSENT** (no listada en `productionEnvironmentVariableNames.api`) | Flag alternativo inactivo. |
| `GEMINI_API_KEY` | **PRESENT** (`True`) | **ABSENT** (no listada en `productionEnvironmentVariableNames.api`) | Clave presente en entorno local, pero inactivada por falta del flag de feature. En producción Vercel no está cargada. |
| `GOOGLE_API_KEY` | **PRESENT** (`True`) | **ABSENT** (no listada en `productionEnvironmentVariableNames.api`) | Clave alternativa presente localmente; ausente en producción Vercel. |
| `GEMINI_MODEL` | **ABSENT** (`False`) | **ABSENT** | Código recurre al default `'gemini-1.5-flash'`. |
| `GEMINI_FALLBACK_MODEL` | **ABSENT** (`False`) | **ABSENT** | Código recurre al default `'gemini-1.5-pro'`. |
| `AI_TIMEOUT_MS` | **ABSENT** (`False`) | **ABSENT** | Código recurre al default de 8.000 ms. |

### Clasificación de Causa E10: NO CONFIRMADA (UNCONFIRMED)
- **Motivo técnico:** Si bien existe presencia de clave de proveedor en las variables de entorno locales, las variables de activación `ENABLE_AI_FEATURES` y `AI_FEATURE_ENABLED` están ausentes, los modelos configurados usan defaults codificados y no se ha probado la conectividad en vivo contra el endpoint de Google Generative AI para verificar validez de clave, habilitación de API en Google Cloud Console, permisos del proyecto y límites de cuota/facturación.
- **Comportamiento observado:** El sommelier y el asistente administrativo operan en modo heurístico local y vista previa degradada (`degraded: true`, `poweredBy: 'heuristic-engine'`).

---

## 6. Ejecución de Checks Locales y Resultados

| Check Script | Comando | Resultado | Observaciones y Justificación |
|---|---|---|---|
| `check:supabase-schema` | `npm run check:supabase-schema` | **EXIT 0 (PASS)** | `schema.supabase.prisma está sincronizado con el schema canónico.` (Verificación offline de schemas prisma de 735 líneas). |
| `check:routes` | `npm run check:routes` | **OMITIDO / BLOQUEADO** | Requiere `node_modules/typescript`. En este worktree limpio recién creado no se ejecutó `npm ci` para respetar las reglas de no instalación de dependencias no autorizadas. |
| `test:local` | `npm run test:local` | **OMITIDO** | Requiere `node_modules/prisma` y `node_modules/vitest`. |
| `build` | `npm run build` | **OMITIDO** | Requiere compilación con `tsc` y generación de Prisma Client. |
| Operaciones destructivas | Cobros, migraciones remotas, deploy, push, merge | **OMITIDAS** | Excluidas expresamente del alcance de E00. |

---

## 7. Clasificación de Pendientes

### PENDING_CLOUD
1. **Verificación de projectRef exacto de Supabase:** `mesaya-canonical-manifest.json` reporta `projectRefStatus: PENDING_EXACT_REF_VERIFICATION`. Requiere confirmación desde el panel de Supabase o metadatos protegidos de Vercel sin exponer credenciales.
2. **Hardening y backup de base de datos:** El esquema remoto está alineado a 26 migraciones, pero el hardening y plan de respaldo continúan pendientes de aprobación.
3. **Despliegue del SHA `6a1cdae` a Vercel:** Los 4 proyectos Vercel (`api`, `client-web`, `staff-panel`, `admin-dashboard`) se encuentran ejecutando el commit histórico `7c38bd5`. No se ha realizado deploy del merge Fauno actual.
4. **Verificación en vivo de cuota y conectividad Gemini (E10):** Requiere prueba controlada en API con `ENABLE_AI_FEATURES=true` para certificar validez de clave y disponibilidad de modelo sin caer en `AI_PROVIDER_FAILED`.

### PENDING_HUMAN
1. **Definición sobre `syncSocialCart`:** Confirmar si se implementa un modelo de borrador por comensal con comanda unificada de mesa o si se retira formalmente el flag para evitar falsas expectativas.
2. **Configuración de Google Place ID:** Si el local piloto desea habilitar reseñas directas en Google Maps, el administrador debe cargar el Place ID en `ModuleConfigManager`.
3. **Carga de secretos Gemini en Vercel:** Para habilitar IA en producción, se deben ingresar `ENABLE_AI_FEATURES=true` y `GEMINI_API_KEY` en el almacén de variables de entorno del proyecto `api` en Vercel.
4. **Validación de la etiqueta "Cliente Inteligente":** Confirmar si correspondía a la "Fila Virtual Inteligente" o si refería a otra función no documentada.

---

## 8. Riesgos Identificados
1. **Desacople de Catálogo (Fauno vs Base de Datos):** La carta visible del comensal lee un archivo JSON estático (`/data/fauno-catalog.json`), mientras que el backend, la cocina y el Sommelier operan sobre la base de datos relacional. Si se reactivan pedidos sin conciliar los IDs en E01, las comandas no podrán asociarse a ítems válidos en cocina.
2. **Promesa de Split Bill no disponible:** En la base de datos `allowSplitBill` está guardado en `true`, pero el contrato de capacidades lo declara `COMING_SOON` y el backend rechaza pagos divididos.
3. **Cobro informativo confuso:** El comensal puede creer que "Mercado Pago" realiza un cobro en línea autónomo, cuando en realidad solo notifica la preferencia al personal para un cobro presencial.
4. **Reemplazo de Modelos Gemini:** El código posee defaults hardcodeados a `gemini-1.5-flash` y `gemini-1.5-pro`. Si el proveedor retira o depreca esas versiones, las peticiones fallarán con `AI_PROVIDER_FAILED` salvo que se configuren explícitamente `GEMINI_MODEL` y `GEMINI_FALLBACK_MODEL`.

---

## 9. Siguiente Paso Recomendado
- **Avanzar a E01:** Conciliación del catálogo Fauno (26 categorías y 144 entradas) con la base de datos operativa, generando IDs estables e idempotentes para que comensal, mozo, cocina y sommelier consulten una única fuente de verdad antes de habilitar pedidos digitales.

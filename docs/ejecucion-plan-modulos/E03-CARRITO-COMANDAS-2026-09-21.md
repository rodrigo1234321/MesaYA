# E03 — Carrito Social y Comandas por Mesa (VERIFICADO_LOCAL)

**Fecha:** 2026-09-21
**Estado:** `VERIFICADO_LOCAL`
**Worktree:** `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-plan-20260920`
**Branch / Toplevel:** `mdpmesasvivas-plan-20260920`

---

## 1. Alcance de la Etapa E03

El módulo E03 consolida la arquitectura del carrito y comanda compartida por mesa, formalizando las siguientes directrices y contratos:

1. **Canonicidad de `TableSession` y Carrito Social Compartido:**
   - La unidad atómica de consumo presencial en MesaYA es la mesa y su sesión activa (`TableSession`).
   - Múltiples comensales sentados a la misma mesa colaboran sobre un único borrador (`DRAFT`) activo hasta su envío a cocina o validación por mozo.
   - Se erradica cualquier noción de "modo de carrito individual por teléfono": no existe tal bifurcación en el modelo de dominio.

2. **Normalización Garantizada (`normalizeSharedCartConfig`):**
   - Se implementa y exporta la función canónica `normalizeSharedCartConfig(config: RestaurantModuleConfigDTO): RestaurantModuleConfigDTO` en `packages/api/src/services/config.service.ts`.
   - Garantiza que `syncSocialCart` sea siempre `true` tanto en la entrega de configuración pública (`getPublicConfig`, tanto para registros recién creados como existentes), como en la configuración administrativa (`getAdminConfig`) y en la salida de mutaciones transaccionales (`updateConfigTransacted`), siempre previo al cálculo de capacidades (`buildCapabilities`).

3. **Política de Actualización Autoritativa (`validateCapabilityUpdate`):**
   - Se intercepta cualquier intento de apagar el carrito social (`dto.syncSocialCart === false`), lanzando un error con `statusCode: 400`, código de error `SYNC_SOCIAL_CART_LEGACY` y mensaje explícito de dominio informando que el carrito compartido es canónico a través de `TableSession` y no existe modo individual.
   - Se acepta `dto.syncSocialCart === true` sin error por compatibilidad hacia atrás con clientes que aún envíen el payload histórico.
   - Se excluye `syncSocialCart` de la lista de campos auditables (`keysToTrack`) y de los datos de actualización (`updateData`), evitando escrituras redundantes y preservando Prisma sin alteraciones DDL.

4. **Aislamiento Estricto entre Sesiones de Distintas Mesas:**
   - Cada mesa conserva su propio contexto de sesión: dos `TableSession` independientes nunca comparten ni mezclan líneas de pedido, manteniendo exactamente 1 borrador `DRAFT` aislado por sesión.

---

## 2. Hallazgos y Decisiones de Arquitectura

- **Hallazgo:** El flag `syncSocialCart` persistía en el esquema como un vestigio de exploración inicial para permitir que un restaurante desactivara la sincronización colaborativa. En la práctica, apagarlo rompería la coherencia con el ciclo de vida de la comanda, el mozo y la caja presencial, dado que el backend agrupa pedidos bajo `tableSessionId`.
- **Decisión de Producto y Backend:**
  - `syncSocialCart` se define arquitectónicamente como invariante (`true`).
  - El panel administrativo no expone ni expondrá interruptores para apagarlo.
  - La API rechaza de forma determinista cualquier intento de desactivación (`SYNC_SOCIAL_CART_LEGACY`), impidiendo estados inconsistentes.
  - `normalizeSharedCartConfig` actúa como capa defensiva asegurando que tanto comensales como personal reciban siempre `syncSocialCart: true`.

---

## 3. Cobertura de Pruebas y Evidencia

### 3.1. Pruebas Unitarias Nuevas sin Prisma (`packages/api/test/e03-sync-social-cart.test.ts`)
Se implementó una suite unitaria pura (sin dependencias de base de datos ni inicialización de servidor) que valida el contrato exacto:
- `normalizeSharedCartConfig`:
  - Entrada con `syncSocialCart: false` normalizada forzadamente a `true`.
  - Entrada con `syncSocialCart: true` preservada.
  - Preservación completa e idéntica de todas las demás propiedades de la configuración modular (`paymentMode`, umbrales, propinas, etc.).
- `validateCapabilityUpdate`:
  - Rechazo estricto de `syncSocialCart: false` arrojando `statusCode: 400`, `code: 'SYNC_SOCIAL_CART_LEGACY'` y mensaje que referencia `TableSession` y la inexistencia de modo individual.
  - Aceptación transparente de `syncSocialCart: true` (compatibilidad).
  - Aceptación de actualizaciones omitiendo el flag (`undefined`).

```
$ npx vitest run packages/api/test/e03-sync-social-cart.test.ts

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Duration  339ms
```

### 3.2. Aislamiento de Borrador Multi-sesión (`packages/api/test/e17-client-cart-resilience.test.ts`)
Se agregó el escenario de prueba previo al caso `S20 agotado`:
- Se generan dos sesiones independientes (`mkSession`) y dos platos (`mkItem`).
- Cada token de sesión agrega su respectivo plato vía `/orders/items`.
- Se consulta `getActiveOrder` para cada sesión, comprobando que cada una contiene única y exclusivamente su línea de pedido propia.
- Se comprueba mediante conteo en base de datos que existe exactamente 1 comanda `DRAFT` por cada sesión.

### 3.3. Runner SQLite Previo (Línea Base 5 Suites 100/100)
El conjunto de resiliencia y comanda colaborativa previamente ejecutado y validado en SQLite reportó 100/100 pruebas pasando:
- `packages/api/test/b06-submit-cart-races.test.ts`
- `packages/api/test/e05-validation-exceptions.test.ts`
- `packages/api/test/e17-client-cart-resilience.test.ts` (incluyendo cobertura S19/S20)
- `packages/api/test/guest-orders-validation.test.ts`
- `packages/api/test/staff-orders-kitchen.test.ts`

### 3.4. Compilación de Paquetes
- `npm run build:shared`: compila `@mesaya/shared` con TypeScript sin errores (`tsc`, exit code 0).

---

## 4. Archivos Modificados y Creados

### Modificados:
1. `packages/api/src/services/config.service.ts`:
   - Exportación de `normalizeSharedCartConfig`.
   - Intercepción de `dto.syncSocialCart === false` en `validateCapabilityUpdate`.
   - Normalización de objetos `parsed` en `getPublicConfig` (created y existente), `getAdminConfig` y `updateConfigTransacted`.
   - Eliminación de `syncSocialCart` en `keysToTrack` y en `updateData`.
   - Esquema y consultas Prisma preservadas intactas.
2. `packages/api/test/e17-client-cart-resilience.test.ts`:
   - Adición del test de aislamiento de sesiones independientes previo a S20 agotado.

### Creados:
3. `packages/api/test/e03-sync-social-cart.test.ts`:
   - Suite unitaria pura sin Prisma para `normalizeSharedCartConfig` y política `SYNC_SOCIAL_CART_LEGACY`.
4. `docs/ejecucion-plan-modulos/E03-CARRITO-COMANDAS-2026-09-21.md`:
   - Documento canónico de verificación y estado `VERIFICADO_LOCAL`.

---

## 5. Tareas Pendientes Fuera del Entorno Local

### PENDING_CLOUD
1. **Sin migración DDL nueva:** No hay migración DDL nueva para E03.
2. **Despliegue Cloud / Staging:** Falta desplegar el código en staging/cloud y verificar el SHA desplegado.

### PENDING_HUMAN
1. **Validación manual (No bloqueante):** Confirmación del copy visible "Carrito colaborativo" y prueba manual con dos teléfonos en la misma mesa y dos mesas distintas (la API ya tiene cobertura automatizada).

---

## 6. Estado de Etapas Posteriores (E04+)

- **E04 a E22:** Se mantienen **completamente intactas y sin cambios**, respetando los contratos y cronogramas establecidos en la matriz de planeamiento `mdpmesasvivas-plan-20260920`.

# Informe de Ejecución E04 — Cobro presencial, efectivo y PIN

- **Etapa**: E04 — Cobro presencial, efectivo y PIN
- **Fecha**: 2026-09-21
- **Branch**: `codex/plan-modulos-20260920`
- **Estado**: `VERIFICADO_LOCAL`
- **Autor/Ejecutor**: Agente Antigravity (escritor exclusivo de E04)

---

## 1. Alcance y Objetivos

E04 establece las garantías operativas y de seguridad para el cobro presencial en salón (Atención y Caja), unificando reglas de saldo, cálculo de consumo/propina, métodos de pago, auditoría de operadores y verificación atómica de cierre.

### Matriz de Contraste Operativo y de Seguridad

| # | Escenario / Requisito | Comportamiento Verificado | Estado |
|---|---|---|---|
| 1 | **Mozo con permiso cobra efectivo sin PIN** | Con `allowWaitersToCollectCash: true`, el mozo liquida en efectivo (`WAITER_CASH`) directamente con respuesta 201 sin requerir PIN adicional de encargado. | CUBIERTO (e12 §3) |
| 2 | **Mozo sin permiso requiere autorización temporal** | Con `allowWaitersToCollectCash: false`, el intento directo devuelve 403 `SETTLE_REQUIRES_MANAGER`. El mozo solicita PIN al encargado, quien emite un token temporal acotado (`CASH_COLLECT`), permitiendo la liquidación. | CUBIERTO (e04 §4, e12 §6) |
| 3 | **Tarjeta y QR no heredan permiso de efectivo** | Medios no-efectivo (`WAITER_CARD`, `WAITER_CARD_DEBIT`, `WAITER_CARD_CREDIT`, `WAITER_MP_QR`, `WAITER_TRANSFER`) exigen siempre rol `MANAGER` (403 `SETTLE_REQUIRES_MANAGER`), incluso con el flag de efectivo activo. | CUBIERTO (e12 §4) |
| 4 | **Encargado mantiene facultades** | El rol `MANAGER` liquida directamente cualquier medio de pago (efectivo, tarjeta, QR) sin requerir flags adicionales. | CUBIERTO (cash-contract, e04 §3) |
| 5 | **PIN inválido** | `/v1/staff/login` con PIN incorrecto responde 401 `UNAUTHORIZED` (`PIN incorrecto o usuario no encontrado`) y no emite token. | CUBIERTO (e04 §1) |
| 6 | **Autorización caducada / JWT expirado** | Token temporal vencido es rechazado por `verifyStaffToken` con 401 `UNAUTHORIZED`. | CUBIERTO (e04 §1) |
| 7 | **Restaurante ajeno (Cross-tenant)** | Credencial de un restaurante vecino intentando liquidar una sesión de otro local es rechazada con 403 `STAFF_TENANT_MISMATCH`. | CUBIERTO (e04 §2, e12 §5) |
| 8 | **Doble clic / reintento idempotente** | Mismo payload y clave de idempotencia devuelve 200 con `idempotentReplay: true` sin duplicar la transacción en base de datos. Reutilización para otra intención devuelve 409 `IDEMPOTENCY_KEY_REUSED`. | CUBIERTO (e04 §3, cash-contract) |
| 9 | **Dos operadores / cambio en tablet compartida** | Liquidación autorizada por encargado pero cobrada por mozo registra inmutablemente `createdBy` (encargado) y `responsibleStaffUserId` (mozo) en `AccountSettlement`. | CUBIERTO (e04 §4) |
| 10 | **Mesa no se libera con deuda** | `settle-and-close` con importe menor al saldo total responde 422 `CLOSE_REQUIRES_FULL_SETTLEMENT` y no cierra la sesión ni transiciona la mesa. Cierre directo de sesión con saldo responde 409 `TABLE_HAS_UNPAID_BALANCE`. | CUBIERTO (e04 §5, cash-contract) |
| 11 | **Privacidad de PIN** | En `ServiceWorkspace.tsx`, el PIN reside únicamente en estado volátil (`useState('')`) y se resetea inmediatamente al enviar o cerrar. No se almacena en `localStorage`, `sessionStorage`, cookies ni se expone en logs. | CUBIERTO (e04 §6) |

---

## 2. Diagnóstico y Hallazgos de Código

1. **Unificación de Reglas en Backend**:
   - `packages/api/src/middlewares/auth.middleware.ts`: Las funciones `verifyStaffToken`, `verifyManagerRole` y `verifySettlementAuthorization` implementan la matriz estricta de roles, métodos de pago permitidos y validación de alcance para tokens temporales (`TOKEN_SCOPE_MISMATCH`, `TOKEN_PURPOSE_MISMATCH`).
   - `packages/api/src/services/order.service.ts`: Los métodos canónicos `settleSessionAccount` y `settleAndCloseSessionAccount` operan bajo transacciones atómicas con ordenamiento `touchSessionTx`, garantizando el registro de auditoría (`createdBy` y `responsibleStaffUserId`), idempotencia estricta por `idempotencyKey` y validación de saldo previo a cualquier cambio de estado.
2. **Interfaz de Servicio (Staff Panel)**:
   - `apps/staff-panel/src/components/ServiceWorkspace.tsx`: Componente centraliza la lógica de cobro presencial, derivando a `ManagerReauthModal` cuando se requiere autorización temporal.
   - El PIN no se persiste ni se expone; al completar la operación o cerrar el modal se ejecuta `setReauthPin('')`.
3. **Resguardo de Invariantes de Mesa**:
   - Ninguna mesa transiciona a `TO_CLEAN` o `AVAILABLE` con consumos pendientes.
   - El cierre exige liquidación completa del saldo (`CLOSE_REQUIRES_FULL_SETTLEMENT` o `TABLE_HAS_UNPAID_BALANCE`).

---

## 3. Archivos Involucrados y Creados

- **Suite focal creada**:
  - `packages/api/test/e04-cash-pin-contract.test.ts`: 9 tests enfocados que cubren PIN inválido, JWT temporal expirado, tenant ajeno, reintento idempotente, auditoría de dos operadores, rechazo de cierre con deuda e inspección de no-persistencia de PIN en frontend.
- **Suites complementarias existentes**:
  - `packages/api/test/e12-waiter-cash-permission.test.ts`: 16 tests de permisos por local y métodos de pago.
  - `packages/api/test/cash-contract.test.ts`: 4 tests de caja presencial e idempotencia.
- **Fuentes auditados**:
  - `packages/api/src/middlewares/auth.middleware.ts`
  - `packages/api/src/routes/orders.routes.ts`
  - `packages/api/src/routes/staff.routes.ts`
  - `packages/api/src/services/order.service.ts`
  - `packages/api/src/services/session.service.ts`
  - `apps/staff-panel/src/components/ServiceWorkspace.tsx`

---

## 4. Evidencia de Ejecución

### Pruebas Automatizadas (Vitest vía `scripts/test-local.mjs`)

1. **Suite focal E04 (`e04-cash-pin-contract.test.ts`)**:
   ```
   RUN  v4.1.11 packages/api
   Test Files  1 passed (1)
        Tests  9 passed (9)
     Duration  2.27s
   ```
2. **Suite de permisos de mozo y caja (`e12-waiter-cash-permission.test.ts`)**:
   ```
   RUN  v4.1.11 packages/api
   Test Files  1 passed (1)
        Tests  16 passed (16)
     Duration  3.10s
   ```
3. **Suite de contrato de caja (`cash-contract.test.ts`)**:
   ```
   RUN  v4.1.11 packages/api
   Test Files  1 passed (1)
        Tests  4 passed (4)
     Duration  507ms
   ```

### Verificaciones de Integridad

- **Rutas de la API (`npm run check:routes`)**:
  ```
  Matriz de rutas OK: 107 rutas clasificadas, sin novedades ni deriva.
  ```
- **Esquema Supabase (`npm run check:supabase-schema`)**:
  ```
  ✅ schema.supabase.prisma está sincronizado con el schema canónico.
  ```
- **Compilación general (`npm run build`)**:
  - El gate integrado posterior de E12 ejecutó `npm run build` completo con los seis workspaces en `OK`. Esta ficha conserva la nota histórica de que el build aún no se había cerrado en el momento exacto de E04.

---

## 5. Tareas Pendientes y Riesgos

### `PENDING_CLOUD`
- Despliegue de los servicios API, Staff Panel y Admin Dashboard a los entornos remotos de Vercel y sincronización de base de datos Supabase, coordinado en el hito de integración E12.

### `PENDING_HUMAN`
- Validación manual en salón con tablet de hardware física compartida: alternancia entre mozo y encargado mediante teclado numérico en pantalla durante un servicio activo, comprobando la fluidez del modal de reautorización.

### Riesgos y Mitigaciones
- **Riesgo de suplantación en cuerpo de petición**: Mitigado en `verifyStaffToken`, que no confía en `staffRole` ni `restaurantId` enviados en el body o parámetros no autenticados; resuelve la identidad directamente desde el JWT verificado y la base de datos.
- **Riesgo de colisión de idempotencia entre terminales**: Mitigado mediante unicidad a nivel de esquema en `AccountSettlement.idempotencyKey` dentro de una transacción `Serializable`.

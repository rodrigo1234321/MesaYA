# E01 — Contrato canónico de ocupación, cuenta y roles

Fecha: 2026-09-09. Estado: decisión técnica adoptada para el bloque E00-E03.
Fuente: `01-DIAGNOSTICO-Y-DECISIONES.md §3` + código vigente (`session.service.ts`,
`order.service.ts`, `fsm.service.ts`). Ninguna etapa posterior (E04+) queda modificada.

## 1. Ocupación = `TableSession`

- Una mesa tiene como máximo **una sesión operativa** (`TableSession.activeKey = tableId`,
  único). Una sesión tiene como máximo **un borrador activo** (`Order.draftKey` único).
- La sesión se identifica por `id` en staff/API y por `token` (UUID v4 rotativo, bearer)
  en cliente. El **QR físico es estable**: codifica `restaurantSlug + tableLabel`, jamás un token.
  Foto/copia del QR nunca contiene el token de una ocupación.
- Ciclo: `AVAILABLE → OCCUPIED_* → … → PAID → TO_CLEAN → AVAILABLE`.
  `Cobrar` no libera; sólo `closeTableSession` / `settle-and-close` cierran (`closedAt`,
  `activeKey=null`) y llevan a `TO_CLEAN`. Sólo `Mesa lista` (`TO_CLEAN → AVAILABLE`,
  confirmación física) habilita y prepara la siguiente ocupación, con `id/token` nuevos y
  cuenta cero. El GET del QR físico sólo resuelve esa sesión preparada; nunca la crea ni muta.
- Sesión vencida con deuda (`expiresAt` pasado + `saldo>0`/borrador/revisión/llamado)
  queda bloqueada para resolución de staff; no se reemplaza silenciosamente.
- Token viejo (cerrado/expirado/`TO_CLEAN`) → `410 SESSION_CLOSED/SESSION_EXPIRED`
  en `GET /v1/sessions/:token` y `GET /v1/orders/session/:token`. Durante `TO_CLEAN` el QR
  devuelve estado inactivo sin cuenta, historial ni token anterior.

## 2. Cuenta por sesión (canónica)

- Verdad: `saldoMinor = consumo confirmado − pagos asignados` (`getSessionAccountTx`).
  Consumen sólo tandas aceptadas no canceladas (`CONFIRMED/IN_KITCHEN/READY_TO_SERVE/SERVED/PAID`).
  `DRAFT`, `PENDING_VALIDATION` y `CANCELLED` **no se cobran**.
- Propina (`tipMinor`) y pagos se presentan separados del consumo.
- Escrituras serializadas por `mutationSeq` + `expectedAccountVersion` (409 `STALE_*`/`*_CONFLICT`
  obliga a releer; nunca se cobra un importe antiguo a ciegas).
- Cobro canónico: `POST /v1/staff/sessions/:sessionId/settle` (`settleSessionAccount`) y
  `POST /v1/staff/sessions/:sessionId/settle-and-close` (E03). Idempotentes por
  `idempotencyKey 1..200`; reintento con misma intención → `200 idempotentReplay:true`;
  misma clave con otra intención → `409 IDEMPOTENCY_KEY_REUSED`. Concurrencia sobre la misma
  versión → `409 SETTLE_CONFLICT`. Sesión cerrada no acepta nuevos cobros (`409 SESSION_CLOSED`)
  salvo replay seguro.
- **Deprecación explícita (E01):** `POST /v1/staff/orders/:id/pay`
  (`registerManualPayment`, cobro por comanda) queda fuera del camino normal. Se conserva por
  compatibilidad histórica con header `Deprecation: true` y sin fecha `Sunset` comprometida
  (no se inventa fecha de retiro), pero el mozo/cliente cotidianos usan cuenta por sesión.
  `GET cash-orders` conserva `orders` (legado) sólo para compat; la vista canónica es
  `accounts` (cuenta por sesión B03). Criterio 35: el camino normal no llama al cobro por
  comanda heredado. En cliente, `StaffApi.payOrder` es el único símbolo deprecado;
  `settleAndCloseSessionAccount` no lo es. Todo reintento idempotente conserva
  exactamente el mismo body/version.
- **Cierre (E03):** si el cobro/cierre DB quedó confirmado pero la FSM a `TO_CLEAN`
  falla, la respuesta es error no exitoso `503/409 SETTLE_CLOSURE_INCOMPLETE` con
  detalles accionables (nunca éxito oculto). El reintento con misma key/body reintenta
  la FSM y devuelve replay sólo con `TO_CLEAN` confirmado; nunca `AVAILABLE→TO_CLEAN`.
- **Rotación (E02):** `createNewSessionForTable` sólo acepta mesa `AVAILABLE`
  (`TO_CLEAN` → `409 TABLE_NEEDS_CLEANING`; otro estado no disponible →
  `409 TABLE_NOT_AVAILABLE`); serializa `mutationSeq` antes de leer la cuenta y
  revalida antes de cerrar/crear (`409 ROTATION_CONFLICT`).

## 3. Propietario de cada estado

| Hecho | Propietario | Notas |
|---|---|---|
| Pedido válido recibido | servidor | pasa a cocina automáticamente (E05, fuera de este bloque) |
| Excepción revisada | mozo | una acción informada (E05+) |
| Plato listo | cocina | `READY` sólo rol/estación configurado (E08+) |
| Mozo retira el plato | mozo | `Me lo llevo` atómico (E09+) |
| Pago registrado | servidor + actor autorizado | idempotente, por cuenta de sesión (este bloque) |
| Grupo terminó | mozo | `Cobrar y cerrar` (E03) o `Cerrar mesa` si saldo cero |
| Mesa limpia | mozo | `Mesa lista`, confirmación física inevitable; sin temporizadores |

## 4. Política de PIN / roles

- Cobrar (`settle`, `settle-and-close`): exige `MANAGER` (vigente). Reautorización de encargado
  inline cuando el operador es mozo: el mozo no obtiene sesión de manager permanente
  (`StaffApi.loginTemporary`; el token de cobro viaja sólo en esa llamada).
- Cerrar mesa limpia: `WAITER` puede; `force` exige `MANAGER` + motivo explícito y aun así
  **nunca** omite deuda/borrador/validación/llamados (audita `forced:true` en evento FSM).
- Cocina/`READY`, división digital y pagos digitales: fuera de este bloque; división digital
  sigue `503 DIGITAL_PAYMENTS_UNAVAILABLE` sin flags que la reactiven.

## 5. Modos de cocina y catálogo de excepciones (referencia para E05)

- Modos soportados: estación KDS dedicada o terminal compartido; un único propietario de
  `READY` por turno (a validar en sala antes de E08).
- `REVIEW_REQUIRED` sólo por regla identificada y visible: producto agotado/cambiado,
  cantidad fuera de umbral o modo manual global del restaurante. La alerta de
  alergia/restricción ya contemplada por la carta se muestra como contexto operativo,
  pero no crea una confirmación humana adicional. (Implementación en E05; este bloque
  sólo garantiza que el cierre nunca silencia una revisión pendiente: `409 PENDING_VALIDATION_UNRESOLVED`.)

## 6. Aprobación E01

Cliente, staff y API usan las mismas definiciones: cuenta por `TableSession`, ocupación única
por mesa, cierre a `TO_CLEAN` y cobro canónico por sesión. No coexisten dos cobros cotidianos
contradictorios: el cobro por comanda está deprecado y marcado como tal en ruta, servicio y cliente.

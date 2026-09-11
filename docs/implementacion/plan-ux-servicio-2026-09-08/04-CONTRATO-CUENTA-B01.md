# Contrato de cuenta — B01 (decisiones operativas de esta ejecución)

Fecha: 2026-09-08. Etapa: B01, estado EN_REVISION (no aprobada; pendiente revisión
Codex y usuario). Acompaña a `01-ANALISIS.md`, `02-PLAN.md` y `03-VERIFICACION-Y-CONTROL.md`
(§11 adenda D1–D7, §12 regresión B02).

**Naturaleza de este documento:** convierte las recomendaciones de la adenda en decisiones
operativas de ESTA ejecución para desbloquear B03/B04. No inventa aprobación del usuario:
cada decisión queda marcada y su validación final corresponde a Codex + usuario.
Nada aquí cambia código, schema ni datos; B03/B04 implementarán contra este contrato.

## C1. Cuenta operativa = TableSession; OccupancySession = métrica

- La cuenta (consumo, pagos, saldo, versión) pertenece a la `TableSession` activa
  (token/QR, `activeKey = tableId`, expiración 3 h). Es el único agregado que ya enlaza
  `Order[]`, `CallRequest[]` y `PaymentTransaction` (vía `Order`).
- `OccupancySession` (presencia física: seated/ordered/served/bill/paid/vacated/cleaned,
  `totalRevenue`, métricas denormalizadas) hoy NO tiene relación con pedidos, pagos ni
  llamados (`schema.prisma` ~486–512). En este ciclo se usa solo como métrica/lectura;
  cualquier FK futura (`occupancySessionId` en `Order`/`PaymentTransaction`) es relación
  posterior fuera de B03–B06 y requiere su propio contrato de transferencia contable
  (unir/mover mesas no fusiona cuentas: análisis §3).

## C2. Tanda = Order aceptado, inmutable en historial

- Cada envío aceptado por el servidor es un `Order` con identidad propia y estado del ciclo
  `DRAFT → PENDING_VALIDATION → CONFIRMED → IN_KITCHEN → READY_TO_SERVE → SERVED`,
  terminales `PAID` / `CANCELLED` (tabla `ALLOWED_ORDER_TRANSITIONS`, `shared` ~508–515).
- Reglas: un `Order` aceptado nunca se edita ni se fusiona; correcciones = nuevo `Order`
  o `CANCELLED` autorizado con motivo/auditoría. `DRAFT` (carrito) nunca integra consumo
  cobrable. `CANCELLED`/rechazados nunca integran. Modo validación: `PENDING_VALIDATION`
  visible como «Esperando confirmación», separado del consumo.

## C3. Dinero en unidades menores enteras (plan de migración incluido)

- Estado actual verificado (solo lectura, corrección de reauditoría: la versión anterior
  afirmaba "7 campos" y enumeraba 6; el inventario exacto es el siguiente, sin conteo
  global falso). Campos de dinero que afectan a la cuenta:
  `Order.totalAmount` (línea 236), `OrderItem.unitPrice` (252, snapshot que alimenta el
  consumo), `SplitBillSession.{partAmount,totalAmount,remainingAmount}` (271–273),
  `PaymentTransaction.{amount,tipAmount,applicationFee}` (287–289) y la métrica
  denormalizada `OccupancySession.totalRevenue` (501). Precio de catálogo (no cuenta):
  `MenuItem.price` (133). Fuera de alcance: `Float` no monetarios (geo y geometría
  del plano, líneas 24–25, 155–159).
- Alcance entero de C3: todos los importes del flujo de cuenta (consumo, snapshots,
  pagos, propina, comisión y métrica de ingreso) más el precio de catálogo, de modo que
  `precio × cantidad` se calcule una sola vez en enteros con redondeo único documentado.
  La capa de lectura B03 expone la misma unidad a cliente y caja. `tipAmount` es campo
  separado: nunca reduce ni oculta deuda de platos.
- Migración/backfill (aditiva, sin reescribir historia): columnas enteras nuevas en
  paralelo; backfill `round(valor*100)` con reporte de filas afectadas ≠ 0; doble lectura
  comparada en paridad SQLite/Supabase (`postgres-schema-parity` debe cubrir los campos
  nuevos, 17 `Float` en el schema Supabase); snapshots históricos ya contratados se
  congelan y no se recalculan. Prohibido `git reset`/borrado de ledger para hacer pasar tests.
  ESTADO B03 (reauditoría): NO persistido — B03 expone solo proyección redondeada a
  centavos desde el Float legado; migración/backfill y ledger objetivo → B04 (NEEDS_REVIEW).

## C4. Liquidación por cuenta acumulada; pago ≠ fulfillment

- Modelo ACTUAL (no presentar como objetivo): `PaymentTransaction.orderId` es obligatorio
  con relación requerida y `onDelete: Cascade` (`schema.prisma` 281–282). El pago está
  atado a un `Order.id`: es el modelo de caja-por-comanda que B02 reproduce como defecto.
- Modelo OBJETIVO que B03/B04 deben implementar (transición exacta, sin doble ledger):
  registro de liquidación a nivel de sesión con asignaciones explícitas por `Order`
  (cada asignación enlaza pago → tanda para trazabilidad histórica); `orderId` pasa a
  opcional con guardia "exactamente una vía": o bien fila legada con `orderId` (solo
  lectura histórica, nunca se reinterpreta su importe), o bien liquidación nueva con
  asignaciones. Fuente única de verdad: las asignaciones; prohibido sumar ambas vías.
  `idempotencyKey` sigue `@unique`; se reutilizan registros, no se duplican.
- Camino normal: **cobro del saldo completo de la sesión** en una operación de servidor
  atómica e idempotente con validación de versión de cuenta.
- Parcial manual (secundario, si soportado): se asigna a líneas/`Order` concretos con
  conciliación (consumo / pagos / saldo / propina por separado); nunca división digital
  automática (fuera del ciclo). Pagar una tanda no libera la mesa; `SERVED` no implica
  cobrado y cobrado no implica entregado. Cierre de saldo con versión vieja → conflicto
  que obliga a revisar el nuevo saldo, nunca liquidación silenciosa.

## C5. Llamados activos por motivo

- Estado actual: `CallRequest.activeKey @unique = tableSessionId` → un solo llamado activo
  por sesión (`schema.prisma` línea 213). Decisión: un activo por **motivo**
  (`BILL | WAITER | SUPPLIES | CUSTOM`) y mesa; resolver uno no elimina otros.
- Representación/índice objetivo (verificable, corrección de reauditoría): NO basarse en
  `@@unique` sobre columnas anulables para filas resueltas —`NULL` es distinto de `NULL`
  en SQLite y PostgreSQL y no protegería como se espera—. En su lugar: clave de alcance
  `activeScopeKey = tableSessionId:type` presente solo mientras el llamado está activo
  (`PENDING`/`IN_PROGRESS`) y `NULL` al resolver/cancelar, con `@unique` sobre esa
  columna (los no-nulos sí se protegen; los `NULL` históricos quedan libres, que es lo
  correcto). Guardia de aplicación + prueba obligatoria en B06/S02: dos llamados
  concurrentes del mismo motivo y mesa → exactamente uno activo y el otro rechazado con
  409/deduplicación; dos motivos distintos coexisten; el historial resuelto se conserva
  (no se borran pendientes reales para pasar tests).

## C6. Validación por defecto; directo solo con receptor explícito

- Config efectiva observada: `requireWaiterValidation = true` (default `true`,
  `schema.prisma` línea 61), `paymentMode = WAITER_ONLY`. Decisión: validación del mozo
  es el modo por defecto.
- Modo directo solo cuando exista **receptor de cocina explícito y documentado**
  (quién/qué confirma recepción del ticket en el local real); sin él, el envío directo
  queda deshabilitado con motivo visible. La prueba local simula el receptor; la
  disposición física queda como `PENDIENTE_EXTERNO`.

## C7. Carrito y sesión vencida

- `DRAFT` es intención editable con su propio contrato (`addItem`/`submitOrder`
  idempotente); reemplazar `getActiveOrder` por una suma rompería edición/envío.
- Token vencido o sesión cerrada con deuda: la deuda persiste y el personal conserva la
  cuenta de la ocupación; el acceso público explica el estado sin liberar la mesa.
  Liberación solo sin saldo y con resolución explícita de pendientes (carrito no enviado
  incluido). Nueva ocupación: consumo cero heredado.

## Invariantes (deben cumplir B03–B06 y V01)

- I1: `consumo = Σ tandas aceptadas no canceladas`; borradores y `PENDING_VALIDATION`
  excluidos del cobrable.
- I2: `saldo = consumo − pagos(APPROVED|MANUAL_SETTLED)`; propina fuera de la ecuación.
- I3: cliente (`GET /orders/session/:token`) y caja (`GET cash-orders`) devuelven el mismo
  total y la misma versión de cuenta para la misma sesión.
- I4: doble submit / doble cobro / respuesta perdida → un solo efecto (idempotencia real).
- I5: ningún `Order` aceptado queda sin cuenta responsable (arbitraje envío vs cobro/cierre).
- I6: estados `PAID`/`CANCELLED` inmutables; sin regresiones.
- I7: sin fuga entre mesas/sesiones/restaurantes (aislamiento tenant ya probado).

## Compatibilidad

- Rutas actuales (`/orders/session/:token`, `cash-orders`, `hasUnpaidBalance`) se conservan
  como compatibilidad durante la migración de consumidores (C02–C06, S05–S08); ningún flag
  visual temporal puede reactivar el contrato parcial como «correcto».
- Cambios aditivos; ledger y auditoría preservados ante incertidumbre.

## Riesgos asumidos y no asumidos

- Asumido: `Float` heredado convive durante B03 tras backfill auditado; doble lectura
  temporal con paridad verificada.
- No asumido: recepción física real en cocina, audio/táctil del terminal, usuarios
  observados (siguen `PENDIENTE_EXTERNO`); reducción de personal o promesas económicas.

## Criterios de salida hacia B03–B06 (qué debe demostrar cada una)

- B03: la regresión B02 pasa (cuenta 4000, borrador excluido, caja agregada por sesión);
  misma versión/total en cliente y caja; sin fuga a otra mesa/sesión.
- B04: doble cobro/reintento/respuesta perdida → un registro; saldo nunca negativo por
  carrera; permiso insuficiente denegado con auditoría; parcial+propina concilian.
- B05: pagar una tanda no libera; token vencido no borra deuda; nueva ocupación en cero;
  unir/mover no fusiona cuentas.
- B06: doble submit, timeout tras commit, dos comensales editando, stock/precio cambiado
  y cobro concurrente → sin duplicados ni consumo huérfano, errores accionables.

## Pendiente de validación Codex (no bloquea B02, bloquea B03–B06)

1. Ratificar C1 (TableSession vs OccupancySession) y C3 (enteros + backfill).
2. Confirmar C5 (reclave de llamados) y C6 (criterio de receptor de cocina).
3. Aprobar que B02 es la puerta de B03: B03 solo se implementa contra este contrato.

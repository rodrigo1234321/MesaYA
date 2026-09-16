# E16 — Diagnóstico y política contable de conciliación

Fecha: 2026-09-15. Ejecutor: OpenCode con `opencode/muse-spark-1.3-contributor-free`;
revisión independiente y cierre local por Codex.
Ficha: E16 (S22 / H09). Dependencia E15 (`VERIFIED_LOCAL` local; S21 PG `PENDING_CLOUD`).

## D1 — Sin turno explícito en reportes (CONFIRMADO, corregido)

`SalesReportQueryOptions` no aceptaba `shiftId`: el dueño sólo podía partir por
día calendario un turno noche (p. ej. 22:00→06:00), lo que dividía en dos días
un mismo turno y rompía la conciliación por jornada. El modelo `Shift`
(`openedAt`/`closedAt`) ya existía y `MetricsService` ya usaba el turno actual,
pero ventas/cobros lo ignoraban.

Decisión: nuevo filtro opcional `shiftId` en servicio, rutas
(summary/operations/csv/pdf), tipos compartidos y Admin. Con `shiftId`, el rango
es `[openedAt, closedAt ?? ahora)` y prevalece sobre período/fechas; el resumen
devuelve `shiftId/shiftLabel/shiftOpenedAt/shiftClosedAt`. Turno de otro
restaurante → `404 SHIFT_NOT_FOUND` (seguro, sin falso cero).

## D2 — Ajustes restados sin mirar su fecha: el pasado se reescribía (CONFIRMADO, corregido)

`getSalesSummary` restaba TODOS los ajustes de cada settlement del período,
aunque el ajuste se hubiera creado días después. Una devolución del día 3
cambiaba retroactivamente el resumen del día 2: imposible conciliar caja por
movimientos y contrario a H09 («definir antes de cambiar timestamps»).

Política E16 (implementada en `sales-reports.service.ts` y probada en S22):

- `consumo` (ventas devengadas): tandas computables por su `createdAt`
  original. Nunca se mueve una orden a la fecha de pago.
- `cobrado neto` / `propina` neta: cobros por su propio `createdAt`
  (`AccountSettlement`, o `PaymentTransaction` legacy aprobado), menos ajustes.
- `devolución`: cada `PaymentAdjustment` computa en el período de SU PROPIO
  `createdAt`, con el método del cobro original. Una devolución posterior NO
  reescribe el resumen del día del cobro; para conciliar cobro+ajuste se
  consulta el rango amplio (jornada/turno), donde el neto es exacto.
- `saldo` / `pendiente al corte`: consumo computable acumulado menos cobros
  netos acumulados al instante `hasta` (exclusivo), sólo de sesiones abiertas
  en ese instante. Una devolución posterior reabre saldo vivo (correcto: la
  deuda reaparece).
- Todo rango es `[desde,hasta)` en la zona IANA del local.
- Filtros: método y responsable aplican a cobros de salón; pagos legacy no
  tienen responsable atribuido (el filtro por responsable los excluye del
  período, pero el saldo vivo siempre los descuenta) y el filtro por método sí
  les aplica; comprobante fiscal filtra por sesión cubierta.
- Rango CUSTOM inválido → `400 INVALID_DATE_RANGE`; turno ajeno → `404
  SHIFT_NOT_FOUND`. Nunca un falso cero tras error.

## D3 — Detalle de operaciones con importes de vida vs. resumen de período (CONFIRMADO, corregido)

`getSalesOperations` listaba sesiones con actividad en el rango pero sumaba
TODAS sus tandas/cobros (vida completa): la suma del detalle no igualaba al
resumen cuando una cuenta cruzaba días, y el CSV heredaba la divergencia.

Decisión: importes de cada operación acotados al período con la misma
semántica del resumen (`consumoTotalMinor`, `cobradoTotalMinor`,
`propinaTotalMinor`, nuevo `devolucionTotalMinor`); tandas/settlements/ajustes
anidados filtrados al período (con `createdAt` preservado por movimiento);
`saldoMinor`/`status` siguen siendo de la cuenta completa para no ocultar
deuda. La sesión con una devolución posterior aparece también en el período
del ajuste (por su saldo vivo), aunque sus importes del período sean cero.

## D4 — PDF sin columna de devolución ni turno (CONFIRMADO, corregido)

El cuerpo del PDF A4 se construye en
`ReceiptService.generateSalesSummaryA4PdfBuffer`
(`packages/api/src/services/receipt.service.ts`). La revisión independiente
extendió de forma explícita el alcance de E16 para cerrar su criterio
obligatorio de coincidencia CSV/PDF/UI: el PDF ahora muestra el turno, la
devolución del período y una columna `DEVOLUCIÓN` por medio, con el mismo
resumen filtrado. S22.9 verifica las etiquetas y el contenido generado.

## Descartado

- Tocar `metrics.service.ts` / `metrics.routes.ts` / `MetricsView.tsx`: la
  métrica operativa por turno ya existe y la semántica E16 vive en ventas; no
  se requiere cambio. Archivos intactos.
- Secuencia fiscal sin huecos / mover órdenes a fecha de pago: contrario a la
  política; descartado explícitamente.
- Mezclar pagos legacy como pseudo-settlements en el detalle: ensucia autoría
  y el botón Ajustar (404). Se documenta el límite: `pagosDetalle` del CSV
  enumera cobros de salón; las columnas canónicas (que mandan) sí incluyen
  legacy.

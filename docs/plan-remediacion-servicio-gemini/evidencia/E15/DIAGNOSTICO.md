# E15 — Diagnóstico del defecto de numeración (H02)

Fecha: 2026-09-15. Fuente: lectura estática de `packages/api/src/services/receipt.service.ts`
(previo a esta corrida), `01-EVIDENCIA-Y-COMPETIDORES.md` y `sales-reports-settle.test.ts`.
La reproducción dinámica posterior quedó registrada en
`VERIFICACION-CODEX-20260915.md`; el gate PostgreSQL sigue pendiente.

## Defecto confirmado por lectura (count + 1)

`getNextReceiptNumber` hacía `count({ startsWith TK-<hoy> }) + 1`. Dos
solicitudes concurrentes leen el mismo `count` y calculan el mismo número:

- La `@@unique([restaurantId, receiptNumber])` convierte el duplicado en
  `P2002`. El bucle reintentaba sólo 4 veces y, agotados, lanzaba 503
  `RECEIPT_PERSIST_FAILED`. Con N≈20 concurrentes los 4 intentos se agotan con
  alta probabilidad: el 503 no era la causa, era el síntoma de la carrera.
- Coherente con la calibración de `01-EVIDENCIA-Y-COMPETIDORES.md` (H02 "no
  demostrado": el código tiene reintentos y el 503 no es sistemático, depende
  del grado de concurrencia).

## Carrera de idempotencia (ventana, no pérdida)

Doble `findUnique(idempotencyKey)` → `create`: dos competidores con la misma
clave podían pasar el fast-path y chocar en el `UNIQUE(idempotencyKey)`. El
código ya recuperaba la fila ganadora (`replay`), pero mezclaba ese caso con
la colisión de número en el mismo `P2002`, con sólo 4 intentos compartidos.
Hipótesis a verificar dinámicamente: bajo 20×misma clave, el 503 era posible
por agotamiento compartido, no por doble cobro (el cobro vive en
`AccountSettlement`, tabla separada que este flujo no toca).

## Persistencia en dos pasos (ventana de reinicio)

El `create` sólo escribía `pdfPath`; `contentHash`/`pdfVersion`/`pdfData` se
proyectaban con un `UPDATE` posterior cuyo fallo se tragaba con
`console.warn`. Un reinicio entre ambos dejaba la fila sin `pdfData`/`contentHash`
en columnas (recuperable vía `pdfPath`/re-render, pero a medio persistir).
Además el caché `pdfCache` en memoria sugería dependencia de proceso: no la
hay para corrección (el lector prefiere columnas), pero se prueba con
`clearPdfCache()`.

## Decisión E15 (implementada)

- Contador atómico por local/período (`ReceiptCounter`, único en
  `(restaurantId, period)`): un solo `UPDATE ... RETURNING` serializa a los
  competidores en PG y SQLite. Inicializado sobre el máximo existente del
  período: convive con numeración histórica sin reiniciarla.
- Número+hash+PDF ligados en una única escritura (`create` con
  `contentHash`/`pdfVersion`/`pdfData`/`pdfPath` a la vez). Sin `console.warn`:
  esquema desactualizado o contador ausente son 503 explícitos
  (`RECEIPT_SCHEMA_UPGRADE_REQUIRED` / `RECEIPT_COUNTER_UNAVAILABLE`).
- Sin promesa de secuencia sin huecos: colisión/reintento avanza el contador
  (hueco documentado, ticket informativo).
- Cobro intacto: el settlement se confirma antes y en otra tabla; un fallo de
  render es `RECEIPT_RENDER_FAILED` sin revertir el cobro (cubierto por test).

## Límites de este diagnóstico

- La prueba local con 20 solicitudes concurrentes pasó; la reproducción
  multi-conexión PostgreSQL todavía no fue posible en este host.
- S21 completo exige PG multi-conexión: SQLite efímera prueba la lógica
  (unicidad/idempotencia/aislamiento/recuperación), PG queda `PENDING_CLOUD`.

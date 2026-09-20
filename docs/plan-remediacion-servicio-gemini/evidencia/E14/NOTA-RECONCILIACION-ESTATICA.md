# E14 — Nota de reconciliación estática (sin ejecución)

Fecha: 2026-09-16. Corrida sin herramienta de ejecución: no se corrió ningún test
ni navegador. Mapeo requisito ↔ implementación existente o agregada en la corrida.

## S17 — cocina recibe, prepara, listo y mozo entrega
| Aserción del test focal | Camino de implementación |
|---|---|
| `GET kitchen-orders` con notas, `guestName`, tags (`GLUTEN_FREE`, `VEGAN`), `tableLabel`, `sector`, `urgency` | `OrderService.getKitchenOrders` (`order.service.ts:3413+`): filtra `PENDING_VALIDATION/IN_KITCHEN/READY_TO_SERVE` por tenant, incluye items + `menuItem.tags` parseados, notas y comensal. Ruta en `orders.routes.ts:174+`. Preexistente. |
| 403 `STAFF_TENANT_MISMATCH` cross-tenant | Guard en `getKitchenOrders` y en `updateOrderStatusByStaff`. Preexistente. |
| `PATCH IN_KITCHEN → READY_TO_SERVE`; mesa NO avanza; aparece tarea `ORDER_DELIVERY` (`SERVE_ORDER` / «Entregar a mesa») | Transición en `ALLOWED_ORDER_TRANSITIONS`; `updateOrderStatusByStaff` no toca FSM en `READY`; workspace mapea `READY_TO_SERVE → ORDER_DELIVERY/SERVE_ORDER` (`service-workspace.service.ts:309+`). Preexistente. |
| `SERVE_ORDER` → `SERVED` + mesa `EATING` | **Agregado en la corrida:** `POST /v1/staff/restaurants/:id/service-tasks/act` (`service.routes.ts:78+`) → `actTask(ORDER_DELIVERY/COMPLETE)` con claim atómica, `updateMany` condicional, FSM `→ EATING` y replay idempotente. |
| Revert `READY_TO_SERVE → IN_KITCHEN` con motivo; desaparece `ORDER_DELIVERY` | Transición permitida en la matriz; workspace deja de emitir `ORDER_DELIVERY`. Preexistente (UI pide confirmación y motivo «Rehecho en cocina»). |
| Doble `READY` concurrente → 200/200 idempotente | `updateOrderStatusByStaff` devuelve la orden recargada si `status === newStatus`; writes no condicionales en avance. Preexistente. |
| Cancelada en salón + `READY` posterior → 409 `ORDER_FINAL_STATE`; excluida del KDS | Guarda de estados finales en `updateOrderStatusByStaff`; KDS excluye `CANCELLED`. **Agregado:** `rejectOrder` acepta `IN_KITCHEN`/`READY_TO_SERVE` con motivo + actor (`order.service.ts:2544+`). |

## S10 — aviso visible en cualquier vista
`useServiceSync` marca `ORDER_DELIVERY` como urgente; `ServiceWorkspace` muestra la
tarjeta «Entregar a mesa»; `KitchenOrdersManager` hace polling (4 s visible / 10 s
oculto) con backoff ante fallos y refresco en `visibilitychange`/`online`. Audio
tras interacción (`lib/audio`). Preexistente; sin verificación en dispositivo real.

## S18 — una pantalla / comanda manual
Modal «Cargar Comanda a Mesa» (pedido presencial atómico por líneas) en
`KitchenOrdersManager`; impresión/export acotado queda para E20/E23. Preexistente.

## H06 / H07
H06: KDS dedicado por puesto con ruta directa (`App.tsx`: `?view=kitchen`,
`?tab=`, `?station=`, `/kitchen`), sin ventas/rewards/PIN en la vista, con JWT de
staff y `STAFF_TENANT_MISMATCH` entre restaurantes. H07: un solo dueño del
polling en el shell + sincronización única E08; eventos `order.status_changed` /
`order.rejected` por `eventBus` tras commit. Preexistente.

## Corrección al propio test (documentada, expectativa preservada)
`TableFSMState.OCCUPIED_ORDERED` no existe en `shared` ni en Prisma → reemplazado
por el canónico `ORDER_IN_KITCHEN` (2 ocurrencias). La expectativa «la mesa no
avanza al marcar listo» queda intacta.

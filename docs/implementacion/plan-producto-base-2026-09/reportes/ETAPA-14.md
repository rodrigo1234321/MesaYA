# Reporte de etapa 14 — Fila virtual y pre-pedido

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- Se agregó una pantalla pública de fila virtual en el cliente web (`?fila=<slug>` o `/fila/<slug>`), independiente de una sesión de mesa: alta de grupo, consentimiento, teléfono, tamaño, estimación, ticket y actualización automática.
- Se agregó `GET /v1/waitlist/:id/status?phone=...`; el teléfono se normaliza y se usa como segundo factor liviano. El endpoint devuelve sólo el ticket propio y nunca el teléfono ni la lista completa.
- La fila y el pre-pedido ahora se reflejan como capacidades disponibles sólo cuando el restaurante los habilita. El pre-pedido valida cantidad, notas, pertenencia al tenant y disponibilidad del plato antes de persistir JSON acotado.
- Al sentar un grupo, el turno se reclama con `UPDATE ... WHERE status IN (WAITING, CALLED)`. La FSM usa además el estado esperado `AVAILABLE`; si la transición falla, la guarda del turno se revierte. Esto evita doble seating en dos pantallas compartidas.
- Un pre-pedido validado se convierte en comanda `IN_KITCHEN` mediante una transacción única de carga del mozo, conservando precio y tenant del servidor y evitando líneas parciales si cambia el stock.
- Se sincronizó el schema de Supabase y se agregó la migración PostgreSQL de `UpsellEvent` que faltaba del bloque anterior.

## Verificación

| Verificación | Resultado |
|---|---|
| fila lifecycle, privacidad, pre-pedido, promoción atómica y carrera concurrente | 31/31 PASS |
| capabilities y política de activación | 23/23 PASS |
| paridad SQLite/PostgreSQL y sincronizador | 3/3 PASS |
| matriz de rutas | 80 rutas clasificadas, PASS |
| suite API completa | 425 PASS, 3 skips PG explícitos |
| build API (Prisma + TypeScript) | PASS |
| build cliente web (Vite) | PASS |
| recorrido visual local (`?fila=trattoria-del-puerto`) | PASS: config/menu 200, formulario, consentimiento y pre-pedido visibles |

## Límites conocidos

- La pantalla pública fue verificada contra la API local levantada y mediante inspección visual/AX; todavía falta la validación en un dispositivo real y en Preview.
- El runner oficial `npm run test:isolated` sigue requiriendo el adaptador Windows Job de la jornada; no se falsificó esa variable ni se ejecutó contra datos remotos.
- La conversión del pre-pedido ocurre después de asignar la mesa. Si la carga a KDS falla por un cambio de stock entre alta y asiento, se informa `PREORDER_PROMOTION_FAILED` y el grupo permanece sentado para resolución del mozo.

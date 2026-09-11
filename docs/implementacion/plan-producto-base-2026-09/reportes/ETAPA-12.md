# Reporte de etapa 12 — Upselling coherente y medible

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- El cliente de comensal consume `/upsell` al abrir el carrito y muestra hasta tres sugerencias disponibles.
- Agregar una sugerencia usa la misma validación de stock/precio del carrito; no se confía en el precio del cliente.
- Se puede descartar una sugerencia sin bloquear el pedido.
- La API valida que el plato de origen y la sugerencia pertenezcan al mismo restaurante.
- Se agregó `UpsellEvent` con hash de sesión, grupo experimental, tipo de evento e idempotency key; registra impresión, aceptación y descarte sin guardar el token crudo.
- Se asigna un grupo control determinístico cuando se consulta con sesión, sin presentar sugerencias al control.
- La capacidad `upsell` pasó a `AVAILABLE` y la configuración ya no bloquea su activación.

## Verificación

| Verificación | Resultado |
|---|---|
| contrato de evento, aislamiento e idempotencia | 3/3 PASS |
| capabilities y política de configuración | 26/26 PASS |
| matriz de rutas | PASS: 79 rutas clasificadas |
| build API + Prisma Client | PASS |
| build client web | PASS |

## Límite conocido

La venta incremental se calcula posteriormente cruzando eventos de aceptación con ítems de órdenes; todavía no se publica una cifra de uplift sin muestra suficiente. El modelo fue agregado a ambos esquemas Prisma y será incluido en la migración PostgreSQL de la próxima promoción; no se tocaron bases remotas.

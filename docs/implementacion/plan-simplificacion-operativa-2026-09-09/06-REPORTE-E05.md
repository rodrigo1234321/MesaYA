# E05 — Validación por excepción

**Estado:** `IMPLEMENTED_NEEDS_REVIEW`  
**Fecha:** 2026-09-09  
**Objetivo:** que los pedidos normales lleguen a cocina sin validación rutinaria y
que sólo una excepción identificada cree una tarea pendiente con motivo legible.

## Decisión aplicada

- El modo `requireWaiterValidation` se conserva como modo manual global y auditable.
- En modo automático, uno o dos productos iguales pasan directo; el valor inicial
  configurable es 6 unidades por línea.
- Stock que cambia después de armar el carrito y cantidad mayor al umbral dejan la
  tanda en `PENDING_VALIDATION` con motivo persistido.
- Una alerta de alergia/restricción ya contemplada por la carta se muestra en Servicio
  como contexto; no agrega una confirmación humana adicional ni bloquea el pedido.
- El rechazo exige motivo y actor, cancela la tanda de forma idempotente y la cuenta
  nunca incorpora pedidos `CANCELLED`.

## Cambios

- Campos aditivos en `RestaurantModuleConfig` (`reviewQuantityThreshold`) y `Order`
  (`reviewReasonCode`, `reviewReasonDetail`), con migración PostgreSQL y paridad de
  schema SQLite/Supabase.
- `submitOrder` determina la excepción dentro de la transacción y persiste el motivo.
- `validateOrder` revalida stock antes de aceptar y limpia el motivo al enviar a cocina.
- `POST /v1/staff/orders/:id/reject` cancela una revisión pendiente de manera idempotente.
- Servicio transporta la razón, mantiene detalle de platos/notas y ofrece `Aceptar y
  enviar` / `Rechazar`; las alertas de alergia no agregan botón de confirmación.
- Administración permite configurar y auditar el umbral.

## Evidencia local

| Control | Resultado |
|---|---|
| E05 aislado | **4/4 PASS** |
| Gate E00–E05 + regresiones B06/guest/S01-S03 | **6 suites, 77/77 PASS** |
| `npm --workspace=@mesaya/shared run build` | **PASS** |
| `npm --workspace=@mesaya/api exec tsc -- --noEmit` | **PASS** |
| Build staff | **PASS** |
| Build admin | **PASS** |
| Paridad `schema.supabase.prisma` | **PASS** |

## Límites y siguiente gate

La verificación visual local confirmó login, Servicio, mapa y selección de mesa,
pero el seed demo no tenía una tarea activa para observar una tarjeta de excepción
poblada. No se ejecutó despliegue, migración remota, restauración, QR/NFC físico ni
piloto real. E06 debe revisar la carrera entre reclamar y actuar para que aceptar o
rechazar sea una intención atómica también entre dos terminales.

# Etapa 01 — Ciclo operativo y caja presencial

## Objetivo

Completar una mesa desde ocupación hasta liberación con pedido y cobro presencial, usando sólo funciones ya respaldadas por el backend.

## Trabajo

1. Diseñar una vista “Mesa/Cuenta” para staff con comanda, total, estado, propina y acciones permitidas.
2. Conectar `StaffApi.payOrder` a una acción visible sólo para manager.
3. Permitir efectivo y tarjeta presencial; mostrar confirmación y comprobante interno trazable.
4. Evitar doble cobro con idempotencia estable por intención, no una clave basada sólo en `Date.now()`.
5. Hacer visible cada error de transición; retirar `catch` silenciosos en los enlaces Order -> FSM.
6. Sincronizar pedido: DRAFT -> PENDING_VALIDATION/IN_KITCHEN -> READY_TO_SERVE -> SERVED -> BILL_REQUESTED -> PAID.
7. Copiar total realmente cobrado a la sesión de ocupación.
8. Definir quién puede liberar mesa, qué ocurre con comandas abiertas y cuándo se invalida el QR rotativo.
9. Ensayar dos clientes en la misma mesa para el carrito social y decidir la conducta de `syncSocialCart`.

## Casos obligatorios

- Manager cobra una orden servida una sola vez.
- Mozo no manager recibe 403 al confirmar cobro.
- Doble toque no crea dos transacciones.
- Pago rechazado por estado no cambia orden, mesa ni métricas.
- Cierre de mesa con cuenta abierta requiere resolución explícita.
- Al liberar, el token anterior deja de ejecutar acciones.

## Aceptación y PAUSA A

En Preview, una persona hace de comensal y otra de staff. Completan el guion sin consola ni llamadas API manuales. Se promueve el tren A al piloto sólo después de aprobar el recorrido y el rollback.


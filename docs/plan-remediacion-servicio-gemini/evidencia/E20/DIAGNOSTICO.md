# E20 — Diagnóstico: comanda, impresión y operación con un equipo

Fecha: 2026-09-16. Ficha E20 (S18). Dependencias E14/E15 (`VERIFIED_LOCAL`).

## Confirmado por lectura (2026-09-16)

1. **D1 — Sin canal a cocina en un puesto único (CONFIRMADO, corregido en alcance).**
   `KitchenOrdersManager.tsx` tenía vista KDS con notas/comensal/alérgenos,
   filtros, polling con backoff y transiciones E14 (`IN_KITCHEN` →
   `READY_TO_SERVE` → entrega en salón), pero ninguna acción para llevar la
   comanda a cocina: ni hoja imprimible ni ficha manual. En modo de una
   pantalla eso dejaba S18 sin camino (contrato §8: sin canal validado no hay
   GO). Se agregó botón `Imprimir comanda`/`Reimprimir comanda` por orden
   activa, hoja `COMANDA DE COCINA` con ID/mesa/sector/fecha-hora/ítems/
   cantidades/notas/comensal, bloque de entrega manual y guía de una pantalla.
2. **D2 — Riesgo de mezclar cocina con recibo económico (CONFIRMADO, evitado).**
   El archivo no referenciaba `ReceiptService`, `PAYMENT_RECEIPT` ni
   `PRE_BILL_DETAIL`; el flujo nuevo tampoco los introduce: la hoja declara
   `No es un recibo económico. No llama a caja ni marca cobro` y el handler
   sólo toca estado local (`printOrderId`, `printVariant`, `printFormat`,
   `printRequests`). E15 queda intacto.
3. **D3 — Riesgo de afirmar entrega/cobro/estado por abrir o imprimir
   (CONFIRMADO, evitado).** No se agregó transición ni mutación: el handler
   no llama `updateOrderStatus`/`addManualOrderByStaff`/ningún `StaffApi` de
   mutación ni endpoint de recibo; no hay `onafterprint`/`afterprint` ni
   callback que marque entrega; cerrar la hoja sólo limpia `printOrderId`;
   `READY_TO_SERVE` sigue mostrando `Esperando retiro por mozo` y la hoja
   repite que abrir/imprimir no confirma entrega, cobro ni cambio de estado
   y que registrar la solicitud no confirma que salió papel.

## Descartado

- Driver ESC/POS, hardware, popups externos o APIs de dispositivo: fuera de
  alcance explícito; se usa sólo `window.print()` tras renderizar la hoja
  dedicada, con `requestAnimationFrame`/`setTimeout` y guarda
  `typeof window.print === 'function'`.
- Ocultar la interfaz en render normal: descartado por accesibilidad; el
  ocultamiento vive sólo en `@media print` (`.e20-kitchen-scope > :not(...)`,
  `.e20-no-print`, `@page` con margen 5 mm).

## Límites

- Prueba física de impresión (diálogo del navegador, PDF local, legibilidad
  58/80/A4, recepción manual observada) queda `PENDING_HUMAN`.
- Gates externos heredados (S21 PostgreSQL, despliegue) quedan `PENDING_CLOUD`.
- La suite focal estática no certifica papel, impresora, tamaños reales de
  fuente, táctil/teclado ni personas/equipos.

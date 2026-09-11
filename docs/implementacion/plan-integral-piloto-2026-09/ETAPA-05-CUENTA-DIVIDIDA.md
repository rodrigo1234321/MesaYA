# Etapa 05 — Cuenta dividida

## Objetivo

Dividir una única deuda de mesa sin cobrar de más, perder saldo ni permitir que dos personas reclamen el mismo ítem.

## Modos

- **Partes iguales:** N partes con manejo explícito del redondeo en la última parte.
- **Por ítems:** cantidades divisibles; no asumir que una línea con cantidad 3 es indivisible.
- **Monto libre:** fuera del primer piloto; documentar como extensión futura.

## Trabajo

1. Rediseñar el modelo para asignaciones por unidad/cantidad y no sólo `claimedByGuest` en toda la línea.
2. Crear snapshot inmutable de la deuda al abrir split.
3. Aplicar locks/transacciones PostgreSQL y control de versión para claims.
4. Separar claim temporal, intención de pago y pago confirmado.
5. Liberar claims vencidos/rechazados de manera segura.
6. Calcular `pagado + pendiente + ajustes = total` en centavos enteros; no usar Float para dinero nuevo.
7. Impedir nuevos ítems o exigir cancelar/recrear split si la cuenta cambia.
8. Mostrar progreso a todos los comensales por polling y permitir recuperación tras recarga.
9. Cerrar la orden/mesa sólo cuando todo el monto esté confirmado.
10. Agregar operación de manager para resolver residuales sin editar pagos aprobados.

## Pruebas obligatorias

- 2, 3 y 7 partes con redondeo.
- Dos clientes reclaman la misma unidad simultáneamente.
- Un cliente paga, otro abandona y vuelve.
- Rechazo y webhook duplicado.
- Propina individual y total.
- Cuenta modificada con split abierto.
- Suma invariante después de cada transición.

## PAUSA C

Ensayo con al menos tres teléfonos y pagos sandbox. Revisar conciliación en DB y Mercado Pago antes de habilitar `allowSplitBill` en Preview.


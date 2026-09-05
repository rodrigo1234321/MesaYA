# Casos obligatorios: cocina y cuenta de grupo

Complemento del plan COCINA-CUENTAS-2026-09-05.md. Son requisitos, no resultados ejecutados.

## Flujo de tres personas

Ana y Bruno piden un plato cada uno; Carla agrega una bebida y los tres comparten una entrada. Cada navegador conserva identidad de visita emitida por servidor y no puede atribuirse el ítem de otro alterando un UUID. La cuenta del grupo incluye TODAS las tandas no canceladas, no sólo `getActiveOrder` más reciente.

1. Añadir y cambiar cantidades propias, sin pérdida al refrescar ni duplicados por retry con misma clave.
2. Ana confirma su tanda; el borrador de Bruno permanece pendiente. La cocina recibe sólo lo efectivamente confirmado/validado.
3. En modo con mozo, crear un único llamado de validación y deduplicarlo. En modo directo, comanda y FSM quedan consistentes. Pedido con alergia necesita aceptación humana.
4. Nuevo pedido de postre no reenvía la primera tanda ni regresa una mesa pagada/cerrada a cocina.
5. Editar carta/precio posteriormente no altera precio/nombre/modificadores de líneas ya enviadas. El servidor revalida producto y disponibilidad al confirmar; cambios de precio en borrador se presentan para aceptar, no se cobran silenciosamente.
6. Cortar red antes/después de POST y reintentar con la misma clave devuelve la misma operación. No mostrar «enviado» si hay duda; consultar estado.

## Matemática del reparto

- Autoridad monetaria en centavos enteros, moneda ARS explícita; límites e integer-safe arithmetic. No aceptar NaN, Infinity, negativos, cantidades fraccionarias inesperadas ni overflows.
- Total 10.000 centavos, tres partes iguales: 3.334 + 3.333 + 3.333 con orden estable. Repetir lectura no cambia a quién se asignó el centavo restante.
- Un plato con varias unidades puede asignarse por unidad; plato compartido admite fracciones de importe consistentes, sin inventar unidades ni duplicar asignaciones. La suma asignada por línea nunca excede su importe.
- Partes personalizadas que suman menos dejan saldo explícito sin asignar; nunca desaparece dinero. No confirmar cierre si resta asignación o saldo de consumo.
- Propina es optativa y separada: no reduce deuda de consumo ni impide cerrar consumo ya pagado si no hay propina. Sin doble redondeo por persona.
- Congelar/revisar versión de cuenta al iniciar reparto. Si llegan nuevos consumos, extender saldo mediante una revisión explícita conservando pagos confirmados; no reescribir asignaciones pagadas.
- Confirmar 3.334 centavos dos veces con igual idempotencyKey registra un cobro; misma clave con otro importe da conflicto.
- Dos empleados intentan cobrar el último saldo simultáneamente: sólo un cobro puede consumir ese saldo; total confirmado nunca lo supera.
- Reversión autorizada conserva auditoría y reabre saldo correspondiente; un guest nunca aprueba/revierte pagos. Rechazar cobro de otra mesa/tenant incluso si se conoce el ID.
- PAID de la cuenta sólo cuando el saldo de consumo llega a cero; TO_CLEAN/cierre no elude deuda. Definir cómo convivir con estado físico de mesa y cuentas anuladas, sin reutilizar token de visita cerrada.

## Identidad, abuso y alcance de visita

Un QR permanente puede fotografiarse. Antes de admitir pedidos directos, la participación debe vincularse a una visita activa autorizada (código rotativo por visita o admisión de Staff), con límites de intentos. No presentar geolocalización como prueba suficiente de presencia. Mantener Carta/llamados y validación del mozo como defaults seguros; Cocina directa exige habilitación consciente de local. Invalidar participantes al cerrar visita/turno y probar reuso del QR viejo.

## Caja presencial y futuro pago online

El comensal solicita pagar su parte; el personal registra que recibió efectivo/tarjeta/QR externo. No llamar «confirmado por Mercado Pago» a un QR externo registrado manualmente. Sólo el futuro adaptador de pagos con evento verificado y consulta al proveedor podrá usar ese estado digital. La habilitación online requiere sandbox, claves, conciliación, reembolsos, notificaciones duplicadas/fuera de orden y prueba de total/moneda/merchant. No forma parte de los cobros reales de esta ejecución.

## UI y operación

Carrito accesible, foco/restauración de foco en modal, botones táctiles, estados de carga y error visibles, notas escapadas contra XSS. Opciones de plato válidas para ese producto. KDS permite pausar entrada, agotar productos y rechazar con motivo visible al cliente. Sonido deduplicado por tanda y silenciable; reconectar no dispara todos los sonidos históricos. No sustituir una falla de API por lista vacía engañosa.

## Regresión y cierre

Pruebas SQLite aisladas y PostgreSQL efímero para concurrencia/migración, gates de rutas, build de todas las apps, npm audit y navegador móvil. Revisar backend y UI con precios ficticios. Documentar pendientes cloud de forma separada: no confundir tests locales con operación productiva acreditada.

# Contrato de pantalla compartida de salón

## Contexto

Los mozos no operarán inicialmente desde teléfonos personales. Todos interactúan con una pantalla común del restaurante. El panel debe diseñarse como terminal compartido, no como una PWA personal persistente.

## Dos identidades distintas

### Terminal

Representa el dispositivo físico autorizado: por ejemplo `SALON-PRINCIPAL-01`. Mantiene una sesión de duración controlada, conoce el restaurante y recibe snapshots operativos.

### Actor

Representa al mozo que realiza la acción. Se selecciona por nombre/avatar y confirma con PIN corto cuando corresponde. La API registra `terminalId`, `staffUserId`, rol y timestamp.

No se debe mantener todo el turno bajo el token de un único mozo ni usar un usuario compartido sin trazabilidad.

## Experiencia propuesta

La pantalla inicial muestra todo el salón:

- llamados por prioridad, antigüedad, mesa, motivo y sector;
- estado de mesas y cuentas pendientes;
- comandas a validar;
- pedidos listos para servir;
- conexión y edad del último snapshot;
- acceso rápido a cocina/caja según el modo del terminal.

Un mozo puede tomar una tarea con dos interacciones:

1. selecciona la acción o se identifica desde la barra persistente;
2. confirma su PIN en teclado táctil.

Durante una ventana breve, nuevas acciones de bajo riesgo conservan el actor activo. Acciones sensibles vuelven a pedir PIN.

## Clasificación de acciones

| Riesgo | Ejemplos | Identificación |
|---|---|---|
| Lectura | ver llamados, mesas, cocina | sesión del terminal |
| Operativa | tomar llamado, en camino, validar comanda, servir | actor activo; PIN al iniciar/cambiar actor |
| Sensible | cobrar, descuento, cancelar pedido, forzar cierre | PIN en cada acción y rol suficiente |
| Administrativa | personal, módulos, turno, credenciales | panel admin separado; manager |

## Concurrencia y propiedad

- “Tomar llamado” debe ser atómico; dos mozos no pueden adjudicárselo simultáneamente.
- La UI muestra quién lo tomó y permite reasignar con auditoría.
- Un pedido listo puede asignarse para entrega sin ocultarse al resto.
- Los filtros por sector no eliminan la vista global; sólo reducen ruido.
- Cada acción usa versión/idempotencia para tolerar doble toque.
- La pérdida de red congela mutaciones y conserva una cola visual; no afirma éxito hasta confirmación del servidor.

## Seguridad del terminal

- alta/revocación de terminales por manager;
- token de terminal distinto del JWT personal;
- bloqueo automático por inactividad;
- botón visible de bloquear/cambiar actor;
- no mostrar PIN en logs ni almacenamiento;
- revocar sesiones al desactivar un mozo;
- modo pantalla completa y recuperación tras refresh;
- indicador permanente de restaurante, terminal, entorno y versión.

## Cocina y caja

La base debe permitir tres perfiles de pantalla:

- `SALON_SHARED`: todos los mozos;
- `KITCHEN`: preparación/KDS;
- `CASHIER`: cuentas y cobros.

En un local pequeño pueden ejecutarse en el mismo equipo cambiando de modo con permiso. En uno grande pueden vivir en dispositivos separados sin cambiar el modelo de datos.

## Criterios de aceptación

- tres mozos usan una pantalla durante un guion completo sin compartir identidad;
- cada mutación se atribuye al actor correcto;
- dos actores intentando tomar la misma tarea producen un único ganador;
- refresh/reconexión no convierte acciones pendientes en resueltas;
- un mozo desactivado deja de operar en terminales ya abiertas;
- caja y cierres sensibles siempre exigen rol e identificación actual.


# Pruebas, métricas y criterios GO/NO-GO

Fecha: 2026-09-09  
Objeto: validar el plan de simplificación operativa antes de declarar terminado el goal futuro

## 1. Matriz funcional mínima

### Sesión, QR y recambio

1. Sesión abierta con deuda: ningún endpoint alternativo puede crear otra sesión o cerrar la actual.
2. Sesión con borrador: cerrar devuelve conflicto accionable y conserva el borrador.
3. Sesión con revisión o llamado pendiente: cerrar no silencia el pendiente.
4. Cobro total + cierre: token anterior devuelve 410 inmediatamente.
5. Escaneo durante `TO_CLEAN`: no devuelve cuenta, historial ni token anterior.
6. `Mesa lista` + nuevo escaneo: crea/entrega sesión distinta, token distinto y cuenta cero.
7. Dos escaneos simultáneos tras disponibilidad: ambos convergen en una sola ocupación.
8. Sesión vencida con deuda: queda bloqueada para resolución de staff, no se reemplaza silenciosamente.
9. Mismo teléfono tras cierre: elimina credenciales de la sesión anterior y re-resuelve por slug/mesa.
10. Foto/copias del QR fijo: nunca contienen el token de una ocupación.

### Pedido y validación

11. Pedido común disponible: pasa a cocina sin tarea de validación.
12. Dos unidades de una bebida común: no se convierte en excepción por defecto.
13. Nota de alergia/restricción contemplada por la carta: queda visible como contexto, con platos, cantidades y nota, sin confirmación humana adicional.
14. Producto agotado entre lectura y envío: no entra silenciosamente a cocina; respuesta comprensible.
15. Umbral de cantidad configurado: genera una sola revisión.
16. Modo manual temporal: todos los pedidos afectados explican ese motivo.
17. Dos mozos aceptan a la vez: una sola transición; el perdedor recibe estado actualizado.
18. Pedido rechazado/cancelado: no integra consumo cobrado y conserva auditoría.

### Cocina y entrega

19. Pedido directo aparece una vez en cocina y en el resumen de Servicio.
20. Sólo el rol/estación configurado puede marcar `READY`.
21. `READY` produce una sola tarea prioritaria de retiro.
22. Dos mozos pulsan `Me lo llevo`: sólo uno reclama el plato.
23. Deshacer dentro de la ventana devuelve el pendiente sin duplicarlo.
24. Reconexión y polling/SSE no repiten sonido ni tarjeta histórica.
25. Varias tandas de la misma mesa mantienen identidad y estados separados.

### Cuenta y cobro

26. Tres rondas acumulan el mismo consumo en cliente, Servicio y ledger.
27. Borrador, pendiente y cancelado no se cobran.
28. Propina y pagos se presentan separados del consumo.
29. Reintento con la misma clave no duplica pago ni cierre.
30. Cobro concurrente con nueva ronda produce resultado serializable o conflicto recuperable.
31. Versión obsoleta obliga a releer el saldo; no cobra un importe antiguo a ciegas.
32. Mozo sin permiso ve reautorización inline; no obtiene una sesión de manager permanente.
33. `Registrar pago y mantener mesa` permite otra ronda sin liberar.
34. `Cobrar y cerrar` deja `TO_CLEAN`, nunca `AVAILABLE` directo.
35. El camino normal no llama al cobro por comanda heredado.

### Cliente y carrito colaborativo

36. Agregar un plato conserva carta, categoría y scroll.
37. Tres platos crean un único borrador y mini-carrito con cantidad/total correctos.
38. `Seguir eligiendo` vuelve al contexto anterior.
39. Envío con respuesta perdida usa la misma clave y no duplica tanda.
40. Dos dispositivos agregan concurrentemente y resuelven `DRAFT_CONFLICT` sin perder datos.
41. Cada línea muestra nombre saneado; el identificador técnico no se expone.
42. Nombre y nota de cocina permanecen en campos distintos.
43. Cuenta explica que colaboración no significa división digital.
44. Descartar sugerencia evita su reaparición durante la sesión.
45. Sugerencia aceptada rota o desaparece; nunca bloquea enviar.
46. Motor de sugerencias deshabilitado/caído no altera el carrito.

## 2. Pruebas de lógica y concurrencia

Cada comando mutador debe verificarse en cuatro condiciones:

- ejecución normal;
- doble clic/doble solicitud;
- respuesta perdida seguida de reintento;
- carrera con otra mutación válida de la misma sesión.

Invariantes obligatorios:

- una mesa tiene como máximo una sesión operativa;
- una sesión tiene como máximo un borrador activo;
- saldo = consumo confirmado − pagos asignados, sin valores negativos ocultos;
- una tarea activa tiene un solo propietario;
- un pedido no salta estados sin evento auditable;
- cerrar nunca borra deuda, borrador, revisión o llamado;
- la ocupación siguiente no puede leer ni modificar la anterior;
- aislamiento por restaurante en todos los nuevos DTO y comandos.

## 3. Prueba humana orientada al mozo

Preparación: 22 mesas, al menos 2 cuentas pedidas, 3 llamados, 4 pedidos en cocina, 2 platos listos, 1 revisión excepcional y 1 mesa pagada por limpiar.

Se realizarán las tareas sin explicación durante el ejercicio:

1. identificar qué atender primero;
2. responder un llamado;
3. comprender y resolver una excepción;
4. retirar un plato listo;
5. consultar una mesa y sus tres rondas;
6. cobrar y cerrar con autorización;
7. marcar la mesa lista;
8. comprobar que el nuevo cliente empieza en cero.

Objetivos:

| Métrica | Aprobación |
|---|---:|
| Encontrar el siguiente pendiente | ≤ 5 s |
| Cambios de pantalla/tab en las 8 tareas | 0 |
| Pedido normal: clics del mozo antes de cocina | 0 |
| Llamado simple | 1 acción |
| Revisión excepcional | 1 acción principal |
| Plato listo | 1 acción de retiro |
| Cobro total y cierre | 1 acción principal + autorización si aplica |
| Limpieza | 1 acción física |
| Errores no recuperados o tarea duplicada | 0 |

Registrar además dudas verbales, retrocesos, aperturas del menú secundario y acciones sobre la mesa equivocada. La rapidez sin comprensión no aprueba.

## 4. Prueba humana orientada al cliente

Dispositivos: 360 px, 390 px, tablet y un segundo teléfono colaborador.

Recorrido:

1. escanear y entender cómo empezar sin ayuda;
2. agregar tres platos de categorías distintas;
3. volver al carrito y continuar eligiendo;
4. identificar qué agregó cada persona;
5. enviar una ronda y luego una segunda;
6. revisar consumo acumulado;
7. entender qué significa dividir la cuenta hoy;
8. pedir cuenta;
9. volver a escanear después del cierre y durante limpieza.

Objetivos:

- ningún agregado abre el carrito automáticamente;
- tres platos distintos requieren como máximo 8 toques desde carta abierta hasta envío, contando apertura de cada detalle;
- no se pierde posición ni categoría;
- el usuario distingue borrador, pedido enviado, consumo, pago y saldo;
- ninguna sugerencia descartada vuelve durante la sesión;
- la ocupación anterior nunca aparece en el siguiente recorrido;
- sin overflow horizontal, controles táctiles adecuados y axe sin violaciones críticas/serias.

## 5. Verificación técnica

Como mínimo:

- suites focales de cuenta, liquidación, cierre seguro, carreras de borrador, historial, cliente, llamados, FSM, tareas y upsell;
- nuevas suites de rotación QR, política de excepciones y comando atómico de cierre;
- typecheck de API, shared y staff;
- builds de API, cliente, staff y admin;
- paridad de esquemas SQLite/PostgreSQL si hay migración;
- `git diff --check` y revisión de cambios no relacionados;
- prueba con dos contextos de navegador/terminal;
- simulación de red interrumpida y reconexión;
- revisión independiente con lentes de corrección, seguridad y pruebas.

La suite se ejecutará sobre base efímera. Antes de Prisma o pruebas locales se detendrán procesos que mantengan bloqueado SQLite; no se usará una URL PostgreSQL ficticia como evidencia de runtime.

## 6. Gates y NO-GO

### GO local de la simplificación

Requiere simultáneamente:

- los cinco gates E00–E15 aprobados;
- 46 escenarios funcionales en verde o una justificación explícita aprobada;
- métricas humanas locales cumplidas;
- cero defectos P0/P1 abiertos;
- diferencias cliente–staff–ledger iguales a cero;
- ninguna herencia de sesión en recambio;
- revisión independiente cerrada y reverificada.

### NO-GO automático

- el siguiente cliente puede ver cuenta/historial anterior;
- existen dos cuentas canónicas o dos cobros cotidianos contradictorios;
- pedido común requiere validación sin motivo;
- mozo necesita cambiar a Caja/Admin para cobrar;
- un clic repetido duplica pago, pedido, tarea o cierre;
- el sistema afirma limpieza, preparación o entrega sin acción física confiable;
- una carrera produce consumo o pago huérfano;
- una migración pierde datos o rompe paridad;
- las pruebas usan una base real o evidencia no reproducible.

### Lo que este GO no certifica

Un GO local no autoriza despliegue ni piloto real. Para ello todavía se requieren despliegue cloud, PostgreSQL real, backup/restore probado, QR físico/NFC en dispositivos reales, red del restaurante, observación con mozos/cocina y aprobación humana final.

## 7. Evidencia por etapa

Cada etapa debe dejar:

1. problema reproducido;
2. archivos y contrato modificados;
3. pruebas añadidas/cambiadas;
4. comandos y resultados completos;
5. capturas sólo como apoyo, nunca como única prueba;
6. revisión independiente y correcciones;
7. decisión `PASS`, `NEEDS_REVIEW` o `BLOCKED` con motivo;
8. riesgos residuales y siguiente dependencia.

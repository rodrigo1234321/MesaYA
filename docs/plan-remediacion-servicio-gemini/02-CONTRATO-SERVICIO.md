# Contrato de experiencia: el mozo debe poder volver al salón

Especificación propuesta para implementar por etapas. Los umbrales son metas iniciales, no resultados medidos. Se pueden ajustar con observación documentada en E02/E23, nunca para esconder errores de dinero, mesa o permisos.

## 1. Modelo físico que gobierna el diseño

| Instalación | Operación propuesta | Límite a demostrar |
|---|---|---|
| Una PC en barra | Inicio en Atención, mouse/teclado; acceso por mesa; encargado cobra en contexto; comanda manual entregada a cocina si no hay canal de impresión | Un único mouse no atiende dos personas a la vez. Medir espera y recorrido; UI no elimina esa restricción |
| Una tablet compartida | Mismas tareas, controles táctiles; detalle reemplaza temporalmente la lista en vertical | Soporte, alimentación y PIN accesible. Sin exigir un teléfono por mozo |
| Dos equipos | Uno salón/caja y otro cocina; mismo estado central y permisos específicos | Si ambos están en salón, sigue siendo necesario un canal a cocina. No contar una impresora/pantalla inexistente |

Relevar mesas, sectores, personal, distancia a cocina, pico de pedidos, red y quién recibe comandas. Hasta tener datos, simular 6 y 20 mesas y 1/10/30 pendientes; no venderlos como capacidad certificada. Si la alternativa manual se satura, limitar piloto o elegir otra configuración antes de GO.

## 2. Portada propuesta: Atención

```text
LOCAL · Atención        Conectado · hace 2 s       Ana · Cambiar
[Atención 7] [Mesas]                          [Más]
Sector: Salón ▾                      Buscar mesa: [       ]

MESA 12    Pide mozo             hace 2 min      [Voy]
MESA  4    2 platos listos       hace 1 min      [Ver entrega]
MESA  8    Solicita cuenta      hace 3 min      [Ver cuenta]
MESA  2    Pedido a revisar     Motivo: …       [Revisar]
```

- Una sola cabecera; borrar duplicación visual, no indicadores de seguridad. Estado de conexión real y operador siempre legibles.
- Atención y Mesas como entradas principales. Más contiene funciones secundarias habilitadas; Cocina es acceso de puesto configurable, no otra fila permanente de controles.
- Sin cinco KPIs ni cinco filtros permanentes en portada. Un selector de sector y búsqueda por mesa. Filtros adicionales en menú sólo cuando hagan falta.
- Cada tarjeta: mesa, necesidad, antigüedad, quién la tomó si aplica y UNA acción principal con verbo específico. Detalle secundario por la tarjeta. Nunca un «Hecho» genérico para cualquier evento.
- Mostrar la primera tarea accionable sin scroll en 1366×768 y 768×1024 con datos de prueba normales. Cabecera sin ocupar media pantalla; intentar no superar 20% del alto visible sin zoom, como meta de maqueta.
- La cuenta o pedido no solicitados quedan fuera de la portada. Excepciones de validación no se ocultan: explican su motivo y requieren decisión.

## 3. Semántica de acciones

| Necesidad | Primera acción | Finalización |
|---|---|---|
| Llamado | Voy: asigna/toma con control de conflicto | Atendido cuando la acción física terminó; historial visible |
| Platos listos | Ver entrega: items y mesa sin precios innecesarios | Entregado confirma la tanda/orden soportada, no todo consumo de la mesa |
| Cuenta solicitada | Ver cuenta | Cobrar sólo con permiso y confirmación de método/importe |
| Pedido con excepción | Revisar: motivo e items | Aceptar/rechazar con contrato vigente; no validar automáticamente por ocultarlo |
| Mesa retirada | Marcar para limpiar según estado permitido | Limpia sólo tras confirmación física; pagar no equivale a dejar libre |

No inventar granularidad de entregas por item si el dominio actual sólo soporta orden: reutilizarlo y dejar el límite visible. Deshacer entrega sólo con la operación inversa existente/validada, ventana y ausencia de eventos posteriores incompatibles. Un toast que desaparece no revierte DB.

## 4. Detalle de mesa y acciones progresivas

- Abrir una mesa desde tarea, búsqueda o vista Mesas con la misma identidad de mesa/sesión.
- En horizontal amplio: lista y detalle lateral, con scroll independiente controlado. En vertical/estrecho: detalle a pantalla completa con «Volver a Atención», conserva filtros y posición. Nunca colocar el detalle después de 30 tareas.
- Detalle inicial: estado de mesa y pedidos relevantes; botones explícitos «Agregar pedido» y «Ver cuenta». Datos de pago sólo en subflujo Cobrar.
- Cobro: total canónico, método obligatorio, propina opcional plegada, responsable preseleccionado desde regla vigente y editable sólo con permiso. Actor que opera, responsable comercial y autorizante son campos distintos; no sobrescribirlos.
- Diferenciar «Cobrar y seguir» de «Cobrar y cerrar» cuando el contrato lo permita. Cierre sigue sin certificar limpieza.
- Ante timeout de cobro: «Comprobando resultado» y relectura por clave idempotente. No invitar a repetir un pago ambiguo como si hubiese fallado.
- Pedido manual: categoría/búsqueda → cantidades/modificaciones → resumen con mesa → enviar. Preservar borrador si cambia vista; avisar si cambia mesa/sesión.

## 5. Identidad de puesto y persona

Reutilizar mecanismo revocable de terminal si ya existe en el candidato; si no, añadir el mínimo modelo necesario, no un sistema de permisos genérico. La credencial del puesto se provisiona por un encargado y queda limitada al local, tipo de puesto y turno/sesión de terminal, con expiración y revocación.

- El tablero del puesto puede seguir visible sin una sesión personal gerente abierta. Con persona bloqueada, sólo datos operativos mínimos: mesa/necesidad/antigüedad; ocultar saldos, datos personales y notas sensibles según contrato.
- Acciones que cambian negocio requieren operador autenticado. Seleccionar un nombre nunca equivale a autenticarse. Cambio mediante PIN con teclado numérico/táctil; operador visible, opción de devolver el control al puesto al alejarse.
- Mantener una ventana personal corta configurable, inicialmente la existente, separada del tablero. No pedir PIN por cada click; medir cambio por tarea/persona. Si no hay actor al pulsar «Voy», autenticar y continuar esa intención exacta, sin repetir selección.
- Toda intención conserva local, terminal, actor, mesa/sesión y versión; cambiar operador mientras hay request en vuelo no reasigna la autoría de esa request. Descartar respuesta visual tardía de otra persona sin revertir una operación ya confirmada.
- Permisos efectivos resueltos en servidor. Tokens temporales de encargado restringidos a propósito, local, sesión/cuenta y tiempo; se invalidan al terminar la intención o al revocar. Ningún token temporal de cobro modifica carta/personal.
- Si el diseño incorpora cookies para credencial del puesto, resolver CORS/CSRF/SameSite con la topología real; si usa bearer, documentar almacenamiento y XSS. No asumir mismo origen entre frontends/API.
- Un modo Cocina no evita auth: acceso de puesto limitado a cocina; cambios de estado tienen actor de cocina autenticado o una identidad de estación explícita aprobada y auditada. No falsificar una persona.

## 6. Atención compartida y conexión

- Un solo dueño del polling/estado en el shell; Atención, Más y Cocina consumen su estado autorizado. Evitar dos ciclos concurrentes que se pisan. Sólo traer datos permitidos por tipo de credencial.
- Estado: conectando, actualizado, atrasado, sin conexión o autorización vencida. Nunca verde por nombre de pestaña. Sin datos no es cero pendientes.
- Conservar lista al fallar la red, indicar edad y bloquear mutaciones que no pueden verificarse. Reintentos seguros y acotados; no construir cobros offline nuevos.
- Aviso visible persistente en cualquier vista; audio tras interacción de usuario y posibilidad de probarlo. Al volver del fondo, refrescar; no prometer sonido mientras el sistema operativo suspendió el navegador.
- Orden estable: no mover la tarjeta bajo el puntero/foco. Incorporar nuevas tareas con indicador y actualizar orden sin robar foco. Mostrar eventos atendidos por otra persona como conflicto resuelto, no como éxito propio.
- Una persona puede asistir otro sector si su permiso lo admite. Filtro no es control de autorización y no debe ocultar indefinidamente urgencias generales.

## 7. Tacto, mouse y teclado

- Controles táctiles principales objetivo 48 px de alto y separación 8 px; texto base 16 px para tareas, contraste comprobado. No depender sólo de color, iconos o hover.
- PC con Tab/Shift+Tab y Enter sobre control enfocado; Escape cierra detalle no destructivo y restaura foco. Buscador de mesa siempre localizable. Atajos adicionales sólo tras probar que no se activan escribiendo o durante cobro.
- No drag obligatorio, doble click ni pulsación prolongada para servicio. No atajo de teclado que cobre sin revisión.
- Zoom 200%, 768×1024 vertical, 1024×768 horizontal y 1366×768; adicional 390×844 para contingencia, no como sustituto de tablet real.
- Loading por acción/mesa, no una cortina que inutiliza toda la pantalla. Foco visible, nombres accesibles y mensajes de estado útiles sin anunciar cada tick del polling.

## 8. Cocina y papel

- Vista Cocina dentro de staff, accesible por enlace directo validado y tipo de puesto. Mostrar comanda, mesa, hora, modificaciones y advertencias relevantes; no ventas, PIN manager o recompensas.
- Preparando → Listo genera trabajo de entrega al salón. Entregado pertenece al salón; evitar que dos puestos den por terminada la misma responsabilidad.
- Con una pantalla: comanda legible exportable/imprimible con impresión del navegador donde sea compatible, o ficha manual numerada con quien la entregó y quién la recibió. No marcar transmitida por abrir el PDF. Reconocimiento de recepción sin crear otro pedido.
- Sin canal a cocina validado: modo de una pantalla no obtiene GO. No prometer que un rediseño resuelve la distancia física.

## 9. Arquitectura acotada de UI

Mantener React/Vite y contratos actuales. Extraer de ServiceWorkspace sólo límites útiles: controlador compartido de datos, cabecera/identidad, lista/tarjeta, detalle de mesa, flujo de cobro y vista Cocina. Nombres finales acordes al repo. No introducir Redux, otra librería UI, WebSocket o una cuarta app sin necesidad probada.

Cambios de permisos/terminal van en contratos compartidos, API y tests negativos; layout no calcula dinero ni replica estado canónico. Flags de transición internos, temporales y con retiro definido; no añadir diez opciones al dueño para compensar un diseño confuso.

# Plan de ajustes de la prueba móvil — 2026-09-10

Estado: IMPLEMENTADO Y VERIFICADO EN LAN (2026-09-10). La validación física en teléfono queda pendiente.

Proyecto: `mdpmesasvivas`. Rama observada: `antigravity/core-capabilities-stage00`. HEAD: `0773ca6`.
El checkout contiene cambios locales previos. Este plan se apoya en el código actual y complementa el plan de simplificación operativa E00–E15.

## Objetivo y alcance

Resolver seis observaciones de la prueba por LAN: medio solicitado para pagar invisible al mozo, navegación incorrecta hacia la cuenta, cantidades por botones, zoom al escribir, espacio vacío debajo de Carta y flujo poco visible/incompleto de propina y opinión.

Trabajar sobre la cuenta canónica por ocupación, conservar reglas de cobro y permisos existentes, y mantener los servicios de la prueba activos. Para la propina se regeneró el cliente Prisma y se aplicó sólo la columna local `CallRequest.tipMinor`; no se sembraron datos ni se reinició la base completa.

## 1. Mostrar cómo pidió pagar el cliente

### Evidencia

- `apps/client-web/index.html`: los botones envían `CASH`, `CARD` o `MERCADO_PAGO`; QR está condicionado por la configuración existente.
- `apps/client-web/app.js`: `sendCall()` transmite `paymentMethod`.
- `packages/api/src/services/call.service.ts`: el medio se guarda en el llamado y se devuelve en sus DTO.
- `packages/api/src/services/service-workspace.service.ts`: la proyección debía incluir explícitamente el medio y la propina elegidos, además del saldo.
- `apps/staff-panel/src/components/ServiceWorkspace.tsx`: el selector de cobro inicia globalmente en `WAITER_CASH`; no representa la elección del cliente ni está aislado por sesión.

### Implementación

1. Extender el contrato compartido y la proyección de Servicio con un campo explícito de medio solicitado. Reutilizar los valores existentes; no deducirlo del texto de la nota ni agregar una columna duplicada.
2. Mostrar en la tarjeta de solicitud y en la sección de cobranza: **Cliente pidió: Efectivo / Tarjeta / QR presencial**. Si falta información, mostrar **Sin medio informado**.
3. Conservar esa información después de atender/resolver el llamado, mientras siga vigente la misma ocupación. Si la consulta actual sólo trae llamados activos, recuperar la última solicitud BILL de esa ocupación para el contexto de cuenta. No vincular históricos únicamente por `tableId`.
4. Preseleccionar el medio efectivo a partir de esa preferencia, permitiendo al mozo corregirlo antes de registrar el pago:

   | Solicitud cliente | Medio del registro de pago |
   |---|---|
   | `CASH` | `WAITER_CASH` |
   | `CARD` | `WAITER_CARD` |
   | `MERCADO_PAGO` | `WAITER_MP_QR` |

5. Guardar la selección del formulario por `tableSessionId`. El polling no debe sobrescribir una selección manual; al cambiar de ocupación no debe heredarse la selección anterior. Sin preferencia, exigir una elección explícita antes de cobrar.
6. La preferencia es informativa: elegir QR o tarjeta no registra ni confirma un pago. Mantener habilitación de capacidades, validación servidor, reautorización, idempotencia y comandos actuales de cobro/cierre.

### Aceptación

- Efectivo, tarjeta y QR habilitado llegan del cliente al mozo con etiqueta correcta.
- La preferencia continúa visible tras atender el llamado y tras recargar el panel.
- Una nueva solicitud válida de la misma ocupación puede actualizar la preferencia mostrada; no pisa un formulario ya editado sin indicarlo.
- Cambiar de mesa, cerrar y reabrir una ocupación no arrastra preferencias ni borradores de cobro.
- Una corrección manual registra el medio realmente elegido por el mozo, sin alterar retroactivamente lo que pidió el cliente.

## 2. “Ver cuenta” debe llevar a la cobranza de esa mesa

### Evidencia

En `ServiceWorkspace.tsx`, `ACCOUNT_COLLECTION` selecciona la mesa y ejecuta `scrollIntoView()` sobre `queueRef`, que corresponde a la cola, no a `TableContextPanel`. La rama de llamados selecciona la mesa tras actuar/refrescar, sin un destino explícito hacia cobranza. El panel se monta condicionalmente debajo de la cola.

### Implementación

1. Crear un destino estable en la sección de cobranza, dentro del contexto de mesa, con referencia DOM y encabezado que identifique la mesa.
2. Centralizar la intención de abrir cuenta desde las tarjetas de llamado y cobro. Seleccionar mesa y registrar una solicitud de navegación; ejecutarla después de que el panel correcto esté renderizado.
3. Desplazar el contenedor que realmente tiene scroll hasta ese destino, con margen para encabezados fijos. No usar `queueRef` ni demoras arbitrarias.
4. En “Atender y ver cuenta”, conservar la acción operativa actual y navegar al resultado correcto. “Ver cuenta” sobre un llamado ya atendido debe abrir el contexto sin repetir innecesariamente la mutación.
5. No disparar scroll en cada polling. Permitir volver a enfocar la misma cuenta con otro clic; impedir que una respuesta tardía de otra mesa cambie el destino actual.
6. Foco accesible sobre el encabezado con `preventScroll`; respetar movimiento reducido para el desplazamiento. Revisar que el autofoco de la reautorización no provoque un segundo salto inesperado.

### Aceptación

- Desde arriba, en medio o al final de la cola, el clic deja visible la mesa seleccionada y el comienzo de su cobranza.
- Funciona al montar el panel por primera vez, con el panel ya abierto y al cambiar de mesa.
- La actualización periódica no mueve la pantalla ni roba el foco.
- Un error de atención muestra el error y no presenta la operación como completada.

## 3. Elegir cantidades con − / cantidad / +

### Evidencia

`dishOrderQuantity` es un `input type="number"` en la ficha del producto. `app.js` lo reinicia en 1 al abrir y lee su valor al agregar, con límites actuales 1–50. El pedido manual del mozo ya incrementa al elegir productos, pero sus líneas sólo muestran una acción de restar.

### Implementación

1. Sustituir el campo editable de la ficha por botones **−**, valor visible no editable y **+**. No abrir teclado para cambiar cantidades.
2. Mantener un entero como estado y reutilizar los límites de negocio vigentes, incluido cualquier límite menor por disponibilidad que ya corresponda. Deshabilitar botones en los extremos y mientras el envío esté en curso.
3. Mantener el reinicio a 1 al cambiar de producto y el cálculo del subtotal donde se muestre. Enviar exactamente la cantidad visible con las notas y el nombre existentes.
4. Usar controles de al menos 48 × 48 px, nombres accesibles “Restar cantidad” y “Sumar cantidad”, y anuncio moderado del valor. Reorganizar la fila actual de 96 px para que los tres controles y el nombre no se superpongan.
5. Aplicar la misma interacción a cantidades editables de productos en otros puntos de la carta, si existen. No convertir en este cambio una tanda enviada en editable ni añadir nuevos comandos de modificación de pedidos.
6. En pedido manual del mozo, añadir un botón explícito de sumar junto al de restar, reutilizando sus manejadores actuales. Mantener clara la diferencia entre mínimo 1 en ficha y quitar una línea de un borrador.

### Aceptación

- Agregar 1, 2 y varias unidades de platos y bebidas sin escribir ni abrir teclado.
- El servidor recibe el número mostrado, con precio/subtotal coherentes y sin duplicar el envío.
- Los límites no permiten cero, negativos, decimales ni exceder el máximo en la ficha.
- Cambiar de plato, volver a Carta y reabrir el carrito conserva el comportamiento vigente.

## 4. Evitar zoom automático y recuperar el diseño al cerrar el teclado

### Evidencia y límite del diagnóstico

Nombre y cantidad usan `text-sm`; la nota usa `text-xs`. Otros formularios también contienen fuentes pequeñas. Esto es compatible con el zoom de enfoque de algunos navegadores móviles, pero la causa exacta del teléfono reportado queda pendiente de reproducción. Hay bloqueo de body al abrir modales y restauración de foco/scroll que también deben verificarse.

### Implementación

1. Revisar todos los campos editables del cliente: nombre, nota, búsqueda si corresponde, llamados, propina, reseña, chat y fila pública. Usar tamaño computado mínimo de 16 px para entrada de texto en móvil, incluso bajo overrides de tema.
2. Conservar `width=device-width, initial-scale=1.0` y el zoom manual de accesibilidad. No usar `user-scalable=no`, `maximum-scale=1` ni un reset global de zoom.
3. Verificar apertura/cierre de teclado con los sheets y modales existentes: el campo y los botones deben seguir alcanzables por scroll, sin dejar el body bloqueado o anchura desbordada al volver a Carta.
4. Priorizar CSS y el manejo de foco existente. Sólo introducir ajustes con `visualViewport` si una reproducción demuestra que siguen siendo necesarios; en ese caso limpiar listeners y evitar bucles de redimensionamiento.

### Aceptación

- En Safari de iPhone y Chrome de Android, enfocar, escribir y cerrar el teclado mantiene o recupera la presentación original de Carta, sin recorte lateral.
- No se pierde texto, carrito, producto seleccionado ni posición de la lista.
- El zoom manual sigue disponible. La emulación de escritorio no sustituye la validación del teclado real.

## 5. El acceso a Carta debe ocupar el espacio inferior disponible

### Evidencia

El body tiene altura mínima `100dvh` y layout flex; el `main` crece, pero no distribuye su altura entre sus hijos. Dentro de `heroMenuCard`, la imagen tiene `h-40 sm:h-60`, por lo que el bloque conserva altura fija y deja espacio sin utilizar.

### Implementación

1. Tratar la tarjeta completa de acceso a Carta como el bloque que debe crecer, incluida su imagen, no sólo estirar el botón naranja interno.
2. Convertir el contenido principal en columna flexible con separaciones explícitas. Mantener encabezado, acciones y avisos con su altura necesaria; asignar el espacio restante al bloque Carta.
3. Eliminar la altura fija como restricción dominante de la imagen. Definir un mínimo útil para pantallas pequeñas y mantener `object-fit: cover` sin deformación.
4. Respetar padding inferior y área segura del dispositivo. Si avisos o solicitudes ocupan más espacio, permitir scroll natural en lugar de superponer Carta o comprimir controles.
5. Verificar estados de conexión, sesión cerrada, llamados activos y modo fila pública. No alterar el layout de los modales ni hacer que un bloque oculto reserve espacio.

### Aceptación

- Sin avisos extraordinarios, Carta llega hasta el margen inferior seguro y ocupa el hueco actualmente visible.
- En pantallas bajas o con varios avisos, se puede acceder a todo mediante scroll.
- La tarjeta y su botón siguen abriendo la carta una sola vez; texto y foto se adaptan sin recortes funcionales.

## 6. Hacer visible y enviable la propina y la opinión

### Evidencia

La cuenta sólo mostraba un acceso genérico a valoración; la propina quedaba dentro de otra ventana, sin acción explícita para guardar la selección. Además, abrir esa ventana ocultaba `modalBill`, por lo que la flecha cerraba la valoración pero no devolvía al flujo de pedido de cuenta.

### Implementación

1. Mostrar en la cuenta una tarjeta visible de **Propina y opinión**, con la propina como opción explícita y un resumen de la selección.
2. Mantener la cuenta abierta debajo de la valoración y hacer que volver/cerrar retorne al mismo flujo, sin perder medio de pago ni selección.
3. Agregar **Guardar propina y valoración**. La valoración se envía al endpoint de feedback; la propina elegida se calcula sobre el consumo y se envía como `tipMinor` estructurado al llamado BILL al elegir efectivo, tarjeta o QR.
4. Mostrar el saldo más la propina como **Total a pagar**. La API persiste la intención de propina en `CallRequest`; Servicio la muestra y la precarga en el cobro. La liquidación mantiene `tipMinor` separado del consumo y no registra un cobro digital.
5. Permitir propina sin valoración, tratar reintentos de valoración ya guardada como estado idempotente y mantener el mensaje privado independiente.

### Aceptación

- Desde “Pedir la cuenta” se entiende sin entrar a otra sección que se puede dejar propina y opinión.
- Elegir 20% y una calificación ofrece un botón de guardado visible y confirma el resultado.
- Volver con la flecha conserva la cuenta abierta; al elegir el medio, el llamado al mozo incluye la propina elegida y el total visible la suma.
- Efectivo, tarjeta y QR siguen siendo opciones diferenciadas y visibles cuando la configuración las habilita.

## Resultado de esta ejecución

- Implementados los seis puntos: preferencia de pago por ocupación, scroll al contexto de mesa/cobranza sin saltos durante polling, cantidades con −/+/valor en carta y preorden, inputs móviles de 16px, Carta flexible hasta el margen inferior y flujo unificado de propina/opinión.
- También se agregó el botón **+** al pedido manual del mozo y se conserva la selección manual de medio sin que el polling la pise.
- Ajuste posterior a la prueba: se retiró por completo el bloque y la consulta de sugerencias de compra; el botón de confirmar pedido queda inmediatamente después del contenido útil.
- Ajuste posterior a la prueba: el selector de cantidad usa una columna segura en móvil y ancho reservado en pantallas mayores; la imagen de Carta se estira con flex junto con su tarjeta.
- Ajuste posterior a la prueba: el estado del pedido de cuenta muestra el medio elegido y confirma explícitamente que el mozo fue notificado.
- Ajuste posterior a la prueba: la cuenta muestra una tarjeta visible de propina/opinión, la selección tiene un guardado explícito y volver desde valoración conserva abierta la cuenta; la propina seleccionada se agrega al llamado BILL al elegir el medio de pago.
- Ajuste posterior a la prueba: la propina dejó de ser sólo informativa: se persiste como `CallRequest.tipMinor`, se muestra dentro del total a pagar y Servicio la precarga en el cobro junto con el medio elegido.
- Pasaron build de shared, client-web y staff-panel; typecheck de API; sintaxis JavaScript; prueba UX E10–E11 (7/7); integración E04 de preferencia/estado de pago (3/3); y `git diff --check`.
- En esta iteración pasaron build de client-web, sintaxis JavaScript, HTTP 200 de cliente/panel, C08 de resiliencia/accesibilidad (4/4) y el contrato existente de feedback (37/37) sobre copias SQLite con esquema vigente. La ejecución contra la base demo antigua falló por ausencia de `mutationSeq`, sin relación con este cambio.
- Los cuatro servicios LAN y el endpoint canónico de Mesa 2 respondieron HTTP 200. Falta únicamente probar teclado, scroll y layout en un teléfono físico; no se marca como validación visual completa.

## Secuencia y verificación

1. Capturar baseline de los cinco casos con el entorno LAN actual y registrar viewport/navegador. Confirmar checkout y cambios concurrentes antes de implementar.
2. Implementar contrato/proyección y UI del medio de pago (1); después navegación al contexto de cuenta (2). Verificar ambos juntos con una solicitud real de cuenta por cada medio habilitado.
3. Implementar cantidades (3), campos móviles (4) y altura flexible de Carta (5); revisar en conjunto la ficha, el teclado y la vuelta a la lista.
4. Extender pruebas de proyección/Servicio y aislamiento por ocupación en `packages/api/test`, aprovechando `e04-service-context`, `e10-e11-workspace-ux` y `e10-e11-service-settle-clean`. Cubrir preferencia tras resolver el llamado, nueva ocupación, medio real registrado y ausencia de duplicación del cobro.
5. Verificar en navegador el destino del scroll y su estabilidad durante polling; cantidades, navegación y persistencia del carrito; fuentes computadas, ausencia de overflow y crecimiento del hero. Usar aserciones de comportamiento, no sólo búsquedas de texto en archivos.
6. Matriz visual mínima: 360 × 640, 390 × 844, 430 × 932 y tablet; repetir orientación horizontal y estados con avisos. Completar teclado en teléfonos reales.
7. Ejecutar typecheck/build y pruebas focalizadas usando los comandos del repositorio compatibles con los servicios activos. Cualquier suite que regenere Prisma debe ejecutarse en un checkout/runtime aislado: usar otra base de datos por sí solo no evita contención del cliente generado compartido.
8. Revisar el diff y entregar un reporte por punto con evidencia, pruebas realizadas y pendientes. El criterio de cierre es la comprobación de los cinco comportamientos; no marcar como verificado en teléfono lo comprobado sólo por HTTP o emulación.

## Entrega y límites

No se necesita desplegar, habilitar pagos digitales ni implementar todavía tickets, caja o contabilidad diaria; esos cambios quedan para el plan posterior solicitado. Sí se agregó la migración local/PostgreSQL mínima para persistir `CallRequest.tipMinor`, sin cambiar las reglas contables del cierre.

Orden de prioridad: **medio de pago → navegación a cobranza → cantidades → teclado/zoom → aprovechamiento del espacio**, con prueba móvil conjunta al finalizar.

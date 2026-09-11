# Análisis de producto: menos manejo del sistema, mejor servicio

Fecha: 2026-09-08. Alcance: diagnóstico y decisiones previas a implementación.
Repositorio comprobado: `mdpmesasvivas`, rama `antigravity/core-capabilities-stage00`, HEAD `0773ca6`, con cambios locales previos que deben conservarse.

## 1. Qué estamos intentando resolver

El problema principal no es la cantidad de funcionalidades faltantes. Es que la estructura visible sigue los módulos internos del software, en lugar del trabajo real del restaurante. El comensal necesita pedir y entender qué ocurre. El personal necesita reconocer y resolver pendientes. El dueño necesita configurar y supervisar sin convertirse en operador permanente.

Objetivo del rediseño: que una mesa pueda completar varias rondas de pedidos, recibir atención, pagar presencialmente y quedar disponible con información consistente y pocas intervenciones. Las métricas son una consecuencia del servicio registrado, no una razón para exigir clics artificiales.

No se promete ausencia absoluta de errores, reducción determinada de personal ni validación física desde un navegador. Sí se exige evidencia reproducible de los recorridos, importes, permisos y recuperación ante fallos.

### Condiciones que no se negocian

- Un terminal compartido para el personal, no un teléfono por mozo.
- Cliente, servicio y cocina tienen prioridad sobre rewards, recomendaciones y analítica avanzada.
- Cobro presencial. Efectivo, tarjeta y QR son métodos informados/registrados; no se incorpora Mercado Pago digital.
- Base clonable con datos y despliegue aislados por restaurante. No se transforma en un SaaS centralizado.
- Se trabaja con el seed Trattoria del Puerto y URLs locales. No se necesitan tags NFC ni recursos de nube para estas correcciones.
- Se preservan mesas/QR y el diseño general del plano del dueño.
- Este documento analiza; el plan posterior determina cómo implementar. Nada descrito como propuesta está ya corregido.

## 2. Evidencia y límites de esta revisión

Se inspeccionaron código actual y pantallas locales de cliente y staff. La comprobación visual fue en navegador, no con usuarios reales. No se ejecutó una nueva campaña de pruebas ni se crearon pedidos durante este análisis.

| Hallazgo | Evidencia actual | Conclusión y certeza |
|---|---|---|
| Cuenta muestra una sola ronda | `apps/client-web/app.js`, `loadBillDetails`, consulta `/orders/session/:token`; `getActiveOrder` en `packages/api/src/services/order.service.ts` retorna DRAFT o último pedido activo | Causa de lectura incorrecta confirmada por código; reproducción automatizada pendiente |
| Un borrador puede desplazar consumo enviado | La misma consulta prioriza DRAFT; `addItem` crea otro borrador tras enviar | Consecuencia directa del contrato; añadir prueba específica |
| Caja fragmenta una mesa por comanda | `getCashOrders` proyecta filas por pedido; `CashManager.tsx` cobra por `order.id` | No hay una cuenta de mesa unificada en esa pantalla |
| Cuenta y liberación pueden discrepar | `hasUnpaidBalance` agrega pedidos, mientras cliente consulta uno; caja incluye estados por exclusión | Revisar invariantes y filtros; no asumir que hubo pérdida de registros |
| Inicio cliente compite con la tarea principal | `index.html`: encabezado con carrito y Ver Carta, tres acciones pequeñas, hero y `featuredDishesSection`; pantalla local confirma jerarquía | Problema de espacio y orientación confirmado |
| Carta poco legible | Modal oscuro y abundante texto de 10–11 px; controles pequeños en cliente | Rediseño de lectura necesario, no solo cambio de fuente |
| Terminal exige explorar módulos | `App.tsx` monta mesas y cinco destinos; `TablesOverview.tsx` limita grilla con `max-h-52 overflow-y-auto` | Pantalla local confirma scroll interno con 22 mesas y tareas debajo |
| Plano vuelve atrás al editar | Polling de `useFloorPlanSSE.ts`; `handleSnapshot` del store reemplaza `tables`; edición local marca cambios sin proteger posiciones | Mecanismo de sobrescritura confirmado; solución puntual |
| Algunas fallas de refresco no llegan al backoff externo | Componentes capturan errores dentro de la carga | Riesgo de recuperación a cubrir con fallos inducidos, no solo revisión visual |
| Permisos de cobro pueden no explicarse en UI | Servicio restringe PAID a MANAGER; caja presenta acciones generales | Verificar rol efectivo y reautorización de terminal; no ampliar permisos a ciegas |

Los estados APPROVED de planes anteriores describen sus verificaciones históricas. No certifican este recorrido de varias rondas ni la facilidad de uso en terminal único. Este análisis cambia la prioridad de los flujos afectados sin borrar la evidencia histórica.

## 3. El defecto de la cuenta es de modelo de lectura

Hoy se usa un concepto parecido a «pedido activo» para necesidades distintas. Una mesa, sin embargo, tiene tres cosas diferentes:

1. **Carrito:** intención editable que todavía no debe cobrarse.
2. **Envíos:** tandas enviadas, cada una con su estado de validación y preparación.
3. **Cuenta de la ocupación:** consumo acumulado y pagos de esa sesión de mesa.

La segunda ronda no reemplaza la primera. Un nuevo borrador no reemplaza ninguna ronda. La cuenta debe pertenecer a la sesión/ocupación, no al último pedido ni a la etiqueta permanente de mesa.

### Contrato propuesto

- El servidor produce una proyección de cuenta que consumen cliente y caja.
- Borradores no integran el importe cobrable. Pedidos rechazados/cancelados tampoco.
- En modo validación, lo pendiente se muestra separado del consumo aceptado: «Esperando confirmación», sin fingir que cocina lo recibió.
- En modo directo, un envío aceptado por el servidor entra en consumo y preparación, aunque aún no esté servido.
- Total de consumo, pagos registrados, saldo y propina son campos diferentes. La propina no debe ocultar ni cancelar deuda de platos.
- Precios aplicados conservan su instantánea; cambiar la carta no modifica retroactivamente consumos.
- Importes se calculan con unidades monetarias exactas y reglas de redondeo únicas.
- Cuenta y caja utilizan los mismos estados y la misma versión de cuenta.
- El cierre de saldo es una operación de servidor, atómica e idempotente. No se resuelve con un bucle del frontend pagando comandas una por una.
- Carrito mantiene su contrato específico. Reemplazar indiscriminadamente `getActiveOrder` por una suma rompería edición y envío.

No hay evidencia de un débito digital: no se está integrando una pasarela. Lo confirmado es que la pantalla puede presentar un importe parcial. La implementación debe comprobar además registro de cobros y estado agregado de mesa para descartar consecuencias contables.

### Casos que obligan a pensar más allá del ejemplo

¿Se pide cuenta y luego otro postre? Pedir cuenta no cierra la sesión automáticamente. Un envío aceptado cambia la versión y actualiza ambos paneles. Un cobro basado en una versión vieja debe pedir revisar el nuevo saldo.

¿Cobran y entra un envío al mismo tiempo? El servidor arbitra: o incorpora el pedido antes de liquidar, o rechaza el envío por sesión ya cerrada. No debe existir un pedido aceptado sin cuenta responsable.

¿Se vence el token con deuda? El acceso público puede vencer sin borrar la deuda ni liberar la mesa. El personal necesita seguir viendo la cuenta de esa ocupación.

¿Se paga una ronda pero quedan otras? La mesa sigue con saldo. El estado de un pedido no puede determinar por sí solo que toda la mesa esté pagada.

¿Hay carrito sin enviar al liberar? Debe advertirse y descartarse/cerrarse de forma explícita según la política definida; no cobrarlo ni bloquear silenciosamente por deuda inexistente.

¿Se juntan dos mesas ocupadas? Mover o unir dibujos no fusiona cuentas. Conservar cuentas separadas inicialmente; impedir transferencias ambiguas y ofrecer una explicación. La transferencia contable requeriría un contrato propio.

## 4. Cliente: una entrada clara, una carta legible, un estado comprensible

### Inicio

Decisión: eliminar «Platos estrella de la casa», su renderizado y el espacio reservado. No reemplazarlo por otro carrusel comercial. Eliminar Ver Carta del encabezado; conservar únicamente carrito como acción del encabezado y la identificación de local/mesa.

Una entrada principal grande «Ver carta» y tres acciones de servicio grandes: «Llamar al mozo», «Pedir cuenta», «Pedir insumos». Se ubican juntas y por delante de contenido decorativo. La disposición se adapta al ancho; no se fuerza una fila de cuatro controles pequeños. El hero no debe volver a desplazar las acciones fuera de la primera pantalla.

La mesa sin sesión puede explorar la carta. La explicación de activación es breve y no parece una avería. No se habilita una ocupación por cualquier escaneo remoto sin conservar las protecciones actuales.

### Carta

Fondo blanco, contraste alto, nombres y precios fáciles de recorrer. Objetivos iniciales: texto de lectura de 18 px, información secundaria relevante de 16 px, nombres de platos de 20–22 px y peso suficiente. Ajustar con pruebas de contenido real; no ensanchar letras deformándolas por CSS.

Controles táctiles de al menos 48 px; acciones principales de 56–64 px como objetivo de diseño. Zoom al 200%, nombres largos, precios grandes y notas deben seguir siendo utilizables. Estos son criterios del proyecto, no una certificación de accesibilidad.

Categorías visibles y comprensibles, sin depender exclusivamente de adivinar un desplazamiento horizontal. Un único scroll principal por vista. Al volver del detalle se recuperan categoría y posición. Fotos ayudan, pero nombre, precio, disponibilidad y descripción no dependen de ellas.

### Pedido y comunicación

Separar «En tu carrito» de «Ya enviado». Mostrar historial agrupado por ronda sin obligar a entender la palabra comanda. Estados para el cliente: esperando confirmación, recibido para preparar, listo para entregar, entregado; no prometer tiempos inexistentes.

Ante timeout: «Estamos comprobando si se envió», no invitar inmediatamente a duplicar. Ante stock agotado: señalar el plato y conservar el resto. El consumo completo debe seguir accesible sin crear otro pedido.

Llamados muestran motivo, confirmación, tiempo y si alguien se ocupa. Pedir cuenta no significa pagar. QR presencial no significa que la aplicación procesó dinero. Cancelar un llamado tomado debe comunicarlo al personal, no desaparecer sin explicación.

## 5. Staff: diseñar para el trabajo, no para los módulos

### Arquitectura propuesta

La pantalla inicial se llama **Servicio**. Su información principal es «qué requiere acción ahora». Las mesas sirven de contexto, no de lista de botones que hay que repasar.

- Cola de atención visible: llamados, validaciones, platos listos y solicitudes de cuenta.
- Contexto espacial compacto: mapa simplificado reutilizando posiciones del plano del dueño.
- Resumen persistente de cocina; expansión para preparación sin perder alertas urgentes de servicio.
- Al tocar una mesa, detalle contextual: pendientes, consumo, pedidos y acción de cargar platos o cobrar.
- Caja deja de ser una isla y pasa a la cuenta de mesa.
- Fila y rewards, si se habilitan y funcionan, quedan en navegación secundaria. No se borran datos ni servicios.

No se necesitan cinco pestañas equivalentes. Como máximo, Servicio y una vista de trabajo Cocina; en el terminal único la preparación debe ser visible también desde Servicio. El diseño concreto debe probarse a 1024×768 y con 22 mesas antes de implementarse por completo.

No se exige que todos los detalles de 22 mesas entren simultáneamente: se exige que ningún pendiente dependa de explorar un scroll interno. En pantallas pequeñas, la cola conserva prioridad y el mapa puede reducir detalle.

### Un terminal no equivale a varios dispositivos escondidos

«Enviar a cocina» significa registrar y mostrar un ticket; por sí solo no garantiza que el cocinero lo vea. Hipótesis de trabajo: terminal compartido colocado en un punto visible/accesible para servicio y preparación, con resumen persistente de tickets.

Si cocina está físicamente separada y no puede consultar ese equipo, hará falta un circuito humano explícito de transmisión. La interfaz puede mostrar «Pendiente de comunicar a cocina» y confirmar recepción, pero eso agrega trabajo. No se debe fingir automatización. Una segunda pantalla o impresión sería una opción futura, no un requisito de equipo inventado para este plan.

Por eso, el modo directo es configurable, no activado globalmente como supuesto. Solo se considera operativamente validado cuando el receptor de cocina puede enterarse de los tickets. La prueba local simula ese receptor; la disposición física queda pendiente de validación real.

### Identidad, responsabilidad y permisos

El terminal y el mozo responsable son conceptos distintos. «Me ocupo» debe ser una toma atómica de tarea, con identificación rápida del actor cuando corresponda. La selección de nombre no sustituye una autorización sensible.

Cobrar, anular o descontar conserva la política de permisos del local. Si se requiere encargado, la reautorización sirve para esa acción y no deja toda la pantalla compartida permanentemente privilegiada. No pedir PIN para cada interacción inocua ni eliminar auditoría por comodidad.

### Automatizar hechos conocidos, no inventar hechos físicos

| Hecho | Comportamiento propuesto |
|---|---|
| Pedido aceptado | Crear ticket y actualizar consumo automáticamente |
| Solicitud nueva | Crear tarea, señal visual y sonido acotado |
| Cocina marca listo | Crear necesidad de entrega sin crear otro llamado manual |
| Persona entrega | Confirmación humana «Entregado»; resolver solo tareas correspondientes |
| Dinero recibido | Confirmación autorizada, registro idempotente |
| Saldo cero | Mostrar pagada; no afirmar que mesa está limpia |
| Mesa limpia y desocupada | Confirmación humana de disponibilidad |

No avanzar estados por temporizador para producir métricas bonitas. No resolver todos los motivos de una mesa al completar uno.

### Prioridad sin caos

Agrupar pendientes de la misma mesa visualmente, conservando cada necesidad. Una solicitud de cuenta no debe ocultar comida lista ni monopolizar por siempre la prioridad. Combinar tipo, antigüedad y responsabilidad; preservar estabilidad para que las tarjetas no cambien bajo el dedo.

Sonido por evento nuevo, no por cada polling. Agrupar ráfagas y mostrar si el navegador bloqueó audio. Tras desconexión, recuperar tareas sin duplicar tickets ni repetir una alarma por cada dato viejo. Mostrar antigüedad del último refresco cuando la información pueda estar desactualizada.

## 6. Administración: corregir sin rehacer lo que sirve

Plano: mantener posiciones editadas como borrador local; mezclar actualizaciones operativas del servidor sin sobrescribir coordenadas pendientes. Guardar con detección de conflicto. Un fallo de guardado conserva el trabajo. No detener toda actualización de estados para proteger el dibujo.

Mesas/QR: preservar rutas y descarga. Comprobarlas en regresión, no rediseñarlas por arrastre.

Carta del dueño: mejorar lectura y vista previa para que corresponda al cliente. La petición de fondo blanco se aplica primero a la carta que ve el comensal; no obliga a recolorear todo el dashboard.

Configuración: expresar tres modos de atención —carta/llamados, validación por personal, directo a cocina— en lugar de obligar a deducir combinaciones de flags. Distinguir disponible, configurado y efectivo. Cada opción inhabilitada explica el motivo real y qué falta; guardar no activa funciones bloqueadas.

Métricas: conservar, corregir trazabilidad de eventos afectados y distinguir medido de estimado. Retirar promesas no probadas como «100% garantizado». No expandir analítica durante este ciclo.

## 7. Alternativas consideradas

| Alternativa | Decisión |
|---|---|
| Solo agrandar botones | Insuficiente: deja cuenta incorrecta y navegación por módulos |
| Una única comanda mutable para toda la noche | Descartada: mezcla historial y preparación; cuenta agrega tandas conservadas |
| Sumar pedidos en JavaScript del cliente | Descartada: duplica reglas, permisos y errores de caja |
| Mostrar todas las funciones juntas | Descartada: una pantalla llena no es una pantalla simple |
| Ocultar cocina porque hay un solo equipo | Descartada: esconder el trabajo no entrega pedidos |
| Automatizar servido, cobrado y liberado por tiempo | Descartada: inventa hechos físicos y puede perder deuda |
| Rehacer también el plano y métricas | Pospuesto: eleva riesgo sin resolver el núcleo |
| Habilitar todos los módulos al final por defecto | Descartada: cada capacidad exige evidencia y utilidad |

## 8. Preguntas resueltas y validaciones pendientes

¿Qué se corrige primero? Cuenta y contrato de sesión; después recorridos cliente y terminal, mediante entregas verticales. Un frontend limpio que cobra mal no está listo.

¿Se elimina información para simplificar? Se cambia jerarquía y ubicación; no se pierde saldo, estado, auditoría ni acceso a tareas.

¿Se permiten pagos parciales? No se elimina soporte existente. El camino normal es saldo completo por mesa; parciales, si siguen disponibles, son una acción secundaria con pruebas de conciliación. No se incorpora división digital automática.

¿Se borran rewards y fila? No. Se apartan del recorrido principal y permanecen sujetos a capacidad y pruebas propias.

¿Hace falta una decisión del usuario para redactar el plan? No. Hay suficiente información. Antes de declarar aptitud real sí se debe observar ubicación del terminal, recepción en cocina y usuarios trabajando.

¿Qué se medirá? Errores de saldo/duplicación, tareas omitidas, clics para acciones frecuentes, tiempo para localizar pendientes, comprensión de estados y recuperación de fallos. No se afirma ahorro económico sin observación de servicio real.

## 9. Criterio de salida del análisis

El plan debe cubrir corrección financiera, legibilidad, terminal compartido, recepción en cocina, administración conservadora y regresión. Debe contener pruebas negativas y concurrencia, no solo el recorrido feliz. Los resultados se separarán en GO local técnico, evaluación de usabilidad y validación física pendiente.

Este análisis habilita redactar el plan. No habilita marcar funcionalidades como corregidas ni declarar producción lista.

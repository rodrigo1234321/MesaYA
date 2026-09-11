# Simplificación operativa cliente–mozo–cocina

Fecha: 2026-09-09  
Estado: plan propuesto; no ejecutado  
Alcance: cliente, mozo, cocina, cobro y recambio de mesa

## 1. Conclusión

El problema principal no es el tamaño de los controles. El sistema obliga al mozo a navegar por módulos y confirmar demasiados estados, aunque su trabajo real consiste en responder una sola pregunta: **qué requiere atención ahora y qué acción concreta corresponde**.

La solución propuesta tiene cinco ejes:

1. **Servicio será la única pantalla operativa cotidiana del mozo.** Cocina, cobro, mapa y contexto de mesa se integran allí. Las funciones poco frecuentes quedan en un menú secundario según rol.
2. **Los pedidos normales irán directamente a cocina.** La validación humana se reservará para excepciones explícitas y explicará el motivo.
3. **Los hechos físicos conservarán una confirmación humana.** El sistema no puede inferir que un plato está listo, que fue retirado o que una mesa fue limpiada. Sí puede ocultar reclamos técnicos, encadenar estados derivados y evitar confirmaciones duplicadas.
4. **Cobro y cierre ocurrirán dentro de la mesa**, con autorización de encargado en el mismo contexto cuando corresponda. La cuenta canónica será por sesión/ocupación, nunca por una sola tanda.
5. **El cliente podrá seguir recorriendo la carta después de agregar**, con mini-carrito visible, colaboración comprensible y sugerencias limitadas.

## 2. Evidencia en el sistema actual

### 2.1 El mozo sigue trabajando por módulos

`apps/staff-panel/src/App.tsx` conserva las secciones `service`, `kitchen`, `cash`, `waitlist` y `rewards`. `ServiceWorkspace` existe, pero es una pestaña más y no reemplaza los caminos separados de cocina y caja.

Consecuencias:

- el mozo debe recordar en qué pantalla ocurre cada tarea;
- Servicio, Cocina y Caja consultan fuentes y frecuencias distintas;
- los pendientes de cocina no tienen el mismo nivel de visibilidad que un llamado;
- Caja todavía puede presentar una cuenta por comanda, mientras la cuenta correcta es por sesión.

### 2.2 La validación no explica qué se valida

La proyección de `service-workspace.service.ts` resume un pedido como `N ítems · tanda X` y sólo transporta cantidad y total. No incluye platos, cantidades por plato, comensal, notas, alérgenos ni motivo de revisión.

Por eso el control se siente burocrático: el mozo debe validar sin información suficiente o navegar a otra vista. Además, `ServiceWorkspace` crea tareas de preparación que permiten al mozo marcar un plato como listo, aunque ese hecho normalmente pertenece a cocina.

### 2.3 Hay dos caminos de cobro

El camino nuevo cobra la cuenta acumulada por `TableSession` mediante `settleSessionAccount`. El camino heredado de Caja opera por comanda mediante `payOrder`. Mantener ambos como caminos cotidianos produce valores y expectativas diferentes.

El cobro correcto ya tiene controles útiles: versión esperada de cuenta, clave de idempotencia, ledger y reautorización de encargado. El problema es de orquestación y UX, no la necesidad de eliminar esos controles.

### 2.4 El recambio es seguro sólo si el mozo completa el cierre

Pagar no cierra la ocupación, intencionalmente, porque el grupo puede pedir otra ronda. `closeTableSession` comprueba saldo, borrador, validaciones y llamados; luego revoca la sesión y pasa la mesa a `TO_CLEAN`. La limpieza lleva la mesa a `AVAILABLE`.

El hueco operativo es el olvido: si el mozo cobra pero no cierra, el QR fijo puede resolver la sesión anterior todavía abierta. El siguiente cliente no debe recibir jamás esa sesión ni su historial.

### 2.5 El cliente es expulsado de la carta

`addDishToCart()` cierra el detalle y ejecuta `openCartModal()` después de cada agregado. Para pedir varios platos, el cliente debe alternar repetidamente entre carta y carrito.

El nombre del comensal se mezcla hoy con notas de cocina y no existe un modelo visible y limpio de participante. La división digital está deliberadamente desactivada; por lo tanto, “carrito colaborativo” no debe prometer que la cuenta ya se puede dividir dentro del cliente.

Las sugerencias usan como contexto el primer ítem del borrador y pueden reaparecer después de descartarlas. Esto genera ruido en lugar de ayuda.

## 3. Contrato operativo objetivo

### 3.1 Una sola pantalla de Servicio

La pantalla se ordena por trabajo pendiente, no por subsistemas:

- encabezado compacto: pendientes críticos, platos listos, cuentas y estado de sincronización;
- cola priorizada: cuenta pedida, plato listo, llamado, revisión excepcional y otros pendientes;
- estado de cocina siempre visible: por revisar, preparando y listos;
- mapa compacto para orientación;
- panel de mesa contextual con tandas, cuenta acumulada, cobro, pedidos manuales y cierre;
- utilidades poco frecuentes en un menú secundario y condicionado por rol.

No habrá una pestaña Caja en el camino normal del mozo. Una vista KDS ampliada puede seguir existiendo para una estación dedicada de cocina, pero sus eventos aparecerán también en Servicio.

### 3.2 Política de validación por excepción

Un pedido común —por ejemplo uno o dos gin disponibles— no requiere aprobación del mozo. Se acepta en servidor y pasa a cocina.

Se crea una tarea `REVIEW_REQUIRED` sólo cuando existe un motivo configurado y visible, por ejemplo:

- producto agotado o cambiado desde que se abrió la carta;
- nota crítica o alergia declarada;
- cantidad fuera del umbral operativo;
- producto sujeto a control de edad o política específica;
- conflicto de precio/configuración;
- modo manual activado temporalmente por el restaurante.

La tarjeta debe mostrar mesa, platos, cantidades, comensal, notas, tiempo, total y motivo exacto. Sus acciones serán aceptar, editar o rechazar con motivo. No se debe reemplazar una política real por una palabra genérica como “validar”.

### 3.3 Propiedad de los estados

| Hecho | Actor propietario | Tratamiento |
|---|---|---|
| Pedido válido recibido | servidor | pasa a cocina automáticamente |
| Excepción revisada | mozo | una acción informada |
| Plato listo | cocina | confirmación física en KDS/modo cocina |
| Mozo retira el plato | mozo | una acción `Me lo llevo`, con reclamo atómico y deshacer breve |
| Plato entregado | operación | no exigir una segunda visita al terminal; registrar retiro como hito operativo y permitir corregir excepción |
| Pago registrado | servidor + actor autorizado | idempotente y por cuenta de sesión |
| Grupo terminó | mozo | `Cobrar y cerrar` o `Cerrar mesa` según saldo |
| Mesa limpia | mozo | una confirmación física inevitable |

No se automatizan por temporizador estados físicos. Sí se automatizan `claim`, resolución de tareas técnicas y transiciones derivadas cuando la acción principal ya expresa la intención.

### 3.4 Cobro, cierre y QR

La acción primaria será **Cobrar y cerrar**:

1. revalida la versión de la cuenta;
2. registra el pago de forma idempotente;
3. cierra la sesión sólo si saldo, borradores, revisiones y llamados lo permiten;
4. revoca el token de la ocupación;
5. pasa la mesa a `TO_CLEAN` y crea el pendiente de limpieza.

La acción secundaria **Registrar pago y mantener mesa** conserva la sesión para una ronda posterior.

El QR físico de la mesa no debe regenerarse: identifica restaurante y mesa. Lo que rota es la sesión/token de ocupación. Durante `TO_CLEAN`, un nuevo escaneo puede mostrar la carta en modo lectura o “mesa en preparación”, pero nunca la cuenta anterior ni un token operativo. La acción física `Mesa lista` habilita y deja preparada una sesión nueva, con cuenta cero; el siguiente escaneo sólo la resuelve y no crea ni muta datos.

Debe eliminarse o aislarse el camino heredado `payOrder` del uso cotidiano. No se permitirá que una creación alternativa de sesión cierre silenciosamente otra sesión con deuda, borrador o pendientes.

### 3.5 Flujo del cliente

1. Escanea el QR fijo y ve la carta.
2. Abre un plato, selecciona cantidad, nombre opcional y nota.
3. Agrega y vuelve a la misma categoría/posición de carta.
4. Recibe un aviso breve y ve una píldora `Ver carrito · N · $total`.
5. Repite sin abandonar la carta.
6. Abre el carrito voluntariamente, revisa y envía una tanda.
7. Puede iniciar otra ronda y consultar el consumo acumulado por sesión.

El carrito explicará: “Lo que agreguen las personas de esta mesa aparece aquí. Todavía no se cobró”. El nombre del participante será un campo propio, nunca una nota de cocina.

La división digital no forma parte de esta entrega. El texto será explícito: “La cuenta es por mesa. Si quieren dividir el pago, avisen al mozo”. Implementarla después requerirá participantes, asignaciones, pagos parciales e importes no asignados; no es un cambio de copy.

Las sugerencias tendrán contexto del último agregado, máximo dos visibles, límite de frecuencia por borrador y descarte persistente durante la sesión. Desaparecen al aceptar, descartar, enviar o perder relevancia.

## 4. Objetivos medibles

| Flujo | Situación actual aproximada | Objetivo |
|---|---:|---:|
| Pedido normal del cliente pasa a cocina | 1 validación del mozo | 0 clics del mozo |
| Excepción de pedido | información incompleta + navegación | 1 acción informada |
| Llamado simple | reclamar + completar | 1 acción; reclamo implícito |
| Plato listo a cargo del mozo | listo + entregado | 1 acción de retiro, con corrección |
| Cobro total y cierre | Caja/Servicio + PIN + liberar | 1 acción primaria + PIN si aplica |
| Preparar mesa siguiente | cierre y limpieza poco visibles | 1 acción física `Mesa lista` |
| Agregar tres platos distintos | rebotes carta–carrito | sin rebotes; conservar posición |
| Encontrar el próximo pendiente | depende de pestañas | menos de 5 segundos sin cambiar vista |

El PIN no se cuenta como clic operativo porque es una barrera de autorización. Se medirá aparte su frecuencia. El plan no asume que deba eliminarse: se definirá si vale por operación, por umbral o por ventana temporal.

## 5. Decisiones adoptadas y decisiones pendientes

### Adoptadas como recomendación del plan

- una pantalla principal de Servicio para el mozo;
- cuenta canónica por ocupación/sesión;
- pedidos normales directos a cocina y revisión sólo por excepción;
- cocina es propietaria de `READY` cuando existe estación de cocina;
- cobro dentro del panel de mesa;
- pago no implica necesariamente fin de ocupación;
- `Cobrar y cerrar` será la acción primaria cuando el grupo se retira;
- QR físico estable y sesión/token rotativos;
- una confirmación física para limpieza;
- agregar un producto no abre el carrito;
- colaboración separada de división de pagos;
- Rewards, fila y administración fuera del camino crítico del mozo.

### A validar antes de las etapas que dependen de ellas

1. ¿Existe una estación de cocina dedicada o se comparte el mismo terminal? El plan soporta ambos modos, pero debe existir un único propietario de `READY` por turno.
2. ¿Qué excepciones exactas requieren revisión y cuáles dependen de configuración local?
3. ¿El mozo puede cobrar dentro de un umbral, o todo cobro requiere PIN de encargado? Si se usa ventana temporal, debe ser corta, visible y auditable.
4. ¿Los pagos parciales presenciales entran en esta ejecución o quedan como flujo secundario posterior?
5. ¿Durante `TO_CLEAN` se permite explorar la carta sin operar o se muestra sólo “mesa en preparación”?

Estas decisiones no bloquean el endurecimiento del ciclo de sesión, la cuenta canónica, la tarjeta detallada ni la corrección del cliente.

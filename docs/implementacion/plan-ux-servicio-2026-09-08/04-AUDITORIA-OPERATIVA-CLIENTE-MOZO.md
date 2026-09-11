# Auditoría operativa cliente–cocina–mozo

**Ejecución:** 8–9 de septiembre de 2026  
**Alcance:** flujo cliente → API → cocina → mozo/staff → cuenta, con varias tandas, llamadas, cobro y nueva tanda posterior al cobro.  
**Resultado:** **GO técnico local** para este flujo; **NO-GO de piloto/producción** hasta completar los gates físicos, cloud y humanos indicados al final.

Este documento complementa:

- [Análisis completo y decisiones](./01-ANALISIS.md)
- [Plan de 37 etapas](./02-PLAN.md)
- [Pruebas, seguimiento y criterios GO/NO-GO](./03-VERIFICACION-Y-CONTROL.md)

## 1. Qué se verificó

La historia operativa comprobada fue:

> El cliente arma un borrador y envía una tanda; la API la persiste; cocina y staff avanzan el estado; el cliente ve el estado; nuevas tandas se acumulan en la cuenta de la sesión; el mozo cobra y libera la mesa explícitamente.

Se cubrieron:

- primera tanda de uno y varios platos;
- varias rondas en la misma mesa;
- validación de comanda por mozo y modo directo;
- cocina: en preparación, listo y entregado;
- mapa y cola de trabajo de Servicio;
- llamadas al mozo y pedidos de insumos;
- pedido y cobro de cuenta;
- pago total y nueva tanda posterior al pago;
- sesiones vencidas resueltas y sesiones vencidas con saldo pendiente;
- carreras de concurrencia del FSM;
- permisos de staff/encargado, idempotencia y resiliencia de cliente.

La prueba manual se ejecutó en un entorno aislado con SQLite, API en `3100`, cliente en `5176` y staff en `5177`. No se modificaron ni se detuvieron deliberadamente el servidor principal, las bases del usuario ni las sesiones de OpenCode.

## 2. Conteo de clics y decisiones

El conteo mide acciones deliberadas visibles en el camino mínimo observado. No cuenta esperas de red ni renderizados. Seleccionar una mesa sí cuenta. La entrada del PIN se informa aparte porque es una entrada de seguridad, no un botón.

| Escenario | Cliente | Mozo/staff | Resultado |
|---|---:|---:|---|
| Una tanda, un plato | 4: `Abrir Carta` → plato → agregar → enviar | 3 con validación: `Validar y enviar` → `Marcar listo` → `Entregado` | PASS |
| Dos platos usando la sugerencia del carrito | 5: flujo anterior + agregar sugerencia + enviar | Igual que la fila anterior | PASS |
| Segundo plato arbitrario, no sugerido | Más fricción: cerrar carrito, volver a carta, elegir, agregar y enviar | Igual que la fila anterior | Mejora recomendada |
| Pedido cargado por staff | No aplica | 5 incluyendo seleccionar mesa; 4 con la mesa ya seleccionada | PASS |
| Llamar al mozo desde el flujo normal | 2: abrir llamada + elegir motivo | 2: `Me ocupo` + `Marcar atendido` | PASS |
| Llamar al mozo con carrito abierto | 2 usando el botón de llamada del carrito + motivo | 2 | PASS; evita cerrar el carrito |
| Pedir insumos | 2: abrir insumos + motivo | 2 | PASS |
| Pedir la cuenta y elegir efectivo | 2: `Pedir la cuenta` + `Efectivo` | 4 botones + entrada de PIN: abrir cuenta, abrir/revisar, reautorizar, autorizar y cobrar | PASS |
| Liberar mesa después del cobro | No aplica | 1 acción explícita de `Liberar mesa` | PASS; evita liberar antes de tiempo |
| Nueva tanda después del pago | 4 para una nueva tanda normal | Mismo circuito de validación/cocina/entrega | PASS |

### Lectura operativa

- El cliente tiene un camino corto y comprensible para una tanda: la única confirmación explícita es el envío final; no apareció un modal de confirmación redundante adicional.
- Con `requireWaiterValidation=true`, el sistema prioriza control: el mozo hace tres acciones por tanda. El modo directo reduce una acción, pero cambia la política de seguridad y trazabilidad; no se cambió por defecto sin decisión del negocio.
- `Me ocupo` y `Marcar atendido` son dos acciones intencionales para evitar que dos personas trabajen el mismo pedido en el terminal compartido.
- La acción más costosa que queda es pedir un plato arbitrario adicional desde el carrito. La ruta de sugerencias ya es rápida, pero el carrito debería ofrecer `Seguir eligiendo` o una selección persistente de carta.

## 3. Problemas encontrados y correcciones aplicadas

### 3.1 Cuenta acumulada — corregido

**Problema:** la lectura podía quedar limitada al borrador o al último envío, aunque la mesa tuviera varias tandas aceptadas. Esto producía desacuerdo entre cliente, staff y cobro.

**Corrección:** la cuenta se construye como una proyección de la `TableSession`: suma tandas aceptadas, separa borrador, pagos, propina y saldo. `getCashOrders` y el espacio de Servicio usan la sesión más nueva sin permitir que una sesión antigua sobrescriba la cuenta actual.

**Evidencia:** se comprobaron tres rondas, consulta de cuenta en cliente y staff, cobro total y una ronda nueva posterior al pago. La cuenta no mezcló el saldo de una sesión vencida anterior.

### 3.2 Desacople entre datos y estado visual de mesa — corregido

**Problema:** una mesa con pedido o cuenta podía seguir figurando como `AVAILABLE`, haciendo que el mozo creyera que estaba libre o que debía iniciar otra operación.

**Corrección:** `ensureOperationalState` converge por pasos permitidos de la FSM y se invoca desde los flujos de pedido, validación, entrega, llamada y cuenta. El pago total deja la mesa en `EATING` hasta que el staff ejecuta `Liberar mesa`, porque el cliente puede iniciar otra tanda.

**Evidencia:** la mesa pasó visualmente por `Pedido en cocina`, `Entregar a mesa`, `Comiendo` y `Cuenta solicitada`; la liberación quedó habilitada sólo después del cobro.

### 3.3 Sesiones vencidas y reutilización de mesa — corregido

**Problema:** una sesión vieja podía competir con la actual o contaminar la cuenta mostrada.

**Corrección:** selección newest-first, `activeKey` saneado, cierre de sesiones vencidas ya resueltas y bloqueo explícito con `STALE_SESSION_UNRESOLVED` cuando la sesión vencida conserva saldo, borrador, validación pendiente o llamadas activas.

**Evidencia:** una mesa con una sesión vieja pagada y una sesión nueva con saldo mostró sólo el consumo nuevo; una sesión vencida no resuelta no pudo abrir una segunda sesión silenciosamente.

### 3.4 Transición inválida en segunda ronda — corregido

Durante la suite completa apareció una transición lógica real: intentar ir directamente de `BILL_REQUESTED` a `ORDER_IN_KITCHEN` no está permitido por la matriz canónica. La convergencia ahora pasa por `EATING` y luego por `ORDER_IN_KITCHEN`, sin saltar la FSM. El E2E completo volvió a pasar.

### 3.5 Indicador de carrito falso — corregido

El badge del cliente contaba ítems de tandas ya enviadas como si siguieran en el carrito. Ahora sólo cuenta ítems cuyo pedido está en `DRAFT`; el historial de tandas permanece visible por separado.

### 3.6 Contraste — corregido

Se ajustaron textos secundarios del cliente y botones de cobro del staff. La auditoría automatizada de accesibilidad quedó en **0 violaciones** en cliente y **0 violaciones** en staff. Sólo quedaron advertencias incompletas sobre fondos degradados, no violaciones confirmadas.

## 4. Verificación de interfaz y comprensión del mozo

La propuesta de organizar la pantalla por trabajo pendiente, bajo el espacio **Servicio**, es la dirección correcta:

- la cola muestra qué requiere una acción ahora;
- el mapa compacto aporta contexto y permite seleccionar una mesa;
- cocina queda señalizada en la cola;
- cuenta y acciones de cobro se abren en el contexto de la mesa;
- el flujo no obliga a navegar por módulos para completar una tarea.

Se observó que la cola y el mapa convergen correctamente después de cada cambio de estado. El mapa no debe convertirse en otra lista paralela de acciones: su función es contexto; la cola debe seguir siendo la lista de trabajo.

## 5. Pendientes de UX que no conviene ocultar

1. **Agregar otro plato arbitrario:** agregar una acción persistente `Seguir eligiendo` dentro del carrito y conservar un mini-carrito visible reduciría cierres y reaperturas.
2. **Validación de comanda:** mantenerla activada conserva una barrera útil en un local con personal compartido. Si el negocio decide priorizar velocidad, el modo directo debe medirse con un permiso y una trazabilidad equivalentes.
3. **Llamada sobre el carrito:** el encabezado queda cubierto por el overlay, aunque el botón dedicado dentro del carrito resuelve el caso. Conviene hacer explícito ese botón y no depender de que el usuario descubra el control interno.
4. **Cobro compartido:** la reautorización con PIN agrega una entrada, pero protege una operación sensible. No se eliminó.
5. **Tema visual:** el contraste fue corregido, pero la carta continúa usando el tema oscuro actual. Si el requisito definitivo es carta blanca con tipografía grande, resta una pasada visual específica; no se hizo un cambio masivo de tema durante esta auditoría funcional.
6. **Pago y liberación:** el pago no libera automáticamente. Es correcto para permitir otra ronda, pero debe quedar explicado en capacitación y en el estado visible de Servicio.

## 6. Evidencia automatizada final

Ejecutado sobre una base SQLite efímera recién creada por `scripts/test-local.mjs`:

- **Suite completa:** 54 archivos; **53 passed, 1 skipped**.
- **Tests:** **513 passed, 3 skipped**; proceso terminado con código 0.
- `npx tsc --noEmit -p packages/api/tsconfig.json`: PASS.
- `npm --workspace=@mesaya/client-web run build`: PASS.
- `npm --workspace=@mesaya/staff-panel run build`: PASS. Sólo se observaron warnings conocidos de anotaciones `@__PURE__` de Zod/Rollup.
- `git diff --check`: PASS. Git informó avisos de conversión LF/CRLF del working tree, no errores de whitespace.
- Regresión RTMS aislada: **12/12 PASS**.
- Regresión QR/sesiones aislada: **15/15 PASS**.
- E2E cliente–staff–cocina: **39/39 PASS**.
- Axe 4.12.1: 0 violaciones cliente y 0 staff.
- Navegador: sin errores de página observados después de limpiar el registro de errores.

Hubo un intento intermedio de ejecutar 20 archivos focales sobre una misma SQLite manualmente sembrada que terminó con 219/220 y un timeout en la ráfaga de 50 actualizaciones. El mismo test RTMS pasó 12/12 aislado y la corrida final recomendada (`test-local`, base nueva y un worker) pasó completa. Se registra como fragilidad del arnés por compartir una SQLite mutada entre archivos, no como resultado verde oculto ni como regresión del producto.

## 7. Dictamen

### GO técnico local

El flujo crítico cliente → cocina → mozo está operativo en local después de las correcciones. La cuenta acumulada, la continuidad posterior al pago, la convergencia de estados, las sesiones vencidas, la concurrencia y la visibilidad de Servicio tienen evidencia de código, tests y recorrido manual.

### NO-GO para piloto/producción todavía

Antes de declarar listo el piloto faltan gates que esta auditoría no puede sustituir:

- recorrido real con QR/NFC físico en dispositivos de cliente y terminal de staff;
- PostgreSQL/Supabase desplegado, migraciones aplicadas y prueba de restore;
- red intermitente, reconexión, doble terminal y concurrencia en el entorno real;
- medición humana con mozos: tiempo, errores, recuperación y comprensión de estados;
- reconciliación final de todos los cambios del working tree y del trabajo de OpenCode;
- decisión de negocio sobre validación obligatoria, tema claro y liberación/cobro.

La conclusión es favorable para seguir con la implementación y la prueba local, pero no equivale todavía a certificación de despliegue ni a un GO de clientes reales.

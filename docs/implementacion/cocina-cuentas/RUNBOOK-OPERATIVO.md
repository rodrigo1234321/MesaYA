# Runbook Operativo: MesaYA — Salón, Cocina KDS y Caja de Cuentas

**Versión:** 1.0.0  
**Fecha:** 2026-09-06  
**Ámbito:** Restaurante Piloto en Mar del Plata  
**Referencia Técnica:** `docs/implementacion/COCINA-CUENTAS-2026-09-05.md` y `docs/implementacion/COCINA-CUENTAS-ACEPTACION.md`

---

## 1. Roles y Responsabilidades Operativas

El sistema MesaYA opera bajo una arquitectura de terminales distribuidas sin papel, diseñada para máxima velocidad, trazabilidad estricta y eliminación de comandas perdidas.

| Rol | Interfaz Principal | Responsabilidad Clave |
|---|---|---|
| **Comensal (Visitante)** | `apps/client-web` (Web Móvil QR) | Escanea QR de mesa, se identifica, arma su carrito, envía tandas y gestiona su parte de la cuenta. |
| **Mozo / Camarero** | `apps/staff-panel` (Tablet / Celular) | Valida pedidos que contienen alérgenos, despacha platos servidos, atiende llamados y cobra presencialmente. |
| **Cocinero / Jefe de Cocina** | `apps/staff-panel` (Pantalla KDS) | Monitorea comandas por tandas, prepara platos en secuencia, avisa platos listos y marca agotados (86). |
| **Encargado / Manager** | `apps/staff-panel` + `apps/admin-dashboard` | Apertura/cierre de turno, configuración de modos de cocina, reversión autorizada de pagos y cierre de mesas. |

---

## 2. Inicio de Turno y Activación del Salón

1. **Apertura de Turno:**
   - El encargado inicia sesión en el panel de administración o staff con su PIN de manager (ej: `9999`).
   - Se activa el turno operativo (`POST /v1/shifts/open`).
   - Todas las mesas del salón quedan vinculadas al `shiftId` activo.
2. **Estado Inicial de Mesas:**
   - Las mesas comienzan en estado `AVAILABLE` (Verde).
   - Los códigos QR impresos en las mesas apuntan a la URL pública con token rotativo seguro (ej: `https://mesaya.app/?token=<UUID>`).

---

## 3. Modos Operativos del Restaurante

El restaurante puede operar en cualquiera de los 3 modos oficiales, configurables desde `apps/admin-dashboard`:

1. **Modo 1: Carta Informativa (`allowOrdering: false`)**
   - El comensal solo puede visualizar el menú digital y realizar llamados de mozo o pedir la cuenta.
   - Ideal para días de evento especial o salón saturado sin pedidos móviles.
2. **Modo 2: Pedido con Validación del Mozo (`requireWaiterValidation: true`)**
   - El comensal arma su tanda y la envía. La tanda queda en estado `CONFIRMED` y genera un llamado silencioso de validación.
   - El mozo se acerca a la mesa, revisa la comanda en su tablet y presiona **"Validar comanda"**.
   - Tras la validación, la comanda ingresa de inmediato a cocina (`IN_KITCHEN`).
3. **Modo 3: Cocina Directa con Guardia de Alérgenos (`requireWaiterValidation: false`)**
   - Las tandas estándar sin observaciones críticas viajan directo a cocina (`IN_KITCHEN`) en menos de 1 segundo.
   - **Regla Estricta de Seguridad Alimentaria:** Si el comensal escribe notas que coinciden con alérgenos (`alergia`, `celiaquía`, `sin tacc`, `maní`, `mariscos`, `gluten`, `intolerancia`), el servidor **fuerza automáticamente la tanda al estado `CONFIRMED`**, exigiendo que un camarero humano verifique personalmente la solicitud antes de encender las hornallas.

---

## 4. Flujo Comensal: Visita, Carrito y Tandas

1. **Ingreso y Participación:**
   - El cliente escanea el QR de la mesa.
   - Si es la primera persona en sentarse, la mesa transiciona automáticamente a `OCCUPIED_NO_ORDER`.
   - Se solicita un nombre de comensal (ej: "Ana", "Bruno", "Carla"). El servidor emite un token de participante con hash SHA-256 persistido en la sesión.
2. **Carrito Borrador Aislado:**
   - Cada persona gestiona sus líneas en su propio dispositivo sin interferir con los borradores de sus acompañantes.
   - Se admiten aclaraciones de cocción y notas por plato.
3. **Envío por Tandas Independientes (`OrderTanda`):**
   - Las mesas pueden pedir en múltiples momentos (ej: Tanda 1: Entradas y Bebidas; Tanda 2: Platos Principales; Tanda 3: Postres y Cafés).
   - Cada tanda cuenta con una clave de idempotencia única generada por el navegador. Si el cliente pulsa dos veces por error o sufre microcortes de WiFi, el servidor garantiza exactamente una comanda.
   - Nuevas tandas de postre no reenvían los platos principales ya servidos ni hacen retroceder el estado de la mesa en el salón.

---

## 5. Pantalla de Cocina (KDS) y Despacho

1. **Organización Visual de Comandas:**
   - Las órdenes aparecen agrupadas por mesa y secuenciadas por número de tanda (`Tanda #1`, `Tanda #2`).
   - Cada tarjeta muestra el comensal que solicitó cada plato y las notas de preparación destacadas.
2. **Alertas de Alérgenos:**
   - Todo ítem con advertencia dietaria se resalta con un banner rojo prominente: `⚠️ ATENCIÓN ALÉRGENOS`.
3. **Control Sonoro Deduplicado:**
   - El panel KDS emite un sonido breve al entrar una nueva tanda confirmada.
   - El audio requiere activación humana inicial al abrir la pantalla para cumplir con las políticas de reproducción de los navegadores.
   - El mecanismo de deduplicación evita que se disparen sonidos repetidos ante reconexiones de red o refrescos de pantalla.
4. **Ciclo de Estados de Tanda en Cocina:**
   - `IN_KITCHEN`: Pedido en cola visible para los cocineros.
   - `PREPARING`: Platos en elaboración activa en estación (fuegos / horno).
   - `READY`: Platos emplatados listos para retirar en el pase.
   - `SERVED`: Mozo retira los platos y los entrega en la mesa. La mesa pasa automáticamente a `EATING`.
5. **Gestión de Agotados (Platos 86):**
   - El jefe de cocina puede pulsar el botón de stock en cualquier momento para marcar un ítem como "Agotado".
   - El cambio se propaga instantáneamente a todos los menús de comensales impidiendo que se sigan ordenando platos sin stock.

---

## 6. División de Cuentas, Cobro Presencial y Caja

MesaYA implementa una política contable estricta basada en **centavos enteros ARS**, eliminando redondeos flotantes inconsistentes.

### A. Modalidades de Reparto Disponibles para el Comensal
1. **👤 Mi Parte (Por Consumo):**
   - Muestra exactamente los platos que pidió ese comensal.
   - Permite reclamar o ceder platos compartidos (ej: una pizza o entrada al medio) con control de versiones optimista (`claimVersion`). Si dos personas tocan al mismo tiempo, el sistema informa el cambio sin duplicar el importe.
2. **➗ Partes Iguales ($N=2..6$):**
   - Divide el saldo pendiente total en partes matemáticas idénticas.
   - Cualquier centavo de residuo indivisible se asigna de forma determinista y estable a la primera cuota, garantizando que $\sum \text{cuotas} = \text{total}$.
3. **📋 Toda la Mesa:**
   - Resumen consolidado de todos los consumos del grupo para una persona que abona la cuenta completa.

### B. Proceso de Cobro en Mesa por el Personal (Mozo / Encargado)
1. El comensal solicita la cuenta desde su teléfono indicando el medio preferido.
2. El mozo abre el modal de cobro (`TableBillingModal`) desde su tarjeta en el panel de salón o desde la pestaña `"Caja y Cuentas"`.
3. **Datos Visibles en Pantalla:** Total comanda, monto ya cobrado y saldo remanente exacto.
4. **Selección del Método Presencial Autorizado:**
   - `WAITER_CASH`: Efectivo en mano.
   - `WAITER_CARD`: Tarjeta de débito/crédito procesada en terminal física (POSNet / Lapos).
   - `WAITER_MP_QR`: Cobro presencial escaneando el QR físico / terminal de Mercado Pago del local.
5. **Propinas:**
   - Campo opcional de propina en centavos. La propina queda registrada a favor del mozo pero **no amortiza el costo de la comida ni altera el saldo remanente de consumo**.
6. **Protección Anti-Sobrepago:**
   - El sistema bloquea con error `409 OVERPAYMENT_NOT_ALLOWED` cualquier intento de ingresar un monto superior a la deuda remanente.
7. **Idempotencia:**
   - Cada cobro genera un token de transacción único. Reintentos ante cortes de red retornan el cobro previo sin cobrar dos veces.

### C. Reversión Autorizada de Cobro
- Si el mozo cargó un cobro por error (ej: voucher rechazado por el POSNet o error de tipeo en efectivo):
  - El personal autorizado pulsa `"Revertir Cobro"`.
  - La transacción pasa al estado auditado `REFUNDED`.
  - El saldo remanente se reabre automáticamente y la mesa vuelve a estado `EATING`.

---

## 7. Cierre de Mesa y Cierre de Turno

1. **Liquidación Completa al 100%:**
   - Cuando los pagos parciales cubren exactamente el total de la comanda, el saldo remanente llega a `$0`.
   - La cuenta pasa a estado `PAID` y la mesa transiciona en la FSM a `PAID`.
2. **Bloqueo de Cierre con Saldo Pendiente:**
   - **Regla Inquebrantable:** El sistema rechaza cualquier intento de cerrar una mesa o revocar la sesión si resta dinero por cobrar (`409 UNPAID_BALANCE_EXISTS`).
3. **Liberación de Mesa:**
   - Con saldo en cero, el camarero pulsa `"Liberar Mesa y Cerrar Sesión"`.
   - La mesa pasa a `TO_CLEAN` (A Limpiar) y finalmente a `AVAILABLE` para los próximos clientes.
   - El token QR de la visita anterior queda revocado para evitar que clientes que ya se retiraron sigan enviando pedidos a la mesa.

---

## 8. Protocolo de Contingencias Técnicas

| Evento de Falla | Comportamiento del Sistema | Acción del Operador |
|---|---|---|
| **Corte de Internet en celular del cliente** | El carrito se conserva en `sessionStorage`. Las tandas ya confirmadas están seguras en el servidor. | Solicitar al cliente que verifique su red o pedirle al mozo que tome el pedido verbalmente vía tablet. |
| **Microcorte al enviar pago** | La clave de idempotencia evita cobros dobles al pulsar reenviar. | Refrescar el modal de caja. Si el pago ya ingresó, se reflejará en el balance. |
| **Discrepancia en cobro con tarjeta** | Botón de reversión auditada de cobro disponible en el historial del modal. | Revertir el pago erróneo y asentar el importe correcto. |
| **Intento de cobro online con Mercado Pago** | Los endpoints digitales online responden incondicionalmente `503 DIGITAL_PAYMENTS_UNAVAILABLE`. | Explicar al cliente que el pago digital se cobra escaneando el QR presencial del comercio (`WAITER_MP_QR`). |

---

*Fin del Runbook Operativo. Documento de cumplimiento obligatorio en salón y cocina.*

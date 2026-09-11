# Plan de producto y piloto real — MesaYA v2

> **SUPERSEDIDO el 2026-09-07:** la estrategia dejó de ser un piloto acotado. El plan vigente propuesto es [Plan de producto base distribuible](../plan-producto-base-2026-09/README.md). Este documento se conserva como historial de la decisión anterior.

Fecha: 2026-09-07  
Estado: **PROPUESTA PARA APROBACION FUNCIONAL**  
Alcance: definición de producto, cierre de brechas operativas, ensayo físico y evolución posterior.  
Código de producto modificado por este plan: **ninguno**.

## Resultado recomendado

El primer piloto debe validar una sola promesa completa:

> Una mesa entra por QR o NFC, consulta la carta, pide ayuda o carga una comanda, el personal la procesa, cocina la entrega, el local cobra presencialmente, libera la mesa y obtiene métricas explicables.

Pago digital, cuenta dividida, fila virtual y Rewards no deben bloquear esa validación. Son productos adicionales con identidad, concurrencia, conciliación y operación propias.

## Decisiones propuestas

| Tema | Decisión para el primer piloto | Motivo |
|---|---|---|
| Comanda C07 | Siempre pasa por validación del mozo | Reduce errores de mesa, stock, notas y carga accidental mientras se observa el comportamiento real |
| Cobro C09/P08/T04 | Cobro presencial operativo; Mercado Pago queda fuera del GO inicial | Completa el circuito sin introducir riesgo financiero ni conciliación externa |
| Fila C16/P09 | No entra en el primer piloto | Necesita pantalla pública, identidad/contacto, aviso y pruebas de concurrencia; no valida el núcleo de mesa |
| Sommelier C13/T05 | Beta controlada, apagable y no bloqueante | Es diferenciador, pero no puede decidir alergias ni recomendar productos ausentes |
| Métricas A10/A11 | Operativas: sólo datos medidos; proyecciones en sección separada | Evita decisiones sobre cifras inventadas o mezcladas |
| Upselling C14 | Experimento posterior al circuito estable | Primero hay que medir impresión, aceptación y venta incremental |
| Propinas C15/P08 | Sólo registro de propina en el cobro presencial | Es una extensión natural de caja y no requiere checkout autónomo |
| Reseñas C15 | Opcional después del servicio, sólo con Place ID real | Puede activarse sin afectar la operación; nunca usar valores de ejemplo |
| Rewards C17 | Fuera del piloto | Sin identidad y ledger sólo sería una calculadora, no un programa de fidelidad |
| Pago digital T04 | Etapa posterior exclusiva de sandbox | Requiere webhooks, idempotencia, conciliación y recuperación |
| Split T04 | Después de aprobar pago digital | Multiplica estados, reclamos y condiciones de carrera |

El razonamiento completo está en [DECISIONES-FUNCIONALES.md](DECISIONES-FUNCIONALES.md).

## Alcance aprobado propuesto

```yaml
Piloto obligatorio:
  - C01-C12 excepto pago digital
  - P01-P07
  - P08 con efectivo/tarjeta/QR presencial y propina registrada
  - A01, A03-A09
  - A10-A11 sólo con datos medidos o N/D
  - T01-T03
  - T07 para enlaces definitivos y validación física QR/NFC

Piloto beta no bloqueante:
  - C13 Sommelier con restricciones, disponibilidad y kill switch
  - C15 reseña Google sólo con Place ID válido

Después del piloto:
  - C14 upselling
  - C16/P09 fila virtual
  - T04 Mercado Pago en sandbox y luego productivo
  - división automática de cuenta
  - C17 Rewards
  - T06 WhatsApp como respaldo

No implementar ahora:
  - alta pública de restaurantes A02
  - pago productivo con dinero real
  - monto libre en cuentas divididas
  - pre-order desde fila virtual
  - garantías automáticas sobre alergias
```

## Dos carriles de trabajo

### Carril P — salida al piloto

`P00 definición -> P01 verdad de módulos -> P02 caja -> P03 ciclo E2E -> P04 métricas -> P05 Sommelier beta -> P06 QR/NFC -> P07 ensayo -> P08 release -> P09 observación`

Las etapas P00–P09 son secuenciales. P05 no bloquea el GO del núcleo: si no supera calidad, se apaga y el piloto continúa sin Sommelier.

### Carril E — expansión posterior

`E01 comercial liviano -> E02 fila -> E03 Mercado Pago sandbox -> E04 split -> E05 Rewards`

Ninguna etapa E se considera implícitamente autorizada por aprobar el piloto. Cada una requiere una decisión de producto separada.

## Documentos

- [DECISIONES-FUNCIONALES.md](DECISIONES-FUNCIONALES.md): decisión, alternativas, riesgos y condición de revisión.
- [PLAN-POR-ETAPAS.md](PLAN-POR-ETAPAS.md): trabajo, pruebas y aceptación de cada etapa.
- [CONTROL.md](CONTROL.md): estados y dependencias para ejecutar una ficha a la vez.
- [PROTOCOLO.md](PROTOCOLO.md): forma de implementación, revisión, evidencia y pausas.
- [MATRIZ-ALCANCE.md](MATRIZ-ALCANCE.md): destino de cada capacidad C/P/A/T.

## Definición estricta de operativo

Una capacidad sólo se marca operativa cuando existen y concuerdan:

1. acción visible y comprensible;
2. contrato API con permisos y errores específicos;
3. persistencia consistente;
4. procedimiento de operación y recuperación;
5. pruebas de caso feliz, rechazo, reintento y recorrido manual.

Un componente visible, un endpoint aislado o una bandera guardada no alcanzan.

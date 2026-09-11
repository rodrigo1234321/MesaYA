# Decisiones funcionales recomendadas

## D01 — La comanda se valida por el mozo

**Decisión:** durante el primer piloto, `requireWaiterValidation=true` para todos los pedidos del comensal. Los pedidos cargados por personal pueden conservar su recorrido directo según permisos.

**Por qué:** el piloto todavía debe descubrir errores de uso, duplicados, notas ambiguas, cambios de stock y comportamiento del carrito grupal. Enviar todo directo a cocina traslada esos errores al punto más caro del flujo.

**Qué medir:** porcentaje aprobado sin cambios, tiempo hasta validación, rechazos, correcciones y duplicados. Se reconsidera el envío directo cuando al menos el 95% de las comandas se valide sin edición durante varias ventanas reales y cocina acepte la regla.

**Evolución:** más adelante puede configurarse por local, franja o categoría; no por un toggle global cuyo efecto no sea visible.

## D02 — Cobro presencial como cierre obligatorio

**Decisión:** efectivo, tarjeta física o QR mostrado/cobrado por el local. El sistema registra medio, importe, propina, responsable, hora e idempotencia. No procesa dinero en el primer GO.

**Por qué:** la caja visible para staff cierra el flujo central y alimenta revenue real. Mercado Pago autónomo añade credenciales, checkout, webhooks, conciliación, reintentos y soporte financiero.

**Condición de salida:** una orden no puede quedar marcada `PAID` por una acción repetida, un actor sin permiso o un error parcial. La mesa no se libera con deuda abierta sin una resolución explícita y auditada.

## D03 — Fila virtual fuera del primer piloto

**Decisión:** mantener la API/panel existente ocultos o rotulados como no disponibles. No crear aún pantalla pública.

**Por qué:** la fila es un flujo anterior a la mesa y requiere contacto, consentimiento, estimación, aviso, no-show, llamada concurrente y asignación. Introducirlo ahora no mejora la prueba del núcleo QR → servicio → cobro.

**Disparador futuro:** un local con espera frecuente, responsable operativo y mecanismo de aviso definido.

## D04 — Contrato del Sommelier

El Sommelier puede recomendar:

- únicamente productos disponibles de la carta activa;
- preferencias de tipo de comida/bebida, intensidad, picante y tamaño;
- presupuesto máximo por persona o grupo;
- restricciones declaradas y etiquetas verificadas;
- maridajes existentes en la carta, alcohólicos o no según el pedido;
- entre dos y tres alternativas diversas, con motivo breve.

No puede:

- afirmar ausencia de alérgenos sin datos verificados;
- sustituir al personal ante alergia severa;
- inventar ingredientes, disponibilidad, precios o bebidas;
- recomendar alcohol cuando el usuario lo excluye;
- ocultar que está funcionando con un fallback degradado.

**Decisión:** beta no bloqueante, con filtros determinísticos antes del modelo, salida estructurada, evaluación versionada y kill switch. Ante alergia o datos insuficientes debe abstenerse y ofrecer llamar al personal.

## D05 — Métricas medidas y proyecciones separadas

**Decisión:** el panel operativo sólo muestra valores `MEASURED` o `UNAVAILABLE`. Una proyección puede existir en una vista separada llamada “Simulaciones”, nunca mezclada con el desempeño real.

Toda métrica incluye: valor, unidad, período, zona horaria, cantidad de muestras, fuente de eventos y calidad. Cero muestras produce `N/D`, no un número atractivo por defecto.

**Consecuencias:**

- rating 1–5 no se llama NPS;
- NPS requiere pregunta 0–10 y fórmula correspondiente;
- RevPASH usa revenue y horas de mesa observadas;
- “viajes ahorrados” se retira hasta contar con un evento comparable;
- ingresos estimados no alimentan rendimiento por mesa.

## D06 — Comercial y fidelización

**Propina:** sí en el piloto, sólo dentro del cobro presencial y con cero/personalizada.  
**Reseña:** opcional con Place ID válido y rating real; no bloquea el GO.  
**Upsell:** después de estabilizar pedidos; debe medirse como experimento.  
**Rewards:** después del piloto y sólo con identidad, ledger, acreditación, saldo y canje.  
**Pre-order:** no implementar junto con fila hasta resolver identidad y reserva.

## D07 — Autoridad para liberar mesa

**Decisión recomendada:** manager y staff con permiso operativo explícito pueden liberar una mesa, pero el backend rechaza la acción si hay deuda, comanda o pago pendiente. Forzar cierre es acción exclusiva de manager, exige motivo y auditoría.

Esto alinea la operación cotidiana con seguridad: no obliga a buscar un manager para cada limpieza, pero evita que cualquier mozo borre una deuda abierta.

## D08 — Carrito colaborativo

**Decisión:** una única vista compartida de la mesa, identificando quién agregó cada línea. Antes de enviar, cualquier participante ve el snapshot completo; después del envío, las modificaciones crean una nueva comanda o requieren acción del mozo.

`syncSocialCart` no debe continuar como bandera ambigua. O gobierna esta semántica de manera comprobable o se retira.

## D09 — QR/NFC

**Decisión:** QR y NFC contienen la misma URL canónica estable de la mesa. La URL resuelve una sesión rotativa del turno; el soporte físico nunca contiene un token de sesión persistente.

Para el GO se requiere lectura real en iPhone y Android, Wi-Fi y datos móviles, cierre/reingreso y comprobación de que un token anterior ya no opera.

## D10 — Regla de priorización

Cuando dos trabajos compiten, se ordenan así:

1. pérdida/corrupción de datos, permisos o doble cobro;
2. imposibilidad de completar el ciclo de mesa;
3. recuperación operativa y errores visibles;
4. calidad/verdad de métricas;
5. experiencia del personal y comensal;
6. automatización comercial;
7. expansión de módulos.


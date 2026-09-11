# Boceto C01 — jerarquía y tareas del cliente (documental, sin runtime)

Fecha: 2026-09-08. Etapa: C01, estado EN_REVISION (boceto; ninguna aprobación de
usabilidad). Acompaña a `01-ANALISIS.md`, `02-PLAN.md` y `03-VERIFICACION-Y-CONTROL.md`.
Archivos leídos para este boceto (solo lectura, sin cambios): `apps/client-web/index.html`
(746 líneas), `apps/client-web/app.js` (mapa `el`, `loadBillDetails`, `submitCart`,
`fetchWithRetry`, `currentToken`), `apps/client-web/styles.css` (422 líneas).

## 1. Objetivo, hipótesis y límites

- Objetivo: definir DÓNDE vive cada tarea del comensal (carta, carrito, historial,
  cuenta, llamados) antes de mover un píxel, con la Carta como acceso principal y
  tres acciones grandes de servicio juntas.
- Hipótesis de trabajo: si la entrada principal es "Ver carta" y Llamar/Cuenta/
  Insumos están siempre visibles arriba, el comensal no necesita explorar ni
  adivinar; el encabezado conserva solo identidad (local/mesa) + carrito.
- Límites: esto es un boceto. No cambia runtime, no promete resultados medidos,
  no certifica accesibilidad ni tiempos. Las medidas reales se observan en V05;
  hasta entonces todo número es objetivo de diseño, no resultado.

## 2. Jerarquía propuesta (touch-first; 360 px en columna)

Orden vertical estricto, una sola columna, un único scroll principal. A 360 px NO
hay fila de tres: cada acción ocupa todo el ancho en columna (56–64 px de alto,
texto legible) para no forzar controles pequeños. Una composición 2+1 solo se
admite si cada control conserva ese alto y su etiqueta completa sin recortes.

```text
┌──────────────── 360 px ────────────────┐
│ [logo] Trattoria · Mesa 1    [🛒 2]    │  ← encabezado: identidad + SOLO carrito
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │ 💰  Pedir la cuenta          →    │ │  ← 56–64 px, juntas y primeras
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ 🙋  Llamar al mozo           →    │ │
│ └────────────────────────────────────┘ │
│ ┌────────────────────────────────────┐ │
│ │ 🧂  Pedir insumos            →    │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ ┌────────────────────────────────────┐ │
│ │  VER CARTA (entrada principal)     │ │  ← UN acceso principal, separado
│ │  Platos, bebidas y precios         │ │
│ └────────────────────────────────────┘ │
├────────────────────────────────────────┤
│ Tus pedidos (ya enviados, por ronda)   │  ← historial, sin palabra "comanda"
│ Cuenta de la mesa (consumo + saldo)    │  ← acumulada, no última tanda
└────────────────────────────────────────┘
```

Variantes: a 390 px se conserva la columna (mismo orden, más aire); a 768 px se
permite —sin forzar— una distribución horizontal de las tres acciones SOLO si cada
una mantiene ≥56 px de alto, etiqueta completa y separación táctil; si no entran
con esos mínimos, sigue la columna. La entrada de carta nunca comparte fila con
las acciones. El hero decorativo NO vuelve a empujar las acciones fuera de la
primera pantalla: si compite por espacio, se reduce él, no las acciones.

## 3. Decisiones para C02 (no implementadas aquí)

- Eliminar "Platos estrella de la casa", su renderizado (`featuredDishesSection`,
  `featuredStoryCardsContainer`) y el espacio reservado. Sin carrusel sustituto.
- Eliminar "Ver Carta" del encabezado (`btnOpenMenuHeader`): el encabezado conserva
  únicamente carrito (`btnOpenCartHeader`) + identidad (`restaurantName`,
  `tableBadge`, `sectorBadge`).
- Reorganizar las acciones existentes (`btnActionBill`, `btnActionWaiter`,
  `btnActionSupplies`) al tamaño objetivo (principales 56–64 px) y reducir el hero
  (`heroMenuCard`) si impide la jerarquía aprobada.
- Nada de lo anterior está hecho en este boceto: C02 lo implementa y lo verifica
  con comparación visual antes/después y prueba de listeners huérfanos.

## 4. Vistas y estados (lenguaje de cliente)

| Estado | Qué ve el comensal |
|---|---|
| Sin sesión (explora) | Identidad del local + Carta completa; aviso breve "escaneá el QR de tu mesa para pedir" que NO parece avería y NO bloquea la carta. |
| Sesión activa sin pedido | Entrada de carta + tres acciones; carrito vacío ("Todavía no hay platos"). |
| Carrito con borrador | "En tu carrito" con cantidades/notas/total del borrador, claramente distinto del consumo; botón "Enviar pedido" inequívoco. |
| Historial de envíos | "Ya enviado": rondas agrupadas con estado por ronda — esperando confirmación, recibido para preparar, listo para entregar, entregado. |
| Cuenta acumulada | Consumo total de la ocupación, pagos registrados, saldo y propina por separado; elegir medio avisa que el mozo se acerca (no procesa dinero). |
| Llamado en curso | Motivo, confirmación, tiempo y si alguien se ocupa; cancelar un llamado tomado avisa al personal. |
| Sesión expirada/cerrada | Aviso + carta explorable + "Reintentar conexión"; la carta nunca es callejón sin salida. |

## 5. Navegación y retorno sin perder contexto

- Volver del detalle de un plato recupera categoría y posición de la carta.
- Cerrar cualquier modal (carta, carrito, cuenta, llamado) devuelve al inicio con
  mesa/local visibles; el contexto nunca se pierde al navegar.
- Sesión expirada: se conserva lo explorable (carta) y se ofrece re-conexión por QR;
  no se finge envío ni se invita a duplicar ante timeout ("estamos comprobando").

## 6. Matriz de tareas a 360 px (simulación, no estudio humano)

| Tarea | Ubicación principal | Pasos | Éxito |
|---|---|---|---|
| Localizar la Carta | Entrada principal separada bajo las acciones | 1 toque en "Ver carta" | Abre la carta sin scroll previo |
| Llamar al mozo | Columna de acciones, segunda tarjeta (56–64 px) | 1 toque + motivo | Confirmación con motivo y estado |
| Pedir la cuenta | Columna de acciones, primera tarjeta (56–64 px) | 1 toque | Ve consumo acumulado + aviso presencial |
| Pedir insumos | Columna de acciones, tercera tarjeta (56–64 px) | 1 toque + insumo | Confirmación sin perder la carta |
| Abrir el carrito | Encabezado (única acción) | 1 toque | Ve borrador separado del consumo |

Criterio: cada tarea frecuente empieza en ≤2 toques desde el inicio, sin explorar
menús ni scroll interno. Pendiente de validación real en V05.

## 7. Para C02–C08, riesgos y pendientes (no inventar resultados)

- C02: implementar §3 con parche visual localizado + comparación antes/después.
- C03–C04: carta blanca legible y carrito-borrador claro (tipografía, 48 px táctil).
- C05–C06: historial por rondas y cuenta acumulada contra el contrato B03/B04.
- C07–C08: seguimiento de llamados, accesibilidad, sesión y fallos (sin callejones).
- Riesgos: hero decorativo que reaparece empujando acciones; listeners huérfanos al
  quitar nodos; confundir "cuenta pedida" con "cuenta pagada"; prometer tiempos de
  cocina inexistentes. Decisiones pendientes: textos finales de cada estado con el
  local; qué foto/ilustración sustituye al hero si se reduce.

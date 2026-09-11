# Auditoría funcional completa

Fecha: 2026-09-06  
Fuentes: código de `main` en `d932969`, contratos, pruebas existentes y consultas de sólo lectura al piloto.

## Escala

- **FUNCIONA**: capacidad completa en las capas necesarias; falta igualmente validación física si depende de hardware.
- **PARCIAL**: hay piezas reales, pero el recorrido no se puede completar o no respeta toda la configuración.
- **NO FUNCIONA**: no existe una capacidad utilizable.
- **ENGAÑOSO**: la interfaz o la métrica afirma algo que el sistema no sostiene.
- **NO VERIFICADO**: requiere dispositivos, credenciales o personas que no formaron parte de esta auditoría.

## Evidencia del entorno piloto

| Comprobación | Resultado |
|---|---|
| `GET https://mesa-ya-api.vercel.app/health` | `status: ok`, base conectada |
| Config pública de `mesaya-piloto` | pago digital, split, espera, pre-order y Rewards aparecen activados |
| Carta pública | 3 categorías, 5 productos disponibles |
| QR estable de Mesa 1 | sesión válida y activa, URL sin token persistente |
| Sommelier, tres preguntas diferentes | mismo producto y mismo maridaje; motor `heuristic-engine` |
| Chequeo de matriz de rutas | falla: `close-session` figura MANAGER y el código permite STAFF |
| Build y suite aislada en esta consola | no ejecutables sin el adaptador Windows Job exigido por el repositorio |

## Resultado por área

| Área | Estado | Qué existe | Problema concreto | Etapa |
|---|---|---|---|---|
| API + Supabase | FUNCIONA | Health y consulta pública responden; PostgreSQL conectado | Falta monitoreo funcional por flujo | 08 |
| Vercel | FUNCIONA con riesgo | Alias estables responden después de las correcciones de build | No hay gate único que pruebe los cuatro artefactos antes de promover | 00, 08 |
| Login admin | FUNCIONA | PIN visible, JWT y límites de tenant | Revisar expiración/recuperación en recorrido real | 00 |
| Navegación admin | PARCIAL | Pestañas cargan en una sola SPA | Barra horizontal poco clara; no hay rutas profundas ni estado persistido | 00 |
| Turnos | FUNCIONA en código/piloto | Apertura y cierre transaccional, sesiones por mesa | Requiere ensayo de cierre con comandas/cobros abiertos | 01, 07 |
| QR estable | FUNCIONA en código/piloto | URL canónica resuelve token rotativo de sesión | El QR del admin depende de `api.qrserver.com` para renderizar | 07 |
| NFC | NO VERIFICADO | Guía de NTAG215 y misma URL canónica que QR | No hay evidencia de tags grabados y leídos en iOS/Android ni registro fiable del origen NFC | 07 |
| Llamados | FUNCIONA | Alta, deduplicación, estados y polling en staff | La interfaz dice SSE aunque SSE está deshabilitado | 00 |
| Carta | FUNCIONA con datos insuficientes | CRUD, importación y carta pública | Piloto tiene sólo 5 ítems y metadatos pobres para IA/upsell | 03 |
| Pedido digital | PARCIAL ALTO | Carrito, alta/baja, submit, validación y KDS | Requiere recorrido multiusuario real y política clara de carrito social | 01 |
| KDS/cocina | PARCIAL ALTO | Carga por mozo y estados hasta SERVED | Errores de acción sólo van a consola; faltan recuperación y estados finales claros | 01 |
| Caja presencial | NO FUNCIONA desde UI | API real para manager y `StaffApi.payOrder` | Ningún componente llama `payOrder`; el cobro no se puede completar en pantalla | 01 |
| Pago autónomo | NO FUNCIONA / ENGAÑOSO | Modelos de credenciales/transacciones y selector admin | Las rutas digitales devuelven siempre 503; `paymentMode=DIGITAL_MP` está activo en vivo | 00, 04 |
| Cuenta dividida | NO FUNCIONA / ENGAÑOSO | Tablas y código histórico deshabilitado | Claim, split y pay-part devuelven siempre 503 aunque `allowSplitBill=true` | 00, 05 |
| Sommelier | NO FUNCIONA con calidad aceptable | Gemini opcional y heurístico local | En vivo ignora intención y repite Smash con bacon; empareja vino ante “sin alcohol” | 03 |
| Métricas de llamados | PARCIAL | Conteos y tiempos desde eventos reales | Mezcla “hoy” con inicio de turno y no muestra tamaño de muestra | 02 |
| NPS | ENGAÑOSO | Promedio de `rating` | Se llama NPS aunque es escala 1–5; sin respuestas muestra 5.0; feedback privado fija rating 5 | 02 |
| Ahorro de viajes | ENGAÑOSO | Tarjeta visual | Se calcula como `totalCalls * 0.6`; no mide viajes evitados | 02 |
| Embudo de fases | ENGAÑOSO | Timestamps de ocupación reales disponibles | Sin muestras devuelve siempre 8/22/38/12/6 minutos y la UI no muestra muestras | 02 |
| Mapa de calor | PARCIAL / ENGAÑOSO | Usa sesiones de ocupación por día/hora | Cuenta sólo hora de llegada, no ocupación por franja; inventa ingreso si falta | 02 |
| RevPASH/facturación | ENGAÑOSO | Fórmula y sesiones | Supone 8 h/día y $9.500 por persona; muestra resultado como real | 02 |
| Rendimiento por mesa | PARCIAL / ENGAÑOSO | Agrupa sesiones por mesa | Hereda ingresos estimados y horas supuestas | 02 |
| Configuración modular | PARCIAL / ENGAÑOSA | Persistencia y auditoría | Varias banderas no gobiernan el producto y no indican dependencia/estado | 00 |
| Upsell | PARCIAL | Endpoint respeta bandera | Ningún cliente consume el endpoint; razones genéricas no validan maridaje | 06 |
| Propinas | NO FUNCIONA como módulo | Selector visual y campo en pago manual | Porcentajes 10/15/20 están fijos en HTML; selección no se vincula al cobro del comensal | 06 |
| Reseñas | PARCIAL / RIESGOSO | Deep link configurable y feedback privado | `enableReviews` no se usa; queda un Place ID de ejemplo si no hay ID; feedback fija 5 estrellas | 06 |
| Fila de espera | PARCIAL | API y pantalla staff | No existe una interfaz pública para unirse desde las apps actuales | 06 |
| Pre-order en espera | NO FUNCIONA / ENGAÑOSO | Interruptor admin | No hay uso fuera de configuración | 00, 06 |
| Rewards | DEMO / ENGAÑOSO | Calculadora de puntos | No hay identidad, ledger, acreditación, saldo, canje ni UI de cliente | 00, 06 |
| Personal/mozos | PARCIAL ALTO | Alta y listado con PIN; login staff | Faltan edición, baja/desactivación, reset de PIN y feedback claro de errores | 06 |
| Plano RTMS/FSM | PARCIAL ALTO | Estados, auditoría y concurrencia | Algunos cambios de estado fallan silenciosamente; fuente NFC/QR no se deriva realmente del acceso | 01, 02 |

## Auditoría de cada interruptor

| Interruptor | Guarda | API lo aplica | Cliente lo aplica | Veredicto |
|---|---:|---:|---:|---|
| `paymentMode` | Sí | No para pago digital | No | Ocultar DIGITAL_MP/HYBRID hasta etapa 04 |
| `allowSplitBill` | Sí | Lo ignora y devuelve 503 | No hay UI | Ocultar/deshabilitar hasta etapa 05 |
| `allowOrdering` | Sí | Sí, rechaza pedidos | Parcial, cambia acciones | Real; conservar y probar |
| `syncSocialCart` | Sí | No hay bifurcación de comportamiento | No | Definir semántica o retirar |
| `requireWaiterValidation` | Sí | Sí | Staff tiene validación | Real; conservar y probar |
| `enableUpsell` | Sí | Sí en endpoint | No | Marcar incompleto hasta etapa 06 |
| `enableSmartTips` | Sí | Sólo campo opcional de pago | Sólo muestra/oculta sección | Parcial; porcentajes configurados no se usan |
| `suggestedTipPercentages` | Sí | Sólo se devuelve | HTML fijo | No efectivo |
| `enableReviews` | Sí | No gobierna el feedback | No se consulta | No efectivo |
| `googlePlaceId` | Sí | Se devuelve saneado | Sí, si es válido | Parcial; eliminar enlace por defecto |
| `enableWaitlist` | Sí | Sí | Sólo staff | Parcial; falta alta pública |
| `enableWaitlistPreOrder` | Sí | No | No | No efectivo |
| `enableRewards` | Sí | Sí en calculadora | No | Demo, no programa de fidelidad |
| `pointsPerHundredPesos` | Sí | Sí en calculadora | No | Demo |

## Diagnóstico del Sommelier

La causa observada es determinística:

1. El piloto respondió con `poweredBy: heuristic-engine`, por lo que Gemini no intervino en las consultas probadas.
2. El heurístico reconoce pocas palabras exactas. “liviano”, “sin alcohol”, “IPA” y “hamburguesa” no tienen intención propia.
3. Al no reconocer la consulta, selecciona ítems `isFeatured` o `CHEF_PICK`. En la carta piloto sólo la Smash posee `CHEF_PICK`.
4. El maridaje de la rama por defecto siempre es “Vino sugerido de la cava del chef”.
5. El catálogo tiene cinco ítems, sin atributos de picante, peso, alcohol, ingredientes normalizados o compatibilidades.
6. La respuesta heurística no se marca degradada, por lo que el usuario no sabe que recibió un fallback básico.

## Diagnóstico de analytics

La base de eventos existe: el FSM registra `orderedAt`, `servedAt`, `billAt`, `paidAt`, `vacatedAt` y `cleanedAt`. El defecto está en la interpretación y presentación:

- El embudo reemplaza ausencia de datos con valores prefijados.
- Resumen y mapa estiman ingresos a $9.500 por persona cuando falta recaudación.
- La ocupación usa sesiones iniciadas en una hora, no el intervalo durante el cual la mesa estuvo ocupada.
- El horario operativo se supone en ocho horas diarias.
- Los promedios no informan cuántas sesiones completaron cada fase.
- El cierre de cobro/estado puede fallar silenciosamente porque varios `catch` ignoran la excepción.
- El ingreso real no se copia de forma consistente desde pagos/órdenes hacia `OccupancySession.totalRevenue`.

## Hallazgo de permisos

`scripts/route-matrix.json` declara `POST /v1/tables/:id/close-session` como MANAGER, pero la ruta usa `verifyStaffToken`. Debe decidirse la política correcta y hacer coincidir código, matriz y pruebas. No se debe “arreglar” sólo el manifiesto sin resolver quién tiene autoridad para liberar una mesa.


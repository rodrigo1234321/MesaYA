# E23 — Guía de ejecución presencial

Estado: `NOT_RUN` / `PENDING_HUMAN`. Este documento prepara la prueba, pero no
es evidencia de que haya sido ejecutada ni habilita un `GO`.

## Alcance seguro

- Usar una fixture/tenant y mesas de prueba dedicadas. No usar clientes reales,
  tarjetas, dinero real ni la carga mutante E22 contra producción.
- Registrar el SHA y la URL exacta del entorno antes de cada ronda. La release
  cloud actualmente publicada es `163c1cc4be43afcb2f5402ac4eaaaa6698dde95a6`;
  verificar que el entorno de prueba corresponda al código observado.
- Equipamiento mínimo: una PC con mouse/teclado, una tablet vertical, dos
  puestos de staff cuando estén disponibles, un puesto de cocina y un teléfono
  para QR/NFC. Preparar también papel y lápiz para el fallback.
- Participantes: tres operadores representativos, incluyendo al menos una
  persona sin experiencia previa en MesaYA. El observador no guía cada click;
  sólo explica la consigna y registra lo ocurrido.

## Dos rondas

Ejecutar la misma matriz en dos rondas por participante/dispositivo. En cada
escenario anotar `PASS`, `FAIL` o `BLOCKED`, sin corregir silenciosamente el
resultado entre rondas.

| Ronda | Participante | Dispositivo/puesto | Escenarios | Evidencia |
|---|---|---|---|---|
| 1 | O1/O2/O3 | PC, tablet, staff/cocina | S01–S20 y S29 aplicables | tiempos, errores, ayuda, captura/nota |
| 2 | O1/O2/O3 | mismos equipos, orden equivalente | S01–S20 y S29 aplicables | tiempos, errores, ayuda, captura/nota |

La prueba debe incluir explícitamente: llamado y atención física, cambio de
operador, dos mozos sobre el mismo llamado, tablet vertical, teclado/mouse,
avisos mientras se está en Más/Cocina, caída y recuperación de API/red,
comanda/impresión y recepción manual, QR, NFC si el equipo lo soporta, pedido,
cocina, entrega, cuenta, cobro sintético y cierre. Si una variante no está
disponible, marcarla `BLOCKED` con causa; no sustituirla por una afirmación.

## Hoja de medición

Para cada tarea conservar:

`participante | ronda | escenario | dispositivo | inicio | fin |
interacción_ms | caminata_s | espera_s | ayuda (sí/no) | errores |
resultado | observación`

Separar el tiempo de mirar/interactuar en la terminal de caminata, atención
física y espera por acceso al puesto. Registrar especialmente mesa equivocada,
actor equivocado, permiso incorrecto, doble pedido, doble cobro, pérdida de
llamado, falso conectado y cualquier dato que obligue a inventar un estado.

## Gate de cierre

E23 sólo puede pasar a `VERIFIED_LOCAL`/`G-HUMANO` si la evidencia presencial
demuestra, como mínimo:

1. al menos 90% de tareas esenciales completadas sin ayuda en la segunda ronda;
2. cero errores de mesa, atribución, permiso, doble pedido o cobro;
3. S01 dentro de 5 s y S02 dentro de 10 s de interacción como metas, reportando
   aparte caminata y espera;
4. entrega conocida en no más de dos acciones de negocio, sin eliminar la
   confirmación monetaria;
5. mejora de al menos 25% de la mediana de interacción frente al baseline cuando
   el baseline sea medible;
6. tablet usable a zoom 200%, controles esenciales accesibles y una ráfaga de
   diez minutos sin que la espera de terminal o la comanda rompa el servicio.

Un error crítico bloquea el gate aunque los promedios de tiempo sean buenos.
Emitir una subficha de ajuste y repetir sólo los escenarios afectados; no
marcar PASS por promedio ni por una captura aislada.

## Evidencia y privacidad

Guardar el formulario firmado por el responsable, capturas o grabación cuando
corresponda, matriz de resultados, SHA, URLs y notas de fallback. No guardar
PINs, tokens, headers, connection strings, nombres completos innecesarios ni
datos de clientes. El responsable operativo debe completar la decisión final:

`responsable | fecha | ronda aceptada | incidencias abiertas | decisión
GO/NO-GO | firma o identificación`

Hasta que esta hoja tenga datos observados y una decisión identificable, E23
permanece `NOT_RUN` / `PENDING_HUMAN`.

# Etapa 02 — Métricas confiables

## Objetivo

Mostrar hechos medidos, separar estimaciones y explicar por qué una métrica cambia o todavía no tiene datos.

## Contrato de datos

Cada métrica debe devolver:

- valor o `null`;
- unidad;
- `sampleCount`;
- rango temporal y zona horaria;
- fuente de eventos;
- calidad `MEASURED`, `ESTIMATED` o `UNAVAILABLE`;
- razón cuando es `UNAVAILABLE`.

## Trabajo

1. Sustituir 8/22/38/12/6 por `null` cuando una fase no tiene muestras.
2. Devolver muestras separadas para cada fase; una sesión incompleta no contamina otras fases.
3. Calcular ocupación por intersección del intervalo `[seatedAt, vacatedAt/now]` con cada franja horaria.
4. Definir horarios operativos configurables o calcular sólo sobre intervalos abiertos de turno.
5. Usar cobros/órdenes reales para revenue. Si se conserva una proyección, etiquetarla y mostrar fórmula.
6. Renombrar rating promedio; implementar NPS sólo con pregunta 0–10 y fórmula de promotores menos detractores.
7. Eliminar 5.0 cuando no hay feedback y el rating fijo 5 al enviar comentario privado.
8. Retirar “viajes ahorrados” hasta definir un evento comparable o presentarlo como hipótesis explícita.
9. Alinear zona horaria `America/Buenos_Aires` en turno, filtros y agrupaciones.
10. Agregar diagnóstico de cobertura de eventos y sesiones atascadas.

## Pruebas

- Cero sesiones: todo N/D, nunca valores plausibles prefijados.
- Sesiones parciales y completas con timestamps controlados.
- Sesión cruza dos horas y dos días.
- Turno abierto en rango “Hoy”.
- Cobro real, reembolso futuro y ausencia de revenue.
- Diferencia entre rating 1–5 y NPS 0–10.

## Aceptación

Un manager puede abrir el detalle de cualquier número y ver fuente, período y cantidad de muestras. Repetir un ciclo de mesa cambia sólo las métricas correspondientes.


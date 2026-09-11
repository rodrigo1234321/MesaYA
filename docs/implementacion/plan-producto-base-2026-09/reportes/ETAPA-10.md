# Reporte de etapa 10 — Analytics medidos y explicables

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado

- Se agregó un contrato común de calidad para analytics: valor, unidad, período, timezone, muestra, fuente y calidad (`MEASURED`, `PARTIAL`, `NO_DATA`, `ESTIMATED`).
- El resumen RTMS calcula horas operativas sólo desde turnos reales; dejó de asumir ocho horas por día.
- Revenue y RevPASH usan pagos conciliados (`APPROVED` o `MANUAL_SETTLED`) y no un ticket promedio inventado.
- Tiempos de fases, duración, ocupación y rendimiento por mesa devuelven cero con `NO_DATA` cuando no hay eventos medidos, junto con advertencias accionables.
- El mapa de calor separa sesiones observadas de revenue por pagos y conserva metadatos por celda.
- El panel administrativo ya no muestra una calificación 5/5 ni “viajes evitados” como si fueran mediciones cuando no hay muestra.

## Verificación

| Verificación | Resultado |
|---|---|
| calidad en período vacío, sin estimaciones | 1/1 PASS |
| FSM + analytics RTMS | 12/12 PASS |
| contrato de métricas de llamados/feedback | incluido en build y tipos |
| build shared | PASS |
| build API | PASS |
| build admin dashboard | PASS; warnings conocidos de comentarios de Zod |

## Límite conocido

La hora local de los buckets del heatmap usa el runtime de la función; el contrato ya expone el timezone de la instancia y la normalización completa por zona queda cubierta en la certificación PostgreSQL de las etapas 20–21. No se consultaron Supabase ni Vercel remotos.

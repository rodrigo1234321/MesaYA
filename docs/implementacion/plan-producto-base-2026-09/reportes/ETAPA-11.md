# Reporte de etapa 11 — Sommelier seguro y generación de carta

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Implementado y verificado

- La recuperación parte exclusivamente de ítems activos/disponibles del restaurante.
- Las restricciones de alergias se abstienen y derivan al personal; sin promesas de ausencia de alérgenos o contaminación cruzada.
- Sin TACC, vegano y vegetariano se resuelven por etiquetas verificadas, diferenciando vegano estricto de vegetariano.
- Se agregó parsing determinístico de presupuesto y se rechazan recomendaciones fuera del límite o sin coincidencias disponibles.
- Las respuestas incluyen las restricciones aplicadas y si el maridaje es genérico/degradado; IDs de Gemini fuera del catálogo o fuera del presupuesto no pasan al cliente.
- Gemini continúa desactivado por defecto; cuando se habilite sólo entrega una respuesta estructurada validada y la generación de carta permanece en vista previa con revisión humana obligatoria.

## Verificación

| Verificación | Resultado |
|---|---|
| contención IA existente | 25/25 PASS |
| presupuesto dentro del catálogo | 1/1 PASS |
| presupuesto sin coincidencias | 1/1 PASS |
| build shared | PASS |
| build API | PASS |

## Límite conocido

La activación de Gemini requiere una clave/configuración por instancia y un set de evaluación de calidad antes de habilitarla. No se habilitó ningún proveedor externo ni se enviaron credenciales.

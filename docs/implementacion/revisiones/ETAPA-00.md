# Revisión Codex — Etapa 00: Inventario y punto de recuperación

Fecha: 2026-09-03  
Veredicto final: **APPROVED**

## Evidencia revisada

- [Reporte del ejecutor](../reportes/ETAPA-00.md)
- [Manifiesto SHA-256](../evidencia/00-baseline.json)
- [Ficha de la etapa](../etapas/00-base-segura.md)
- Estado Git efectivo y hashes actuales del filesystem

Se confirmó que `git rev-parse --show-toplevel` desde el proyecto devuelve `C:/Users/rodri`; el proyecto no tiene `.git` propio. El índice del repositorio padre muestra el árbol completo como no seguido, por lo que no ofrece una comparación histórica útil y no se debe usar para staging.

Se verificaron los 259 registros del manifiesto. Sus 223 entradas ajenas a `docs/implementacion/` coinciden hoy con SHA-256; no se observó cambio en código de aplicación, schemas, scripts ni configuración de producto incluida en esa parte del baseline. Los dos `.env.example` son ejemplos públicos y su inclusión no expone valores de `.env` privados.

## Hallazgo

### [P3] El manifiesto no es reproducible al finalizar la propia ficha

El manifiesto incluye archivos de proceso bajo `docs/implementacion/`, incluido `CONTROL.md`, pero registra el hash anterior a la transición a `NEEDS_REVIEW`. Al verificarlo tras la entrega hay un mismatch únicamente en `docs/implementacion/CONTROL.md`.

Esto no altera código ni datos y no invalida el inventario técnico, pero incumple el criterio de «manifiesto reproducible» si se presenta como estado final. Además, cada cambio legítimo de estado/revisión volvería a invalidarlo.

## Corrección solicitada (misma etapa)

1. Ajustar el generador/manifiesto para excluir los artefactos mutables del flujo (`docs/implementacion/CONTROL.md`, `reportes/`, `revisiones/` y, preferentemente, todo `docs/implementacion/`). Mantener los archivos del producto y la documentación de producto que corresponda al baseline.
2. Regenerar `evidencia/00-baseline.json` con el nuevo alcance y actualizar el reporte: cantidad final, exclusiones exactas y que `.env.example` público sí puede estar incluido mientras `.env` privado queda excluido.
3. Reejecutar la verificación de todos los hashes del manifiesto contra el estado final y adjuntar el resultado (0 faltantes, 0 mismatches, 0 secretos privados).
4. Mantener etapa 00; no inicializar Git, no tocar aplicación ni ejecutar builds/tests/bases. Volver a `NEEDS_REVIEW` y detenerse.

## Decisión Git

Se acepta la necesidad de un repositorio propio para trazabilidad, pero no se autoriza `git init` dentro de esta revisión: es una mutación de alcance distinto y se decide explícitamente antes de la primera etapa que vaya a crear commits. Mientras tanto, el manifiesto aislado es la evidencia de partida.

## Revisión de la corrección [P3]

El manifiesto regenerado contiene 223 entradas. Se verificaron todas contra el filesystem actual: 223 hashes coincidentes, 0 faltantes y 0 mismatches. Las rutas usan `/`; no incluye `docs/implementacion/`, `.env` privados ni bases de datos. Los ejemplos públicos `.env.example` permanecen permitidos.

## Resultado

Etapa 00 aprobada. Se conserva la restricción de no inicializar Git ni modificar el repositorio padre. La etapa 01 permanece bloqueada hasta autorización expresa de Rodrigo para continuar.

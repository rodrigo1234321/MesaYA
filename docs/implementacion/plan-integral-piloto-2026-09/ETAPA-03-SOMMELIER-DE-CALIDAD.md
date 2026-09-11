# Etapa 03 — Sommelier de calidad

## Objetivo

Recomendar productos reales que satisfagan la intención del cliente y abstenerse cuando la carta no permite una respuesta segura.

## Preparación de carta

Agregar datos estructurados por producto: categoría, ingredientes, alérgenos declarados, restricciones, intensidad, tamaño/porción, picante, contiene alcohol, tipo de bebida, maridajes válidos y disponibilidad. Los datos dietarios siguen requiriendo confirmación del personal.

## Motor

1. Crear una capa de recuperación determinística que filtre restricciones duras antes de rankear.
2. Rankear por intención, categoría, términos, tags, precio y diversidad; no devolver siempre el primer destacado.
3. Hacer que “sin X” excluya X y que “sin alcohol” prohíba maridajes alcohólicos.
4. Entregar IDs exactos y verificar cada afirmación contra los datos del ítem.
5. Si Gemini está disponible, usar salida estructurada y sólo permitir que el modelo elija candidatos recuperados.
6. Si se usa heurístico, marcar `degraded: true` y explicar el límite sin presentarlo como IA completa.
7. No usar modelos por defecto que puedan estar retirados; validar modelo configurado al iniciar y exponer estado operativo al admin.
8. Registrar métricas sin guardar texto sensible: motor, latencia, candidatos, abstención y feedback útil/no útil.

## Set de evaluación inicial

Al menos 20 consultas versionadas, incluyendo:

- liviano y sin alcohol;
- con IPA;
- hamburguesa sin bacon;
- opción económica;
- vegetariano, vegano y sin TACC;
- alergia severa;
- para compartir;
- bebida sin comida;
- producto inexistente;
- consulta ambigua que requiere pregunta aclaratoria.

Cada caso declara productos permitidos, prohibidos y si debe abstenerse. La aceptación exige cero productos prohibidos y un umbral de relevancia acordado de al menos 90%.

## PAUSA B

Rodrigo revisa las 20 respuestas en Preview. No se promueve por tests automáticos solamente.


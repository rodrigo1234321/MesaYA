# Protocolo de trabajo acotado — Antigravity / Codex

## 1. Contexto mínimo

Trabajar sólo en C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas. Leer task.md, este protocolo, CONTROL y la ficha habilitada. Después leer únicamente los archivos/funcciones que esa ficha necesita y su reporte/revisión previos si existen.

No cargar repomix-output.xml completo, todo el roadmap ni todos los skills a cada intento. Si una instrucción local aplicable requiere skill/recurso, leerla y usar sólo lo relevante. El código es fuente de verdad: rutas nuevas indicadas como NUEVO son propuestas, no archivos existentes.

Las rutas de las fichas son relativas a la raíz de este proyecto. Resolverlas allí, nunca desde C:/Users/rodri.

## 2. Reglas de ejecución

1. Confirmar etapa READY y predecesora APPROVED en CONTROL; registrar IN_PROGRESS.
2. Leer y explicar en un máximo de cinco líneas el cambio acotado y sus riesgos. Verificar firmas/rutas reales antes de editar.
3. Implementar checklist en orden, una unidad a la vez. Presupuesto orientativo: hasta seis archivos de producto + pruebas/documentación relacionadas. Si hace falta más o una decisión no prevista, detener y proponer dividir la ficha; no sacrificar tests para cumplir el número.
4. Ejecutar prueba enfocada y luego gates indicados. A partir de etapa 02: build + test:isolated; desde 23, agregar integración PG cuando toque persistencia/concurrencia. Antes de 01 no ejecutar la suite existente.
5. Tras dos intentos fallidos del mismo problema sin nueva evidencia, detener y reportar diagnóstico; no improvisar APIs ni reescribir el módulo completo.
6. Completar reporte y CONTROL en NEEDS_REVIEW; devolver resumen al usuario y PARAR.

No ejecutar fichas en paralelo ni delegar a múltiples agentes con escrituras concurrentes. No encadenar automáticamente bloques.

## 3. Permisos y datos

- Rodrigo actúa como canal entre Antigravity y Codex. Cada ficha sólo se implementa cuando Codex la deja en READY; la autorización de siguiente ficha surge de una revisión APPROVED de Codex.
- No tocar secretos reales, perfiles privados .gemini, reglas globales ni configuración de modelos.
- No ejecutar seed, db push, migrate reset ni scripts legacy contra la conexión habitual.
- Un .env existente NO autoriza usar la base que contiene para pruebas.
- No deploy, push, cobro, cuenta cloud, mensaje externo ni migración real sin autorización específica.
- No borrar cambios del usuario. Si Git apunta al home, no usar staging allí; registrar y resolver el límite antes de versionar.
- Reportar comandos, rutas y errores con secretos y datos personales redactados. No incluir contenido de .env en hashes/artefactos compartidos.

## 4. Qué prueba cada evidencia

Screenshots = aspecto visual. app.inject = contrato HTTP local. SQLite = comportamiento local. PostgreSQL con conexiones independientes = evidencia relevante para concurrencia PG. Ninguna sustituye a las otras.

No marcar PASS por compilar, por un HTTP >=400 genérico, por un mock de pago o por reutilizar un reporte anterior. Assertions de permisos comprueban status específico Y ausencia de cambios. Tests de tenant usan A/B, no un solo restaurante.

Los comandos futuros deben crearse y verificarse antes de citarse como ejecutados. No ejecutar npm test por costumbre: ahora no existe test raíz. La etapa 01 define test:isolated. No instalar herramientas o actualizar versiones fuera de alcance sin justificarlo.

## 5. Entrega

Usar [REPORTE_TEMPLATE](REPORTE_TEMPLATE.md). Marcar criterios cumplidos sólo con evidencia. Si falta prueba importante, explicar y dejar pendiente/BLOCKED, no éxito parcial disfrazado.

Mensaje final sugerido:

> Etapa NN: NEEDS_REVIEW. Archivos: [...]. Pruebas ejecutadas: [...]. No ejecutado: [...]. Riesgos: [...]. Reporte: [...]. Me detengo para revisión de Codex.

## 6. Revisión de Codex

Rodrigo dice «Revisá la etapa NN». Codex:
- Lee diff/manifiesto inicial, reporte y checklist; preserva cambios ajenos.
- Verifica seguridad y tests en entorno aislado, proporcional al riesgo.
- Registra veredicto, hallazgos por gravedad, evidencia y pendientes en revisiones/ETAPA-NN.md.
- Si hay correcciones: CHANGES_REQUESTED, con tareas de reparación acotadas.
- Si aprueba: registra APPROVED y habilita la siguiente ficha en READY, salvo que exista una decisión externa pendiente.

Si ejecutar una prueba modifica datos reales o exige nueva autoridad, no hacerlo: pedir dirección concreta.

## 7. Compatibilidad con instrucciones existentes

Se inspeccionaron ANTIGRAVITY.md, reglas globales, plantillas de _orchestration y documentos de Arquitecto/Ejecutor. Algunas plantillas anteriores sugerían continuar todo el roadmap o paralelizar. Para ESTE plan prevalece el pedido explícito actual de Rodrigo: una ficha, revisión y pausa. No se modifican esas reglas globales.

Los requisitos de diseño aplican cuando haya trabajo de diseño; estas fichas de seguridad no autorizan rediseñar interfaces. No se ha configurado ni verificado la disponibilidad del modelo nombrado por el usuario.

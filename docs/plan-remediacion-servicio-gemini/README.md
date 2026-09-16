# MesaYA — Remediación con prioridad en el trabajo del mozo

Plan preparado para Antigravity con Gemini 3.8 Flash. Fecha: 2026-09-14.
Estado coordinado al 2026-09-16: E00–E22 tienen implementación y evidencia
local documentada; E24 tiene paquete de producción preparado y verificado en
alcance local/documental. E23 y los gates cloud/humanos siguen pendientes.
Este README describe el plan; no constituye un GO de producción.

## Objetivo

Que un mozo llegue a una PC o tablet compartida, identifique qué mesa necesita atención, actúe con pocos pasos y vuelva al salón sin dudas. Corregir también autenticación, cliente, cuentas, reportes, cocina y las brechas de producción. La calidad de uso es un gate propio: un build verde no lo reemplaza.

**Prioridad de producto: servicio de salón. Prioridad de seguridad: no perder pedidos, dinero ni identidad.** Primero se diseña y prueba el recorrido del mozo; las bases técnicas necesarias se corrigen antes de conectarlo a operaciones reales.

## Base y documentación de entrada

- Base fija: `7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83`, rama local `release/pilot-1day-v1.0.0`.
- El checkout `mdpmesasvivas` está en `main` antiguo (`d932969`); contiene estos documentos, pero NO es el código a modificar.
- QA existente: `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-audit-7bcddf6`, detached en el candidato y sin cambios observados. Conservarlo como referencia.
- Para implementar, crear worktree propio desde el SHA fijado, rama `codex/servicio-remediacion`, directorio propuesto `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-servicio-remediacion`. Si ya existe, verificar base y cambios; nunca sobrescribirlo.
- Auditar como entrada los 15 H y los 12 D de `../auditoria-integral/20260914-7bcddf6/` y `../PLAN-AUDITORIA-INTEGRAL-PRODUCCION-GEMINI.md`. Son insumos, no pruebas heredadas.
- No hacer merge completo de `4c8d02f`, `07074c5` ni del admin-ux sin commit. Portar sólo comportamiento necesario y probado; preservar Ventas, contratos, cuentas y validación por excepción.

Copiar este paquete de planes al worktree de implementación antes de ejecutar; el paquete todavía no está en la release. La copia de documentos no cambia la base del código. Todas las rutas de código de las fichas son relativas al worktree de implementación.

## Leer en este orden

1. [Calibración del informe y referencias de competidores](01-EVIDENCIA-Y-COMPETIDORES.md).
2. [Contrato de experiencia de salón](02-CONTRATO-SERVICIO.md).
3. [Escenarios de aceptación](03-ACEPTACION.md).
4. [Control de etapas](CONTROL.md), luego sólo la ficha correspondiente en `etapas/`.
5. Al ejecutar, crear `reportes/E##.md`, `evidencia/E##/` y `CONTINUAR.md`. No crear resultados aprobados antes de correr las pruebas.

## Método específico para ejecutar con Gemini Flash

Una ficha = un resultado verificable. El nombre del modelo es elección del usuario: no instalar/configurar routers ni cambiar a otro modelo silenciosamente. No depender de que recuerde una conversación larga.

1. Leer CONTINUAR, control y ficha. Confirmar SHA de entrada y diff pendiente. Explicar en dos frases problema y resultado esperado.
2. Leer únicamente contratos, archivos y tests relacionados, ampliando si aparece una dependencia real. No reescribir el proyecto desde el informe.
3. Reproducir el fallo o registrar que era hipótesis/decisión de producto. En UX capturar primero recorrido real y métricas base.
4. Definir el cambio mínimo. Una etapa ideal toca un contrato o flujo; si exige varios contratos nuevos, dividir en subfichas `E##a/b` con dependencias, no improvisar un refactor masivo.
5. Implementar en la rama propia, conservar APIs o añadir compatibilidad explícita. No modificar expectativas de tests para esconder un error.
6. Ejecutar prueba del fallo + regresión relacionada. En UI navegar el flujo real con mouse y tacto emulado; screenshots preparados o inspección de strings no bastan.
7. Inspeccionar diff y emitir reporte. No autodenominarse revisor independiente. Una segunda sesión puede revisar con instrucciones críticas, pero debe distinguirse de una persona distinta.
8. Actualizar CONTINUAR antes de terminar el contexto: último SHA, archivos modificados, comandos/resultados, fixture, dudas y próxima acción exacta. No incluir secretos.

Estados: READY → IN_PROGRESS → IMPLEMENTED_NEEDS_REVIEW → VERIFIED_LOCAL. FAILED vuelve a la misma ficha. BLOCKED incluye causa reproducible; PENDING_HUMAN/PENDING_CLOUD no se convierten en PASS. Al ejecutar una ficha, no pedir aprobación por cada edición rutinaria ya habilitada. Sí conservar gates de validación antes de ampliar el alcance.

El prompt de este paquete inicia sólo E00; las siguientes fichas se pueden habilitar por bloque. Al completar una ficha autorizada, avanzar a la siguiente autorizada si sus dependencias pasan. Si falla algo, corregir esa misma ficha; no encadenar 25 etapas sin revisar resultados.

## Bloques y decisiones de avance

| Bloque | Fichas | Resultado |
|---|---|---|
| Diseño y evidencia | E00–E02 | Diagnóstico calibrado, contrato y prototipo de operación |
| Bases del puesto | E03–E08 | PG, PIN, control de abuso, identidad y sincronización confiable |
| Servicio principal | E09–E14 | Cola, mesa, tacto/mouse, cobro autorizado y cocina |
| Exactitud y superficies restantes | E15–E20 | Tickets, reportes, cliente, Admin, información de carta e impresión acotada |
| Cierre | E21–E24 | Seguridad/E2E, carga real, ensayo humano y paquete de producción |

Los bloqueos físicos/cloud no impiden preparar cambios locales independientes, pero impiden certificar ese gate. No presentar una fecha total de 10–14 horas: la auditoría no midió el esfuerzo de rediseño ni de integración. Estimar por ficha después de leer código.

## Reglas que evitan soluciones frágiles

- Nada de convertir a todos en MANAGER, suprimir límites de seguridad o dejar una sesión gerencial abierta para que el salón funcione.
- Nada de desactivar autenticación para conservar una pantalla encendida: lectura del puesto y autorización de una persona son conceptos distintos.
- Nada de arreglar cobros sólo ocultando botones. El servidor decide permiso, identidad, idempotencia, importe y estado.
- Nada de resolver cocina obligando a comprar una tercera pantalla. Con una sola pantalla debe existir entrega manual de comanda documentada; con dos, una puede ser cocina.
- Nada de borrar métricas/Ventas del dueño para simplificar el mozo. Separar las tareas por contexto y rol.
- Nada de marca automática «entregado», «cobrado» o «limpio» por seleccionar una mesa, imprimir o cerrar un modal.
- Nada de prometer impresión USB/Ethernet silenciosa desde cualquier navegador. E20 delimita alternativas; hardware nuevo es trabajo condicionado.
- Nada de publicar, hacer push/merge, migrar datos reales, instalar en el local o comprar equipos con este plan como autorización. E24 prepara un paquete concreto para aprobación posterior.

## Cobertura de todos los hallazgos

| Hallazgo de entrada | Resolución prevista |
|---|---|
| H01 migración PIN | E03, PG real desechable |
| H02 numeración concurrente | Reproducir E00; E15 y E21 |
| H03 rotación de secreto | E04 |
| H04 límite de logins válidos | E05, E07 y E22 |
| H05 cobro del mozo | Decisión de permiso granular E01; E12–E13 |
| H06 cocina | E14 + operación de una pantalla E20/E23 |
| H07 conexión/avisos | E08 + E21 |
| H08 doble toque | E17 + E21 |
| H09 medianoche | Definiciones primero; E16 |
| H10 token temporal amplio | E06/E12/E21 |
| H11 carga insuficiente | E22 |
| H12 diferencias admin | Portar selectivamente E18; no afirmar borrado histórico |
| H13 bloqueo del puesto | E06–E07/E14 |
| H14 impresora | E20: soporte delimitado y decisión de hardware explícita |
| H15 filtros carta | E19: datos confirmados, sin promesa médica |
| D06 sanitización y restos no clasificados | E21; conservar 5xx opacos y revisar 4xx |
| D12 ramas y casos heredados | E00/E17/E18; no integrar split por accidente |
| Cloud, QR/NFC, restore, costos y soporte | E23–E24; no cerrarlos sólo con documentos |

## Prompt de arranque

```text
Trabajá con el paquete docs/plan-remediacion-servicio-gemini de MesaYA.
El código base es 7bcddf6bf298f6cb15da70579fb49b9ecd7d1c83, no el main antiguo.
Leé README, 01-EVIDENCIA-Y-COMPETIDORES, 02-CONTRATO-SERVICIO, 03-ACEPTACION
y CONTROL. Ejecutá sólo E00 para preparar el worktree y calibrar evidencia.
La prioridad es que un mozo use una PC o tablet compartida de forma rápida,
clara y segura. Las siguientes fichas implementan eso paso a paso cuando
se habiliten. No simplifiques el producto eliminando capacidades esenciales.
No heredes PASS ni defectos dinámicos no demostrados del informe anterior.
Reproducí, implementá sólo la ficha habilitada, probá y dejá reporte/CONTINUAR.
No modifiques el checkout original ni el de auditoría. No publiques ni migres
datos reales. Si falta hardware o acceso cloud, registrá el gate pendiente.
```

Para continuar: «Ejecutá E## de este paquete, resolvé sus fallos y entregá su evidencia. No avances a la siguiente ficha hasta completar ésta». Para un bloque: nombrar sus IDs explícitamente.

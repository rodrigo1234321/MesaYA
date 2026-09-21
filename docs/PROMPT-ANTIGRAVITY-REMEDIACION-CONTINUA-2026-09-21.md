# Prompt para AntiGravity — Gemini 3.8 Flash

Copia el bloque siguiente en AntiGravity, con acceso a este proyecto:

```text
Actúa como ingeniero senior responsable de ejecutar y cerrar la remediación integral de MesaYA. Usa Gemini 3.8 Flash; comprueba y registra el identificador/modelo efectivo. No cambies silenciosamente de modelo o proveedor.

OBJETIVO PERSISTENTE
Corregir todos los hallazgos vigentes de las 18 secciones de ERRORES_MESAYA_COMPLETO.md, verificar las correcciones y resolver una revisión independiente. No te limites a analizar, proponer otro plan o completar la primera etapa. Continúa autónomamente hasta cumplir la condición de cierre del plan adjunto o demostrar un bloqueo externo que impida todo progreso útil.

LEE PRIMERO
1. Las instrucciones AGENTS.md aplicables.
2. C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas/docs/PLAN-REMEDIACION-AUDITORIA-ANTIGRAVITY-2026-09-21.md
3. C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas/ERRORES_MESAYA_COMPLETO.md
4. El manifiesto canónico, controles y checkpoints existentes de la línea actual de MesaYA completo.

El documento de errores mezcla defectos de un main antiguo con correcciones ya presentes en otras revisiones. Sus conteos y líneas deben revalidarse. El checkout original tiene cambios de usuario: no ejecutes git pull allí ni reset/clean. Verifica referencias, ancestros y línea canónica; crea o reanuda un candidato aislado desde la base actual de MesaYA completo. No mezcles Solo Mozos ni asumas que main es la rama productiva. Conserva la carta Fauno, cambios válidos de scroll y CORS, y toda funcionalidad operativa existente.

ORGANIZACIÓN
Inventa etapas nuevas o subdivide/reordena R00–R13 si mejora la ejecución, pero conserva todas sus dependencias, criterios de aceptación y cobertura. Crea BASELINE.md, HALLAZGOS.md, CONTROL.md, CONTINUAR.md y evidencia por etapa en docs/remediacion-auditoria-20260921/ dentro del candidato.

Inventaría y utiliza las skills y agentes que ya tengas para exploración, seguridad, React, accesibilidad, navegador, pruebas y revisión. Lee sus instrucciones y úsalos de verdad; no basta con nombrarlos. Delega tareas concretas a agentes disponibles, con archivos asignados y sin escritores concurrentes en el mismo worktree. Revisión independiente en lectura; integración y gates pesados en serie. Si no puedes lanzar agentes, avanza secuencialmente y registra la revisión independiente pendiente sin simularla. No instales herramientas o proveedores innecesarios. No uses Nodeterm sin solicitud expresa y entorno habilitado.

CICLO OBLIGATORIO
Reproducir → entender → implementar el cambio mínimo coherente → pruebas pertinentes → revisión independiente → corregir hallazgos → verificar → actualizar checkpoint → siguiente etapa habilitada.

No me preguntes si continúas después de cada etapa. No termines con “puedo seguir”, un resumen provisional o una lista de tareas que puedes ejecutar tú. No aparques deuda programable del informe como mantenimiento futuro. Si algo ya estaba resuelto o era falso positivo, demuéstralo y cierra ese ID sin reimplementar.

Corrige errores API sin filtrar message/details internos, incluyendo 4xx no confiables; añade ErrorBoundary seguro sin mostrar error.message; da feedback visible a cada acción; tipa contratos; instala/configura lint compatible; verifica código muerto antes de borrarlo; preserva sanitización XSS; resuelve accesibilidad por comportamiento real, teclado, foco, nombres y contraste. No reduzcas la tarea a agregar aria-label o pasar búsquedas de texto.

No expongas valores de secretos del informe ni de .env. No rotes claves de cifrado existentes por iniciativa propia. No debilites autenticación, guards del runner, tests o validaciones para conseguir verde. Respeta el gate JEV si las instrucciones vigentes lo exigen, sin usar probabilidades como sustituto de tests/revisión.

VERIFICACIÓN
Usa los runners y versiones instaladas. Ejecuta baseline y pruebas focalizadas, typechecks, lint, build, contratos de rutas/esquema y regresión integrada pertinente. Inspecciona scripts antes de ejecutarlos y verifica DB efímera/local. En Windows, usa el supervisor Job Object real si es obligatorio; nunca simules su presencia con una variable. Prisma y gates pesados secuenciales. Comprueba flujos en navegador y guarda evidencia sanitizada. No mates servicios o procesos ajenos.

PERSISTENCIA Y BLOQUEOS
Una etapa aprobada habilita la siguiente sin pedirme permiso. Una falla exige diagnóstico y corrección, no abandono. Dos fallos idénticos sin avance requieren cambio de estrategia. Si una etapa necesita un recurso externo, documenta el bloqueo exacto y sigue con todo trabajo independiente. Mantén CONTINUAR.md actualizado antes de perder contexto. Si la plataforma corta la sesión, deja la siguiente acción concreta para reanudar, nunca un falso “completado”. No cambies de proveedor ni gastes fuera del modelo solicitado para evitar un bloqueo.

ALCANCE AUTORIZADO
Inspección, worktree aislado, cambios locales, pruebas locales seguras, documentación, revisión y preparación de entrega. No hagas push, merge a ramas compartidas/canónicas, deploy, borrado de ramas/worktrees, migraciones/seed/reset de DB compartida, rotación de secretos reales ni mensajes a terceros. Completa primero toda la remediación local posible; si hace falta autorización externa, pide solo esa acción concreta sobre un resultado ya revisable.

CONDICIÓN DE CIERRE
Cada hallazgo tiene evidencia de FIXED_VERIFIED, ALREADY_FIXED_VERIFIED o FALSE_POSITIVE_EVIDENCED; los pendientes externos están individualizados y no cuentan como aprobados. No quedan defectos programables del alcance, los gates locales están verdes y la revisión independiente está cerrada. Entonces entrega PROGRAMMABLE_READY/PASS_LOCAL con SHA/diff exacto, tabla antes/después, pruebas y pendientes PENDING_HUMAN/PENDING_CLOUD. No declares GO global ni producción certificada por pruebas locales. Si falta un gate obligatorio, declara INCOMPLETE/BLOCKED_EXTERNAL y un checkpoint, no éxito.

Empieza ahora por R00 y R01 y continúa con la implementación hasta cumplir estos criterios. Tu responsabilidad es entregar la remediación comprobada, no simplemente describir cómo hacerla.
```

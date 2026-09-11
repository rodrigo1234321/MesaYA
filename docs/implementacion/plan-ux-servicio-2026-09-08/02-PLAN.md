# Plan de ejecución: cliente, servicio compartido y administración

Fecha: 2026-09-08. Estado: IMPLEMENTACIÓN LOCAL EJECUTADA; cierre técnico y límites externos registrados en `03-VERIFICACION-Y-CONTROL.md` (§48 en adelante).

Documento previo obligatorio: [Análisis](01-ANALISIS.md). Control de resultados: [Verificación y control](03-VERIFICACION-Y-CONTROL.md).

## 1. Organización y reglas

37 etapas pequeñas, agrupadas por responsabilidad: 7 de base transaccional, 8 de cliente, 11 de staff/cocina, 5 de administración y 6 de integración/entrega. La base cruza los tres paneles y se corrige antes de dar por buena su presentación.

La secuencia no es terminar todo el cliente y recién después descubrir que staff interpreta otra cosa. Se ejecutan contratos compartidos primero y se conectan pantallas mediante cortes verificables.

Orden recomendado:

1. B00–B06: establecer evidencia y corregir cuenta, cobros y concurrencia.
2. C01–C08: simplificar cliente y conectar historial/cuenta al contrato probado.
3. S01–S11: reemplazar navegación de módulos por trabajo de servicio y cocina.
4. A01–A05: corregir sincronización y configuración preservando plano/QR.
5. V01–V06: probar recorridos completos, carga operativa, regresión y entrega.

Se pueden preparar los bocetos C01 y S01 después de B01, sin adelantar su aprobación funcional. No se ejecutan simultáneamente tareas que cambien el mismo contrato o base de pruebas.

### Método obligatorio por etapa

1. Leer el análisis, estado y cambios locales; delimitar archivos propios.
2. Registrar hipótesis y prueba que detecta el defecto. Para un cambio visual, capturar antes y definir tarea de usuario.
3. Implementar el cambio mínimo coherente; no mezclar rediseños ajenos.
4. Ejecutar pruebas dirigidas y el pequeño recorrido integrado afectado.
5. Registrar comandos, resultado, capturas y limitaciones; revisar errores de consola/red cuando corresponda.
6. Aprobar solo con evidencia. Si falla una invariancia, corregir antes de acumular más etapas.

Reversión común: conservar cambios previos del usuario y revertir únicamente el parche de la etapa, nunca un reset amplio. Migraciones requieren estrategia de compatibilidad y recuperación; no borrar registros para hacer pasar pruebas. Flags visuales temporales no pueden reactivar el contrato de cuenta conocido como incorrecto.

No hacen falta aprobaciones humanas rutinarias entre etapas técnicas. Sí se detiene una acción que requiera nueva autoridad, destrucción de datos o una decisión operativa sin alternativa segura. Publicación, push y creación de recursos quedan fuera de este ciclo local.

## 2. Base transaccional compartida

### B00 — Congelar una línea base reproducible

- Trabajo: identificar checkout/commit y cambios existentes; inventariar procesos y comandos locales sin detener servicios ajenos; registrar versiones, seed y capacidades efectivas. Leer scripts de ejecución antes de usarlos.
- Entregable: ficha de arranque y cobertura existente, capturas del cliente/staff/admin, listado de fallos conocidos separado de fallos nuevos.
- Verificación: arranque reproducible y una pasada de baseline acotada; health, carta pública, login de personal y encargado. Guardar comandos reales, no inventados.
- Aceptación: se sabe qué se probó y qué datos se pueden mutar. Dependencia: ninguna. Reversión: sin cambios funcionales.

### B01 — Contrato de ocupación, tandas y cuenta

- Trabajo: definir estados incluidos/excluidos, pendientes de validación, totales, pagos, propina, versión, cierre y acceso con sesión vencida. Identificar tipos y consumidores existentes.
- Entregable: contrato de cuenta compartido y tabla de transiciones con invariantes; política de precios y dinero exacto.
- Verificación: revisar ejemplos de tres rondas, borrador, cancelación, pago parcial, saldo cero y nueva ocupación con los tres consumidores.
- Aceptación: cada cantidad tiene un significado único; carrito no se convierte en cuenta. Dependencia: B00. Reversión: conservar compatibilidad de rutas mientras migran consumidores.

### B02 — Reproducción automatizada del importe parcial

- Trabajo: crear fixture aislado con varias tandas; reproducir que la consulta actual devuelve último pedido o borrador. Cubrir cliente y caja, no solo sumar arrays fabricados.
- Entregable: pruebas de regresión que fallen por el defecto identificado, con importes esperados y registros verificables.
- Verificación: demostrar fallo antes de la corrección y explicar por qué; no adaptar el esperado al comportamiento roto.
- Aceptación: el test distingue historial acumulado de último pedido y excluye borradores. Dependencia: B01. Reversión: fixtures aislados, sin reset del seed que usa el usuario.

### B03 — Proyección autorizada de cuenta por sesión

- Trabajo: implementar lectura agregada en API, tipos compartidos y permisos; conservar consulta de carrito. Excluir cancelados, separar pendientes y registrar pagos válidos.
- Entregable: contrato consumible por cliente/caja, con versión y detalle por tanda; compatibilidad documentada.
- Verificación: B02 pasa; probar otra mesa, otra sesión y acceso sin autorización; mismo total en consultas equivalentes de cliente y personal.
- Aceptación: tres rondas suman correctamente; un borrador nuevo no cambia consumo; no hay fuga de cuentas. Dependencia: B02. Reversión: cambio compatible y aislado, no migración destructiva.

### B04 — Liquidación presencial coherente por cuenta

- Trabajo: normalizar cobro del saldo de sesión con validación de versión, permisos e idempotencia. Reutilizar registros de pagos existentes sin duplicarlos. Mantener parciales como camino secundario si están soportados.
- Entregable: operación de liquidación y conciliación que no depende de bucles del navegador. Propina separada. Método presencial no implica integración digital.
- Verificación: dos intentos iguales, dos terminales lógicos simultáneos, respuesta perdida, saldo cambiado y permiso insuficiente; comparar ledger y respuesta.
- Aceptación: dinero se registra una vez; nunca saldo negativo por carrera; conflicto devuelve una salida entendible. Dependencia: B03. Reversión: no eliminar pagos reales ni reinterpretar históricamente su importe.

### B05 — Estados agregados y liberación segura

- Trabajo: revisar marcado de mesa pagada, `hasUnpaidBalance`, borradores y cierre de sesión. Separar «pagada» de «disponible». Definir tratamiento explícito de carrito no enviado.
- Entregable: guardas consistentes con la cuenta y transición final confirmada por personal.
- Verificación: pagar una tanda con otra pendiente no libera; token vencido no borra deuda; nueva ocupación no hereda consumo; unir mesas no fusiona cuentas accidentalmente.
- Aceptación: solo se libera sin saldo y con resolución explícita de pendientes relevantes. Dependencia: B04. Reversión: preservar deuda y auditoría ante incertidumbre.

### B06 — Envíos, reintentos y carreras

- Trabajo: verificar idempotencia real de submit, stock/precios y concurrencia de carrito; resolver pedido nuevo contra cuenta solicitada/cobro/cierre; devolver errores accionables.
- Entregable: reglas de arbitraje de servidor y respuestas de recuperación que usarán los paneles.
- Verificación: doble clic, timeout tras commit, dos comensales editando, stock agotado entre lectura y submit, cambio de precio y cuenta cobrada simultáneamente.
- Aceptación: no se duplican tickets ni se acepta consumo huérfano; cambios concurrentes no se pisan silenciosamente. Dependencia: B05. Reversión: cambios aditivos, conservación del estado recuperable.

**Gate G1:** cuenta y caja comparten verdad; pruebas de múltiples rondas y carreras pasan. Sin G1 no se declara corregido el problema del cobro.

## 3. Cliente

### C01 — Jerarquía y boceto de tareas

- Trabajo: diseñar inicio, carta, carrito, historial y cuenta en móvil; comprobar etiquetas sin términos internos. Mantener contexto de mesa/local.
- Entregable: boceto con Carta como acceso principal, tres acciones grandes y carrito como única acción del encabezado; vistas sin sesión y sin pedido.
- Verificación: simular localizar carta, llamar y pedir cuenta a 360 px; comprobar que decoración no empuja todas las acciones hacia abajo.
- Aceptación: una acción tiene una ubicación principal clara; no hay carrusel comercial sustituto. Dependencia: B01. Reversión: boceto sin cambios de runtime.

### C02 — Limpiar inicio y ampliar controles

- Trabajo: eliminar sección/renderizado de platos estrella y Ver Carta del header; reorganizar acciones y reducir hero si impide la jerarquía aprobada. Limpiar listeners y referencias huérfanas.
- Entregable: inicio implementado con controles táctiles grandes y estados habilitado/deshabilitado explicados.
- Verificación: todos los accesos principales abren el flujo correcto; ningún listener falla al faltar un nodo; comparación visual antes/después.
- Aceptación: cero duplicación de Ver Carta en encabezado y ausencia real de sección estrella. Dependencia: C01. Reversión: parche visual localizado, sin cambiar catálogo.

### C03 — Carta blanca y tipografía legible

- Trabajo: establecer fondo blanco, contraste, escala tipográfica, precios y disponibilidad; categorías navegables; quitar scrolls anidados innecesarios.
- Entregable: lista y categorías legibles con fotos faltantes, platos largos y distintos precios.
- Verificación: 360/390/768 px, zoom 200%, teclado y nombres extensos; no overflow horizontal de página ni precios tapados.
- Aceptación: lectura relevante respeta objetivos del análisis o registra una excepción justificada con captura; ninguna información depende solo del color. Dependencia: C02. Reversión: estilos acotados a cliente.

### C04 — Detalle y carrito como borrador

- Trabajo: cantidades, notas, nombre de comensal, disponibilidad y total de borrador claramente diferenciados del consumo; conservar contexto al volver. Tratar conflictos colaborativos.
- Entregable: edición sin pérdida accidental y confirmación inequívoca de envío.
- Verificación: editar desde dos sesiones de navegador; volver a categoría/posición; texto largo; eliminar último ítem; stock fallido conserva el resto.
- Aceptación: no se cobra por añadir al carrito y no se sobrescribe cambio ajeno silenciosamente. Dependencias: C03, B06. Reversión: contrato de carrito compatible.

### C05 — Historial y estados de los envíos

- Trabajo: separar pendientes, enviado y entregado; historial por ronda con lenguaje cliente; recuperación de envío incierto.
- Entregable: vista «Tus pedidos» o equivalente integrada al recorrido sin crear otra navegación dominante.
- Verificación: tres tandas y una nueva en borrador; validación requerida y directa; rechazo parcial según contrato; reapertura de navegador.
- Aceptación: el cliente puede distinguir qué falta enviar y qué ya recibió el sistema. Dependencias: C04, B03. Reversión: no alterar estados de cocina por presentación.

### C06 — Cuenta completa y solicitud presencial

- Trabajo: migrar `loadBillDetails` al contrato de cuenta; mostrar consumo, pagos, saldo y propina por separado. Informar que elección de método solicita atención, no procesa pago.
- Entregable: cuenta acumulada conectada a la misma verdad que caja; renderizado seguro de nombres/notas.
- Verificación: matriz financiera completa; prueba de texto potencialmente inyectable; pedir cuenta dos veces; una ronda nueva tras solicitarla.
- Aceptación: nunca se presenta únicamente el último envío como total; borrador excluido y versión actualizada visible. Dependencias: C05, B04. Reversión: no volver silenciosamente a endpoint parcial.

### C07 — Llamados e insumos con seguimiento

- Trabajo: confirmación por motivo, pendiente/en atención/resuelto/cancelado, tiempos y limitación de duplicados. Separar distintos motivos de una misma mesa.
- Entregable: estados claros y sincronizados con personal; cancelación segura si la tarea ya fue tomada.
- Verificación: dos motivos simultáneos, doble toque, cancelar mientras se toma, reconexión y resolución desde terminal.
- Aceptación: el cliente sabe si la solicitud llegó; no desaparece otra necesidad al resolver una. Dependencias: C02, B06. Reversión: conservar historial y semántica de API.

### C08 — Accesibilidad, sesión y fallos

- Trabajo: foco, escape/volver, teclado, zoom, lectura de estados y errores; sesión inactiva/vencida sin bloquear carta; recuperación tras suspensión del teléfono.
- Entregable: cliente robusto y lista de excepciones visuales reales, no supuestas.
- Verificación: red caída al enviar y al pedir cuenta; refresh y back; sesión cerrada por personal; sin imágenes; zoom 200%; lector de pantalla básico si herramienta disponible.
- Aceptación: no hay callejones sin salida ni afirmaciones de éxito no confirmadas; navegación accesible comprobada en el alcance disponible. Dependencias: C03–C07. Reversión: mantener mensajes seguros aunque falle recuperación automática.

**Gate G2:** inicio simple, carta legible y cuenta completa; recorrido móvil de varias rondas pasa. La estética por sí sola no aprueba el gate.

## 4. Staff y cocina en terminal compartido

### S01 — Boceto operativo de una pantalla

- Trabajo: distribuir cola de atención, mapa compacto y preparación visible; detalle de mesa contextual. Comparar vista de servicio con foco de cocina sin perder pendientes.
- Entregable: boceto con 22 mesas y una ráfaga de tareas, no una maqueta vacía. Documentar hipótesis física del terminal compartido.
- Verificación: tareas simuladas a 1024×768 y 1366×768; localizar llamado, plato listo y cuenta sin cambiar cinco pestañas.
- Aceptación: toda necesidad activa tiene señal independiente del scroll del mapa; cocina no queda invisible. Dependencia: B01. Reversión: diseño previo al reemplazo de pantallas.

### S02 — Proyección única de trabajo pendiente

- Trabajo: combinar llamados, validaciones, preparación lista y cuentas solicitadas en un modelo de atención; definir IDs estables, fuente y acciones válidas.
- Entregable: proyección API/tipos o composición segura sobre fuentes existentes, con coherencia temporal y pruebas. Evitar polling duplicado por cada tarjeta.
- Verificación: una mesa con varias necesidades conserva todas; eventos repetidos no crean tareas nuevas; estados terminales no reaparecen.
- Aceptación: cada tarjeta representa un trabajo real y tiene dueño/origen verificable. Dependencias: B06, S01. Reversión: preservar fuentes originales, no duplicar entidades innecesariamente.

### S03 — Toma de tareas, prioridad y estabilidad

- Trabajo: implementar «Me ocupo», reasignación/resolución autorizadas, prioridad por tipo y antigüedad; evitar saltos bajo el dedo.
- Entregable: tareas con responsable y resultado de conflicto visible; agrupación por mesa sin esconder motivos.
- Verificación: doble toma desde dos clientes lógicos, resolución/cancelación concurrente, pendientes antiguos durante ráfagas nuevas.
- Aceptación: una sola toma efectiva; no inanición de tareas y ningún clic se aplica a una tarjeta que cambió de lugar. Dependencia: S02. Reversión: no perder asignaciones existentes.

### S04 — Servicio y mapa compacto

- Trabajo: reemplazar jerarquía de cinco tabs por Servicio, cola principal y mapa contextual; reutilizar posiciones sin permitir edición accidental. Mantener acceso a cocina.
- Entregable: terminal usable con 22 mesas, sectores y nombres largos; estados comprensibles sin color como único indicador.
- Verificación: todas las tareas alcanzables sin explorar mesas una por una; redimensionar; tabla sin coordenadas; sectores llenos.
- Aceptación: no hay caja de 208 px como único acceso al trabajo; mapa y pendientes no compiten con igual densidad. Dependencias: S01–S03. Reversión: conservar componentes previos temporalmente sin exhibir doble navegación.

### S05 — Mesa como contexto de acción

- Trabajo: detalle de mesa con pendientes, cuenta, historial y «Agregar pedido»; mover carga manual fuera de dependencia conceptual de pestaña Cocina.
- Entregable: pedido del mozo entra al mismo circuito y cuenta que pedido QR, con origen y actor auditados.
- Verificación: cargar manualmente y luego desde cliente; mismo plato en ambas tandas; cierre del detalle y regreso preserva contexto.
- Aceptación: no se crean cuentas paralelas por canal y una acción frecuente no exige buscar en varios módulos. Dependencias: S04, B03. Reversión: conservar compatibilidad de pedidos existentes.

### S06 — Recepción y preparación de cocina

- Trabajo: integrar tickets, validación cuando aplique y listo para entregar; mantener resumen persistente al operar Servicio. Definir qué confirma recepción efectiva.
- Entregable: flujo completo en equipo único, con foco de cocina opcional y advertencia/documentación si requiere transmisión humana por ubicación física.
- Verificación: pedido directo y validado mientras se atiende un llamado; tickets largos; nuevas tandas; alguien usa cuenta mientras cocina recibe trabajo.
- Aceptación: ningún ticket aceptado depende de abrir una pestaña sin señal; «listo» genera trabajo de entrega una sola vez. Dependencias: S04, S05. Reversión: no marcar preparación/recepción retrospectivamente por inferencia.

### S07 — Quitar clics redundantes, conservar confirmaciones reales

- Trabajo: conectar hechos del sistema con estados derivados; entregar resuelve tarea correspondiente. Separar pagada, por limpiar y disponible; retirar botones de avance ciego donde no representan una acción real.
- Entregable: tabla final de acciones humanas y automáticas implementada y auditada.
- Verificación: entregas parciales, dos motivos en mesa, pagar antes de entregar, tarea cancelada y confirmación repetida.
- Aceptación: menos pasos sin afirmar hechos físicos no confirmados; métricas conservan significado. Dependencias: S03, S06, B05. Reversión: no recalcular historia física a partir de estados actuales.

### S08 — Caja dentro de la mesa

- Trabajo: mostrar cuenta por ocupación, saldo y cobros; método/propina aislados por cuenta; autorización sensible visible; camino normal «Cobrar saldo».
- Entregable: caja contextual sin tarjetas separadas por cada tanda ni selector global contaminando otra mesa.
- Verificación: tres rondas, pago parcial existente, propina, reintento, versión cambiada, permiso insuficiente y conciliación posterior.
- Aceptación: coincide con C06 y B04; una respuesta perdida no duplica dinero; cobro no equivale a mesa disponible. Dependencias: S05, B04, C06. Reversión: preservar ledger; no ofrecer antiguo cobro ambiguo como atajo.

### S09 — Identidad del terminal y del operador

- Trabajo: revisar selección rápida de actor, expiración y privilegios; reautorizar acciones sensibles sin cerrar toda operación de servicio; no reutilizar permisos de encargado de forma invisible.
- Entregable: política UI/API consistente y auditoría de actor frente a terminal.
- Verificación: cambio de mozo, credencial inválida, permiso vencido a mitad de acción, refresh, regreso tras inactividad y operación sin privilegio.
- Aceptación: acciones sensibles no dependen de confianza en frontend; acciones comunes no exigen login completo repetido. Dependencias: S03, S08. Reversión: ante duda conservar restricción, nunca ampliar permisos automáticamente.

### S10 — Señales y recuperación confiables

- Trabajo: centralizar refrescos cuando corresponda; propagar fallos para backoff; antigüedad de datos, audio activado/bloqueado y señales de eventos nuevos.
- Entregable: terminal que se recupera tras suspensión/red sin recargar manualmente ni duplicar tareas.
- Verificación: ráfaga de eventos, corte de 30 s, servidor reiniciado, pestaña suspendida, audio bloqueado y respuesta HTTP fallida.
- Aceptación: sin tormenta de polling/sonido; tareas recuperadas; no falso «conectado» con datos viejos. Dependencias: S04, S06, S08. Reversión: conservar señal de desconexión y modo manual documentado.

### S11 — Funciones secundarias sin ruido

- Trabajo: trasladar fila/rewards a acceso secundario según capacidades; retirar teléfono/consentimiento comercial del camino obligatorio de cobro; preservar servicios existentes.
- Entregable: navegación reducida y explicación de capacidades ausentes, sin enlaces muertos.
- Verificación: activar/desactivar cada módulo en fixture; servicio sigue funcionando; permisos y acceso directo; historial anterior accesible cuando corresponde.
- Aceptación: funciones opcionales no bloquean pedido, entrega ni cobro; no se habilitan por guardar otra opción. Dependencias: S09, S10. Reversión: recuperar acceso secundario sin volver a sobrecargar inicio.

**Gate G3:** recorrido cliente–servicio–cocina–cobro funciona con un terminal simulado. Recepción física en cocina sigue pendiente hasta comprobar el lugar real.

## 5. Administración conservadora

### A01 — Borrador del plano protegido

- Trabajo: separar geometría editada y snapshot operativo; proteger posiciones pendientes, resolver conflicto de versión y conservar cambios tras error de guardado.
- Entregable: edición que no vuelve atrás al polling sin congelar estados de servicio.
- Verificación: mover mesa y esperar varios ciclos; otro operador cambia estado/posición; fallo de guardado; cancelar borrador.
- Aceptación: no se pierde trabajo local silenciosamente; conflicto se explica. Dependencia: B00. Reversión: conservar datos persistidos y borrador recuperable.

### A02 — Configuración en lenguaje operativo

- Trabajo: expresar modo carta/llamados, validación o directo; explicar capacidad disponible/configurada/efectiva y restricciones. Vincular modo directo con circuito de recepción documentado.
- Entregable: configuración coherente entre API, cliente y staff; ninguna opción bloqueada sin razón visible.
- Verificación: combinaciones de modos, guardado de sección no relacionada y actualización con sesión activa; misma política en todos los paneles.
- Aceptación: flags bloqueados se preservan; no se promete integración inexistente. Dependencias: B01, C08, S11. Reversión: guardar representación compatible sin habilitar capacidades nuevas.

### A03 — Editor de carta y vista previa coherente

- Trabajo: legibilidad del editor, etiquetas/precios/stock y vista previa que refleje C03; no rediseñar catálogo entero.
- Entregable: el dueño entiende cómo verá el cliente los datos que cambia.
- Verificación: nombre largo, sin foto, plato agotado, cambio de precio con pedidos existentes y categoría vacía.
- Aceptación: nuevo catálogo visible, historial conserva precios contratados. Dependencias: C03, B06. Reversión: cambios de presentación sin migración arbitraria de datos.

### A04 — Contenedores y regresión de mesas/QR

- Trabajo: corregir truncados críticos y scrolls anidados prioritarios; preservar creación de mesas, sectores, enlaces y descarga QR.
- Entregable: estados completos y controles alcanzables; cambios de layout limitados a problemas demostrados.
- Verificación: viewport de tablet/escritorio, zoom, nombre largo, descarga y navegación de URL QR a mesa correcta; unión/movimiento no rompe enlace.
- Aceptación: no se degrada lo que el usuario considera logrado. Dependencias: A01, A03. Reversión: estilos localizados, no regeneración de identificadores/links.

### A05 — Métricas y promesas veraces

- Trabajo: revisar eventos modificados por el nuevo circuito; separar medido/estimado/no disponible; corregir textos como garantías no demostradas. No agregar nuevos dashboards.
- Entregable: mapa de procedencia de métricas afectadas y limitaciones visibles.
- Verificación: recorrido determinista contra eventos; no doble conteo por reintento ni duración de entrega inferida por pago.
- Aceptación: métricas no condicionan clics innecesarios y no presentan estimaciones como mediciones. Dependencias: S07, S08, A02. Reversión: mostrar no disponible antes que inventar valores.

**Gate G4:** plano estable, QR preservado y configuración explica la operación real.

## 6. Integración y entrega

### V01 — Recorridos completos automatizados

- Trabajo: ejecutar matriz compartida desde navegador → API → datos → respuesta; cliente y terminal abiertos simultáneamente, en ambos modos de atención.
- Entregable: pruebas de tres rondas, atención, cocina, cobro y nueva ocupación con evidencia por transición.
- Verificación: no mocks como única prueba; cotejar totales/estado persistidos; consola y requests; repetición con fixture limpio.
- Aceptación: todos los escenarios críticos pasan de extremo a extremo. Dependencias: G1–G4. Reversión: si falla, reabrir etapa causal, no parchear test para ocultarlo.

### V02 — Servicio concurrido y fallos inducidos

- Trabajo: simular 22 mesas, varias necesidades, pedidos y cobros concurrentes; red lenta, desconexión y respuestas perdidas en momentos críticos.
- Entregable: evidencia de no pérdida/duplicación y registro de latencias/carga con umbrales justificados por entorno.
- Verificación: matriz de carreras y alarmas; pendientes siguen encontrables; no monopolizar Windows con procesos sin límite.
- Aceptación: cero discrepancias financieras y cero tareas desaparecidas; degradación señalizada. Dependencia: V01. Reversión: bajar alcance de carga sin presentar prueba reducida como estrés aprobado.

### V03 — Revisión visual y accesible de conjunto

- Trabajo: recorrer todas las vistas modificadas con contenido realista, errores, vacíos y muchos datos; comprobar tipografía y scroll.
- Entregable: capturas comparables y checklist por resolución de cliente, staff y admin.
- Verificación: 360×800, 390×844, tablet 768×1024 y 1024×768, escritorio 1366×768; zoom 200% y teclado. Emulación no equivale a dispositivo físico.
- Aceptación: ninguna acción crítica queda tapada, ilegible o inaccesible; no controles pequeños introducidos por excepción accidental. Dependencia: V01. Reversión: corregir el componente responsable, no bajar arbitrariamente la escala global.

### V04 — Regresión y arranque de base limpia

- Trabajo: correr suites relevantes/builds y después campaña integral; validar setup sobre entorno aislado sin borrar trabajo del usuario; respetar scripts y límites de procesos del repo.
- Entregable: comandos reproducibles, resultados y requisitos de arranque. Verificar paridad de esquema PostgreSQL si cambió persistencia; restaurar cliente Prisma correspondiente antes de pruebas SQLite.
- Verificación: instalación/seed/arranque con pasos documentados; no secretos en archivos; configuración por instancia; QR y módulos no afectados siguen funcionando.
- Aceptación: baseline sin regresiones no justificadas; el usuario puede abrir las tres interfaces y repetir los casos. Dependencias: V02, V03. Reversión: aislamiento de datos, nunca reset del entorno de demostración sin alcance explícito.

### V05 — Evaluación de tareas y límite humano

- Trabajo: medir pasos y tiempo para encontrar un pendiente, tomarlo, entregar y cobrar; simular usuario nuevo. Si hay personas disponibles, observar cliente y personal sin guiarlos clic a clic.
- Entregable: comparación antes/después y lista de dudas reales. Objetivo inicial: localizar pendiente en cinco segundos y acceder a detalle desde Servicio en un toque; son hipótesis a validar, no resultados prometidos.
- Verificación: no ocultar clics de identidad/permisos al contar; probar cocina mientras alguien usa caja; documentar colocación física pendiente.
- Aceptación: simulación aprobada se distingue de estudio humano. Si faltan participantes/dispositivo, marcar pendiente externo y continuar entrega técnica, no inventar aprobación. Dependencias: V02, V03.

### V06 — Entrega y dictamen por alcance

- Trabajo: consolidar control, instrucciones locales, links verificados, cuentas de prueba documentadas de forma segura y recorrido de demostración; archivar evidencia sin secretos.
- Entregable: GO/NO-GO local, limitaciones humanas/físicas/cloud y backlog secundario separado. Confirmar que base sigue clonable por local, sin crear proyectos remotos.
- Verificación: repetir smoke final con servidores disponibles; revisar diff propio y documentación; todos los bloqueantes tienen estado y evidencia.
- Aceptación: no queda pendiente crítico escondido tras «todo listo». GO local requiere G1–G4, V01–V04 y simulación V05; producción/operación física no se certifican solo con eso. Dependencias: V04, V05.

## 7. Qué queda explícitamente fuera

- Implementar una pasarela digital o división automática de pagos.
- Ampliar IA, rewards, upselling o métricas para compensar problemas del servicio.
- Cambiar la arquitectura a multi-tenant centralizada o aprovisionar nube durante esta revisión.
- Rehacer el plano del dueño, sustituir QR correctos o exigir NFC físico.
- Prometer reducción de empleados sin medir un servicio real.

La aprobación técnica de este plan no habilita automáticamente funciones opcionales. Primero el núcleo sencillo y correcto; después, cada función demuestra que agrega valor sin complicarlo.

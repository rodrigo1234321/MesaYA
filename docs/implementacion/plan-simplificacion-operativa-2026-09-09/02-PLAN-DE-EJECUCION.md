# Plan de ejecución — simplificación operativa

Fecha: 2026-09-09  
Estado: listo para revisión; no iniciado  
Regla: ninguna etapa se aprueba sólo por compilar o por una captura

## Orden y dependencias

El plan tiene 16 etapas (E00–E15). Primero protege la frontera entre ocupaciones y unifica contratos; luego simplifica la pantalla del mozo; finalmente mejora el cliente y valida el recorrido completo.

### E00 — Baseline reproducible

**Depende de:** nada.  
**Entrega:** checkout, commit, cambios preexistentes, base efímera, datos, URLs y comandos de prueba documentados. Inventario de flujos heredados `payOrder/getCashOrders` y de todas las rutas que crean, resuelven o cierran sesiones.  
**Prueba:** builds, typecheck y suites focales actuales; recorrido grabado y conteo de clics antes del cambio.  
**Aprobación:** se puede repetir el baseline sin tocar una base real y se distinguen fallos preexistentes.

### E01 — Contrato canónico de ocupación, cuenta y roles

**Depende de:** E00.  
**Entrega:** decisión técnica escrita sobre `TableSession`, cuenta por sesión, propietario de cada estado, política de PIN, modos de cocina y catálogo de excepciones. Deprecación explícita del cobro por comanda como camino normal.  
**Prueba:** revisión de arquitectura contra rutas, DTO, FSM y esquema; no puede haber dos comandos con semántica contradictoria.  
**Aprobación:** cliente, staff y API usan las mismas definiciones de cuenta, ocupación y cierre.

### E02 — Endurecer la rotación de sesión y QR

**Depende de:** E01.  
**Entrega:** toda creación/reemplazo de sesión usa los mismos guardas: deuda, borrador, revisión, llamado y carrera concurrente. Token viejo revocado al cerrar. Durante `TO_CLEAN` no se entrega sesión operativa ni datos anteriores. El QR físico conserva slug/mesa.  
**Prueba:** token viejo 410; intento de crear sesión con pendientes 409; dos intentos simultáneos producen una sola ocupación; nueva ocupación obtiene id/token nuevos y cuenta cero.  
**Aprobación:** ningún camino alternativo puede cerrar silenciosamente o reutilizar una ocupación anterior.

### E03 — Comando atómico de cierre operativo

**Depende de:** E02.  
**Entrega:** comando idempotente `settle-and-close` o equivalente que revalida versión, registra pago, cierra sesión, revoca token, transiciona a `TO_CLEAN` y genera tarea de limpieza. Opción separada para pagar y continuar en mesa.  
**Prueba:** respuesta perdida/reintento no duplica pago; pago concurrente con nueva ronda falla de forma segura o incorpora la ronda; con deuda o borrador no hay cierre parcial.  
**Aprobación:** no depende de una cadena frágil de llamadas del navegador y deja auditoría completa.

### E04 — Proyección única de Servicio

**Depende de:** E01.  
**Entrega:** snapshot único que incluya cola, mapa, cocina, cuentas y contexto detallado. Las tareas de pedido llevan platos, cantidades, participantes, notas, alérgenos, total, antigüedad y `reviewReason`.  
**Prueba:** contrato y tenant isolation; payload grande/nota larga; una sesión vieja no reemplaza una nueva; la cuenta coincide con cliente y ledger.  
**Aprobación:** la vista cotidiana no requiere consultar `getKitchenOrders` o `getCashOrders` para comprender un pendiente.

### E05 — Validación por excepción

**Depende de:** E01 y E04.  
**Entrega:** pedidos normales confirmados y despachados a cocina por servidor; `REVIEW_REQUIRED` sólo por una regla identificada. Configuración conservadora y auditable.  
**Prueba:** uno y dos gin disponibles pasan sin tarea; una alergia/restricción ya contemplada por la carta queda como contexto visible sin confirmación adicional; stock, umbral y modo manual generan revisión con motivo; aceptar/rechazar es idempotente; nunca se cobra un pedido rechazado.  
**Aprobación:** cada revisión responde “qué ocurre y por qué hace falta una persona”.

### E06 — Reclamo implícito y acciones de una intención

**Depende de:** E04.  
**Entrega:** el botón principal reclama y actúa atómicamente; los estados técnicos no exigen clic adicional. En conflicto, se muestra operador y estado actualizado.  
**Prueba:** dos terminales actúan sobre la misma tarea: uno gana y el otro no duplica; no hay reintento ciego ante 409.  
**Aprobación:** llamado simple y revisión excepcional requieren una sola acción normal.

### E07 — Shell de mozo en una sola pantalla

**Depende de:** E04 y E06.  
**Entrega:** Servicio es la pantalla inicial y única del trabajo diario. Encabezado compacto, cola priorizada, cocina visible, mapa compacto y panel de mesa. Caja, Rewards, fila y administración dejan de ser pestañas primarias.  
**Prueba:** 1024×768 y móvil/tablet acordados; 22 mesas y múltiples pendientes; navegación por teclado; axe; estado sin red/stale.  
**Aprobación:** el mozo encuentra el siguiente pendiente en menos de 5 segundos sin cambiar de pantalla.

### E08 — Cocina integrada con propiedad explícita

**Depende de:** E05 y E07.  
**Entrega:** estados `por revisar`, `en preparación` y `listo` visibles en Servicio. Una estación KDS puede tener vista foco, pero comparte contrato/eventos. Cocina marca `READY`; el mozo sólo lo hace en modo compartido configurado.  
**Prueba:** pedido directo aparece en cocina; `READY` crea/actualiza una sola tarea de retiro; reconexión no duplica tarjetas ni sonidos.  
**Aprobación:** no se confunde “enviado” con “visto” ni “preparando” con “listo”.

### E09 — Retiro/entrega con una sola acción operativa

**Depende de:** E08.  
**Entrega:** `Me lo llevo` reclama el plato y registra el hito operativo; ofrece deshacer/corregir durante una ventana corta. No obliga al mozo a volver al terminal para una segunda confirmación rutinaria.  
**Prueba:** doble mozo no retira lo mismo; deshacer recupera el pendiente; excepción de entrega se registra sin alterar otras tandas.  
**Aprobación:** un plato listo requiere una acción del mozo y conserva trazabilidad honesta.

### E10 — Cobro y cierre dentro de la mesa

**Depende de:** E03 y E07.  
**Entrega:** cuenta acumulada, método, propina, pagos y saldo en el panel de mesa. Acciones `Cobrar y cerrar` y `Registrar pago y mantener mesa`; reautorización de encargado inline cuando aplique. Guardas visibles, no errores genéricos.  
**Prueba:** tres rondas, pago parcial si está habilitado, propina separada, versión obsoleta, permiso insuficiente y reintento.  
**Aprobación:** el mozo no abre Caja ni Admin; cliente y staff muestran los mismos importes.

### E11 — Limpieza y siguiente ocupación

**Depende de:** E03 y E10.  
**Entrega:** tarea priorizada `Mesa X · pagada · falta limpiar`; acción física `Mesa lista` lleva `TO_CLEAN → AVAILABLE` y prepara la nueva sesión vacía. El escaneo intermedio no expone la ocupación anterior; el siguiente escaneo resuelve esa sesión ya preparada.  
**Prueba:** cobrar/cerrar, escanear durante limpieza, marcar lista y escanear desde dos dispositivos; sesión y cuenta nuevas.  
**Aprobación:** el recambio normal tiene dos intenciones humanas: cobrar/cerrar y confirmar limpieza; la segunda deja listo el QR siguiente sin paso adicional de Caja/Admin.

### E12 — Cliente permanece en la carta

**Depende de:** E01.  
**Entrega:** agregar cierra sólo el detalle, conserva categoría/scroll y actualiza toast + mini-carrito. El carrito se abre voluntariamente e incluye `Seguir eligiendo` y `Agregar otra ronda`.  
**Prueba:** tres platos distintos, edición de cantidad, producto agotado, red interrumpida, zoom 200 % y 360 px.  
**Aprobación:** ningún agregado abre el carrito automáticamente y enviar sigue siendo una confirmación explícita.

### E13 — Colaboración comprensible, sin prometer división digital

**Depende de:** E12.  
**Entrega:** nombre de participante como dato separado de notas; cada persona ve quién agregó cada línea; copy de borrador compartido. Mensaje honesto sobre cuenta por mesa. Diseño del contrato futuro de división, sin activarlo.  
**Prueba:** dos dispositivos y nombres distintos; actualización concurrente; XSS; privacidad; notas de cocina intactas.  
**Aprobación:** colaboración funciona sin exponer identificadores técnicos ni mezclar identidad con cocina.

### E14 — Sugerencias contextuales y no persistentes

**Depende de:** E12.  
**Entrega:** fuente en último ítem, exclusión de productos ya agregados/no disponibles, máximo dos sugerencias, límite por borrador y descarte persistente en la sesión. Fallo del motor no afecta el pedido.  
**Prueba:** aceptar, descartar, reabrir, nueva ronda, producto agotado y motor deshabilitado.  
**Aprobación:** una sugerencia descartada no reaparece y el bloque desaparece cuando deja de ser relevante.

### E15 — Verificación integral y piloto observado

**Depende de:** E05–E14.  
**Entrega:** matriz automatizada completa, recorrido E2E cliente–mozo–cocina–cobro–limpieza–cliente nuevo, medición de clics/tiempo y revisión independiente.  
**Prueba:** ver `03-PRUEBAS-Y-GATES.md`.  
**Aprobación:** todos los gates locales en verde y riesgos restantes explícitos. El piloto real conserva su propio GO/NO-GO.

## Reglas de ejecución

- una etapa no modifica archivos de etapas posteriores salvo contrato imprescindible;
- cada etapa comienza con prueba que reproduce el problema y termina con diff revisado;
- no sumar cuentas en frontend: usar siempre la proyección de servidor por sesión;
- no eliminar idempotencia, control de versión, aislamiento de tenant ni auditoría para reducir clics;
- no afirmar hechos físicos por temporizador;
- no reactivar pagos o división digital mediante flags;
- preservar cambios preexistentes del checkout compartido;
- cambios de esquema serán aditivos, con paridad SQLite/PostgreSQL y migración reversible;
- si una decisión pendiente cambia el contrato, detener sólo las etapas dependientes, no todo el plan.

## Gates intermedios

| Gate | Etapas | Condición |
|---|---|---|
| G-A Seguridad de ocupación | E00–E03 | sesión anterior imposible de heredar; cobro/cierre idempotente |
| G-B Verdad operativa | E04–E06 | snapshot, cuenta y excepciones coherentes; concurrencia segura |
| G-C Mozo simple | E07–E11 | una pantalla, cocina/cobro integrados, recambio claro |
| G-D Cliente fluido | E12–E14 | carta continua, colaboración clara, upsell acotado |
| G-E Integral local | E15 | E2E completo, accesibilidad, build y revisión independiente |

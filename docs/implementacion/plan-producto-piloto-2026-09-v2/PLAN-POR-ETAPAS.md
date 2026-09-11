# Plan extenso por etapas

Cada etapa es una ficha independiente. Se implementa, reporta, revisa y detiene antes de habilitar la siguiente.

## Carril P — piloto obligatorio

### P00 — Cierre de producto y baseline

**Objetivo:** congelar alcance, reglas y evidencia inicial.

**Trabajo:** aprobar las decisiones D01–D10; mapear los IDs funcionales a UI/API/datos/pruebas; capturar build, suite aislada, matriz de rutas y estado de Preview; registrar qué datos reales no deben tocarse; definir severidades y responsables operativos.

**Pruebas/evidencia:** commit base, worktree limpio o cambios ajenos inventariados, builds de los cuatro artefactos, suites existentes, health y smoke no destructivo.

**Aceptación:** el YAML de alcance está aprobado; cada capacidad tiene destino `PILOT_REQUIRED`, `PILOT_BETA`, `LATER` o `BLOCKED`; no hay una decisión funcional pendiente que cambie arquitectura.

**No incluye:** cambios de producto ni despliegue.

### P01 — Verdad de capacidades y configuración

**Objetivo:** que ninguna pantalla prometa una capacidad que no puede completarse.

**Trabajo:** registro de capacidades con estado y dependencias; ocultar/deshabilitar pago digital, split, fila pública, pre-order y Rewards; hacer efectivas las banderas reales; retirar textos SSE si el transporte es polling; resolver `syncSocialCart`; alinear permiso de cierre de sesión con D07; diagnóstico visible por módulo.

**Casos:** configuración incompatible rechazada; módulo sin dependencia explica el motivo; flags de otro tenant no afectan al actual; admin y cliente muestran el mismo estado.

**Aceptación:** cero toggles decorativos; `paymentMode` del piloto es presencial; matriz de rutas y pruebas de permisos pasan.

**Pausa:** revisión funcional de todas las tarjetas de configuración.

### P02 — Caja presencial y cierre de deuda

**Objetivo:** cerrar una cuenta desde la UI del personal sin llamadas manuales a la API.

**Trabajo:** pantalla Mesa/Cuenta; detalle de comandas y total; efectivo, tarjeta y QR presencial; propina cero/predefinida/personalizada; confirmación; idempotencia estable; comprobante interno; auditoría; permisos manager/rol de caja; copia de revenue real a ocupación; recuperación ante error parcial.

**Casos:** cobro correcto; doble toque; rol no autorizado; importe desactualizado; orden no servida; cuenta ya pagada; propina inválida; error entre pago y FSM; cierre con deuda.

**Aceptación:** una operación repetida no duplica transacción; orden, pago, ocupación y mesa concuerdan; todo error es visible y accionable.

### P03 — Ciclo E2E y colaboración de mesa

**Objetivo:** validar el núcleo completo con dos comensales y tres roles del local.

**Trabajo:** carrito compartido según D08; identidad por nombre; snapshot al enviar; validación obligatoria del mozo; estados de cocina; llamados con deduplicación/cancelación; pedir cuenta; cobro; liberación; invalidación del token; reconexión y polling.

**Guion:** QR → sesión → dos nombres → carta → carrito simultáneo → comanda → validación → cocina → servido → llamado → cuenta → cobro → liberar → reingreso nuevo.

**Casos adversos:** dos envíos simultáneos; producto sin stock; sesión vencida; pérdida de red; refresh en cada estado; staff de otro tenant; cierre forzado con motivo.

**Aceptación / PAUSA A:** recorrido en Preview sin consola, SQL ni herramientas manuales. Cero pérdida de líneas, duplicados o estados imposibles.

### P04 — Métricas confiables

**Objetivo:** hacer que cada número pueda explicarse desde eventos observados.

**Trabajo:** contrato `value/unit/sampleCount/range/timezone/source/quality`; eliminar defaults; fases con muestras independientes; ocupación por intervalo; revenue cobrado; rating 1–5; NPS sólo si existe encuesta; RevPASH medido; sesiones atascadas y cobertura de eventos; vista separada para simulaciones si se conserva alguna.

**Casos:** cero datos; sesión parcial; sesión completa; cruce de hora/día; turno abierto; pagos múltiples; datos faltantes; zona Buenos Aires; un evento duplicado.

**Aceptación:** repetir un ciclo modifica sólo métricas relacionadas; cero muestras muestra N/D; el detalle permite rastrear fuente y período.

### P05 — Sommelier beta seguro

**Objetivo:** validar el diferenciador sin poner en riesgo el servicio.

**Trabajo:** enriquecer catálogo; filtros duros; ranking; presupuesto; maridaje existente; alcohol/no alcohol; abstención por alergia/datos; Gemini opcional limitado a candidatos; fallback rotulado; kill switch; telemetría sin texto sensible.

**Evaluación:** conjunto versionado de al menos 30 consultas con permitidos, prohibidos y abstención esperada. Debe incluir sin TACC, vegano, alergia severa, sin alcohol, presupuesto, compartir, picante, bebida, inexistente y ambiguo.

**Aceptación / PAUSA B:** cero producto prohibido, 90% o más de relevancia, 100% de IDs existentes y disponibles. Revisión humana. Si falla, se desactiva; no bloquea P06.

### P06 — Preparación física QR/NFC

**Objetivo:** producir soportes correctos y un entorno repetible para el local.

**Trabajo:** URLs canónicas definitivas; generador sin valores históricos; QR SVG/local; nomenclatura de mesas; tags apropiados; guía de grabación y bloqueo; inventario; cuenta manager/mozo/cocina; datos piloto suficientes; matriz de teléfonos/redes; hoja de incidentes; rollback documentado.

**Casos:** iPhone/Android; QR/NFC; Wi-Fi/datos; doble lectura; turno cerrado; sesión anterior; etiqueta dañada o mesa incorrecta.

**Aceptación:** cada soporte resuelve local/mesa correctos sin token persistente; existe forma de reemplazarlo y rastrear versión.

### P07 — Ensayo general en salón

**Objetivo:** ejecutar el servicio completo sin clientes reales ni dinero productivo.

**Trabajo:** roles reales o simulados; al menos tres mesas; pico de llamados/comandas; cambios de stock; pérdida de red; cobro presencial de prueba; liberación; cierre de turno; lectura de métricas; incidente y recuperación.

**Bloqueantes NO-GO:** fuga entre tenants, doble cobro registrado, pérdida/duplicación de comanda, liberación con deuda sin override, token cerrado operativo, QR/NFC incorrecto, imposibilidad de recuperación o backup/restauración no ensayado.

**Aceptación / PAUSA C:** acta PASS/FAIL por paso, incidentes clasificados y riesgos residuales aceptados por responsable de producto y operación.

### P08 — Release agrupado del piloto

**Objetivo:** promover artefactos compatibles con rollback rápido.

**Trabajo:** misma revisión para API/cliente/staff/admin; migraciones forward-compatible; smoke de Preview; registro de deployment IDs; promoción API compatible, paneles y cliente; activación de flags al final; smoke de alias; rollback ensayado.

**Aceptación:** cuatro artefactos compatibles, CORS/variables correctos, versión visible, deployment anterior recuperable. El GO humano es explícito y separado de la aprobación técnica.

### P09 — Observación y cierre del piloto

**Objetivo:** decidir con evidencia si continuar, corregir o retroceder.

**Ventana mínima:** 48 horas técnicas y varias ventanas reales de servicio; no cerrar sólo por tiempo calendario.

**Observar:** salud/latencia; errores por flujo; edad de snapshots; sesiones atascadas; llamados; tiempos de validación; comandas por estado; cobros presenciales; cobertura analytics; uso/abstención del Sommelier; incidentes y recuperación.

**Salida:** informe `GO_EXPAND`, `CONTINUE_PILOT`, `ROLLBACK` o `STOP`; backlog priorizado por impacto y frecuencia; decisión separada para cada etapa E.

## Carril E — evolución posterior, no bloqueante

### E01 — Propinas, reseñas y upselling medible

Completar porcentajes configurables, reseña con Place ID válido y upsell consumido por el cliente. Instrumentar impresión, aceptación, ticket incremental y opt-out. Desactivar cualquier bloque que no mida su efecto.

### E02 — Fila virtual pública

Diseñar ingreso, contacto/consentimiento, estado, estimación no engañosa, aviso, llamado, no-show, asignación atómica de mesa y eventual pre-order seguro. Probar múltiples hosts llamando/sentando el mismo grupo.

### E03 — Mercado Pago en sandbox

ADR de integración vigente; credenciales test; intención con snapshot; centavos enteros; idempotencia; webhook validado; consulta server-to-server; estados pendiente/rechazado/aprobado; conciliación; recuperación serverless; UI que nunca aprueba por callback del navegador.

**Gate:** cuentas vendedor/comprador de prueba y cero dinero real. Producción requiere otra aprobación.

### E04 — División de cuenta

Sólo después de E03. Partes iguales y por unidades/ítems; claims temporales; locks/transacciones PostgreSQL; versionado; expiración; redondeo; suma invariante; tres teléfonos concurrentes. Monto libre queda fuera de la primera versión.

### E05 — Rewards

Definir identidad y privacidad; ledger inmutable; reglas versionadas; acreditación por pago confirmado; reversión; saldo; vencimiento; canje atómico; fraude/abuso; soporte. No reactivar la calculadora existente como si fuera un programa real.

## Riesgos transversales

| Riesgo | Control |
|---|---|
| Función visible pero inoperante | Registro de capacidades y test de contrato UI/API |
| Estados divergentes | Transacciones, idempotencia y pruebas de recuperación |
| Datos piloto contaminados | Entornos y bases desechables; no seed sobre la conexión habitual |
| Métricas plausibles pero falsas | Calidad y muestra obligatorias; N/D ante ausencia |
| IA inventa o contradice restricciones | Recuperación determinística, abstención y kill switch |
| Release parcial | Promoción agrupada por revisión y rollback registrado |
| Alcance vuelve a crecer | Carriles P/E y aprobación independiente por etapa |


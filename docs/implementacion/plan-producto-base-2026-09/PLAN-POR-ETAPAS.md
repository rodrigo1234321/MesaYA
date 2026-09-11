# Plan maestro por etapas

Las etapas entregan código base, no instalaciones específicas. Cada una termina en revisión antes de comenzar la siguiente.

## Bloque A — contrato y plataforma

### Etapa 00 — Baseline y contrato de producto

Inventariar cada C/P/A/T en interfaz, API, datos, permisos, operación y pruebas. Aprobar estados objetivo, invariantes y recorridos. Congelar baseline de builds, rutas, schema, tests y entorno de referencia. Crear matriz de trazabilidad requisito → prueba.

**Salida:** ninguna función se declara completa sólo por aparecer; backlog y criterios son verificables.

### Etapa 01 — Registro real de capacidades

Crear capability registry con dependencias y estados. Hacer que configuración, API y clientes consuman el mismo contrato. Impedir combinaciones incoherentes y retirar toggles decorativos. Añadir diagnóstico que explique credencial, dato, migración o módulo faltante.

**Pruebas:** combinaciones válidas/inválidas, aislamiento, defaults de instalación y degradación segura.

### Etapa 02 — Modelo single-codebase / single-instance

Implementar modo de restaurante único por instancia sin retirar aislamiento por tenant. Resolver restaurante raíz, bloquear enumeración/cambio de tenant y definir metadatos de versión/instancia. Crear manifiesto de configuración sin secretos.

**Pruebas:** base con un restaurante, intento de segundo restaurante, recurso ajeno, slug inválido y migración desde el modo actual.

### Etapa 03 — Provisioning y ciclo de vida de una instancia

Evolucionar `bootstrap-restaurant.ts` hacia instalación declarativa e idempotente. Separar migración, bootstrap, importación y verificación. Agregar preflight, PIN temporal, rotación, backup/restauración, manifiesto de salida, health profundo y teardown sólo para entornos desechables.

**PAUSA A:** instalar dos instancias desechables desde cero con configuraciones distintas y demostrar que una actualización se aplica sin copiar código.

## Bloque B — operación central

### Etapa 04 — Terminal compartido e identidad del actor

Implementar registro/revocación de terminal, modos `SALON_SHARED/KITCHEN/CASHIER`, selección rápida de mozo, PIN por nivel de riesgo, expiración, cambio de actor y auditoría. Migrar el panel que hoy persiste un único `mesaya_staff_token` a este contrato.

**Pruebas:** tres mozos, un terminal, actor correcto, sesión expirada, usuario desactivado y acción sensible.

### Etapa 05 — Mesas, turnos, QR y NFC definitivos

Cerrar FSM de mesa/ocupación/limpieza; autoridad normal y force-close; URL canónica; token rotativo; generador físico sin datos históricos; reingreso; unión de mesas; sectores/capacidad; origen de acceso medido sólo si puede verificarse.

**Pruebas:** turnos concurrentes, deuda abierta, QR/NFC viejo, iPhone/Android y dos redes.

### Etapa 06 — Carta, sesión, carrito y envío

Completar catálogo, stock, etiquetas, notas, identidad grupal, carrito social y snapshots. Definir modificación después del envío. Validación de stock/precio en servidor, idempotencia y política configurable de validación del mozo o envío directo.

**Pruebas:** dos comensales, producto agotado, precio cambiado, doble submit, refresh, sesión vencida y modo sin ordering.

### Etapa 07 — Centro de salón y llamados

Diseñar bandeja compartida global con sectores, prioridades, temporizador, sonido, conexión, claim/reasignación atómica, estados y cancelación. Integrar mozo/insumos/cuenta y ownership visible. No ocultar tareas por el actor autenticado.

**Pruebas:** dos mozos toman el mismo llamado, reconexión, deduplicación, escalado por edad y acción de otro sector.

### Etapa 08 — Comandas, KDS y carga por staff

Unificar pedidos de comensal y mozo en una misma tubería. Completar validación, preparación, listo, servido, cancelación y recuperación. Mostrar errores de transición, historial y actor. Optimizar KDS para pantalla dedicada y modo combinado.

**Pruebas:** pedidos simultáneos, parcial agotado, cancelación, reimpresión/refresh, cambio de actor y orden fuera de secuencia.

### Etapa 09 — Caja presencial y cierre operativo

Crear pantalla de cuenta/caja, efectivo, tarjeta y QR presencial, propina, ajustes autorizados, comprobante interno, idempotencia y revenue real. Sincronizar pago, orden, ocupación, mesa y cierre de turno de manera recuperable.

**PAUSA B:** recorrido completo QR/NFC → caja → liberar mesa con tres mozos sobre una pantalla compartida.

## Bloque C — experiencia e inteligencia

### Etapa 10 — Analytics medidos y explicables

Contrato común con valor, unidad, período, timezone, muestra, fuente y calidad. Eliminar defaults plausibles; revenue real; ocupación por intervalo; tiempos por fase; rating versus NPS; RevPASH; mapa de calor; rendimiento; diagnósticos de cobertura. Proyecciones separadas.

**Pruebas:** cero datos, parciales, cruces de día, turnos abiertos, duplicados, correcciones y datasets conocidos.

### Etapa 11 — Sommelier seguro y generación de carta

Datos estructurados de ingredientes/restricciones/maridajes; recuperación determinística; presupuesto; diversidad; abstención; salida estructurada; Gemini configurable; fallback explícito; costos, latencia y evaluación versionada. Generación de carta requiere borrador, validación humana y nunca publicación directa.

**Gate:** cero recomendación prohibida, IDs disponibles y revisión humana de un set amplio por tipo de restaurante.

### Etapa 12 — Upselling coherente y medible

Relaciones de complemento configurables, sugerencias contextuales en carta/carrito/cuenta, límites de frecuencia y stock. Instrumentar impresión, aceptación, descarte, venta incremental y grupo control. No usar recomendaciones genéricas como evidencia.

### Etapa 13 — Propinas, feedback y reseñas

Porcentajes configurables, cero/monto libre, asociación a pago, reversión y reporte. Rating interno real, comentario privado, NPS opcional separado y Google Review sólo con Place ID válido. Consentimiento y momentos de solicitud no invasivos.

**PAUSA C:** prueba de coherencia de experiencia desde pedido hasta feedback y métricas.

## Bloque D — módulos de expansión completos

### Etapa 14 — Fila virtual y pre-order

Pantalla pública de ingreso, consentimiento/contacto, tamaño, preferencias, estado, estimación explicada, aviso, no-show, llamada y asiento atómico. Pre-order se asocia a identidad/reserva y sólo se convierte en comanda al sentar según regla definida.

### Etapa 15 — Opción Mercado Pago informativa

En la release base solicitada, esta etapa se reduce a una opción informativa configurable: el local puede marcar `WAITER_ONLY`, `DIGITAL_MP` o `HYBRID`; el cliente comunica la preferencia y el personal cobra presencialmente. La integración autónoma de Mercado Pago, si se retoma, será una etapa futura independiente.

El diseño de integración autónoma queda documentado como trabajo futuro, no como requisito de esta release: credenciales cifradas; intención con snapshot; unidades monetarias enteras; idempotencia; frontend seguro; webhook validado; consulta server-to-server; conciliación; expiración/rechazo/reintento/reembolso y diagnóstico admin.

**Gate:** no requiere sandbox ni credenciales. Dinero productivo y cualquier cobro autónomo quedan fuera de esta release.

### Etapa 16 — Cuenta dividida concurrente

Partes iguales, por cantidad/ítem y luego monto libre si se aprueba. Snapshot de deuda, claims temporales, locks PostgreSQL, expiración, redondeo, pagos parciales, propinas individuales, residuales y suma invariante.

**Pruebas:** al menos tres clientes concurrentes, webhook duplicado/tardío y cuenta modificada.

### Etapa 17 — Integraciones y hardware

Completar WhatsApp como fallback real con reglas anti-duplicado y consentimiento; generador QR/NFC por instancia; diagnóstico de enlaces; proveedores reemplazables. Integraciones sin credencial quedan no disponibles de forma limpia.

### Etapa 18 — Rewards con ledger

Identidad del cliente, consentimiento, ledger inmutable, reglas versionadas, acreditación por pago confirmado, reversión, saldo, vencimiento, canje atómico, límites de abuso y soporte. Migrar o retirar la calculadora demo.

**PAUSA D:** todos los módulos alcanzan `MODULE_STABLE` o `INTEGRATION_READY`; ninguno queda parcial y visible.

## Bloque E — producto distribuible

### Etapa 19 — Seguridad, accesibilidad y resiliencia E2E

Revisión de permisos, tenant/instance, terminales, XSS, abuso, secretos, headers, dependencias, recuperación, offline/reconexión, accesibilidad táctil/teclado, reduced motion, contraste y errores accionables. Pruebas de caos en estados críticos.

### Etapa 20 — Suite de certificación del producto

Crear fixtures y journeys automáticos para cada capacidad. Ejecutar SQLite sólo para feedback rápido y PostgreSQL desechable para garantías reales. Matriz de navegadores/dispositivos, performance y contratos API. Generar reporte por versión.

### Etapa 21 — Certificación en una instancia real

Promover una release a una instancia Supabase/Vercel autorizada por un local. Ejecutar todos los journeys con QR/NFC físicos, pantalla compartida, KDS, caja y fallos controlados. Corregir en el código base; nunca parchear sólo la instancia. Esta etapa certifica una instalación concreta y no reemplaza los gates locales del repositorio.

### Etapa 22 — Fábrica de releases e instalación por local

Versionado, changelog, migraciones compatibles, plantillas Vercel, provisioning asistido, configuración Supabase, dominios/CORS, smoke, backup, rollback, actualización por lotes e inventario de versiones instaladas. Crear runbook de alta, personalización, soporte, upgrade y baja.

**CIERRE:** clonar una release sin editar código, instalar una instancia nueva de principio a fin y dejar documentada la actualización/rollback conservando datos coherentes.

## Criterio global de terminado

- todos los C/P/A/T tienen estado objetivo y recorrido probado;
- una feature desactivada desaparece coherentemente de todos los clientes;
- pantalla compartida conserva identidad por acción;
- ninguna cifra estimada parece medida;
- pagos y Rewards tienen ledger/conciliación, no sólo UI;
- nueva instancia reproducible sin copiar la base de referencia;
- personalizaciones sobreviven actualizaciones;
- documentación coincide con la release y no con intenciones futuras.

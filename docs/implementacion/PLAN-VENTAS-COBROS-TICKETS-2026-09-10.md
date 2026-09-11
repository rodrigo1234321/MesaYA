# Plan de ventas, cobros y tickets informativos

Fecha: 2026-09-10. Estado: IMPLEMENTADO LOCALMENTE (etapas 1–5); no desplegado.

## 1. Resultado esperado

El dueño consulta cuánto se vendió, cuánto se cobró, por qué medios, qué propinas se recibieron y qué operaciones tienen comprobante fiscal asociado. Puede descargar tickets PDF y entregar un resumen diario o mensual con su detalle al contador. El registro se actualiza automáticamente al cobrar: no exige abrir caja, contar billetes ni cerrar un turno. El cierre de una mesa continúa siendo una operación independiente.

Nombre de la sección administrativa: **Ventas y cobros**. Pestañas: Resumen, Operaciones, Tickets y Comprobantes. En el panel del mozo, los tickets y pagos permanecen dentro de Cuentas, sin agregar tarjetas permanentes a la cola de atención.

La implementación local cubre el registro confiable, reportes, tickets informativos, CSV y asociación manual de comprobantes descritos en las etapas 1–5. No habilita facturación electrónica, cobros digitales automáticos ni conciliación automática con proveedores.

Verificación ejecutada el 2026-09-10: suite completa `65` archivos aprobados, `601` tests aprobados y `3` skips existentes; suite de ventas `24/24`; matriz de rutas `105`; schemas SQLite/PostgreSQL válidos y sincronizados; builds de shared, administración y mozos correctos; interfaces y health del API responden por IP local. El API que ya estaba ejecutándose no se reinició, por lo que las rutas nuevas quedan cargadas en el próximo reinicio autorizado del proceso.

## 2. Evidencia y decisiones de alcance

### MesaYA actual

- `packages/api/prisma/schema.prisma`: `AccountSettlement` registra consumo en centavos, propina aparte, método presencial, restaurante, sesión, responsable, fecha e idempotencia. `SettlementAllocation` vincula pagos con tandas. `PaymentTransaction` conserva pagos históricos por pedido, estado y referencias de proveedor.
- `packages/api/src/services/order.service.ts`: `buildSessionAccount`, `settleSessionAccount` y `settleAndCloseSessionAccount` ya proyectan cuentas, admiten pagos parciales y previenen reintentos duplicados. Los flujos nuevos deben seguir esa base; no reactivar el cobro legado por pedido.
- `packages/api/src/services/metrics.service.ts`: `callsByPaymentMethod` cuenta llamados, no importes efectivamente cobrados. No sirve como origen del informe monetario.
- El esquema actual agrupa tarjetas en `WAITER_CARD`. No se puede reconstruir débito/crédito histórico sin evidencia.
- Hay cambios locales de otros trabajos. La ejecución deberá conservarlos y comprobar la versión vigente de las rutas y contratos antes de editar.

### Referencia Control-Comercio

Investigación anterior de `C:/Users/rodri/Desktop/AI/Projects/Control-Comercio`, commit `b098433`:

- Reutilizar como referencia de experiencia: pagos desglosados, historial, exportación, plantilla térmica de 80 mm y totales por período.
- No copiar su apertura/cierre obligatorio como requisito del nuevo módulo.
- Corregir en nuestro diseño sus limitaciones observadas: PDF sin detalle de pagos mixtos, ausencia de archivo histórico inmutable del ticket, pagos de cuentas desconectados de caja y backup incompleto.
- No trasladar la actualización de deuda por precio actual a las mesas: una operación documentada conserva los importes originales.

### Investigación externa

ARCA distingue los comprobantes fiscales de los recibos que respaldan un pago. Por eso el PDF de MesaYA debe decir **“Comprobante informativo — No válido como factura”**. Conservar información para facturar no reemplaza la emisión fiscal ni autoriza a postergarla hasta fin de mes. La configuración fiscal concreta y los plazos aplicables deben verificarse para el local cuando se aborde esa integración. Fuente: [ARCA, tipos de comprobantes](https://www.afip.gob.ar/facturacion/comprobantes/tipos.asp).

Mercado Pago distingue referencia de operación, medio de pago, importe bruto, fecha de aprobación, comisiones, retenciones, neto, devoluciones y contracargos. Esto justifica guardar por separado lo registrado como cobrado y lo conciliado con el proveedor; la venta y la liquidación bancaria pueden caer en días distintos. Fuente: [Mercado Pago, campos de conciliación](https://www.mercadopago.com.ar/developers/es/docs/links-and-debts/additional-content/reports/account-money/report-fields).

Los totales se conservarán para TODOS los medios, incluido efectivo. No se presumirá una alícuota fija ni el tratamiento fiscal de la propina. El módulo inicial es de registro y preparación de información, no calcula obligaciones tributarias.

## 3. Definiciones que evitan cifras engañosas

| Dato | Regla propuesta |
| --- | --- |
| Consumo confirmado del período | Tandas aceptadas por el servidor, con precios originales; excluye borradores, rechazados y pendientes de validación. Correcciones registradas por separado. |
| Cobros de consumo | Importes de consumo de pagos confirmados en el período, menos devoluciones de consumo efectuadas en ese período. |
| Propinas cobradas | Propinas efectivamente confirmadas, menos devoluciones de propina. La selección o sugerencia del cliente no es ingreso. |
| Total recibido registrado | Cobros de consumo + propinas cobradas. Cada pago aparece una sola vez. |
| Pendiente al final del período | Saldo de consumo existente a esa fecha, incluyendo saldos anteriores; no es simplemente ventas del día menos cobros del día. |
| Comisiones y retenciones | Deducciones identificadas en una liquidación; sin dato se muestra “Sin información”, no cero. |
| Neto acreditado | Dato conciliado con el proveedor, separado del total vendido y de lo registrado por el personal. |
| Con/sin comprobante fiscal asociado | Cobertura documental de las operaciones, independiente de su estado de pago. Un pago parcial no crea una venta nueva. |

No llamar “ganancia” a lo cobrado: para beneficio hacen falta costos y gastos que este alcance no incorpora.

Fechas almacenadas en UTC y agrupadas por la zona IANA del restaurante, con valor inicial Argentina. Día calendario de 00:00 a 00:00 local y mes calendario. Rangos con inicio incluido y fin excluido. Guardar fecha de operación, cobro, devolución, emisión fiscal y acreditación por separado. Un eventual día gastronómico con corte a las 04:00 será una vista adicional, nunca un desplazamiento silencioso del reporte calendario.

## 4. Medios de pago y propina

Clasificación visible: Efectivo, Tarjeta débito, Tarjeta crédito, QR/billetera, Transferencia y Tarjeta sin especificar (histórico). Los datos desconocidos conservan esa condición.

Guardar dos dimensiones: canal usado en el local y, cuando se conozca, instrumento que financió el pago. Un QR financiado con tarjeta se suma a QR en el cuadro principal; la tarjeta es un atributo secundario, nunca otro ingreso.

Al pedir la cuenta, el cliente elige su preferencia. Esa preferencia llega al mozo y preselecciona el formulario, pero solo **Confirmar cobro** crea el registro monetario. El mozo puede corregir el medio antes de confirmar. Tras confirmar, toda rectificación conserva el original, autor, motivo y fecha.

Antes de cobrar se muestra consumo, propina elegida, total y saldo. Si el cliente elige 10% sobre $10.000, se cobran $11.000: consumo $10.000 y propina $1.000. La propina no debe volver a aplicarse al reabrir el formulario, reintentar o registrar un segundo pago.

Pagos mixtos: líneas de medio + importe, separando consumo y propina y mostrando restante. Un grupo de pago mixto confirmado de una vez debe registrarse atómicamente; los anticipos sucesivos siguen siendo pagos parciales independientes. Redondeo en centavos y reparto del remanente determinista. El efectivo recibido para dar vuelto no aumenta ventas: recibido $20.000, vuelto $9.000, ingreso registrado $11.000.

## 5. Resumen y navegación

Filtros: Hoy, Ayer, Este mes, Mes anterior y Rango; filtros adicionales por medio, responsable y estado documental. Mostrar zona horaria y fecha de actualización.

Cabecera con consumo confirmado, consumo cobrado, propinas, total recibido y pendiente al corte. Tabla por medio: cantidad de pagos, consumo, propina, devoluciones y total. La cantidad de cuentas se calcula por sesión distinta; no sumando conteos por medio en pagos mixtos. Si se muestra promedio, indicar si es por pago o por cuenta totalmente saldada.

Cada cifra permite abrir las operaciones que la componen. Cada operación muestra mesa y ocupación histórica, responsable, ítems, pagos, propina, correcciones y tickets. Reutilizar el número de mesa no mezcla ocupaciones.

Consulta histórica calculada desde registros persistentes; no depende de que la aplicación haya estado abierta a medianoche. El reporte de un día anterior sigue disponible sin un botón “Cerrar caja”.

## 6. Tickets PDF y conservación

Dos documentos claramente distintos:

1. **Detalle de cuenta** antes del cobro: consumo, propina seleccionada y saldo; marcado “Pendiente de pago”.
2. **Comprobante de pago** por cobro confirmado: importe recibido, detalle del pago parcial o total y saldo restante. Una cuenta con varios pagos permite además descargar su detalle consolidado.

Contenido: nombre y datos configurados del local, número interno único, fecha y hora local, mesa/ocupación, responsable, ítems y precios congelados, consumo, propina, total, métodos e importes, referencias y leyenda no fiscal. Sin CAE ni QR fiscal inventados.

PDF térmico de 80 mm como formato inicial y A4 para resumen diario/mensual. Descarga, impresión mediante navegador/visor y reimpresión desde historial. Compatibilidad física con la impresora del local se verifica antes de prometer impresión automática; ESC/POS y agentes de impresión quedan para otra etapa.

Persistir una instantánea del documento y su PDF original, versión de plantilla, hash, fecha, número e identificador de origen. Cambiar menú, nombre del local o plantilla no altera tickets emitidos. Reimprimir no crea otro ingreso ni otro número. Nunca regenerar documentos históricos con precios o datos actuales sin advertirlo.

Confirmar el cobro y reservar el comprobante/instantánea en la misma transacción. Generar el PDF luego, con estado pendiente/listo/error y reintento idempotente. Si falla la generación, el cobro sigue confirmado y el botón debe ofrecer “Reintentar PDF”, nunca “Cobrar otra vez”.

## 7. Información para facturación y conciliación

Exportación inicial CSV: resumen por día y medio, operaciones/ítems, pagos/propinas/devoluciones y vínculos con comprobantes. Incluir IDs estables, moneda, zona, rango, momento de extracción y cobertura histórica. Ofrecer también resumen PDF. XLSX puede añadirse cuando los contratos estén validados.

En Comprobantes: filtro “Sin comprobante asociado”, “Asociación parcial” y “Con comprobante asociado”; registrar tipo, punto de venta, número, fecha, emisor, total, referencia/archivo y operaciones cubiertas. Marcar la fuente como carga manual; no presentar una carga manual como validación de ARCA. Separar el número del ticket interno del número fiscal. Exportar un archivo tampoco marca automáticamente como facturado.

Asociación por operación o por parte documentada, con control de cobertura para no duplicar importes. La división de medios de pago no exige dividir artificialmente una venta en varias facturas. No ofrecer facturación mensual consolidada automática; el resumen mensual es apoyo de control y preparación.

Primera versión: medios presenciales registrados por personal, con referencia de transacción opcional y estado “Registrado por el local”. Etapa posterior: importar un reporte de proveedor de ejemplo previamente anonimizado, comparar por ID externo, y mostrar conciliado, sin coincidencia, diferencia o devolución. Nunca hacer coincidir automáticamente solo por importe y fecha. Importaciones repetidas no duplican pagos ni acreditaciones. Las filas desconocidas quedan para revisión. La integración API automática de Mercado Pago/terminales no es requisito de la primera versión.

## 8. Diseño técnico propuesto

- Mantener `AccountSettlement` como fuente de cobros nuevos. Crear una proyección monetaria común para registros nuevos e históricos (`PaymentTransaction`) con identificador de origen; incluir solo estados válidos y comprobar solapamientos antes de sumar.
- Servicio de reportes separado de las métricas de llamados. Consultas paginadas, agregación por restaurante y fechas; índices acordes a esos filtros.
- Añadir metadatos compatibles para clasificación de tarjeta, canal, referencia y confirmación. Sin activar capacidades digitales hoy deshabilitadas.
- Registros vinculados para reversos/rectificaciones, recibos y asociación fiscal. Persistencia conceptual: `PaymentAdjustment`, `Receipt`, `FiscalDocument` y sus asignaciones; decidir nombres definitivos siguiendo convenciones del repositorio.
- Congelar ítems/precios e instante de confirmación de consumo para reconstruir períodos. Si el historial no permite reconstruir un saldo pasado, mostrar cobertura incompleta; no fabricar fechas o subtipo de tarjeta.
- Dinero en enteros de centavos, validación de enteros seguros y moneda explícita. Conversiones Float solo para historia y con regla documentada.
- Resumen consultable desde el registro detallado; si luego se materializan agregados, deben poder reconstruirse. Las correcciones posteriores se registran en su fecha con referencia a la operación original; no borrar registros cerrados ni modificar exportaciones antiguas.
- Permisos separados de consulta general y operación de cobro. Invitados acceden únicamente a sus documentos mediante acceso autorizado; el panel del mozo no recibe totales globales sin permiso.
- Los registros/documentos deben sobrevivir a liberar mesa y archivar sesiones. Revisar relaciones con borrado en cascada y política de conservación antes de migrar.
- Backup incluye cobros, ajustes, asignaciones, instantáneas, archivos PDF y referencias fiscales. Prueba de restauración en entorno aislado.

## 9. Etapas y criterios de salida

| Etapa | Entregable | Verificación necesaria |
| --- | --- | --- |
| 1. Contrato de datos | Definiciones, política de fecha, proyección de cobros y análisis de cobertura histórica | Casos numéricos acordados; esquema SQLite/PostgreSQL compatible; detectar datos que no se pueden recuperar. |
| 2. Registro confiable | Preferencia vs. cobro real, medios, pagos mixtos, propinas y correcciones auditadas | Reintentos y concurrencia sin duplicados; propina una sola vez; reparto de consumo/propina/vuelto exacto. |
| 3. Resumen automático | Día, mes, rango y detalle por medio en administración | Totales coinciden con pagos fuente; cruces de medianoche y meses; no depende de turno abierto. |
| 4. Tickets | Instantánea, PDF, descarga, impresión y reimpresión | PDF con textos largos, pagos mixtos y muchas líneas; fallo de generación recuperable; precios históricos intactos. |
| 5. Preparación documental | CSV, resumen PDF y asociación de comprobantes externos | Sin cobertura duplicada; exportes coinciden con pantalla; carga manual identificada. |
| 6. Conciliación de proveedor | Importador y comparación con reporte real anonimizado | Comisiones/neto correctos; repetición de importación, diferencias y devoluciones; no duplicar cobros. |
| 7. Verificación integral | Pruebas de flujo, revisión, conservación y restauración | Reporte, pagos, documentos y respaldo coinciden; regresión de Cuentas/Servicio y comprobación móvil. |

Entrega inicial útil: etapas 1–5 y controles aplicables de la 7. Etapa 6 requiere definir proveedor/formato con un archivo de muestra. Ninguna etapa incorpora apertura/cierre obligatorio, inventario, gastos, reparto de propinas entre empleados ni emisión fiscal automática.

## 10. Escenarios mínimos

1. Consumo $10.000 + propina $1.000: total $11.000; consumo $10.000, propina $1.000, una operación de consumo.
2. De ese ejemplo: efectivo $6.000 de consumo y QR $4.000 de consumo + $1.000 de propina. Cuadro: efectivo $6.000, QR $5.000; suma $11.000. No duplicar la venta por tener dos pagos.
3. Cliente pide efectivo, mozo confirma débito: la solicitud conserva la preferencia; el reporte usa débito confirmado.
4. Solicitud de cuenta sin cobro, pago rechazado o pendiente: ingreso cero.
5. Consumo antes de medianoche y cobro después: cada evento figura en su fecha; saldo al corte correcto.
6. Pago parcial un día y saldo al siguiente, incluso entre meses: se conserva una cuenta y dos fechas de cobro.
7. Doble toque, dos operadores y reintento tras desconexión: un cobro y un comprobante por intención confirmada.
8. Propina deseleccionada antes de pagar: no se registra; propina ya cobrada no puede desaparecer por editar una sugerencia.
9. Devolución parcial posterior: resta en la fecha de devolución, conserva consumo/propina afectados y ticket original. Nunca devolución superior al cobro.
10. Cambiar nombre/precio de plato y liberar/reutilizar mesa: documentos originales idénticos y ocupaciones separadas.
11. Falla el PDF después de cobrar: recuperación sin nuevo pago. Nombres largos, acentos y tickets de varias páginas legibles.
12. Tarjeta histórica sin subtipo: visible como desconocido; jamás asignada automáticamente a débito.
13. Reporte vacío vs. error de carga: estados distintos, no mostrar $0 ante falla.
14. Cobro QR registrado $11.000 y proveedor acredita menos: se conserva bruto $11.000 y se explican deducciones con datos reales.
15. Intento de acceder al ticket de otro restaurante o sesión: denegado. Restaurar backup reproduce registros y PDF originales.

## 11. Decisiones para la ejecución

Defaults propuestos: ARS; día calendario de Argentina; PDF 80 mm; captura presencial por operador; CSV + resumen PDF; sin cierre manual de caja. Antes de implementar conciliación se elegirá proveedor y muestra. Antes de implementar emisión fiscal se definirá condición del local, sistema emisor y reglas vigentes. Estas decisiones posteriores no impiden construir primero el registro y los reportes.

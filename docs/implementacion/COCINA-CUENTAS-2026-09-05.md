# MesaYA: correcciones, cocina directa y cuentas por persona

Autorización: Rodrigo solicita ejecutar las correcciones C01–C08 pendientes y estas funcionalidades con OpenCode / Muse Spark 1.3, supervisadas por Codex cada 15 minutos, avanzando hasta completar el alcance. Fecha: 2026-09-05.

## Decisiones tomadas

1. Primero cerrar seguridad y acceso. No considerar implementado un plan escrito: las correcciones del dossier siguen pendientes y Rodrigo lo confirmó.
2. Tres modos claros: Carta y llamados (sin pedidos), Pedido con validación del mozo y Cocina directa. «Híbrido» significa validación selectiva de pedidos marcados; no crear un cuarto modo ambiguo en esta entrega.
3. Consumo abierto, pago al final. Sin prepago obligatorio. Cada mesa tiene participantes de visita y una cuenta compartida, con autoría por ítem y tandas de pedido independientes.
4. El carrito muestra quién agregó cada ítem. Cada participante edita/confirma sus líneas pendientes; ningún navegador envía o borra silenciosamente las de otra persona. Staff autorizado puede operar la mesa con registro de autoría. Usar identidad de participante emitida por servidor ligada a visita, no confiar en un nombre/UUID arbitrario del cliente.
5. Cocina directa usa polling autoritativo con backoff y recuperación; no reabrir SSE. Sonido al detectar IDs nuevos, sólo tras interacción del operador; sin prometer avisos con teléfono bloqueado ni entrega instantánea.
6. Pedido y transición FSM consistentes: no añadir un `attemptTransition` fuera de transacción que deje cambios parciales. Si la FSM no admite un paso, respuesta explícita y estado coherente; contemplar pedidos adicionales sin hacer retroceder la mesa.
7. Modificadores versionados y validados por servidor, con representación legible para cocina. Notas libres se conservan como texto; no usar etiquetas arbitrarias como fuente de precio o ingrediente disponible. Se permiten migraciones aditivas revisadas: evitar meter contabilidad en `notes` sólo por no migrar. Opciones por producto y snapshots de precio/nombre; no ofrecer «sin cebolla» en todos los platos por defecto.
8. Alergias y peticiones especiales visibles: requieren validación humana antes de preparar, incluso en modo directo. No prometer ausencia de alérgenos ni interpretar notas como garantía automática.
9. Cuenta dividida por consumo (incluido plato compartido), partes iguales y monto personalizado. Dinero en centavos enteros, residuo distribuido de forma determinista; suma de partes exactamente igual al saldo, sin números flotantes como autoridad.
10. Cada persona ve su parte y puede pedir pagarla. El cobro presencial efectivo (efectivo, tarjeta o QR externo) sólo lo confirma personal autorizado, con método/importe/actor/fecha. «Solicitado», «pendiente» y «pagado confirmado» son distintos. No marcar pago por un botón del comensal ni una redirección web.
11. Pagos parciales persistidos, idempotencia, concurrencia, saldo pendiente y bloqueo de cierre con deuda. Cambios de reparto requieren revisión y no reescriben dinero ya confirmado. Propina optativa separada del consumo; ningún porcentaje preseleccionado obligatorio.
12. Pago online integrado con Mercado Pago es una siguiente activación separada: requiere credenciales/test users, verificación de notificaciones, conciliación y pruebas sandbox antes de cobrar. En esta entrega implementar reparto y cobro presencial completo; documentar contrato de integración digital, mantener endpoints digitales inseguros apagados. No implementar marketplace/comisiones ni cobros reales por inferencia.
13. Extras incluidos porque completan el flujo: agotados, pausa de pedidos, rechazo con motivo, pedido adicional, seguimiento por tanda, cancelación autorizada con auditoría y deduplicación de reintentos. Reservas, delivery, fidelización, IA, facturación fiscal y pagos online en vivo quedan fuera.

## Ajustes al plan de correcciones recibido

- Fastify 5/JWT 10/CORS 11: verificar versiones corregidas actuales y compatibilidad, no confiar sólo en el número mayor. Lock y auditoría obligatorios.
- PIN uniforme 4–6 cifras; duplicados por restaurante rechazados también bajo concurrencia. Bootstrap sin secreto por defecto/por logs, rotación explícita y repetición que conserva credenciales.
- No `trustProxy: true` indiscriminado: contrato explícito de proxy confiable, pruebas de cabeceras falsificadas y despliegue. Política por tenant/IP compatible con 25 intentos por 5 minutos como punto inicial, con control complementario de fallos para no debilitar defensa por PIN corto. No garantizar seguridad sólo por subir el umbral.
- Si falta URL HTTPS de Comensal en producción, deshabilitar QR y mostrar error accionable; no generar uno incorrecto con un banner.
- Pruebas exclusivamente aisladas, nunca Vitest contra `.env`/dev.db. Supervisor Windows Job obligatorio para trabajo pesado.

## Etapas y aceptación

| Etapa | Entrega del ejecutor | Gate de revisión Codex |
|---|---|---|
| 01 | Login Admin/Staff, bootstrap, PIN, QR/CORS, validación y rate limit | Tests de credenciales, tenant, input inválido, expiración, bootstrap y QR; no auto-login demo. |
| 02 | Dependencias, handler HTTP y hardening documentado | Instalación limpia, audit, build, GET/POST/OPTIONS por handler real; PG y paridad. |
| 03 | Contratos/datos: participantes, modificadores, tandas, centavos e idempotencia | Migración aditiva, compatibilidad de datos previos, schemas sincronizados, invariantes y tests PG/SQLite. |
| 04 | Backend de pedidos directo/validado + FSM + disponibilidad | Atomicidad, aislamiento, restricciones del servidor, reintentos, pedidos extra, rechazos y sesiones cerradas. |
| 05 | Comensal: producto, carrito, autoría, confirmar y seguir tanda | Pruebas UI/contratos, móvil, cantidades, notas escapadas, sin precios cliente autoritativos, errores/reconexión. |
| 06 | Admin modos y KDS operativo | Polling/audio deduplicado, notas/alergias, aceptación/rechazo y agotados; no regresión del salón. |
| 07 | Cuenta dividida backend, asignaciones y cobros parciales | Centavos, reparto estable, pagos idempotentes concurrentes, permisos, no sobrepago, no cierre con saldo. |
| 08 | UI de mi parte y caja de Staff/Manager | Flujo de 3 personas, plato compartido, importe custom, propina, varios métodos y saldo visible. |
| 09 | E2E integral, docs de operación y contrato futuro Mercado Pago | Build completo, suites SQLite/PG, UI, matriz de rutas y audit. Entrega revisada sin afirmar deploy/cloud no realizados. |

No saltar etapas ni aceptar «DONE» del ejecutor como prueba. Cada etapa puede requerir varias entregas acotadas; corregir con el mismo modelo y repetir sólo gates afectados. Si una etapa es grande, dividirla conservando sus criterios. Codex mantiene control/revisiones; OpenCode implementa código y tests. No ampliar este alcance por ideas adicionales durante el ciclo.

## Investigación y fundamentos

- [Square: dividir por ítem o asiento](https://squareup.com/help/us/en/article/8165-split-a-payment-and-check-with-square-for-restaurants): referencia funcional para repartir consumo; no implica integración ni disponibilidad de Square para este proyecto.
- [Toast: modificadores predeterminados](https://support.toasttab.com/en/article/Creating-Default-Modifiers): opciones definidas por menú y diferencias legibles en cocina. La selección de funciones de MesaYA es una decisión propia basada en estos patrones y el código actual.
- [Mercado Pago: notificaciones](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-preferences/payment-notifications) y [crear order con idempotencia](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-api/create-order/post): fundamentan separar reparto del cobro online confirmado. Adaptar contrato al producto de pago que se elija; no mezclar APIs como si fueran equivalentes.
- [OpenCode CLI](https://opencode.ai/docs/cli/) y [Zen](https://opencode.ai/docs/zen/): ruta seleccionada `opencode/muse-spark-1.3-contributor-free`, igual al flujo anterior y al catálogo local. Contributor permite uso de prompts/completions para entrenamiento; el ejecutor recibe código/fixtures, nunca secretos ni datos reales. Sin rotación silenciosa a otro modelo.

## Ejecución

Rama aislada: `codex/mesaya-cocina-cuentas-20260905` en `C:/Users/rodri/Desktop/AI/Projects/mdpmesasvivas-cocina-cuentas`.

Control operativo y lanzador: `C:/Users/rodri/Desktop/AI/Projects/_orchestration/runs/mesaya-cocina-cuentas-20260905/`.

Un solo ejecutor a la vez. Cada entrega tiene timeout técnico de 15 minutos, 3 GiB y 8 procesos mediante el supervisor Windows Job existente. Revisión programada cada 15 minutos; no es una promesa de duración de cada etapa. No desplegar, migrar bases remotas, ejecutar cobros, publicar o modificar credenciales. Integrar localmente sólo entregas revisadas, preservando los cambios previos de documentación.

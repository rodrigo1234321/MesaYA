# Escenarios de aceptación y evidencia

Todos usan fixtures sintéticas aisladas y el SHA implementado. Antes/después sobre mismas mesas, necesidades y equipo. Estado inicial del paquete: NOT_RUN para todos.

## Matriz mínima

| ID | Escenario | Esperado |
|---|---|---|
| S01 | Mozo nuevo identifica próximo llamado | Sin explicación adicional localiza mesa/necesidad en ≤5 s como meta |
| S02 | Voy → atención física → Atendido | Dos acciones de negocio, identidad correcta; no cerrar con Voy |
| S03 | 30 pendientes, llega nuevo mientras apunta | No cambia el target de click ni se pierde foco; nuevo visible |
| S04 | Dos mozos toman el mismo llamado | Un ganador, otro recibe estado actualizado; cero duplicación |
| S05 | Tablet vertical: abrir mesa y volver | Detalle inmediato, sin atravesar la cola; restaurar filtro/scroll |
| S06 | PC mouse y teclado | Todas las tareas esenciales sin drag/hover; controles alcanzables |
| S07 | Cambio de persona con request en vuelo | Resultado queda atribuido al actor original; nueva UI sin herencia de privilegios |
| S08 | 12 accesos válidos y 6 cobros autorizados en 5 min, dos puestos misma IP | No bloqueo con fixture normal; luego ataque concurrente limitado sin evasión rotando terminalId |
| S09 | Inactividad personal | Tablero mínimo sigue visible con credencial de puesto vigente; mutación pide actor |
| S10 | Llamado mientras está en Más/Cocina | Aviso visible; audio sólo si disponible; latencia dentro de polling definido |
| S11 | API caída y vuelta tras suspensión | Nunca falso conectado, no cero falso, recuperación sin duplicar |
| S12 | Cobro mozo permitido/no permitido | Matriz de permiso servidor; apagado por defecto; sin rol manager implícito |
| S13 | Token temporal de cobro contra carta/personal/otra mesa | Rechazo sin escrituras, aún antes de expirar |
| S14 | Mismo cobro, timeout y dos reintentos | Un único settlement; relectura y recibo coherentes |
| S15 | Cobrar y seguir / cerrar / limpiar | No liberar mesa ocupada o con saldo por pagar ni por imprimir ticket |
| S16 | Pedido con excepción | Motivo visible, no bypass por rediseño; decisión auditada |
| S17 | Cocina recibe, prepara, listo y mozo entrega | Transición y responsable correctos; no repetir toda la mesa |
| S18 | Un solo puesto, comanda manual/impresión | Recepción física registrada; no afirmar entrega a cocina por click |
| S19 | Cliente doble toque y timeout de add/submit | Una intención, una mutación; agregar otra unidad después sigue permitido |
| S20 | Carrito refresh, sesión nueva y dos teléfonos | Sin restaurar pedido antiguo ni multiplicarlo; servidor concilia estado |
| S21 | 20 recibos paralelos, dos locales y misma clave idempotente | Unicidad, aislamiento, PDF persistente, replay estable; sin garantía artificial de numeración sin huecos |
| S22 | 23:30 pedido / 01:15 pago, turno y día calendario | Métricas según contrato, caja reconcilia por cobros; no forzar ventas=caja |
| S23 | PG desde historial vacío y upgrade sintético | Columna/constraint y auth/cobro funcionan sin db push |
| S24 | Rotación de secreto y legacy PIN | Recuperación definida, identidad inequívoca y no duplicados concurrentes |
| S25 | Admin y cliente completos | Ventas/QR/exportaciones/carta/flags no desaparecen al simplificar Staff |
| S26 | Carta con datos alimentarios desconocidos | No etiqueta seguro/sin TACC por inferencia; filtros sólo sobre datos confirmados |
| S27 | Error inesperado 500 y 4xx con detalle interno centinela | Respuesta pública segura, correlación y logs redactados |
| S28 | k6 sin token/fixture y luego con flujo completo | Falla preflight; carga con resultados semánticos y conciliación final |
| S29 | Teléfonos físicos QR/NFC y cambio de mesa/turno | Dominio correcto, sesiones aisladas y fallback accesible |
| S30 | Backup/restauración en ambiente separado | Artefacto, checksum, restore y conciliación; RPO/RTO medidos |

## Gate principal de usabilidad

Comparar prototipo y versión integrada contra baseline, por participante/dispositivo. Muestra formativa propuesta: al menos 3 operadores representativos (uno sin experiencia en MesaYA), 2 rondas; ampliar si resultados contradictorios. No presentarla como estudio estadístico.

- Al menos 90% de tareas esenciales completadas sin ayuda en la segunda ronda. Informar número exacto de intentos/éxitos, mediana y peor caso.
- Cero errores de mesa, atribución, permiso, doble pedido o cobro. Un error de esos bloquea, aunque promedio de tiempo mejore.
- S01 ≤5 s, S02 ≤10 s de interacción total excluyendo atención física como metas; reportar por separado caminata, atención y cola de acceso al puesto.
- Entrega conocida ≤2 acciones de negocio; pedido manual y cobro tienen presupuesto propio, no sacrificar confirmación monetaria para cumplir dos clics.
- Mejorar al menos 25% la mediana del tiempo de interacción de tareas frecuentes respecto al baseline, cuando éste tenga fricción medible. Si ya está cerca del mínimo, justificar por precisión y ausencia de regresión en vez de manipular la meta.
- Ningún detalle esencial debajo de una cola larga en tablet vertical; zoom 200% funcional. Validación visual por persona además de emulación.
- Medir espera en terminal durante ráfaga de 10 minutos con personal concurrente. Si la espera empeora el servicio o la comanda no llega a cocina, el modo de una pantalla queda NO-GO aunque la UI sea correcta.

## Evidencia obligatoria por ficha

SHA de entrada/salida, fixture, comando exacto, exit code, esperado/observado, captura o grabación cuando corresponda, consultas redactadas y limitaciones. Tests de DOM no prueban velocidad de una persona; pruebas directas de servicio no prueban permisos HTTP.

Oráculo monetario: `2 * 1234567 + 3 * 123456 = 2839502`; tras una bebida anulada según política, `2716046`. Sin anulaciones retroactivas ilegales. Separar ventas, saldo, cobros, propina, ajustes y devoluciones.

## Gates finales

- G-DISEÑO: E01/E02 cumplen recorridos y dejan pendientes humanos visibles.
- G-SERVICIO-LOCAL: S01–S20 técnicos + regresiones y permisos; no certifica personas reales.
- G-DATOS: PG, concurrencia, cuentas, tickets y reportes con oráculo.
- G-HUMANO: ensayo observado de mozos/encargado/cocina con equipos reales y modo elegido.
- G-CLOUD: deployment IDs/SHA, permisos reales, dominios, carga y restore.
- GO sólo con todos los aplicables, soporte/fallback y aprobación explícita del responsable. Un plan de impresora o restore no es una prueba ejecutada.

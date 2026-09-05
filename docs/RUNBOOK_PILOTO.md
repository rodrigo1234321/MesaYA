# Runbook de piloto presencial — MesaYA

Estado: borrador para revisión humana. Fecha: 2026-09-05.

Este runbook sirve para un piloto presencial limitado. No autoriza despliegue, migración sobre datos reales, impresión de QR reales, cobros digitales, acceso externo ni operación de un restaurante. La decisión GO/NO-GO es exclusiva de Rodrigo.

## Estado de capacidades

| Área | Estado | Límite operativo |
|---|---|---|
| Turnos, QR/sesiones, llamados y atención | Implementado y ensayado | El QR identifica una mesa/sesión; no acredita presencia física por sí solo. |
| Carta, pedidos, cocina y cobro presencial manual | Implementado y ensayado con datos ficticios | El cobro es un registro autorizado de caja manual; no integra un proveedor de pagos. |
| Polling de Staff/Admin | Implementado y ensayado | Revisar indicador de conexión y edad del snapshot; no prometer instantaneidad. |
| SSE `/stream` | Apagado | Responde `410 SSE_STREAM_DISABLED`; no configurar infraestructura SSE. |
| Pago digital, split, claims | Apagado | Responden `503 DIGITAL_PAYMENTS_UNAVAILABLE`; no anunciar ni cobrar por esa vía. |
| IA | Apagada salvo habilitación explícita | No usarla para decisiones de servicio ni prometer recomendaciones. |
| Pre-order y rewards | Fuera del piloto | No habilitar ni comunicar como disponibles. |
| Backup/restauración real | Pendiente bloqueante | No está ensayado contra una base real; no hay permiso para ejecutar este paso. |

## Preflight de instalación (antes de un piloto autorizado)

1. Rodrigo aprueba por escrito el piloto, el restaurante de prueba, responsables y ventana horaria.
2. Crear un entorno separado de producción, con PostgreSQL y URLs exclusivamente de ese entorno. No reutilizar `dev.db`, una base remota existente ni secretos versionados.
3. Definir `NODE_ENV=production`, secretos distintos de al menos 32 caracteres y `CORS_ORIGIN` HTTPS explícito. Mantener `PILOT_PUBLIC_ONBOARDING_ENABLED` ausente/falso.
4. Ejecutar sólo `migrate deploy` mediante el procedimiento manual revisado. No usar `db push`, `migrate dev` ni seed.
5. Realizar y verificar backup/restauración en un entorno desechable equivalente. Hasta tener esa evidencia, el resultado debe ser **NO-GO**.
6. Ejecutar build, suite aislada y smoke de serverless indicados en CI. Registrar versión/commit y resultado sin secretos.

## Operación del salón

### Apertura

1. El encargado inicia sesión desde Admin y confirma restaurante correcto.
2. Abre turno. Verifica que el panel muestre `TURNO ACTIVO`, mesas disponibles y QR/sesiones rotativas.
3. Staff inicia sesión, verifica el local, el indicador de conexión y que el audio fue activado mediante interacción física del operador.
4. Probar un único QR de prueba: debe mostrar mesa y acciones del cliente. No usar QR impreso de un local real durante el ensayo.

### Durante el turno

1. Cliente solicita mozo, insumo o cuenta; Staff recibe el snapshot y marca `En camino`/`Atendido`.
2. Pedidos y cocina siguen el flujo autorizado. Para una cuenta, el pago es presencial/manual y sólo lo confirma el rol autorizado.
3. Si aparece opción de pago digital, split, rewards o pre-order, no continuar: es una capacidad apagada y se registra como incidencia de documentación/UI.
4. El encargado revisa periódicamente tiempos de atención, cantidad de llamados y la conexión de Staff/Admin.

### Cierre

1. Resolver o documentar llamados pendientes y cerrar las cuentas manuales.
2. El encargado cierra turno desde Admin.
3. Verificar que un QR previo indique sesión inactiva y que el Staff no conserve llamados activos.
4. Registrar incidencias, métricas y hora de cierre. No eliminar datos ni modificar la base para “limpiar” resultados.

## Incidencias

| Señal | Acción inmediata | Escalamiento/registro |
|---|---|---|
| Staff/Admin indica desconexión o snapshot viejo | Confirmar red local y reabrir/focalizar la app para forzar polling. No duplicar llamados. | Registrar hora, vista, restaurante y duración. Si no recupera, usar procedimiento manual de salón y marcar NO-GO para ampliar piloto. |
| Re-login requerido | Verificar restaurante y rol; iniciar sesión otra vez con PIN del operador autorizado. | No compartir PINs en chat, fotos ni tickets. Registrar sólo que ocurrió. |
| Backend no responde | Detener nuevas operaciones digitales, conservar la caja manual fuera del sistema y no editar DB. Reiniciar sólo según procedimiento técnico autorizado. | Registrar error, hora y estado de datos tras recuperación. |
| QR activo fuera de contexto | Cerrar turno/sesión desde Staff/Admin y reemplazar el soporte físico sólo bajo autorización. | Tratarlo como riesgo conocido: QR fijo no prueba presencia. |
| Pedido/cobro ambiguo | No repetir mutaciones a ciegas. Consultar el estado en Staff/Admin antes de actuar. | Registrar identificador interno sin datos personales. |

## Datos, backup y rollback

El código de recuperación de servicio (reiniciar API, relogin, polling) no equivale a recuperación de datos. A la fecha no hay una restauración de backup real ensayada; por tanto:

- No migrar ni operar datos reales hasta ejecutar un ensayo independiente de backup, restauración y verificación de integridad en entorno desechable.
- Antes de una migración real, tomar un backup verificable, inventariar schema/extensiones, revisar SQL de `migrate deploy`, definir punto de retorno y obtener aprobación humana.
- Si una migración o despliegue falla, detener el rollout, preservar logs sin secretos, volver al artefacto previamente aprobado y restaurar sólo conforme al backup ya verificado. No usar `db push`, reset ni seed como rollback.

## Métricas propuestas y responsables

| Métrica | Fuente | Responsable propuesto | Canal |
|---|---|---|---|
| Errores por flujo (QR, llamado, pedido, cocina, cierre) | logs/API y registro de incidencias | Operador técnico a designar | Canal operativo a definir por Rodrigo |
| Latencia y edad del snapshot | indicador de conexión de Staff/Admin y timestamps | Encargado de turno | Planilla o canal a definir |
| Llamados duplicados/rechazados | API/observación de Staff | Encargado de turno | Registro de incidencias |
| Tiempo de atención | timestamps de llamado/atención | Encargado de turno | Resumen post-turno |
| Recuperación tras red/backend | bitácora de incidencias | Operador técnico a designar | Canal operativo a definir |

No se inventan contactos, SLA ni canales: Rodrigo debe nombrarlos antes del GO.

## Checklist GO/NO-GO de Rodrigo

### NO-GO automático

- No existe backup/restauración ensayada y verificada en entorno desechable.
- Secretos, CORS HTTPS, migraciones o versión del artefacto no fueron revisados.
- Se pretende habilitar pago digital, IA, pre-order, rewards o SSE sin aprobación específica.
- Hay fallo sin explicación en QR, aislamiento tenant, cierre/revocación o recuperación de red.

### GO condicionado

- [ ] Backup/restauración ensayada y evidencia archivada.
- [ ] Responsable de salón, responsable técnico y canal operativo nombrados por Rodrigo.
- [ ] Ventana, restaurante de prueba, límites de mesas y procedimiento manual de caja aprobados.
- [ ] Resultados de build, suite aislada y smoke PG registrados para el artefacto a usar.
- [ ] QR de prueba, no QR real, verificado durante la apertura.
- [ ] Rodrigo declara explícitamente: **GO** o **NO-GO**.

Sin esa declaración, el estado es **NO-GO**. Este documento no despliega ni ejecuta acciones externas.

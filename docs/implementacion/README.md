# Plan de implementación — MesaYA / RTMS

Fecha: 2026-09-03. Estado: planificación lista; implementación no iniciada.

## Objetivo y límites

Preparar un piloto de un restaurante con aislamiento entre tenants, sesiones válidas, pedidos/llamados confiables y cobro presencial. No reescribir el producto. No habilitar cobros digitales, split, preorden, recompensas ni IA paga por simple existencia de botones.

30 fichas pequeñas ordenadas en 9 bloques. No equivalen a 30 features ni a una estimación de días. Sólo se entrega una ficha al ejecutor a la vez. Los bloques de datos pueden necesitar subdivisión tras inspeccionar el diff; no ampliar alcance en silencio.

## Secuencia

| Etapa | Bloque | Entrega |
|---|---|---|
| 00 | Fundación | [Inventario y punto de recuperación](etapas/00-base-segura.md) |
| 01 | Fundación | [Aislar tests y proteger el seed](etapas/01-pruebas-aisladas.md) |
| 02 | Fundación | [Restaurar build y contratos compartidos](etapas/02-build.md) |
| 03 | Contención | [Desactivar pagos y split simulados](etapas/03-pagos-bloqueados.md) |
| 04 | Contención | [Quitar fallbacks engañosos de IA](etapas/04-ia-contencion.md) |
| 05 | Identidad | [Validar secretos, CORS y expiración](etapas/05-entorno-jwt.md) |
| 06 | Identidad | [Helpers de autorización y matriz de rutas](etapas/06-politica-auth.md) |
| 07 | Identidad | [Cerrar altas de personal y login admin](etapas/07-staff.md) |
| 08 | Autorización | [Proteger configuración, auditoría y métricas](etapas/08-config-metricas.md) |
| 09 | Autorización | [Proteger todas las mutaciones del menú](etapas/09-menu.md) |
| 10 | Autorización | [Proteger mesas y apertura/cierre de turno](etapas/10-mesas-turnos.md) |
| 11 | Autorización | [Autorizar plano y transiciones FSM](etapas/11-plano-fsm-auth.md) |
| 12 | Operación | [Separar QR estable de sesión operativa](etapas/12-sesiones-qr.md) |
| 13 | Operación | [Validar llamados, feedback y lecturas privadas](etapas/13-llamados-feedback.md) |
| 14 | Operación | [Validar pedidos del comensal](etapas/14-pedidos-invitado.md) |
| 15 | Operación | [Autorizar cocina y estados de pedidos](etapas/15-pedidos-staff.md) |
| 16 | Operación | [Cerrar lista de espera y módulos incompletos](etapas/16-espera.md) |
| 17 | Confiabilidad | [Cerrar SSE público y definir snapshots](etapas/17-stream-cierre.md) |
| 18 | Confiabilidad | [Reconexión y avisos consistentes](etapas/18-polling-clientes.md) |
| 19 | Confiabilidad | [Eliminar inyección de contenido en cliente](etapas/19-xss.md) |
| 20 | Confiabilidad | [Acotar generación IA y validar respuestas](etapas/20-ia-limites.md) |
| 21 | Entrega | [Build del cliente sin dependencias de demo](etapas/21-assets.md) |
| 22 | Datos | [Unificar contratos SQLite/PostgreSQL](etapas/22-postgres-schema.md) |
| 23 | Datos | [Migraciones y harness PostgreSQL desechable](etapas/23-postgres-migraciones.md) |
| 24 | Datos | [Hacer atómicos turnos y sesiones](etapas/24-atomicidad-turnos.md) |
| 25 | Datos | [Controles compartidos de abuso y llamados duplicados](etapas/25-limites-dedup.md) |
| 26 | Datos | [Guardar plano sin pérdidas ni sobrescrituras](etapas/26-plano-atomico.md) |
| 27 | Entrega | [CI y build reproducible de despliegue](etapas/27-ci-release.md) |
| 28 | Piloto | [Ensayo integral del piloto con datos ficticios](etapas/28-ensayo.md) |
| 29 | Piloto | [Runbook y decisión humana de lanzamiento](etapas/29-salida-piloto.md) |

## Puertas de control

- 00–02: se puede comprobar el producto sin poner en riesgo datos existentes.
- 03–11: contención de capacidades inseguras y permisos del personal.
- 12–20: contratos operativos, transporte y contenido confiable.
- 21–27: artefactos, PostgreSQL, concurrencia y gates de release.
- 28–29: ensayo reproducible y decisión humana de piloto.

NO desplegar etapas intermedias de esta secuencia a un restaurante. Una etapa aprobada valida su alcance; no certifica al producto completo.

## Decisiones propuestas para este plan

1. Polling autenticado autoritativo para piloto; SSE público apagado. No contratar infraestructura de eventos.
2. Cobro presencial; toda simulación de aprobación digital bloqueada en backend.
3. QR estable identifica mesa, no crea ocupación ni acredita presencia física. El personal abre sesión; limitación de acceso remoto se documenta para GO/NO-GO.
4. SQLite para feedback rápido; PostgreSQL real desechable para garantías de producción.
5. IA en preview, sin publicación automática ni garantías dietarias no verificadas; apagada por defecto hasta controles de gasto.
6. Una sola ficha por ejecución; siguiente bloqueado hasta revisión de Codex.

Codex valida estas decisiones antes de desbloquear la ficha que las implementa; Rodrigo centraliza la comunicación entre Codex y Antigravity. No son afirmaciones de capacidades actuales.

## Después del piloto: backlog sin autorización de implementación

- Pagos reales: primero ADR de proveedor, responsabilidades, idempotencia, firma de webhook, conciliación, reembolsos, importes/moneda y sandbox. Luego nuevas fichas, no activar payEqualPart existente.
- Split: identidad por invitado, propiedad de claims, concurrencia PG y ledger; sólo tras diseño de pagos aprobado.
- Admisión fuerte por visita si QR fijo resulta insuficiente.
- SSE distribuido sólo con necesidad/carga medida.
- Preorden, fidelización y automatización comercial después de validar flujo básico.
- Rotación/revocación avanzada del personal y endurecimiento adicional según riesgos.

## Fuente y revisión

[CONTROL](CONTROL.md) es el estado operativo único. [BASELINE](BASELINE.md) resume evidencias de partida; el código actual prevalece sobre este texto y repomix. [PROTOCOLO](PROTOCOLO.md) explica la entrega.

La coordinación global conserva un índice en [roadmaps](../../../_orchestration/roadmaps/MESAYA-IMPLEMENTACION-2026-09-03.md), sin duplicar las fichas ni sus estados.

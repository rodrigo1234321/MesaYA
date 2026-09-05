# Control de etapas

Fecha de creación: 2026-09-03. Última etapa aprobada: **29**.

Etapa habilitada: ninguna; todas las etapas del plan están cerradas técnicamente. La decisión GO/NO-GO y cualquier despliegue continúan siendo autoridad exclusiva de Rodrigo.

| Etapa | Ficha | Estado | Requisito | Reporte | Revisión |
|---|---|---|---|---|---|
| 00 | [Inventario y punto de recuperación](etapas/00-base-segura.md) | APPROVED | Pedido de Rodrigo | [ETAPA-00](reportes/ETAPA-00.md) | [Revisión](revisiones/ETAPA-00.md) |
| 01 | [Aislar tests y proteger el seed](etapas/01-pruebas-aisladas.md) | APPROVED | 00 APPROVED + habilitación de Codex | [ETAPA-01](reportes/ETAPA-01.md) | [Revisión](revisiones/ETAPA-01.md) |
| 02 | [Restaurar build y contratos compartidos](etapas/02-build.md) | APPROVED | 01 APPROVED + habilitación de Codex | [ETAPA-02](reportes/ETAPA-02.md) | [Revisión](revisiones/ETAPA-02.md) |
| 03 | [Desactivar pagos y split simulados](etapas/03-pagos-bloqueados.md) | APPROVED | 02 APPROVED + habilitación de Codex | [ETAPA-03](reportes/ETAPA-03.md) | [Revisión](revisiones/ETAPA-03.md) |
| 04 | [Quitar fallbacks engañosos de IA](etapas/04-ia-contencion.md) | APPROVED | 03 APPROVED + habilitación de Codex | [ETAPA-04](reportes/ETAPA-04.md) | [Revisión](revisiones/ETAPA-04.md) |
| 05 | [Validar secretos, CORS y expiración](etapas/05-entorno-jwt.md) | APPROVED | 04 APPROVED + autorización explícita de Rodrigo | [ETAPA-05](reportes/ETAPA-05.md) | [Revisión](revisiones/ETAPA-05.md) |
| 06 | [Helpers de autorización y matriz de rutas](etapas/06-politica-auth.md) | APPROVED | 05 APPROVED | [ETAPA-06](reportes/ETAPA-06.md) | [Revisión](revisiones/ETAPA-06.md) |
| 07 | [Cerrar altas de personal y login admin](etapas/07-staff.md) | APPROVED | 06 APPROVED | [ETAPA-07](reportes/ETAPA-07.md) | [Revisión](revisiones/ETAPA-07.md) |
| 08 | [Proteger configuración, auditoría y métricas](etapas/08-config-metricas.md) | APPROVED | 07 APPROVED | [ETAPA-08](reportes/ETAPA-08.md) | [Revisión](revisiones/ETAPA-08.md) |
| 09 | [Proteger todas las mutaciones del menú](etapas/09-menu.md) | APPROVED | 08 APPROVED | [ETAPA-09](reportes/ETAPA-09.md) | [Revisión](revisiones/ETAPA-09.md) |
| 10 | [Proteger mesas y apertura/cierre de turno](etapas/10-mesas-turnos.md) | APPROVED | 09 APPROVED | [ETAPA-10](reportes/ETAPA-10.md) | [Revisión](revisiones/ETAPA-10.md) |
| 11 | [Autorizar plano y transiciones FSM](etapas/11-plano-fsm-auth.md) | APPROVED | 10 APPROVED + habilitación de Codex | [ETAPA-11](reportes/ETAPA-11.md) | [Revisión](revisiones/ETAPA-11.md) |
| 12 | [Separar QR estable de sesión operativa](etapas/12-sesiones-qr.md) | APPROVED | 11 APPROVED | [ETAPA-12](reportes/ETAPA-12.md) | [Revisión](revisiones/ETAPA-12.md) |
| 13 | [Validar llamados, feedback y lecturas privadas](etapas/13-llamados-feedback.md) | APPROVED | 12 APPROVED | [ETAPA-13](reportes/ETAPA-13.md) | [Revisión](revisiones/ETAPA-13.md) |
| 14 | [Validar pedidos del comensal](etapas/14-pedidos-invitado.md) | APPROVED | 13 APPROVED | [ETAPA-14](reportes/ETAPA-14.md) | [Revisión](revisiones/ETAPA-14.md) |
| 15 | [Autorizar cocina y estados de pedidos](etapas/15-pedidos-staff.md) | APPROVED | 14 APPROVED | [ETAPA-15](reportes/ETAPA-15.md) | [Revisión](revisiones/ETAPA-15.md) |
| 16 | [Cerrar lista de espera y módulos incompletos](etapas/16-espera.md) | APPROVED | 15 APPROVED | [ETAPA-16](reportes/ETAPA-16.md) | [Revisión](revisiones/ETAPA-16.md) |
| 17 | [Cerrar SSE público y definir snapshots](etapas/17-stream-cierre.md) | APPROVED | 16 APPROVED | [ETAPA-17](reportes/ETAPA-17.md) | [Revisión](revisiones/ETAPA-17.md) |
| 18 | [Reconexión y avisos consistentes](etapas/18-polling-clientes.md) | APPROVED | 17 APPROVED | [ETAPA-18](reportes/ETAPA-18.md) | [Revisión](revisiones/ETAPA-18.md) |
| 19 | [Eliminar inyección de contenido en cliente](etapas/19-xss.md) | APPROVED | 18 APPROVED | [ETAPA-19](reportes/ETAPA-19.md) | [Revisión](revisiones/ETAPA-19.md) |
| 20 | [Acotar generación IA y validar respuestas](etapas/20-ia-limites.md) | APPROVED | 19 APPROVED | [ETAPA-20](reportes/ETAPA-20.md) | [Revisión](revisiones/ETAPA-20.md) |
| 21 | [Build del cliente sin dependencias de demo](etapas/21-assets.md) | APPROVED | 20 APPROVED | [ETAPA-21](reportes/ETAPA-21.md) | [Revisión](revisiones/ETAPA-21.md) |
| 22 | [Unificar contratos SQLite/PostgreSQL](etapas/22-postgres-schema.md) | APPROVED | 21 APPROVED | [ETAPA-22](reportes/ETAPA-22.md) | [Revisión](revisiones/ETAPA-22.md) |
| 23 | [Migraciones y harness PostgreSQL desechable](etapas/23-postgres-migraciones.md) | APPROVED | 22 APPROVED | [ETAPA-23](reportes/ETAPA-23.md) | [Revisión](revisiones/ETAPA-23.md) |
| 24 | [Hacer atómicos turnos y sesiones](etapas/24-atomicidad-turnos.md) | APPROVED | 23 APPROVED | [ETAPA-24](reportes/ETAPA-24.md) | [Revisión](revisiones/ETAPA-24.md) |
| 25 | [Controles compartidos de abuso y llamados duplicados](etapas/25-limites-dedup.md) | APPROVED | 24 APPROVED | [ETAPA-25](reportes/ETAPA-25.md) | [Revisión](revisiones/ETAPA-25.md) |
| 26 | [Guardar plano sin pérdidas ni sobrescrituras](etapas/26-plano-atomico.md) | APPROVED | 25 APPROVED | [ETAPA-26](reportes/ETAPA-26.md) | [Revisión](revisiones/ETAPA-26.md) |
| 27 | [CI y build reproducible de despliegue](etapas/27-ci-release.md) | APPROVED | 26 APPROVED | [ETAPA-27](reportes/ETAPA-27.md) | [Revisión](revisiones/ETAPA-27.md) |
| 28 | [Ensayo integral del piloto con datos ficticios](etapas/28-ensayo.md) | APPROVED | 27 APPROVED | [ETAPA-28](reportes/ETAPA-28.md) | [Revisión](revisiones/ETAPA-28.md) |
| 29 | [Runbook y decisión humana de lanzamiento](etapas/29-salida-piloto.md) | APPROVED | 28 APPROVED | [ETAPA-29](reportes/ETAPA-29.md) | [Revisión](revisiones/ETAPA-29.md) |

## Transiciones y autoridad

- Antigravity: READY -> IN_PROGRESS -> NEEDS_REVIEW. Puede marcar BLOCKED y explicar causa.
- Codex: NEEDS_REVIEW -> APPROVED o CHANGES_REQUESTED, después de inspeccionar código y pruebas.
- Rodrigo transmite los reportes entre Antigravity y Codex. Tras una revisión APPROVED, Codex habilita sólo la próxima ficha en READY y comunica esa autorización al ejecutor.
- CHANGES_REQUESTED: corregir la MISMA ficha; no comenzar la siguiente. Conservar revisiones anteriores y adjuntar evidencia nueva.
- Si falta entorno PG/acceso/decisión, BLOCKED con causa concreta y alternativa segura. Nunca inventar resultados.
- La etapa 29 APPROVED no equivale a permiso de despliegue: GO/NO-GO de Rodrigo es separado.

Los reportes se crean al ejecutar: `reportes/ETAPA-NN.md`. Las revisiones se crean al revisar: `revisiones/ETAPA-NN.md`. No hay reportes ni aprobaciones prefabricadas.

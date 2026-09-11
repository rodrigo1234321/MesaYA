# Control del plan integral

Este control es independiente del plan histórico de etapas 00–29. No lo reemplaza ni reescribe sus aprobaciones.

Estado general: **PLAN PREPARADO — ESPERANDO ASIGNACIÓN DE EJECUTOR**  
Rama de implementación: todavía no creada.  
Entorno estable: no modificar hasta completar el gate de cada tren.

| Etapa | Estado | Dependencia | Ejecutor | Commit/PR | Evidencia | Pausa |
|---|---|---|---|---|---|---|
| 00 | PENDIENTE_DE_ASIGNACIÓN | Plan aceptado | — | — | — | No |
| 01 | BLOQUEADA | 00 APPROVED | — | — | — | PAUSA A |
| 02 | BLOQUEADA | 01 APPROVED | — | — | — | No |
| 03 | BLOQUEADA | 02 APPROVED | — | — | — | PAUSA B |
| 04 | BLOQUEADA | 03 APPROVED + credenciales test | — | — | — | No |
| 05 | BLOQUEADA | 04 APPROVED | — | — | — | PAUSA C |
| 06 | BLOQUEADA | 05 APPROVED | — | — | — | No |
| 07 | BLOQUEADA | 06 APPROVED + local/tags/dispositivos | — | — | — | PAUSA D |
| 08 | BLOQUEADA | 07 APPROVED + decisión GO | — | — | — | CIERRE |

## Estados permitidos

`PENDIENTE_DE_ASIGNACIÓN -> READY -> IN_PROGRESS -> NEEDS_REVIEW -> APPROVED`

Si la revisión encuentra fallas: `NEEDS_REVIEW -> CHANGES_REQUESTED -> IN_PROGRESS`.  
Si falta una dependencia externa concreta: `BLOCKED`, con evidencia y siguiente acción.

## Gate de cada etapa

- Diff acotado y sin secretos.
- Prueba enfocada con casos positivos y negativos.
- Build de cada workspace tocado mediante el runner supervisado del repositorio.
- Suite aislada mediante el adaptador Windows Job; no saltear su guard.
- Para persistencia/concurrencia: PostgreSQL desechable.
- Para UI: recorrido manual en móvil y escritorio, con capturas.
- Reporte de qué se ejecutó y qué no.

## Gate de cada tren

| Tren | Criterio de salida |
|---|---|
| A | Configuración no promete funciones ausentes; caja presencial y ciclo de mesa se completan |
| B | Ninguna métrica inventa hechos; Sommelier supera el set de evaluación |
| C | Pagos sandbox reconciliados y split resistente a doble toque/concurrencia |
| D | QR y NFC físicos completan el guion del local y el rollback fue ensayado |


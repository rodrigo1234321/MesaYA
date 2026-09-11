# Control del plan de producto y piloto v2

Estado general: **ESPERANDO APROBACION DE DECISIONES**  
Rama de implementación: no creada.  
Entorno piloto: no modificar por la creación de este plan.

## Estados

`PROPOSED -> READY -> IN_PROGRESS -> NEEDS_REVIEW -> APPROVED`

Si hay fallas: `NEEDS_REVIEW -> CHANGES_REQUESTED -> IN_PROGRESS`.  
Si falta una dependencia externa concreta: `BLOCKED`, con evidencia y siguiente acción.

## Carril P

| Etapa | Estado | Dependencia | Evidencia requerida | Pausa |
|---|---|---|---|---|
| P00 | PROPOSED | Aprobación de decisiones | baseline + alcance firmado | Sí |
| P01 | BLOCKED | P00 APPROVED | config/capabilities + pruebas | Sí |
| P02 | BLOCKED | P01 APPROVED | caja presencial E2E | No |
| P03 | BLOCKED | P02 APPROVED | ciclo multiusuario en Preview | PAUSA A |
| P04 | BLOCKED | P03 APPROVED | fixtures y métricas trazables | No |
| P05 | BLOCKED | P04 APPROVED | set IA + revisión humana | PAUSA B |
| P06 | BLOCKED | P04 APPROVED; P05 aprobado o apagado | matriz QR/NFC | No |
| P07 | BLOCKED | P06 APPROVED + local/dispositivos | acta de ensayo | PAUSA C |
| P08 | BLOCKED | P07 APPROVED + GO humano | deployments + rollback | Sí |
| P09 | BLOCKED | P08 APPROVED | informe de observación | CIERRE |

## Carril E

| Etapa | Estado | Dependencia mínima |
|---|---|---|
| E01 | DEFERRED | P09 + decisión comercial |
| E02 | DEFERRED | P09 + local con necesidad de fila |
| E03 | DEFERRED | P09 + ADR + credenciales de prueba |
| E04 | DEFERRED | E03 APPROVED |
| E05 | DEFERRED | P09 + decisión de identidad/fidelización |

`DEFERRED` no significa READY. Ningún ejecutor debe iniciar una etapa E sin cambio explícito de estado.

## Gate de cada etapa

- diff acotado, sin secretos y sin borrar cambios ajenos;
- pruebas positivas, negativas, reintento y permisos;
- build de cada workspace afectado;
- suite aislada mediante el runner del repositorio;
- PostgreSQL desechable para persistencia/concurrencia;
- recorrido móvil/escritorio y capturas cuando haya UI;
- reporte con ejecutado, no ejecutado, riesgos y rollback;
- revisión independiente antes de habilitar la siguiente.

## Gate del piloto

- C01–C12 completan el recorrido con cobro presencial;
- P01–P08 permiten operar sin consola ni API manual;
- no hay módulos “activos” que sólo guarden configuración;
- no hay cifras inventadas en métricas operativas;
- Sommelier aprobado o apagado;
- QR/NFC pasan en iPhone y Android;
- backup/restauración y rollback fueron ensayados;
- no se procesa dinero productivo.


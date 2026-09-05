# Revisión Codex — Etapa 28

Veredicto: **APPROVED**
Fecha: 2026-09-05

## Alcance revisado

- Ficha y reporte de la Etapa 28.
- `packages/api/test/pilot-rehearsal.test.ts` y su registro en el runner aislado.
- Evidencia de PostgreSQL 16 efímero, build completo, runner completo y recorrido UI real consignada en el reporte.
- Corrección documental menor: se eliminaron dos referencias heredadas al bloqueo anterior de UI; no cambiaron código ni pruebas.

## Evidencia confirmada

| Verificación | Resultado |
|---|---|
| `node scripts/test-isolated.mjs pilot-rehearsal` | 8/8 PASS en SQLite aislada durante esta revisión |
| Integridad `packages/api/prisma/dev.db` | Hash canónico `499C2F9CD68D22079429D87FEA17DDC503F98069097637B22D4365C043148CFF` |
| Ensayo PostgreSQL 16, build 6/6 y runner 30/30 | Evidencia de ejecución registrada y revisada en el reporte |
| UI real | Admin, Cliente y Staff verificados contra PostgreSQL/API efímeros; apertura, llamado, atención, cierre y revocación observables |

## Hallazgos

No hay hallazgos bloqueantes. El ensayo no usó pagos digitales reales, datos reales, despliegue ni una base demo. La cobertura UI es complementaria; el recorrido de pedido/cocina/cuenta/cobro, A/B y reinicio queda probado por la suite aislada de integración.

## Decisión

Etapa 28 queda **APPROVED**. Se habilita exclusivamente la Etapa 29, cuyo resultado será un runbook y una decisión humana informada; no autoriza deploy, migración real, cobros ni operación de restaurante.

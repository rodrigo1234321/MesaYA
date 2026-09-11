# CONTROL — Plan de simplificación operativa MesaYA

**Corte:** 2026-09-10 -03:00  
**Repositorio:** `mdpmesasvivas`  
**Rama:** `antigravity/core-capabilities-stage00`  
**Commit de base observado:** `0773ca622616d261b6cc20d83cd98a0c5f6eafc4`

Este control conserva el estado real del checkout compartido. El worktree ya estaba
ampliamente modificado antes de este ciclo; los cambios ajenos se preservan. No se
ejecutó despliegue, conexión a Supabase/Vercel real ni uso de datos reales.

## Estado de etapas

| Etapa | Estado | Evidencia / condición |
|---|---|---|
| E00 | PASS_LOCAL_NEEDS_REVIEW | Baseline reproducible; suite completa verde y checkout compartido preservado. |
| E01 | PASS_LOCAL_NEEDS_REVIEW | Contrato canónico de ocupación/cuenta/roles contrastado con rutas, FSM y ledger. |
| E02 | PASS_LOCAL_NEEDS_REVIEW | Rotación segura, bloqueo por deuda/limpieza y coalescencia de carreras; QR físico estable. |
| E03 | PASS_LOCAL_NEEDS_REVIEW | Cobro/cierre atómico, idempotente y con transición explícita a `TO_CLEAN`. |
| E04 | PASS_LOCAL_NEEDS_REVIEW | Proyección única de Servicio con detalle, participantes, notas y contexto de cuenta. |
| E05 | PASS_LOCAL_NEEDS_REVIEW | Validación sólo por excepción; pedido normal y dos unidades no requieren aprobación. |
| E06 | PASS_LOCAL_NEEDS_REVIEW | Reclamo/acción atómica con un único propietario y conflictos recuperables. |
| E07 | PASS_LOCAL_NEEDS_REVIEW | Servicio es la pantalla primaria; Cocina y Caja dejaron de ser módulos primarios. |
| E08 | PASS_LOCAL_NEEDS_REVIEW | Cocina aparece dentro de la cola/mapa de Servicio y conserva el propietario de `READY`. |
| E09 | PASS_LOCAL_NEEDS_REVIEW | Retiro/entrega tiene una acción por intención e idempotencia/deshacer. |
| E10 | PASS_LOCAL_NEEDS_REVIEW | Cuenta acumulada, cobro y reautorización inline dentro del contexto de mesa. |
| E11 | PASS_LOCAL_NEEDS_REVIEW | `Mesa lista` confirma limpieza, deja `AVAILABLE` y prepara sesión nueva vacía. |
| E12 | PASS_LOCAL_NEEDS_REVIEW | Agregar conserva la carta; el carrito se abre voluntariamente. |
| E13 | PASS_LOCAL_NEEDS_REVIEW | Nombre de participante separado de nota de cocina, saneado y sin IDs técnicos. |
| E14 | PASS_LOCAL_NEEDS_REVIEW | Sugerencias contextuales, máximo dos, excluidas/descartables y no bloqueantes. |
| E15 | PASS_LOCAL_NEEDS_REVIEW | Suite completa + recorrido LAN cliente/mozo ejecutados; falta revisión independiente y piloto real. |

## Gates ejecutados en este ciclo

```text
npm run test:local
64 archivos: 571 tests passed, 3 skipped explícitos
```

| Gate | Estado local | Evidencia resumida |
|---|---|---|
| G-A | PASS_LOCAL_NEEDS_REVIEW | E00-E03: 17/17; QR, deuda, cierre, rotación y carreras verdes. |
| G-B | PASS_LOCAL_NEEDS_REVIEW | E04-E06 y pruebas de conflictos/idempotencia dentro de la suite completa verde. |
| G-C | PASS_LOCAL_NEEDS_REVIEW | Servicio único, cocina integrada, cobro inline, entrega y limpieza verificados en API/UI LAN. |
| G-D | PASS_LOCAL_NEEDS_REVIEW | E12-E14 focal: 10/10; carta continua, colaboración y sugerencias verificadas. |
| G-E | PASS_LOCAL_NEEDS_REVIEW | E15: 64 archivos/571 tests + build/checks + recorrido cliente/mozo LAN. |

## Decisiones cerradas en este corte

- Un pedido común pasa directo a cocina. La validación queda para excepciones
  configuradas (agotado/cambio, umbral, modo manual); no se usa para contar gin ni
  para confirmar rutinariamente una nota de alergia contemplada por la carta.
- `Mesa lista` es la segunda intención humana del recambio: además de cambiar la FSM
  a `AVAILABLE`, prepara una sesión nueva, vacía y con token nuevo. El GET del QR
  sigue siendo read-only.
- La autorización de encargado, cuando el actor es mozo, aparece inline y puntual;
  no requiere abrir Caja/Admin ni deja una sesión permanente de manager.

## Límite de este control

`PASS_LOCAL_NEEDS_REVIEW` no equivale a GO de piloto o producción. No se ejecutaron
despliegue/restauración Supabase-Vercel, QR/NFC físico en un teléfono real ni revisión
independiente de OpenCode en este corte. OpenCode no pudo aportar esa revisión por
`AI_APICallError: Rate limit exceeded`; la ejecución local y la verificación principal
se completaron directamente sobre el checkout compartido.

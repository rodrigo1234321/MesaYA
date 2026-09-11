# Reporte de etapa 18 — Rewards con ledger

Estado: **APPROVED LOCALMENTE**  
Fecha: 2026-09-07

## Decisión

Rewards deja de ser un calculador aislado. Se habilita sólo cuando el encargado activa el módulo y existe un catálogo de premios. La identidad se asocia al teléfono normalizado, la acreditación requiere consentimiento explícito en caja y cada cambio de saldo queda en un ledger inmutable con versión de regla e idempotencia.

## Implementado

- `CustomerLoyalty` conserva saldo cacheado, consentimiento y versión optimista.
- `RewardLedgerEntry` registra acreditaciones, canjes y reversiones sin editar movimientos anteriores.
- El cobro manual puede acreditar puntos automáticamente usando el monto confirmado y la regla `rewards-v1`.
- El canje verifica saldo, catálogo, tenant, consentimiento e idempotencia dentro de una transacción.
- La cancelación de un canje genera una reversión positiva; reintentarla devuelve el mismo resultado.
- Administración puede cargar el catálogo; la pantalla compartida consulta saldo y canjea premios.
- Si Rewards está apagado, la API rechaza nuevas acreditaciones y no crea identidades.

## Verificación

| Verificación | Resultado |
|---|---|
| ledger, idempotencia, canje, reversión y regla de puntos | 27/27 PASS en suites dirigidas |
| build API con Prisma actualizado | PASS |
| build pantalla staff con caja + Rewards | PASS |
| build administración con catálogo | PASS |
| schema canónico/Supabase sincronizado | PASS |
| matriz de rutas | 86 rutas clasificadas |

## Límites

- La acreditación automática sólo se produce para cobro manual confirmado y teléfono con consentimiento; no se inventan puntos para pagos autónomos.
- Split/cobro digital continúa cerrado por decisión funcional de esta release.
- PostgreSQL/Supabase remoto, backup/restore y prueba con dispositivos reales quedan para sus gates externos.

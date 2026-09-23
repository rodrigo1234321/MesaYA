# E09 — Rewards simple y trazable

Estado: `PASS_LOCAL / REVIEW_PROVIDER_BLOCKED`

Fecha: 2026-09-21
Base: `codex/plan-modulos-20260920` sobre `6a1cdae`
Alcance: circuito asistido por personal del local; no se implementa un perfil autónomo del cliente.

## Resultado

E09 queda funcional y verificado localmente para el flujo asistido:

- alta explícita con consentimiento y teléfono canónico;
- consulta de saldo que nunca crea una cuenta por lectura;
- ledger append-only con idempotencia, versión optimista y trazabilidad `approvedBy`;
- puntos calculados sobre consumo efectivamente pagado, sin propina;
- atribución del consumo elegible en split;
- canje, cancelación de canje y reversión manual con permisos de encargado;
- recuperación de `rewardsWarning` en cobro legado;
- reversión proporcional e idempotente al crear un ajuste de devolución de `AccountSettlement`;
- aislamiento entre restaurantes y rechazo de operaciones de otro tenant.

La identidad se normaliza a `+549` más exactamente diez dígitos nacionales. Se rechazan números parciales o ambiguos; los formatos con `0`, `+54`, `+549` y `15` admitidos se convierten al mismo valor.

## Cambios principales

- `packages/api/src/services/rewards.service.ts`
  - normalización estricta de teléfono;
  - consentimiento obligatorio para alta/acreditación de cliente nuevo;
  - `accrueForSettlementTx` transaccional para `settle` y `settle-and-close`;
  - `pointsEarned` derivado del ledger existente también en replay;
  - reconciliación de pagos y settlements confirmados;
  - `reverseSettlementAdjustment` proporcional, idempotente y sin saldo negativo;
  - reversión manual y operaciones de canje auditables.
- `packages/api/src/services/order.service.ts`
  - cableado de teléfono/consentimiento en las dos rutas de cuenta y en el cobro legado;
  - puntos basados en `amountMinor`, no en `tipMinor`;
  - `rewardsWarning` no deshace un cobro presencial ya confirmado.
- `packages/api/src/services/sales-reports.service.ts`
  - un ajuste de consumo intenta automáticamente revertir los puntos asociados;
  - una falla de Rewards deja advertencia segura y no elimina la devolución financiera append-only.
- `packages/api/src/routes/rewards.routes.ts`, `orders.routes.ts`, `scripts/route-matrix.json`
  - alta, reconciliación y reversión con permisos/tenant explícitos.
- `packages/api/prisma/schema.prisma`, `schema.supabase.prisma` y
  `packages/api/prisma/migrations-postgres/20260921130000_e09_reward_ledger_approved_by/migration.sql`
  - `RewardLedgerEntry.approvedBy` nullable y compatible con histórico.

## Evidencia local

| Gate | Resultado |
|---|---:|
| `node scripts/test-local.mjs e09-rewards-payment.test.ts rewards-ledger.test.ts` | 2 archivos, 24/24 |
| Regresión `e04-cash-pin-contract`, `e05-split-bill`, `e06-tips-reviews` | 3 archivos, 52/52 |
| `npm run check:routes` | 115 rutas, sin deriva |
| `npm run check:supabase-schema` | sincronizado |
| `npm run prisma:generate` | OK |
| `npm run build` | 6/6 workspaces |
| `git diff --check` | exit 0; sólo avisos LF/CRLF |

La suite E09 contiene 20 casos: formatos inválidos, consentimiento, consulta sin creación, puntos sin propina, replay, split, tenants, canje/cancelación, reversión de ledger, módulo apagado, reconcile-settlement, settle-and-close, devolución proporcional, `rewardsWarning` + `reconcile-payment` y canje concurrente.

## Revisión y workflow

- Antigravity fue el ejecutor principal intentado para E09 (`agy` headless), pero la sesión terminó con cuota individual agotada antes de cerrar la etapa.
- OpenCode fue el fallback. El modelo pago devolvió `No payment method`; no se reintentó ni se usaron tokens de Codex. El contribuidor gratuito aplicó la primera corrección de E09, pero la sesión posterior de corrección quedó limitada por proveedor; las correcciones finales fueron aplicadas y verificadas por el supervisor en el mismo worktree.
- La primera revisión independiente de OpenCode encontró hallazgos P1/P2 concretos. Se resolvieron la normalización laxa, la reversión de ajustes, `settle-and-close`, `reconcile-payment`, la recuperación de advertencia y el canje concurrente.
- Los intentos de revisión independiente final posteriores fueron bloqueados por `Rate limit exceeded`/sin salida utilizable. Por eso el estado no se presenta como `PASS_E09` externo: es `PASS_LOCAL / REVIEW_PROVIDER_BLOCKED`.

## Límites y pendientes

- No existe en el checkout una ruta de mutación que cambie un `PaymentTransaction` legado a `REFUNDED`; sí existe reconciliación segura para pagos confirmados y `reversePayment` para una devolución operativa posterior. La integración automática de un webhook/proveedor legacy queda pendiente hasta definir esa fuente de verdad.
- La reversión proporcional no fuerza el saldo a negativo si el cliente ya gastó puntos; devuelve una advertencia para revisión del encargado.
- La aprobación del alta de cliente no crea una fila de ledger; `approvedBy` queda persistido en movimientos de puntos. Si se requiere auditoría formal del consentimiento, falta un registro de consentimiento separado.
- `PENDING_CLOUD`: aplicar la migración en Supabase real, respaldar antes, verificar el SHA desplegado y probar recuperación contra PostgreSQL real.
- `PENDING_HUMAN`: definir texto de consentimiento, política de vencimiento/devoluciones y guion para que el cliente consulte puntos al personal.

No se hicieron commits, push, despliegues ni mutaciones remotas.

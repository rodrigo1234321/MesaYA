# CORRECCIONES DE REVISIÓN — Etapas 04 a 06

Estado: APROBADO PARA INTEGRACIÓN
Fecha: 2026-09-06
Base revisada: `355c89d` (etapas 03–06)
Rama de corrección: `codex/fix-stages-04-06-review`

Este documento cierra los hallazgos de la revisión técnica de las etapas de pedidos a cocina y operación KDS. No modifica la etapa 07, que continúa aislada en su propio worktree.

## Correcciones aplicadas

### Etapa 04 — Concurrencia e idempotencia de tandas

- `TableSession.nextTandaSeq` reserva la secuencia mediante un incremento atómico dentro de la transacción. Se elimina el cálculo `MAX(seq) + 1`, que podía colisionar cuando dos personas de una mesa enviaban pedidos al mismo tiempo.
- Una solicitud concurrente con la misma `idempotencyKey` ya no puede terminar en un error técnico de unicidad. Si la tanda ganadora pertenece a la misma sesión, participante y carga exacta, se devuelve esa tanda; cualquier diferencia devuelve `409 IDEMPOTENCY_CONFLICT`.
- Las notas generales de la tanda ahora se validan, persisten en `OrderTanda.notes` y se exponen en el DTO. Esto conserva instrucciones relevantes para cocina, incluidos alérgenos.
- La migración PostgreSQL aditiva inicializa `nextTandaSeq` con el siguiente valor válido para sesiones que ya tengan tandas.

### Etapa 05 — Reintento seguro desde el móvil

- El cliente conserva una clave de idempotencia pendiente en `sessionStorage`, separada por mesa y participante.
- Ante una respuesta perdida o un corte de red, reenviar exactamente el mismo carrito y nota reutiliza la clave anterior, por lo que el servidor devuelve la tanda ya creada en vez de duplicar la comanda.
- Cambiar productos, cantidades o nota cambia la huella del payload y crea una nueva clave.
- La clave pendiente sólo se elimina después de una respuesta exitosa.

### Etapa 06 — Operación KDS consistente y trazable

- `validateOrder` y todas las transiciones operativas de órdenes y tandas se ejecutan dentro de una sola transacción.
- El cobro manual, la actualización de la orden y la sincronización de tandas quedan incluidos en la misma transacción.
- El motivo escrito al rechazar una comanda se transmite desde el KDS, se valida, se persiste en `Order.cancellationReason` y se devuelve al cliente.

## Migración requerida antes de desplegar

La migración nueva es:

`packages/api/prisma/migrations-postgres/20260906000000_fix_ordering_consistency/migration.sql`

Es estrictamente aditiva: agrega tres columnas y calcula el próximo número de tanda de cada sesión existente. En Supabase/Vercel debe aplicarse por el flujo controlado de `prisma migrate deploy`; no usar `db push`, `migrate dev`, reset ni seed contra una base real.

## Pruebas ejecutadas

- `node scripts/test-isolated.mjs cocina-cuentas-etapa-04` con SQLite efímera: **13/13 PASS**. Incluye tandas concurrentes de participantes distintos y reintentos concurrentes con la misma clave.
- `node scripts/test-isolated.mjs cocina-cuentas-etapa-05`: **15/15 PASS**.
- `node scripts/test-isolated.mjs cocina-cuentas-etapa-06`: **14/14 PASS**. Incluye rollback real si falla la sincronización de tandas y persistencia del motivo de rechazo.
- `node scripts/sync_supabase_schema.js --check`: esquema Supabase sincronizado.
- `node scripts/check-route-matrix.mjs`: **80 rutas** clasificadas, sin deriva.
- TypeScript de `@mesaya/shared` y `@mesaya/api`: PASS.
- Build ordenado de los seis workspaces: PASS.

## Límites de esta corrección

La funcionalidad de división de cuenta y pagos parciales pertenece a la etapa 07 y no fue modificada aquí. Este conjunto deja sólidas las etapas ya revisadas sin mezclar esos cambios con el trabajo que sigue en curso.

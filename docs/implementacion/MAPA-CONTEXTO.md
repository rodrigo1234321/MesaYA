# Mapa de contexto rápido — MesaYA

Propósito: reducir exploración repetida de OpenCode. Es un índice, no una fuente de autoridad: antes de editar, la ficha de etapa y `CONTROL.md` prevalecen.

## Lectura mínima por etapa

1. `docs/implementacion/CONTROL.md`
2. `docs/implementacion/etapas/NN-*.md`
3. Sólo la ruta y el servicio nombrados por la ficha.
4. La prueba enfocada de ese módulo y los consumidores que la ficha enumere.

No recorrer el repositorio completo ni releer etapas ya aprobadas salvo que haya una firma o contrato compartido afectado.

## Flujo principal

```text
Cliente QR/staff/admin
        │
        ▼
packages/api/src/index.ts  (/v1)
        │
        ▼
packages/api/src/routes/*.routes.ts
        │
        ▼
packages/api/src/services/*.service.ts
        │
        ▼
packages/api/prisma/schema.prisma + Prisma SQLite/PostgreSQL
```

## Mapa de módulos

| Dominio | Rutas | Servicio principal | Cliente | Etapas relevantes |
|---|---|---|---|---|
| Sesión QR | `sessions.routes.ts` | `session.service.ts` | `apps/client-web/app.js` | 12–14 |
| Llamados | `calls.routes.ts` | `call.service.ts` | `apps/client-web/app.js`, `apps/staff-panel/src/lib/api.ts` | 13, 25 |
| Feedback | `feedback.routes.ts` | `feedback.service.ts` | cliente web | 13 |
| Pedidos invitado | `orders.routes.ts` | `order.service.ts` | cliente web | 14 |
| Pedidos staff/cocina | `orders.routes.ts` | `order.service.ts` | staff panel | 15 |
| Mesas y turnos | `tables.routes.ts`, `shifts.routes.ts` | `shift.service.ts`, `session.service.ts` | admin/staff | 10, 24 |
| FSM y plano | `tablestate.routes.ts`, `floorplan.routes.ts` | `fsm.service.ts`, `floorplan.service.ts` | admin dashboard | 11, 26 |
| Menú | `menu.routes.ts` | — | cliente/admin | 09, 14, 21 |
| Espera | `waitlist.routes.ts` si existe | `waitlist.service.ts` | paneles | 16 |
| SSE/polling | `stream.routes.ts` | `eventBus`, servicios emisores | cliente/staff/admin | 17–18 |
| Configuración/métricas | `config.routes.ts`, `metrics.routes.ts` | `config.service.ts`, `metrics.service.ts` | admin | 08 |

## Contratos de seguridad ya establecidos

- Toda mutación de invitado exige `TableSession` existente, abierta, no expirada y asociada a turno abierto.
- Una transición a `TO_CLEAN` o `AVAILABLE` revoca la `TableSession`; token viejo no habilita QR, llamados, feedback ni pedidos.
- Staff se deriva del JWT vigente contra base de datos; IDs/actores enviados por body no son autoridad.
- Recursos de otro tenant se rechazan antes de mutar. No incorporar tokens de invitado en DTOs públicos/staff.
- QR canónico: `/r/:slug/mesa/:label`. La lectura QR no crea restaurante, mesa, turno ni sesión.
- Pagos digitales continúan bloqueados; no simular éxito.

## Pruebas y gates

- Runner: `scripts/test-isolated.mjs`; una SQLite efímera por suite bajo `.tmp/qa/<uuid>`.
- Siempre ejecutar primero la suite enfocada de la etapa, luego `node scripts/build.mjs` y `node scripts/test-isolated.mjs` con `MESAYA_BOUNDED_JOB=1`.
- `packages/api/prisma/dev.db` no se modifica; validar SHA-256 al final.
- Suites de referencia: `qr-session-lifecycle`, `calls-feedback-access`, `fsm-concurrency`, `floorplan-fsm-access`, `full-system-e2e`.

## Navegación de la etapa actual

Para Etapa 14, abrir primero y sólo:

1. `docs/implementacion/etapas/14-pedidos-invitado.md`
2. `packages/api/src/routes/orders.routes.ts`
3. `packages/api/src/services/order.service.ts`
4. Las llamadas a pedidos en `apps/client-web/app.js`
5. La prueba enfocada que se cree para pedidos.

Actualizar este mapa sólo si cambian rutas registradas, límites de seguridad compartidos o relaciones entre módulos.

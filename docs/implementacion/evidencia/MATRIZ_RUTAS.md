# Matriz de rutas — Etapa 06

Fecha: 2026-09-04. Esta matriz inventaría la política objetivo; no implica que todos los módulos ya estén cerrados. Las columnas **Actor** y **Tenant** indican el control que deben aplicar las fichas posteriores. Las rutas públicas son excepciones explícitas, no un permiso implícito para el resto.

| Plugin | Método y ruta | Actor objetivo | Tenant / nota |
|---|---|---|---|
| auth | `GET /restaurants` | Público | Directorio de plataforma; sin datos privados |
| auth | `POST /auth/register-restaurant` | Público controlado | Alta de plataforma; fuera del tenant previo |
| auth | `POST /auth/login-admin` | Público | Emite token de staff para el tenant autenticado |
| staff | `POST /staff/login` | Público | Emite token de staff para el slug autenticado |
| staff | `GET /staff` | Manager | Tenant obtenido del token, nunca de query |
| staff | `POST /staff` | Manager | Alta dentro del tenant del token |
| sessions | `GET /sessions/:token` | Invitado/sesión | Token opaco de sesión |
| sessions | `GET /sessions/:slug/:tableLabel` | Público excepcional | Debe validar mesa/sesión al resolver |
| sessions | `GET /sessions/table/:label` | Público excepcional | No debe exponer otros tenants |
| menu | `GET /restaurants/:slugOrId/menu` | Público | Carta publicada del tenant solicitado |
| menu | `GET /restaurants/:slugOrId/upsell` | Invitado/sesión | Sólo ítems del tenant solicitado |
| menu | `POST /restaurants/:slugOrId/menu/categories` | Manager | Tenant del token debe coincidir |
| menu | `DELETE /restaurants/:slugOrId/menu/categories/:categoryId` | Manager | Ocultar recurso ajeno con 404 |
| menu | `POST /restaurants/:slugOrId/menu/items` | Manager | Tenant del token debe coincidir |
| menu | `PATCH /restaurants/:slugOrId/menu/items/:itemId` | Manager | Ocultar recurso ajeno con 404 |
| menu | `DELETE /restaurants/:slugOrId/menu/items/:itemId` | Manager | Ocultar recurso ajeno con 404 |
| menu | `POST /restaurants/:slugOrId/menu/import` | Manager | Importación sólo del tenant propio |
| menu | `PATCH /restaurants/:slugOrId/branding` | Manager | Configuración privada del tenant |
| menu | `PATCH /restaurants/:slugOrId/template` | Manager | Configuración privada del tenant |
| menu | `POST /restaurants/:slugOrId/menu/ai-generate` | Manager | Preview IA; nunca autoaplicar |
| menu | `POST /restaurants/:slugOrId/ai-sommelier` | Invitado/sesión | Sólo carta/sesión del tenant |
| calls | `POST /calls` | Invitado/sesión | Validar sesión de mesa, no body tenant |
| calls | `PATCH /calls/:id` | Staff | Llamado debe pertenecer al tenant del token |
| calls | `POST /calls/:id/cancel` | Invitado/sesión | Validar titularidad de sesión |
| calls | `GET /calls` | Staff | Filtrar estrictamente por tenant del token |
| stream | `GET /stream` | Público excepcional | SSE debe convertirse en snapshot tenant/sesión en etapa 17 |
| orders | `GET /orders/session/:token` | Invitado/sesión | Token opaco de sesión |
| orders | `POST /orders` | Invitado/sesión | Resolver mesa desde sesión, no body |
| orders | `DELETE /orders/:id` | Invitado/sesión | Verificar titularidad de sesión |
| orders | `POST /orders/:id/confirm` | Invitado/sesión | Verificar titularidad de sesión |
| orders | `POST /orders/:id/cancel` | Invitado/sesión | Verificar titularidad de sesión |
| orders | `GET /orders/:id` | Staff | Recurso debe pertenecer al tenant |
| orders | `POST /orders/:id/accept` | Staff | Tenant y transición válidos |
| orders | `PATCH /orders/:id/status` | Staff | Tenant y FSM válidos |
| orders | `POST /orders/claim-item` | Staff | Tenant y asignación válidos |
| orders | `POST /orders/:id/split` | Staff | Pago digital deshabilitado; tenant igual |
| orders | `POST /orders/:id/payment` | Staff | Pago digital deshabilitado; tenant igual |
| shifts | `POST /shifts/open` | Manager | Tenant del token |
| shifts | `POST /shifts/:id/close` | Manager | Turno del tenant; ocultar ajeno |
| shifts | `GET /shifts/current` | Staff | Tenant del token |
| tables | `GET /restaurants/:id/tables` | Staff | Tenant del token; no inventariar otros locales |
| tables | `POST /restaurants/:id/tables` | Manager | Tenant del token |
| tables | `POST /tables/:id/close-session` | Staff | Mesa del tenant |
| tables | `POST /tables/:id/new-session` | Staff | Mesa del tenant |
| tables | `DELETE /tables/:id` | Manager | Mesa del tenant |
| tablestate | `POST /tables/:tableId/state/tap` | Invitado/sesión | Mesa ligada a sesión válida |
| tablestate | `POST /tables/:tableId/state/override` | Manager | Mesa del tenant |
| tablestate | `GET /tables/:tableId/state-history` | Staff | Mesa del tenant |
| tablestate | `GET /tables/states/:restaurantId` | Staff | Tenant del token |
| floorplan | `GET /floor-plan/:restaurantId` | Staff | Tenant del token |
| floorplan | `PUT /floor-plan/:restaurantId` | Manager | Tenant del token |
| floorplan | `PATCH /tables/:tableId/position` | Manager | Mesa del tenant |
| floorplan | `POST /floor-plan/:restaurantId/zones` | Manager | Tenant del token |
| floorplan | `PATCH /floor-plan/:restaurantId/zones/:id` | Manager | Zona del tenant |
| floorplan | `DELETE /floor-plan/:restaurantId/zones/:id` | Manager | Zona del tenant |
| floorplan | `DELETE /floor-plan/:restaurantId/tables/:tableId` | Manager | Mesa y plano del mismo tenant |
| config | `GET /config/:slug` | Público | Sólo configuración pública de carta |
| config | `GET /config/id/:id` | Manager | Configuración privada del tenant |
| config | `PATCH /config/:id` | Manager | Tenant del token |
| config | `GET /config/:id/audit` | Manager | Auditoría sólo del tenant |
| config | `GET /config/:slugOrId/loyalty` | Invitado/sesión | Datos limitados al tenant/sesión |
| metrics | `GET /metrics` | Manager | Agregados sólo del tenant del token |
| analytics | `GET /analytics/overview/:restaurantId` | Manager | Tenant del token |
| analytics | `GET /analytics/demand/:restaurantId` | Manager | Tenant del token |
| analytics | `GET /analytics/menu/:restaurantId` | Manager | Tenant del token |
| analytics | `GET /analytics/staff/:restaurantId` | Manager | Tenant del token |
| feedback | `POST /feedback` | Invitado/sesión | Ligado a sesión/mesa, no tenant de body |
| waitlist | `POST /waitlist` | Público controlado | Entrada pública, rate limit posterior |
| waitlist | `GET /waitlist/:id` | Invitado/sesión | ID opaco o staff del tenant |
| waitlist | `PATCH /waitlist/:id/seat` | Staff | Lista y mesa del tenant |
| waitlist | `PATCH /waitlist/:id/status` | Staff | Lista del tenant |
| health | `GET /health`, `GET /v1/health` | Público | Sin datos de tenant |

## Convención de respuestas

- `401 UNAUTHORIZED`: token ausente, inválido, vencido o staff inexistente/movido.
- `403 FORBIDDEN`: identidad vigente pero rol insuficiente.
- `404 NOT_FOUND`: recurso o tenant ajeno cuando el detalle permitiría enumeración.
- Los helpers detienen el hook al enviar una respuesta; ningún handler debe continuar tras un rechazo.

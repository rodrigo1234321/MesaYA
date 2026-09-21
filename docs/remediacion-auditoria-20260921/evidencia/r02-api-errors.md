# Evidencia R02 — Errores API Seguros y Tipados

Fecha: 2026-09-21
Candidato: `C:\Users\rodri\Desktop\AI\Projects\mdpmesasvivas-remediacion-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## 1. Acciones Realizadas

### A. Refactorización y Endurecimiento de `errorHandler.ts`
- **Tipado estricto:** Firma actualizada a `sendSanitizedError(reply: FastifyReply, err: unknown, extraFields?: Record<string, unknown>)`.
- **Enmascaramiento de patrones DB:** Implementado filtro regex contra fugas de Prisma, PostgreSQL, SQLite, nombres de tablas/columnas o trazas de invocación interna (`/prisma/i`, `/foreign key/i`, `/unique constraint/i`, `/syntax error/i`, etc.). Si un error de BD adquiere código 4xx, el mensaje devuelto al cliente se sustituye por uno seguro (`Error en la solicitud`).
- **Redacción de secretos en `details`:** `details` valida que no contenga tokens, passwords, secrets, ni URLs de conexión.
- **Cabecera HTTP estándar:** Inyección automática de `Retry-After: <seconds>` ante errores 429 `TOO_MANY_REQUESTS`.
- **Consistencia de contrato:** `error: publicCode`, `code: publicCode`, `message: publicMessage`, `requestId: <id>`.

### B. Eliminación de Bypasses en Rutas
Se escanearon las 19 familias de rutas (`packages/api/src/routes/*.routes.ts`). Se eliminaron los 6 bypasses identificados:
1. `floorplan.routes.ts:104`: PUT `/floor-plan/:restaurantId` -> Ahora canalizado por `sendSanitizedError`.
2. `floorplan.routes.ts:158`: PATCH `/tables/:tableId/position` -> Ahora canalizado por `sendSanitizedError`.
3. `sessions.routes.ts:39`: GET `/sessions/:slug/:tableLabel` -> Canalizado con `{ valid: false }`.
4. `sessions.routes.ts:62`: GET `/sessions/table/:label` (demo) -> Canalizado con `{ valid: false }`.
5. `tablestate.routes.ts:67`: POST `/tables/:tableId/state/tap` -> Bloque multi-if reemplazado por `sendSanitizedError`.
6. `tablestate.routes.ts:134`: POST `/tables/:tableId/state/override` -> Búsqueda manual de código reemplazada por `sendSanitizedError`.

Verificación estática posterior: **0 bypasses restantes**.

### C. Verificación de Pruebas
- `packages/api/test/error-sanitization.test.ts`: 6 tests pasando (5xx opaco, 4xx estándar, Prisma enmascarado, secretos redactados en details, 429 Retry-After, extraFields preservados).
- `packages/api/test/floorplan-fsm-access.test.ts`: 5 tests pasando.
- `packages/api/test/qr-session-lifecycle.test.ts`: 15 tests pasando.
- `packages/api/test/customer-operational-fsm.test.ts`: 6 tests pasando.

## 2. Conclusión de Etapa R02
Etapa R02 completada en estado `VERIFIED_LOCAL`. Hallazgos `SEC02-01` y `SEC02-02` cerrados como `FIXED_VERIFIED`.

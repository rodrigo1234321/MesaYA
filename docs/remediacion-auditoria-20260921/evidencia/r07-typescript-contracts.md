# Evidencia R07 — Tipado de Contratos y Eliminación de `any`

Fecha: 2026-09-21
Rama: `codex/remediacion-auditoria-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## 1. Alcance y Objetivos
- Eliminar usos injustificados de `any` en contratos de datos, servicios clave y componentes React.
- Tipar DTOs de comunicación API y modelos compartidos en frontend (`apps/admin-dashboard`, `apps/staff-panel`) y backend (`packages/api`).
- Garantizar compilación TypeScript estricta con 0 errores en todos los workspaces.

## 2. Archivos Modificados

### Frontend
- `apps/admin-dashboard/src/lib/api.ts`:
  - Exportación de `interface ShiftItem`.
  - Tipado de contratos: `createMenuItem`, `updateMenuItem`, `getCurrentShift(): Promise<ShiftItem | null>`, `getModuleConfig(): Promise<RestaurantModuleConfigDTO>`, `updateModuleConfig(..., data: UpdateModuleConfigDTO): Promise<RestaurantModuleConfigDTO>`.
- `apps/admin-dashboard/src/App.tsx`:
  - Tipado de estado `currentShift: ShiftItem | null`.
- `apps/admin-dashboard/src/components/ShiftManager.tsx`:
  - Props tipadas con `ShiftItem | null`.
  - Manejo seguro de errores en bloques catch con `err instanceof Error ? err.message : '...'`.
  - Verificaciones de nulidad estrictas antes de invocar operaciones de cierre de turno y renderizado condicional.
  - Atributo `role="alert"` en mensajes de error.
- `apps/staff-panel/src/lib/api.ts`:
  - Definición y exportación de `StaffTableItemDTO`.
  - Tipado de métodos: `getMenu(slugOrId): Promise<RestaurantMenuResponse>`, `getTables(restaurantId): Promise<StaffTableItemDTO[]>`.
- `apps/staff-panel/src/components/KitchenOrdersManager.tsx`:
  - Tipado de estado `tables: StaffTableItemDTO[]` y `menu: RestaurantMenuResponse | null`.
  - Tipado de parámetro `handleAddItemToForm(item: MenuItemDTO)`.
  - Tipado de categorías y platos en el renderizado del selector de menú (`MenuCategoryDTO`, `MenuItemDTO`).
- `apps/staff-panel/src/components/WaitlistManager.tsx`:
  - Reemplazo de `(t: any)` por `FloorTableDTO` y `StaffTableItemDTO` en filtros y mappers de mesas disponibles.
  - Manejo seguro de errores en bloques catch.

### Backend
- `packages/api/src/services/shift.service.ts`:
  - Importación de `Shift` de `@prisma/client`.
  - Tipado de transacción: `committed: { shift: Shift; sessionsCount: number; tablesCount: number } | null`.
- `packages/api/src/services/staff.service.ts`:
  - Importación de `StaffUser` de `@prisma/client`.
  - Tipado de retorno: `Promise<{ staffUser: StaffUserDTO; rawUser: StaffUser }>`.
- `packages/api/src/services/ai.service.ts`:
  - Importación de `Restaurant` de `@prisma/client`.
  - Tipado de parámetro `restaurant: Restaurant | { name: string }` en `deterministicDietaryAnswer` y `callGeminiForSommelier`.

## 3. Pruebas de Verificación
- `npx tsc --noEmit -p apps/admin-dashboard`: **PASS** (0 errores).
- `npx tsc --noEmit -p apps/staff-panel`: **PASS** (0 errores).
- `npm --workspace=@mesaya/api run build`: **PASS** (prisma generate + tsc completados con código 0).
- `npm run lint`: **PASS** (0 errores en monorepo).

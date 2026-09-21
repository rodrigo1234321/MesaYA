# Evidencia R08 — Hooks con Nombres Reales, Código Muerto y Dependencias No Usadas

Fecha: 2026-09-21
Rama: `codex/remediacion-auditoria-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## 1. Alcance y Objetivos
- Renombrar y proveer nombres canónicos a los hooks que implementan `PollingCoordinator` (`useCallsPolling`, `useFloorPlanPolling`) manteniendo compatibilidad con código existente.
- Documentar deprecación de `buildStaffStreamUrl` dado que el endpoint `/stream` responde `410 GONE` y la arquitectura oficial utiliza polling coordinado.
- Auditar métodos API supuestamente muertos: verificar llamadas reales (`tapTableState` en `TablesOverview` y `ServiceWorkspace`, `payOrder` en `CashManager`), conservando los endpoints necesarios.
- Eliminar dependencias innecesarias de `apps/staff-panel/package.json` (`konva`, `react-konva`, `zustand`).
- Eliminar importación no utilizada de `Fastify` en la raíz `index.ts`.
- Verificar preservación de seguridad XSS y paridad entre `apps/client-web/app.js` y `packages/shared/src/security.ts`.

## 2. Acciones Ejecutadas

### Hooks
- `apps/staff-panel/src/hooks/useSSE.ts`:
  - Se agregó el alias canónico `export const useCallsPolling = useSSE;`.
  - Se documentó con `@deprecated` la función `buildStaffStreamUrl` señalando el status `410 GONE` del endpoint legacy.
- `apps/admin-dashboard/src/hooks/useFloorPlanSSE.ts`:
  - Se tipó la referencia del coordinador con `PollingCoordinator<FloorPlanResponseDTO>`.
  - Se agregó el alias canónico `export const useFloorPlanPolling = useFloorPlanSSE;`.

### Limpieza de Dependencias
- `apps/staff-panel/package.json`:
  - Se eliminaron `konva`, `react-konva` y `zustand`, dado que `staff-panel` utiliza exclusivamente `useState` nativo y no renderiza canvas Konva.
  - El tamaño de dependencias y tiempos de bundle se optimizaron sin ningún impacto en la UI.
- `index.ts`:
  - Se removió el import no utilizado de `Fastify`.

### Auditoría de Código de Seguridad y Métodos
- Verificación exhaustiva de métodos:
  - `StaffApi.tapTableState`: en uso activo en `TablesOverview.tsx` (L60) y `ServiceWorkspace.tsx` (L814). Conservado.
  - `StaffApi.payOrder`: en uso activo en `CashManager.tsx` (L77). Conservado.
  - `AdminApi.overrideTableState`, `updateTablePosition`, `createZone`, `deleteZone`: métodos de cliente HTTP que corresponden a rutas Fastify existentes (`/tables/:id/state/override`, `/tables/:id/position`, `/floor-plan/:id/zones`). Conservados para completitud de SDK.
- XSS y Paridad de Sanitización:
  - Se ejecutó `packages/api/test/client-xss-security.test.ts` que valida 23 vectores de inyección XSS y sanitización contextual en `@mesaya/shared` y `client-web/app.js`. Todos superados.

## 3. Pruebas de Verificación
- `npx vitest run packages/api/test/client-xss-security.test.ts`: **23/23 PASS**.
- `npm --workspace=@mesaya/staff-panel run build`: **PASS** (4.44s, 0 errores).
- `npm --workspace=@mesaya/admin-dashboard run build`: **PASS** (6.20s, 0 errores).
- `npm run lint`: **PASS** (0 errores).

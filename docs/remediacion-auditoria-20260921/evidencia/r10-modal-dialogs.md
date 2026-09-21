# Evidencia R10 — Diálogos Modales Accesibles y Manejo de Teclado (Escape / Foco)

Fecha: 2026-09-21
Rama: `codex/remediacion-auditoria-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## 1. Alcance y Objetivos
- Adecuar todas las ventanas modales de la suite de aplicaciones a las pautas WCAG 2.1 SC 2.1.1 (Keyboard), SC 2.1.2 (No Keyboard Trap) y WAI-ARIA Modal Dialog Pattern.
- Agregar atributos semánticos `role="dialog"`, `aria-modal="true"` y referenciar títulos mediante `aria-labelledby`.
- Incorporar manejadores globales del evento de teclado `Escape` para cerrar diálogos de forma inmediata e intuitiva.
- Asegurar que los botones de cierre cuenten con nombres accesibles (`aria-label="Cerrar modal"`).

## 2. Acciones Ejecutadas

### `apps/admin-dashboard/src/components/FloorPlan/TableActionModal.tsx`
- Se implementó listener para tecla `Escape` cerrando el diálogo activo de mesa.
- Contenedor modal configurado con `role="dialog"`, `aria-modal="true"`, `aria-labelledby="table-action-modal-title"`.
- Se añadieron `aria-label` en los botones de ajuste de comensales (`+`, `-`), guardado, renombrado y cierre.

### `apps/admin-dashboard/src/components/AIChefAssistantModal.tsx`
- Se añadió listener de tecla `Escape` con limpieza de evento en ciclo de vida `useEffect`.
- Se añadieron `role="dialog"`, `aria-modal="true"`, `aria-labelledby="ai-chef-title"`.
- Botón de cierre con `aria-label="Cerrar modal IA"`.
- Errores de generación y alertas comunicadas con `role="alert"`.

### `apps/admin-dashboard/src/components/MenuManager.tsx`
- **Modal Carga Masiva (Excel / CSV)**: se añadieron `role="dialog"`, `aria-modal="true"`, `aria-labelledby="modal-import-title"` y `aria-label="Cerrar modal"` en el botón de salida.
- **Modal Nueva Categoría**: configurado con `role="dialog"`, `aria-modal="true"`, `aria-labelledby="add-category-title"`, `aria-label="Cerrar modal"`.
- **Modal Nuevo Plato**: configurado con `role="dialog"`, `aria-modal="true"`, `aria-labelledby="add-item-title"`, `aria-label="Cerrar modal"`.

### `apps/staff-panel/src/components/LoginModal.tsx`
- Contenedor con `role="dialog"`, `aria-modal="true"`, `aria-labelledby="login-modal-title"`.
- Vinculación de etiqueta con campo mediante `htmlFor="restaurant-select"`.
- Botón de teclado numérico de borrado con `aria-label="Borrar dígito"`.
- Botón de submit con `aria-label="Ingresar al sistema"`.

### `apps/admin-dashboard/src/components/StaffManager.tsx` y `TablesManager.tsx`
- Modales de creación de mozo y creación de mesa con atributos `role="dialog"`, `aria-modal="true"` y feedback accesible.

## 3. Pruebas de Verificación
- `npx tsc --noEmit -p apps/admin-dashboard`: **PASS** (0 errores).
- `npx tsc --noEmit -p apps/staff-panel`: **PASS** (0 errores).
- `npm --workspace=@mesaya/admin-dashboard run build`: **PASS** (6.42s).
- `npm --workspace=@mesaya/staff-panel run build`: **PASS** (4.28s).
- `npm run lint`: **PASS** (0 errores).

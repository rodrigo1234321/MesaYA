# Evidencia R09 — Controles Accesibles, Etiquetas y Semántica Interactiva

Fecha: 2026-09-21
Rama: `codex/remediacion-auditoria-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## 1. Alcance y Objetivos
- Dotar de nombres accesibles y etiquetas semánticas (`aria-label`, `aria-expanded`, `aria-controls`, `role="switch"`) a todos los controles interactivos que carecían de texto visible o dependían exclusivamente de íconos visuales.
- Asegurar que los botones de eliminación destructiva y acciones críticas identifiquen inequívocamente el recurso afectado para lectores de pantalla.
- Ocultar íconos decorativos SVGs repetitivos mediante `aria-hidden="true"` para evitar ruido auditivo en tecnologías asistivas.
- Garantizar que las etiquetas de viewport permitan el escalado y zoom del usuario respetando WCAG 2.1 SC 1.4.4 (Resize text).

## 2. Acciones Ejecutadas

### `apps/admin-dashboard/src/components/MenuManager.tsx`
- **Eliminar categoría**: se añadió `aria-label={`Eliminar categoría ${cat.name}`}` al botón de eliminación de categorías.
- **Plegar/Desplegar categoría**: se añadió `aria-expanded={!isCollapsed}` y `aria-label={`${isCollapsed ? 'Desplegar' : 'Plegar'} categoría ${cat.name}`}`.
- **Eliminar plato**: se añadió `aria-label={`Eliminar plato ${item.name}`}` en la botonera de cada item.
- **Selector de Emojis/Íconos**: se añadió `aria-label={`Seleccionar ícono ${icon}`}` en cada uno de los botones de la grilla de emojis de nueva categoría.

### `apps/admin-dashboard/src/components/ModuleConfigManager.tsx`
- Se verificó que los 8 switches de configuración de módulos (`Mesas y Salón`, `Comandas Cocina`, `Facturación`, `Fidelización`, `Reservas Online`, `Asistente IA Chef`, etc.) cuenten con:
  - `role="switch"`
  - `aria-checked={Boolean(value)}`
  - `aria-label={moduleDescription}`

### `apps/staff-panel/src/components/KitchenOrdersManager.tsx`
- **Eliminar item de comanda**: se añadió `aria-label={`Eliminar ${it.name} de la comanda`}` en el botón de descarte rápido con ícono `Trash2`.

### `apps/client-web/index.html` & `app.js`
- **SVGs decorativos**: se añadió `aria-hidden="true"` a los 5 SVGs inline de adornos gráficos (flechas, pines, íconos de estado en modales).
- **Detalle de Cuenta**: se incorporó `aria-expanded="false"` y `aria-controls="modalBillItemsContainer"` al botón `#btnToggleBillDetails`. Se sincronizó el estado en `app.js` alternando `aria-expanded` entre `"true"` y `"false"` al abrir/cerrar.
- **Reseña Google Maps**: se asignó `aria-label="Dejar reseña en Google Maps (se abre en nueva pestaña)"` en `#btnGoogleReviewDeepLink`.
- **Viewport**: se validó que `viewport` mantenga `width=device-width, initial-scale=1.0` sin directivas que bloqueen zoom (`user-scalable=no` ausente).

## 3. Pruebas de Verificación
- `npx tsc --noEmit -p apps/admin-dashboard`: **PASS** (0 errores).
- `npx tsc --noEmit -p apps/staff-panel`: **PASS** (0 errores).
- `npm --workspace=@mesaya/client-web run build`: **PASS** (0 errores, 2.31s).
- `npm run lint`: **PASS** (0 errores).

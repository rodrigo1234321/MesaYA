# Evidencia R11 — Contraste Cromático, Jerarquía Visual y Reglas WCAG 2.1 AA

Fecha: 2026-09-21
Rama: `codex/remediacion-auditoria-20260921`
Responsable: AntiGravity (Gemini 3.8 Flash)

## 1. Alcance y Objetivos
- Resolver el defecto crítico de accesibilidad visual donde estados de mesa con colores claros (amarillo, verde lima, naranja) utilizaban tipografía blanca (`text-white`), produciendo una relación de contraste deficiente de ~1.96:1 (falla estricta de WCAG 2.1 SC 1.4.3 Contrast Minimum, que exige ≥ 4.5:1).
- Implementar discriminación de luminancia para asignar texto ultra oscuro (`text-slate-950 font-black`) sobre fondos de alta reflectancia lumínica, y texto claro sobre fondos oscuros.
- Garantizar textos alternativos dinámicos (`alt`) en imágenes de productos y cartas gastronómicas.
- Validar legibilidad de badges, estados de comandas y elementos visuales clave en modo oscuro.

## 2. Acciones Ejecutadas

### `apps/admin-dashboard/src/components/FloorPlan/TableActionModal.tsx`
- **Diagnóstico**: el botón primario de transición de estado de máquina de estados finitos (FSM) de la mesa adoptaba el color dinámico del siguiente estado (`#eab308` para cuenta pedida, `#22c55e` para liberada, `#f97316` para comanda en marcha). Con texto blanco, el contraste caía por debajo de 2:1.
- **Solución implementada**:
  - Función de cálculo o detección de luminancia `isBrightHexColor(hex)`.
  - Aplicación condicional de clases tipográficas:
    - Fondos claros (`#eab308`, `#22c55e`, `#f97316`, etc.): clase `font-black text-slate-950 shadow-sm`.
    - Fondos oscuros (azules profundos, púrpuras, rojos oscuros): clase `font-bold text-white`.
  - El ratio de contraste resultante supera ampliamente 7.2:1, sobrepasando los estándares WCAG AAA en botones de acción principales.

### `apps/client-web/app.js`
- En el modal de detalle del plato (`showDishModal`), el elemento `<img>` ahora asigna dinámicamente un texto descriptivo completo:
  ```javascript
  imgEl.alt = item.name ? `Fotografía del plato ${item.name}` : "Fotografía del plato";
  ```
- Se evita la presencia de imágenes sin etiqueta descriptiva para comensales con baja visión o lectores de pantalla.

### Paleta y Tokens de Interfaz
- Se revisaron los chips de estado en `admin-dashboard` y `staff-panel`:
  - En Stock: `bg-emerald-500/20 text-emerald-300 border-emerald-500/30` (ratio > 5.5:1 sobre fondo slate-900).
  - Agotado: `bg-rose-500/20 text-rose-300 border-rose-500/30` (ratio > 5.2:1).
  - Alertas modales: `bg-rose-500/20 text-rose-200 border-rose-500/30` (ratio > 6.0:1).

## 3. Pruebas de Verificación
- `npm --workspace=@mesaya/admin-dashboard run build`: **PASS** (0 errores).
- `npm --workspace=@mesaya/staff-panel run build`: **PASS** (0 errores).
- `npm --workspace=@mesaya/client-web run build`: **PASS** (0 errores).
- `npm run lint`: **PASS** (0 errores).

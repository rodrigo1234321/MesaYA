import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const serviceWorkspaceSrc = readFileSync(
  join(__dirname, '../../..', 'apps/staff-panel/src/components/ServiceWorkspace.tsx'),
  'utf8'
);

const operatorPinModalSrc = readFileSync(
  join(__dirname, '../../..', 'apps/staff-panel/src/components/OperatorPinModal.tsx'),
  'utf8'
);

const appSrc = readFileSync(
  join(__dirname, '../../..', 'apps/staff-panel/src/App.tsx'),
  'utf8'
);

describe('E11 — Tablet vertical, mouse, teclado y accesibilidad (S05/S06/H08/H09/H10)', () => {
  describe('1. Touch targets >= 48px y espaciado >= 8px (Ergonomía táctil)', () => {
    it('ServiceTaskCard tiene botones principales con min-h-[48px] y separación', () => {
      expect(serviceWorkspaceSrc).toContain('min-h-[48px]');
      expect(serviceWorkspaceSrc).toContain('taskActionLabel(task)');
      expect(serviceWorkspaceSrc).toContain('min-w-[56px]');
      expect(serviceWorkspaceSrc).toMatch(/Rechazar[\s\S]*?<\/button>/);
      expect(serviceWorkspaceSrc).toContain('grid gap-2');
    });

    it('Barra de portada Atención cuenta con touch targets >= 48px en selector, búsqueda y filtros', () => {
      expect(serviceWorkspaceSrc).toContain('Filtrar por sector del salón');
      expect(serviceWorkspaceSrc).toContain('id="table-search-input"');
      expect(serviceWorkspaceSrc).toContain('id="service-filter-menu-button"');
      expect(serviceWorkspaceSrc).toContain('Actualizar Servicio');
      expect(serviceWorkspaceSrc).toMatch(/min-h-\[48px\][\s\S]*?id="service-filter-menu-button"/);
    });

    it('TableContextPanel tiene botones de acción y cobro con min-h-[48px]', () => {
      expect(serviceWorkspaceSrc).toContain('← Volver a Atención');
      expect(serviceWorkspaceSrc).toContain('Cerrar contexto de mesa');
      expect(serviceWorkspaceSrc).toContain('Agregar pedido');
      expect(serviceWorkspaceSrc).toContain('Cobrar cuenta');
      expect(serviceWorkspaceSrc).toContain('Registrar pago y mantener mesa');
      expect(serviceWorkspaceSrc).toContain('Cobrar y cerrar');
      expect(serviceWorkspaceSrc).toContain('Mesa lista');
      expect(serviceWorkspaceSrc).toContain('Liberar mesa');
    });

    it('OperatorPinModal tiene teclado numérico táctil con min-h-[48px] y separación', () => {
      expect(operatorPinModalSrc).toContain('min-h-[48px]');
      expect(operatorPinModalSrc).toContain('handleKeyPress(n)');
      expect(operatorPinModalSrc).toContain('handleBackspace');
      expect(operatorPinModalSrc).toContain('doLogin(pin)');
      expect(operatorPinModalSrc).toContain('Cerrar modal');
      expect(operatorPinModalSrc).toContain('grid grid-cols-3 gap-2.5');
    });

    it('App.tsx provee navegación de pestañas y botones de operador con min-h-[48px]', () => {
      expect(appSrc).toContain('min-h-[48px]');
      expect(appSrc).toContain('id="more-menu-button"');
      expect(appSrc).toContain('Cambiar mozo');
      expect(appSrc).toContain('Bloquear');
    });
  });

  describe('2. Navegación por Teclado, Atajos y Focus Management (PC)', () => {
    it('todos los controles interactivos clave cuentan con focus-visible visible', () => {
      expect(serviceWorkspaceSrc).toContain('focus-visible:ring-2');
      expect(serviceWorkspaceSrc).toContain('focus-visible:outline-none');
      expect(appSrc).toContain('focus-visible:ring-2');
      expect(operatorPinModalSrc).toContain('focus-visible:ring-2');
    });

    it('atajo "/" enfoca el buscador de mesas en PC cuando no se escribe en inputs', () => {
      expect(serviceWorkspaceSrc).toContain("event.key === '/'");
      expect(serviceWorkspaceSrc).toContain("document.getElementById('table-search-input')");
      expect(serviceWorkspaceSrc).toContain("searchInput.focus()");
    });

    it('tecla Escape cierra modales y contextos en orden inverso sin mutaciones destructivas', () => {
      expect(serviceWorkspaceSrc).toContain("event.key === 'Escape'");
      expect(serviceWorkspaceSrc).toContain("if (reauthAccount)");
      expect(serviceWorkspaceSrc).toContain("if (manualOrderOpen)");
      expect(serviceWorkspaceSrc).toContain("if (filterMenuOpen)");
      expect(serviceWorkspaceSrc).toContain("if (selectedTableId)");

      const keydownIndex = serviceWorkspaceSrc.indexOf("if (event.key === 'Escape')");
      const keydownEndIndex = serviceWorkspaceSrc.indexOf("window.addEventListener('keydown', handleKeyDown)");
      const keydownBlock = serviceWorkspaceSrc.slice(keydownIndex, keydownEndIndex);
      expect(keydownBlock).not.toContain("runSettlement");
      expect(keydownBlock).not.toContain("submitManualOrder");
      expect(keydownBlock).not.toContain("handleCollect");
    });

    it('tecla Escape en App.tsx cierra el menú desplegable Más y devuelve foco al botón', () => {
      expect(appSrc).toContain("if (!moreOpen) return;");
      expect(appSrc).toContain("if (e.key === 'Escape')");
      expect(appSrc).toContain("setMoreOpen(false)");
      expect(appSrc).toContain("moreButtonRef.current?.focus()");
    });
  });

  describe('3. Semántica ARIA y Accesibilidad de Puestos Compartidos', () => {
    it('modales tienen roles accesibles completos y backdrop accesible', () => {
      expect(serviceWorkspaceSrc).toContain('role="dialog"');
      expect(serviceWorkspaceSrc).toContain('aria-modal="true"');
      expect(serviceWorkspaceSrc).toContain('aria-labelledby="service-manager-reauth-title"');
      expect(serviceWorkspaceSrc).toContain('aria-labelledby="manual-service-order-title"');
      expect(operatorPinModalSrc).toContain('role="dialog"');
      expect(operatorPinModalSrc).toContain('aria-modal="true"');
    });

    it('menús desplegables implementan atributos ARIA correctos', () => {
      expect(serviceWorkspaceSrc).toContain('id="service-filter-menu-button"');
      expect(serviceWorkspaceSrc).toContain('aria-haspopup="menu"');
      expect(serviceWorkspaceSrc).toContain('aria-expanded={filterMenuOpen}');
      expect(serviceWorkspaceSrc).toContain('role="menu"');
      expect(serviceWorkspaceSrc).toContain('role="menuitem"');

      expect(appSrc).toContain('id="more-menu-button"');
      expect(appSrc).toContain('aria-haspopup="menu"');
      expect(appSrc).toContain('aria-expanded={moreOpen}');
      expect(appSrc).toContain('id="more-menu-dropdown"');
      expect(appSrc).toContain('role="menu"');
    });

    it('visores y alertas tienen roles adecuados', () => {
      expect(serviceWorkspaceSrc).toContain('role="alert"');
      expect(appSrc).toContain('aria-live="polite"');
    });
  });

  describe('4. Responsividad en Viewports y Tablet Vertical (S05/S06)', () => {
    it('en móvil / tablet vertical la cola se oculta cuando hay mesa seleccionada', () => {
      expect(serviceWorkspaceSrc).toContain("selectedTable ? 'hidden lg:block' : 'block'");
    });

    it('en desktop / tablet horizontal se utiliza layout de dos columnas lado a lado', () => {
      expect(serviceWorkspaceSrc).toContain("grid-cols-1 lg:grid-cols-[minmax(0,1.3fr)_minmax(350px,0.9fr)]");
    });

    it('el detalle de mesa incluye botón para volver a Atención en pantallas táctiles', () => {
      expect(serviceWorkspaceSrc).toContain("← Volver a Atención");
      expect(serviceWorkspaceSrc).toContain("lg:hidden");
    });
  });
});

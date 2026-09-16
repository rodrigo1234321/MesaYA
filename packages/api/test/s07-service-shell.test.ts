import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const appSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/App.tsx'), 'utf8');
const wsSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');

describe('E07 service shell (static contract)', () => {
  it('Servicio es la vista inicial; la navegación primaria es Servicio + Más y Cocina queda como acceso secundario/directo', () => {
    // E14 usa un inicializador lazy para soportar /kitchen y query params;
    // el fallback efectivo sigue siendo Servicio.
    expect(appSrc).toMatch(/useState<ActiveTab>\(\(\) =>/);
    expect(appSrc).toContain("return 'service';");
    // La navegación primaria sólo expone Servicio y Más (contrato 02: Cocina es
    // acceso configurable dentro de Más, no otra fila permanente).
    const navStart = appSrc.indexOf('<nav');
    const navEnd = appSrc.indexOf('</nav>');
    expect(navStart).toBeGreaterThanOrEqual(0);
    expect(navEnd).toBeGreaterThan(navStart);
    const navBlock = appSrc.slice(navStart, navEnd);
    // Quitar el dropdown de Más (menuitems secundarios) antes de comprobar la primaria.
    const primaryOnly = navBlock.replace(/role="menuitem"[\s\S]*?<\/button>/g, '');
    expect(primaryOnly).not.toMatch(/<span>Cocina<\/span>/);
    expect(primaryOnly).not.toMatch(/<span>Caja<\/span>/);
    expect(primaryOnly).not.toMatch(/selectTab\('cash'\)/);
    expect(appSrc).toContain('Servicio');
    expect(appSrc).toContain('Más');
    // Acceso secundario/directo a Cocina explícitamente permitido: Más + /kitchen o query param.
    expect(appSrc).toContain("selectTab('kitchen')");
    expect(appSrc).toContain('/kitchen');
    expect(appSrc).toContain('KitchenOrdersManager');
  });

  it('ServiceWorkspace conserva snapshot y secciones mapa/cola/cuenta', () => {
    expect(wsSrc).toContain('getServiceWorkspace');
    expect(wsSrc).toContain('Cola de atenci');
    expect(wsSrc).toContain('Mapa contextual');
    expect(wsSrc).toContain('Cuenta de la ocupaci');
    expect(wsSrc).toContain('ORDER_PREPARATION');
    expect(wsSrc).toContain('ORDER_DELIVERY');
    // No navega fuera: onOpenKitchen es opcional y hace scroll/foco interno
    expect(wsSrc).toContain('onOpenKitchen?');
    expect(wsSrc).toContain('scrollIntoView');
  });

  it('no agrega overflow horizontal en breakpoints chicos', () => {
    expect(wsSrc).not.toMatch(/overflow-x-auto(?!.*Sectores)/);
    expect(appSrc).not.toContain('overflow-x-scroll');
  });
});

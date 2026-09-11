import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const appSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/App.tsx'), 'utf8');
const wsSrc = readFileSync(join(ROOT, 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');

describe('E07 service shell (static contract)', () => {
  it('Servicio es la vista inicial y no hay botones primarios Cocina/Caja', () => {
    expect(appSrc).toMatch(/useState<ActiveTab>\('service'\)/);
    // No primary nav buttons with text Cocina o Caja
    expect(appSrc).not.toMatch(/<span>Cocina<\/span>/);
    expect(appSrc).not.toMatch(/<span>Caja<\/span>/);
    expect(appSrc).not.toMatch(/selectTab\('kitchen'\)/);
    expect(appSrc).not.toMatch(/selectTab\('cash'\)/);
    expect(appSrc).toContain('Servicio');
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

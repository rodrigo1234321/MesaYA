import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * E19 — carta con filtros e información alimentaria fiable (S26).
 *
 * Contrato estático del cliente (apps/client-web/app.js + index.html):
 * filtros determinísticos Sin TACC / Vegano / Vegetariano sólo sobre tags
 * estructurados confirmados por el local (GLUTEN_FREE, VEGAN, VEGETARIAN),
 * sin inferencia por nombre/descripción/imagen/categoría/IA; selector de
 * categoría combinable; Todas/limpiar; estado vacío y aviso accesible;
 * advertencia honesta de no certificación y tratamiento de desconocidos.
 * Sin backend nuevo: los tags ya son los campos estructurados vigentes.
 */
describe('E19 — filtros de carta e información alimentaria fiable', () => {
  const clientRoot = resolve(__dirname, '../../../apps/client-web');
  const appJs = readFileSync(resolve(clientRoot, 'app.js'), 'utf8');
  const html = readFileSync(resolve(clientRoot, 'index.html'), 'utf8');
  const menuManager = readFileSync(
    resolve(__dirname, '../../../apps/admin-dashboard/src/components/MenuManager.tsx'),
    'utf8'
  );

  function fnBody(source: string, fnName: string): string {
    const start = source.indexOf(fnName);
    expect(start, `${fnName} existe`).toBeGreaterThanOrEqual(0);
    const tail = source.slice(start);
    const nextFn = tail.slice(10).search(/\n(?:async function|function) /);
    return nextFn === -1 ? tail : tail.slice(0, nextFn + 10);
  }

  // Bloque de helpers E19 de app.js: no incluir el detalle ni el render
  // completo, que necesariamente usa item.name para mostrar el plato.
  const e19Start = appJs.indexOf('const MENU_DIET_FILTERS');
  const e19End = appJs.indexOf('function openDishDetailSheet(');
  expect(e19Start).toBeGreaterThanOrEqual(0);
  expect(e19End).toBeGreaterThan(e19Start);
  const e19Block = appJs.slice(e19Start, e19End);

  describe('filtros Sin TACC / Vegano / Vegetariano y estado Todas/limpiar', () => {
    it('expone los tres filtros dietarios con etiquetas visibles y acentos', () => {
      for (const tag of ['data-diet-filter="ALL"', 'data-diet-filter="GLUTEN_FREE"', 'data-diet-filter="VEGAN"', 'data-diet-filter="VEGETARIAN"']) {
        expect(html).toContain(tag);
      }
      expect(html).toContain('Sin TACC');
      expect(html).toContain('Vegano');
      expect(html).toContain('Vegetariano');
      expect(html).toContain('Todas');
      expect(appJs).toContain('const MENU_DIET_FILTERS');
      expect(appJs).toContain("{ id: 'GLUTEN_FREE', label: 'Sin TACC'");
      expect(appJs).toContain("{ id: 'VEGAN', label: 'Vegano'");
      expect(appJs).toContain("{ id: 'VEGETARIAN', label: 'Vegetariano'");
    });

    it('los botones son type="button" con aria-pressed y foco visible', () => {
      const dietBar = html.slice(html.indexOf('id="menuDietFilters"'), html.indexOf('id="menuCategoryFilterSelect"'));
      expect(dietBar).toContain('role="group"');
      expect(dietBar).toContain('aria-label="Filtrar por preferencia alimentaria');
      const buttons = dietBar.match(/<button[^>]*data-diet-filter="[^"]*"[^>]*>/g) || [];
      expect(buttons.length).toBe(4);
      for (const button of buttons) {
        expect(button).toContain('type="button"');
        expect(button).toContain('aria-pressed=');
        expect(button).toContain('focus-visible:');
      }
    });

    it('ofrece Todas/limpiar filtros como control accesible', () => {
      expect(html).toContain('id="menuFiltersClear"');
      expect(html).toContain('Mostrar todo / limpiar filtros');
      const clearAt = html.indexOf('id="menuFiltersClear"');
      expect(html.slice(clearAt, clearAt + 200)).toContain('type="button"');
      expect(appJs).toContain('function clearMenuFilters()');
      const clearBody = fnBody(appJs, 'function clearMenuFilters()');
      expect(clearBody).toContain("menuDietFilter = 'ALL';");
      expect(clearBody).toContain("menuCategoryFilter = 'ALL';");
      expect(clearBody).toContain('renderDynamicMenu(lastMenuResponse);');
    });
  });

  describe('filtro sólo por tags confirmados, sin heurística', () => {
    it('coincide únicamente por tag confirmado presente; ALL conserva todo', () => {
      const body = fnBody(appJs, 'function dishMatchesDietFilter(');
      expect(body).toContain("if (filter === 'ALL') return true;");
      expect(body).toContain('MENU_DIET_TAGS.has(filter)');
      expect(body).toContain('normalizeMenuItemTags(item).includes(filter)');
    });

    it('no deduce dieta desde nombre, descripción, imagen, categoría o IA', () => {
      expect(e19Block).not.toContain('item.name');
      expect(e19Block).not.toContain('item.description');
      expect(e19Block).not.toContain('imageUrl');
      expect(e19Block).not.toContain('toLowerCase');
      expect(e19Block).not.toMatch(/inteligencia|sommelier|maridaje|infer/i);
      expect(e19Block).toContain('MENU_DIET_UNKNOWN_NOTICE');
    });

    it('el estado de filtros es local, pequeño y sobrevive a re-render (red/tema)', () => {
      expect(appJs).toContain("let menuDietFilter = 'ALL';");
      expect(appJs).toContain("let menuCategoryFilter = 'ALL';");
      const renderBody = fnBody(appJs, 'function renderDynamicMenu(');
      // Preserva la selección: sólo corrige valores que ya no existen.
      expect(renderBody).toContain('knownCategoryKeys');
      expect(renderBody).toContain('MENU_DIET_FILTERS.some((option) => option.id === menuDietFilter)');
      expect(renderBody).not.toMatch(/menuDietFilter = 'ALL';\s*\n\s*menuCategoryFilter = 'ALL';/);
    });
  });

  describe('combinación categoría + preferencia, vacíos y avisos', () => {
    it('combina categoría y preferencia sin depender de scroll', () => {
      const renderBody = fnBody(appJs, 'function renderDynamicMenu(');
      expect(renderBody).toContain('dishMatchesCategoryFilter(`dynamic-cat-${idx}`, menuCategoryFilter)');
      expect(renderBody).toContain('dishMatchesDietFilter(item, menuDietFilter)');
      expect(html).toContain('<label for="menuCategoryFilterSelect"');
      expect(html).toContain('<select id="menuCategoryFilterSelect" aria-label="Filtrar por categoría"');
      expect(renderBody).toContain('bindMenuFilterControls()');
      expect(renderBody).toContain('syncMenuFilterControls()');
      expect(appJs).toContain("getElementById('menuCategoryFilterSelect')?.addEventListener('change'");
      // Las opciones del select salen de los datos; las pills de navegación
      // por scroll se conservan como navegación.
      expect(renderBody).toContain('escapeHtml(cat.name)}</option>');
      expect(renderBody).toContain('scrollIntoView');
    });

    it('los productos sin tags siguen visibles en Todas y hay estado vacío claro', () => {
      const dietBody = fnBody(appJs, 'function dishMatchesDietFilter(');
      expect(dietBody).toContain("if (filter === 'ALL') return true;");
      const renderBody = fnBody(appJs, 'function renderDynamicMenu(');
      expect(renderBody).toContain('id="menuFilterEmpty"');
      expect(renderBody).toContain('Sin platos para esta combinación');
      expect(renderBody).toContain('role="status"');
    });

    it('la cantidad/estado se anuncia para lector de pantalla', () => {
      expect(html).toContain('id="menuFilterStatus"');
      expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
      expect(appJs).toContain('function updateMenuFilterStatus(visibleCount, totalCount)');
      const statusBody = fnBody(appJs, 'function updateMenuFilterStatus(');
      expect(statusBody).toContain('textContent');
      expect(statusBody).toContain('Mostrando ${visibleCount} de ${totalCount}');
      expect(statusBody).toContain('Sin platos para esta combinación');
    });
  });

  describe('scroll único de carta y restauración de contexto', () => {
    it('mantiene un solo dueño del scroll y el footer fuera del área desplazable', () => {
      expect(html).toContain('id="menuScrollContent" class="flex-1 min-h-0 overflow-y-auto');
      const pillsStart = html.indexOf('id="modalMenuCategoryPillsContainer"');
      expect(pillsStart).toBeGreaterThanOrEqual(0);
      expect(html.slice(pillsStart, pillsStart + 260)).toContain('sticky top-0');

      const categoriesStart = html.indexOf('id="dynamicMenuCategoriesContainer"');
      expect(categoriesStart).toBeGreaterThanOrEqual(0);
      const categoriesTag = html.slice(categoriesStart, categoriesStart + 180);
      expect(categoriesTag).not.toContain('overflow-y-auto');
      expect(categoriesTag).not.toContain('flex-1');

      const footerStart = html.indexOf('id="btnOpenSommelierModal"');
      expect(footerStart).toBeGreaterThan(categoriesStart);
      expect(html.slice(footerStart - 180, footerStart)).toContain('pb-[env(safe-area-inset-bottom)]');
    });

    it('guarda y restaura la posición desde el contenedor único', () => {
      expect(appJs).toContain('function getMenuScrollContainer()');
      expect(appJs).toContain("document.getElementById('menuScrollContent')");
      expect(appJs).toContain('const sc = getMenuScrollContainer();');
      expect(appJs).toContain('const outsideViewport = targetRect.top');
      expect(appJs).toContain("inline: 'nearest'");
    });
  });

  describe('detalle, precio, disponibilidad y teclado preservados', () => {
    it('el detalle conserva precio, disponibilidad y apertura por click/Enter/Espacio', () => {
      const detailBody = fnBody(appJs, 'function openDishDetailSheet(');
      expect(detailBody).toContain('dishSheetPrice');
      expect(detailBody).toContain('dishSheetAvailability');
      expect(detailBody).toContain('No disponible');
      const bindBody = fnBody(appJs, 'function bindDishCardActivation(');
      expect(bindBody).toContain("event.key === 'Enter'");
      expect(bindBody).toContain("event.key === ' '");
      expect(bindBody).toContain('preventDefault');
      const renderBody = fnBody(appJs, 'function renderDynamicMenu(');
      expect(renderBody).toContain('role="button" tabindex="0"');
      expect(renderBody).toContain('aria-label="${escapeHtmlAttr(`Ver detalle de ${item.name}');
      expect(renderBody).toContain('focus-visible:ring-');
    });

    it('el detalle informa dieta con datos confirmados o desconocido explícito', () => {
      const detailBody = fnBody(appJs, 'function openDishDetailSheet(');
      expect(detailBody).toContain('getMenuDietNoticeForItem(item)');
      expect(detailBody).toContain("getElementById('dishSheetDietInfo')");
      expect(html).toContain('id="dishSheetDietInfo"');
      expect(appJs).toContain('function getMenuDietNoticeForItem(');
      expect(appJs).toContain('MENU_DIET_UNKNOWN_NOTICE');
      expect(appJs).toContain('Sin información alimentaria confirmada — consultá al personal antes de pedir.');
    });
  });

  describe('advertencia honesta sin promesas de seguridad', () => {
    it('la barra de filtros y el detalle advierten no certificación y consulta', () => {
      expect(html).toContain('id="menuDietDisclaimer"');
      expect(html).toContain('id="dishSheetDietDisclaimer"');
      expect(appJs).toContain('MENU_DIET_BAR_NOTICE');
      for (const source of [html, appJs]) {
        expect(source).toContain('no certifican ausencia de alérgenos ni contaminación cruzada');
        expect(source).toContain('consultá al personal antes de pedir');
      }
    });

    it('las cadenas E19 no prometen seguridad alimentaria', () => {
      const noticeStart = appJs.indexOf('const MENU_DIET_UNKNOWN_NOTICE');
      const noticeEnd = appJs.indexOf('let menuDietFilter');
      const notices = appJs.slice(noticeStart, noticeEnd);
      expect(notices).not.toMatch(/seguro|libre de alérgenos|garantiz|100%|sin riesgo/i);
      expect(html).not.toContain('libre de alérgenos');
    });

    it('los textos del menú se escapan y el estado usa textContent', () => {
      const renderBody = fnBody(appJs, 'function renderDynamicMenu(');
      expect(renderBody).toContain('escapeHtml(cat.name)');
      expect(renderBody).toContain('escapeHtml(MENU_DIET_BAR_NOTICE)');
      expect(renderBody).toContain('syncMenuFilterControls()');
      const syncBody = fnBody(appJs, 'function syncMenuFilterControls()');
      expect(syncBody).toContain("setAttribute('aria-pressed'");
    });
  });

  describe('MenuManager: copy mínimo sin modelo nuevo', () => {
    it('aclara que las etiquetas deben ser confirmadas por el local', () => {
      expect(menuManager).toContain('E19');
      expect(menuManager).toMatch(/confirmadas por el local/i);
      expect(menuManager).toContain('Sin TACC');
    });

    it('no agrega modelo de alérgenos ni inventa datos', () => {
      expect(menuManager).not.toMatch(/allergen|alérgeno|contaminaci|cross.?contact/i);
      expect(menuManager).not.toContain('isGlutenFree');
      expect(menuManager).not.toContain('isVegan');
    });
  });
});

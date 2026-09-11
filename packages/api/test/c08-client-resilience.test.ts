import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { SessionService } from '../src/services/session.service';
import { TableFSMState } from '@mesaya/shared';

/**
 * C08 — accesibilidad, sesión y fallos del cliente comensal.
 *
 * La prueba estática protege el contrato que no debe degradarse en un refactor
 * visual; la prueba HTTP confirma que el cliente puede distinguir una sesión
 * realmente cerrada de una caída de red.
 */
describe('C08 — resiliencia, sesión y accesibilidad del cliente', () => {
  const clientRoot = resolve(__dirname, '../../../apps/client-web');
  const appJs = readFileSync(resolve(clientRoot, 'app.js'), 'utf8');
  const html = readFileSync(resolve(clientRoot, 'index.html'), 'utf8');
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mantiene una ruta visible y honesta para red caída, reintento y suspensión', () => {
    expect(html).toContain('id="networkStatus"');
    expect(html).toContain('aria-live="polite"');
    expect(appJs).toContain('function showConnectionState(message)');
    expect(appJs).toContain("showConnectionState('No pudimos comprobar la mesa.");
    expect(appJs).not.toContain("showExpiredState('No se pudo establecer conexión con la mesa.");
    expect(appJs).toContain("window.addEventListener('offline'");
    expect(appJs).toContain("window.addEventListener('online'");
    expect(appJs).toContain("window.addEventListener('pageshow'");
    expect(appJs).toContain("window.addEventListener('popstate'");
    expect(appJs).toContain('isLikelyNetworkError');
    expect(appJs).toContain('function bindImageResilience(image)');
    expect(appJs).toContain("image.classList.add('hidden')");
    expect(appJs).toContain('No se enviará nada hasta comprobarlo.');
    expect(appJs).toContain('Conexión restablecida; comprobando la mesa');
    expect(appJs).toContain("void init();");
    expect(appJs).not.toContain("sessionStorage.removeItem('mesaya_token');\n    init();");
  });

  it('implementa Escape, foco inicial, retorno de foco y trampa de Tab en todos los overlays', () => {
    expect(appJs).toContain('const MANAGED_MODAL_IDS = [');
    expect(appJs).toContain('function rememberModalFocus');
    expect(appJs).toContain('function focusManagedModal');
    expect(appJs).toContain('function restoreModalFocusIfNone');
    expect(appJs).toContain("if (event.key === 'Escape')");
    expect(appJs).toContain("if (event.key !== 'Tab') return;");
    expect(appJs).toContain('closeManagedModal(modal);');
    expect(appJs).toContain('focusables[0]');
    expect(appJs).toContain('last.focus({ preventScroll: true })');

    const dialogIds = [
      ['modalMenu', 'menuHeading'],
      ['modalCart', 'cartHeading'],
      ['dishDetailSheetBackdrop', 'dishSheetTitle'],
      ['sommelierSheetBackdrop', 'sommelierHeading'],
      ['modalBill', 'billHeading'],
      ['modalWaiter', 'waiterHeading'],
      ['modalSupplies', 'suppliesHeading'],
      ['modalReviewFair', 'reviewHeading']
    ];
    for (const [dialogId, headingId] of dialogIds) {
      expect(html).toContain(`id="${dialogId}"`);
      expect(html).toContain(`aria-labelledby="${headingId}"`);
    }
    expect(html.match(/role="dialog"/g)?.length).toBeGreaterThanOrEqual(dialogIds.length);
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="dishDetailSheetBackdrop" class="bottom-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="dishSheetTitle" aria-hidden="true" inert');
    expect(html).toContain('id="sommelierSheetBackdrop" class="bottom-sheet-backdrop" role="dialog" aria-modal="true" aria-labelledby="sommelierHeading" aria-hidden="true" inert');
    expect(appJs).toContain("sheet.removeAttribute('inert')");
    expect(appJs).toContain("drawer.removeAttribute('inert')");
    expect(html).toContain('aria-label="Cerrar carta"');
    expect(html).toContain('aria-label="Cerrar cuenta"');
    expect(html).toContain('aria-label="Cerrar llamado al mozo"');
    expect(html).toContain('aria-label="Cerrar pedido de insumos"');
    expect(html).toContain('aria-label="Cerrar valoración"');
    expect(html).toContain('role="region" tabindex="0" aria-label="Detalle del plato"');
  });

  it('conserva el contrato de viewport accesible y no depende de imágenes para leer acciones', () => {
    expect(html).toMatch(/<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*initial-scale=1\.0[^"]*"/i);
    expect(html).not.toMatch(/maximum-scale\s*=|user-scalable\s*=/i);
    expect(html).toContain('Carta Digital & Precios');
    expect(html).toContain('Pedir la cuenta');
    expect(html).toContain('Llamar al mozo');
    expect(html).toContain('Pedir insumos');
    expect(html).toContain('alt="Carta Gastronómica"');
    expect(html).toContain('alt="Plato"');
  });

  it('observa una sesión cerrada como estado inactivo/cerrado, sin inventar una cuenta activa', async () => {
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const restaurant = await prisma.restaurant.create({
      data: {
        name: `c08-resilience-${suffix}`,
        slug: `c08-resilience-${suffix}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b'
      }
    });
    const shift = await prisma.shift.create({
      data: { restaurantId: restaurant.id, openedAt: new Date() }
    });
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: `Mesa C08 ${suffix}`,
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
      }
    });
    const session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000)
      }
    });

    await SessionService.closeTableSession(table.id);
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${session.token}`
    });
    expect(response.statusCode).toBe(410);
    const data = response.json();
    expect(data.valid).toBe(false);
    expect(data.isClosed).toBe(true);
    expect(data.token).toBeUndefined();
  });
});

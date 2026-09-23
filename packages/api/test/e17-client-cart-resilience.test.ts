import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderService } from '../src/services/order.service';
import { SessionService } from '../src/services/session.service';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

/**
 * E17 — carrito cliente resistente a doble acción (S19/S20).
 *
 * Contrato estático del cliente (apps/client-web/app.js + index.html):
 * una intención de agregar/quitar/enviar produce una sola mutación —
 * mutex lógico inmediato antes de la primera llamada, feedback visual
 * inmediato, botón restaurado en `finally`, mutaciones en una sola tentativa
 * (sin retry automático general) y clave auxiliar ligada a
 * restaurante/mesa/orden sin tokens crudos.
 *
 * Contrato dinámico del servidor (SQLite efímera, sin mocks de
 * persistencia): idempotencia estable de /orders/submit por borrador,
 * agotado/precio al commit, conflicto colaborativo, offline post-commit
 * (sin retry ciego posible desde el cliente) y sesión expirada.
 */
describe('E17 — carrito resistente a doble acción', () => {
  const clientRoot = resolve(__dirname, '../../../apps/client-web');
  const appJs = readFileSync(resolve(clientRoot, 'app.js'), 'utf8');
  const html = readFileSync(resolve(clientRoot, 'index.html'), 'utf8');

  function fnBody(source: string, fnName: string): string {
    const start = source.indexOf(fnName);
    expect(start, `${fnName} existe`).toBeGreaterThanOrEqual(0);
    // Recorte generoso hasta la próxima función de primer nivel.
    const tail = source.slice(start);
    const nextFn = tail.slice(10).search(/\n(?:async function|function) /);
    return nextFn === -1 ? tail : tail.slice(0, nextFn + 10);
  }

  describe('contrato estático del cliente', () => {
    it('agregar tiene mutex lógico inmediato, feedback y restauración en finally', () => {
      const body = fnBody(appJs, 'async function addDishToCart(');
      expect(body).toContain('if (dishAddInFlight) return;');
      const guardAt = body.indexOf('if (dishAddInFlight) return;');
      const fetchAt = body.indexOf('fetchMutationOnce(`${API_BASE}/orders/items`');
      expect(fetchAt).toBeGreaterThan(guardAt);
      expect(body).toContain('dishAddInFlight = true;');
      expect(body).toContain('setDishOrderButtonBusy(true,');
      expect(body).toContain('Agregando');
      expect(body).toContain('finally');
      const finallyAt = body.lastIndexOf('finally');
      expect(body.slice(finallyAt)).toContain('dishAddInFlight = false;');
      expect(body.slice(finallyAt)).toContain('setDishOrderButtonBusy(false);');
    });

    it('tras un agregado exitoso la acción del plato se resetea (nueva unidad = nueva intención)', () => {
      const body = fnBody(appJs, 'async function addDishToCart(');
      expect(body).toContain('setDishOrderQuantity(1);');
      const resetAt = body.indexOf('setDishOrderQuantity(1);');
      const closeAt = body.indexOf('closeDishDetailSheet();');
      expect(resetAt).toBeGreaterThan(0);
      expect(closeAt).toBeGreaterThan(0);
    });

    it('las mutaciones del carrito usan una sola tentativa con timeout razonable', () => {
      expect(appJs).toContain('async function fetchMutationOnce(url, options = {}, timeoutMs = 10000)');
      expect(appJs).toContain('fetchMutationOnce(`${API_BASE}/orders/items`');
      expect(appJs).toContain('fetchMutationOnce(`${API_BASE}/orders/items/${encodeURIComponent(itemId)}`');
      expect(appJs).toContain('fetchMutationOnce(`${API_BASE}/orders/submit`');
      // Ninguna mutación POST/DELETE del carrito usa el retry automático general.
      expect(appJs).not.toContain('fetchWithRetry(`${API_BASE}/orders/items`');
      expect(appJs).not.toContain('fetchWithRetry(`${API_BASE}/orders/submit`');
    });

    it('quitar tiene mutex por ítem, feedback y restauración en finally', () => {
      const body = fnBody(appJs, 'async function removeCartItem(');
      expect(body).toContain('if (cartRemoveInFlight.has(itemId)) return;');
      expect(body).toContain('cartRemoveInFlight.add(itemId);');
      expect(body).toContain("btn.textContent = 'Quitando…'");
      expect(body).toContain('finally');
      const finallyAt = body.lastIndexOf('finally');
      expect(body.slice(finallyAt)).toContain('cartRemoveInFlight.delete(itemId);');
      expect(body.slice(finallyAt)).toContain('renderCart();');
    });

    it('enviar conserva mutex con restauración delegada al estado real', () => {
      const body = fnBody(appJs, 'async function submitCart()');
      expect(body).toContain('if (isCartSubmitting) return;');
      expect(body).toContain('isCartSubmitting = true;');
      expect(body).toContain('finally');
      const finallyAt = body.lastIndexOf('finally');
      expect(body.slice(finallyAt)).toContain('isCartSubmitting = false;');
      expect(body.slice(finallyAt)).toContain('renderCart();');
    });

    it('la clave auxiliar está ligada a restaurante/mesa/orden, sin tokens crudos', () => {
      const keyStart = appJs.indexOf('function getCartSubmitStorageKey()');
      const keyEnd = appJs.indexOf('function readPersistedCartSubmitKey(');
      expect(keyStart).toBeGreaterThanOrEqual(0);
      expect(keyEnd).toBeGreaterThan(keyStart);
      const keyBody = appJs.slice(keyStart, keyEnd);
      expect(keyBody).toContain('mesaya_cart_submit_${parts.slug}_${parts.table}_${parts.session}_${parts.order}');
      expect(keyBody).not.toContain('currentToken');
      expect(keyBody).not.toContain('getToken');
      expect(appJs).toContain('function getCartContextParts()');
      expect(appJs).toContain('currentSession.restaurant');
      expect(appJs).toContain('currentSession.table');
      expect(appJs).toContain('currentSession.expiresAt');
      expect(appJs).toContain('session: sanitizeCartKeyPart(sessionVersion');
    });

    it('sesión vencida y cambio de mesa invalidan el estado auxiliar sin restaurar pedidos viejos', () => {
      const expired = fnBody(appJs, 'function showExpiredState(');
      expect(expired).toContain('invalidateCartSubmitState();');
      expect(expired).toContain('dishAddInFlight = false;');
      expect(expired).toContain('cartRemoveInFlight.clear();');
      expect(appJs).toContain('trackCartSessionContext();');
      const track = fnBody(appJs, 'function trackCartSessionContext()');
      expect(track).toContain('invalidateCartSubmitState();');
      expect(track).toContain('parts.session');
      for (const fn of [
        fnBody(appJs, 'async function addDishToCart('),
        fnBody(appJs, 'async function removeCartItem('),
        fnBody(appJs, 'async function submitCart()')
      ]) {
        expect(fn).toContain('showExpiredState(');
      }
      const loadActive = fnBody(appJs, 'async function loadActiveOrder(');
      expect(loadActive).toContain('if (res.status === 410)');
      expect(loadActive).toContain('showExpiredState(message);');
    });

    it('los errores de red son accionables y no prometen no-duplicación sin mecanismo', () => {
      // La afirmación falsa previa desapareció del camino de agregar.
      expect(appJs).not.toContain('no se duplicó');
      expect(appJs).toContain('Revisá el carrito');
      // El camino de envío sí puede afirmarlo: el backend pinnea la clave.
      const submit = fnBody(appJs, 'async function submitCart()');
      expect(submit).toContain('idempotencyKey');
      expect(submit).toContain('await loadActiveOrder({ silent: true });');
    });

    it('se preservan guestName, historial y cuenta desde el servidor', () => {
      expect(appJs).toContain('getGuestName()');
      expect(appJs).toContain('guestNameToSend');
      expect(appJs).toContain('renderOrderHistory();');
      expect(appJs).toContain('data.history');
      const add = fnBody(appJs, 'async function addDishToCart(');
      // El servidor es la fuente de verdad: se adopta su respuesta.
      expect(add).toContain('activeOrder = data;');
    });

    it('los estados de error del carrito son accesibles (role status + live region)', () => {
      expect(html).toContain('id="cartError"');
      expect(html).toContain('id="dishSheetError"');
      const cartLine = html.split('\n').find((l) => l.includes('id="cartError"')) || '';
      const dishLine = html.split('\n').find((l) => l.includes('id="dishSheetError"')) || '';
      for (const line of [cartLine, dishLine]) {
        expect(line).toContain('role="status"');
        expect(line).toContain('aria-live="polite"');
      }
    });
  });

  describe('idempotencia y carreras del servidor (S19/S20)', () => {
    let app: FastifyInstance;
    let rest1: any;
    let shift1: any;
    let cat1: any;

    async function mkSession(label: string) {
      const table = await prisma.table.create({
        data: {
          restaurantId: rest1.id,
          label: `${label}-${randomUUID().slice(0, 6)}`,
          sector: 'SALON',
          currentState: TableFSMState.OCCUPIED_NO_ORDER,
          capacity: 4
        }
      });
      const session = await prisma.tableSession.create({
        data: {
          tableId: table.id,
          shiftId: shift1.id,
          token: randomUUID(),
          activeKey: table.id,
          expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
        }
      });
      return { table, session };
    }

    async function mkItem(name: string, price: number) {
      return prisma.menuItem.create({ data: { categoryId: cat1.id, name, price, isAvailable: true } });
    }

    async function add(sessionToken: string, menuItemId: string, quantity = 1, extra: any = {}) {
      return OrderService.addItem({ sessionToken, menuItemId, quantity, ...extra } as any);
    }

    beforeAll(async () => {
      app = await buildApp();
      await app.ready();
      rest1 = await prisma.restaurant.create({
        data: {
          name: 'e17-r1',
          slug: `e17-r1-${Date.now()}`,
          templateId: 'GOURMET_OBSIDIAN',
          themeColor: '#f59e0b',
          moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: false } }
        }
      });
      shift1 = await prisma.shift.create({ data: { restaurantId: rest1.id, openedAt: new Date() } });
      cat1 = await prisma.menuCategory.create({ data: { restaurantId: rest1.id, name: 'E17', orderIndex: 0 } });
    });

    afterAll(async () => {
      await app.close();
    });

    it('S19 doble envío con la misma clave: una sola tanda (clave estable por borrador)', async () => {
      const { session } = await mkSession('Mesa E17-S19a');
      const item = await mkItem('Plato E17-A', 1000);
      await add(session.token, item.id);
      const key = `e17-double-${randomUUID()}`;
      const first = await OrderService.submitOrder(session.token, { idempotencyKey: key });
      const replay = await OrderService.submitOrder(session.token, { idempotencyKey: key });
      expect(replay.id).toBe(first.id);
      expect(await prisma.order.count({ where: { tableSessionId: session.id, status: { not: 'DRAFT' } } })).toBe(1);
      expect(await prisma.submitReceipt.count({ where: { tableSessionId: session.id } })).toBe(1);
    });

    it('S19 replay tras timeout con borrador nuevo: devuelve la tanda original sin duplicar', async () => {
      const { session } = await mkSession('Mesa E17-S19b');
      const item = await mkItem('Plato E17-B', 1200);
      await add(session.token, item.id);
      const key = `e17-replay-${randomUUID()}`;
      const first = await OrderService.submitOrder(session.token, { idempotencyKey: key });
      await add(session.token, item.id);
      const replay = await OrderService.submitOrder(session.token, { idempotencyKey: key });
      expect(replay.id).toBe(first.id);
      expect(await prisma.order.count({ where: { tableSessionId: session.id, status: { not: 'DRAFT' } } })).toBe(1);
      const draft = await prisma.order.findFirst({
        where: { tableSessionId: session.id, status: 'DRAFT' },
        include: { items: true }
      });
      expect(draft?.items).toHaveLength(1);
    });

    it('S19 dos agregados secuenciales son dos líneas: /orders/items no es idempotente', async () => {
      // Documenta por qué el cliente debe usar una sola tentativa: un retry
      // ciego tras commit duplicaría la línea.
      const { session } = await mkSession('Mesa E17-S19c');
      const item = await mkItem('Plato E17-C', 500);
      await add(session.token, item.id, 1);
      const draft = await add(session.token, item.id, 1);
      expect(draft.items).toHaveLength(2);
      expect(draft.totalAmount).toBe(1000);
    });

    it('S20 dos teléfonos colaboran sobre un único borrador sin duplicarlo', async () => {
      const { session } = await mkSession('Mesa E17-S20a');
      const [itemA, itemB] = await Promise.all([mkItem('Plato E17-D', 1000), mkItem('Plato E17-E', 2500)]);
      await add(session.token, itemA.id, 2, { guestName: 'Ana', guestSessionId: 'tel-1' });
      const draft = await add(session.token, itemB.id, 1, { guestName: 'Bruno', guestSessionId: 'tel-2' });
      expect(draft.items).toHaveLength(2);
      expect(draft.totalAmount).toBe(4500);
      expect(await prisma.order.count({ where: { tableSessionId: session.id, status: 'DRAFT' } })).toBe(1);
      const names = draft.items.map((i: any) => i.guestName).sort();
      expect(names).toEqual(['Ana', 'Bruno']);
    });

    it('S20 dos sesiones aisladas: cada token recibe su item, getActiveOrder sólo tiene su línea propia y count DRAFT por sesión es 1', async () => {
      const { session: s1 } = await mkSession('Mesa E17-S20-iso1');
      const { session: s2 } = await mkSession('Mesa E17-S20-iso2');
      const [item1, item2] = await Promise.all([
        mkItem('Plato E17-Iso1', 1200),
        mkItem('Plato E17-Iso2', 1800)
      ]);

      await add(s1.token, item1.id, 1);
      await add(s2.token, item2.id, 1);

      const active1 = await OrderService.getActiveOrder(s1.id);
      const active2 = await OrderService.getActiveOrder(s2.id);

      expect(active1?.items).toHaveLength(1);
      expect(active1?.items[0].menuItemId).toBe(item1.id);

      expect(active2?.items).toHaveLength(1);
      expect(active2?.items[0].menuItemId).toBe(item2.id);

      expect(await prisma.order.count({ where: { tableSessionId: s1.id, status: 'DRAFT' } })).toBe(1);
      expect(await prisma.order.count({ where: { tableSessionId: s2.id, status: 'DRAFT' } })).toBe(1);
    });

    it('S20 agotado al enviar: queda en revisión con motivo persistido, resto intacto', async () => {
      const { session } = await mkSession('Mesa E17-S20b');
      const okItem = await mkItem('Plato E17-F', 900);
      const doomedItem = await mkItem('Plato E17-G', 1100);
      await add(session.token, okItem.id);
      await add(session.token, doomedItem.id);
      await prisma.menuItem.update({ where: { id: doomedItem.id }, data: { isAvailable: false } });
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken: session.token, idempotencyKey: `e17-s20b-${randomUUID()}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('PENDING_VALIDATION');
      expect(res.json().reviewReason?.code).toBe('STOCK_UNAVAILABLE');
      expect(await prisma.order.count({ where: { tableSessionId: session.id, status: 'DRAFT' } })).toBe(0);
    });

    it('S20 precio cambiado antes de enviar: rige la instantánea tomada al agregar', async () => {
      const { session } = await mkSession('Mesa E17-S20c');
      const item = await mkItem('Plato E17-H', 1000);
      await add(session.token, item.id, 2);
      await prisma.menuItem.update({ where: { id: item.id }, data: { price: 2500 } });
      const submitted = await OrderService.submitOrder(session.token, { idempotencyKey: `e17-snap-${randomUUID()}` });
      const line = submitted.items.find((i: any) => i.menuItemId === item.id);
      expect(line?.unitPrice).toBe(1000);
      expect(submitted.totalAmount).toBe(2000);
    });

    it('S20 sesión expirada o cerrada: 410 accionable sin huérfanos', async () => {
      const expired = await mkSession('Mesa E17-S20d1');
      const item = await mkItem('Plato E17-I', 500);
      await prisma.tableSession.update({
        where: { id: expired.session.id },
        data: { expiresAt: new Date(Date.now() - 1000) }
      });
      await expect(add(expired.session.token, item.id)).rejects.toMatchObject({
        statusCode: 410,
        code: 'SESSION_EXPIRED'
      });
      const closed = await mkSession('Mesa E17-S20d2');
      // Cierre sobre mesa sin pendientes (con borrador bloquearía con
      // DRAFT_UNRESOLVED según B05); luego todo intento es 410.
      await SessionService.closeTableSession(closed.table.id);
      await expect(add(closed.session.token, item.id)).rejects.toMatchObject({
        statusCode: 410,
        code: 'SESSION_CLOSED'
      });
      await expect(OrderService.submitOrder(closed.session.token)).rejects.toMatchObject({
        statusCode: 410,
        code: 'SESSION_CLOSED'
      });
      expect(await prisma.order.count({ where: { tableSessionId: { in: [expired.session.id, closed.session.id] }, status: { not: 'DRAFT' } } })).toBe(0);
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { OrderService } from '../src/services/order.service';

/**
 * B02 — Reproducción automatizada del importe parcial (plan UX Servicio 2026-09-08).
 *
 * Fixture aislado (filas reales, sin mocks de persistencia):
 * - 3 tandas aceptadas: A=1000, B=2500, C=500 (estado SERVED) => consumo esperado 4000.
 * - 1 borrador nuevo D=700 (estado DRAFT) => NO integra el consumo; carrito separado.
 *
 * La regresión exige el comportamiento correcto (cuenta acumulada 4000, borrador
 * excluido) contra las consultas REALES que usan cliente y caja:
 * - Cliente: GET /v1/orders/session/:token, bloque `account` (post-fix B03).
 * - Caja: GET /v1/staff/restaurants/:id/cash-orders, bloque `accounts` (post-fix B03).
 * - Servicio: OrderService.getSessionAccount (cuenta agregada). getActiveOrder NO es
 *   la cuenta: conserva el carrito DRAFT por contrato.
 *
 * Post-fix B03 (verde). Evidencia histórica pre-fix (fallaba 3/3 porque `order`
 * devolvía el borrador y caja fragmentaba por comanda) conservada únicamente en
 * 03-VERIFICACION-Y-CONTROL.md §12. La UI (cliente/caja) todavía NO consume `account`;
 * el cableado visual llega en C06/S08.
 */
describe('B02 — importe parcial: tres tandas + borrador (cuenta agregada post-fix B03)', () => {
  let app: FastifyInstance;
  let rest: any;
  let session: any;
  let table: any;
  let managerToken: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    rest = await prisma.restaurant.create({
      data: {
        name: 'B02 Repro (aislado)',
        slug: `b02-repro-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: {
          create: { allowOrdering: true, requireWaiterValidation: true }
        }
      }
    });

    const shift = await prisma.shift.create({
      data: { restaurantId: rest.id, openedAt: new Date() }
    });

    table = await prisma.table.create({
      data: {
        restaurantId: rest.id,
        label: 'Mesa B02',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    await prisma.staffUser.create({
      data: {
        restaurantId: rest.id,
        name: 'Encargado B02',
        pinHash: await bcrypt.hash('9999', 10),
        role: 'MANAGER'
      }
    });

    const cat = await prisma.menuCategory.create({
      data: { restaurantId: rest.id, name: 'B02', orderIndex: 0 }
    });
    const mkItem = (name: string, price: number) =>
      prisma.menuItem.create({ data: { categoryId: cat.id, name, price, isAvailable: true } });
    const [itemA, itemB, itemC, itemD] = await Promise.all([
      mkItem('Tanda A', 1000),
      mkItem('Tanda B', 2500),
      mkItem('Tanda C', 500),
      mkItem('Borrador D', 700)
    ]);

    const mkOrder = (item: any, qty: number, total: number, status: OrderStatus, createdAt: Date) =>
      prisma.order.create({
        data: {
          tableSessionId: session.id,
          status,
          totalAmount: total,
          createdAt,
          items: {
            create: [
              {
                menuItemId: item.id,
                quantity: qty,
                unitPrice: item.price,
                addedByGuest: session.id
              }
            ]
          }
        }
      });

    const t = Date.now();
    await mkOrder(itemA, 1, 1000, OrderStatus.SERVED, new Date(t - 30000));
    await mkOrder(itemB, 1, 2500, OrderStatus.SERVED, new Date(t - 20000));
    await mkOrder(itemC, 1, 500, OrderStatus.SERVED, new Date(t - 10000));
    await mkOrder(itemD, 1, 700, OrderStatus.DRAFT, new Date(t));

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login-admin',
      payload: { restaurantSlug: rest.slug, pin: '9999' }
    });
    expect(login.statusCode).toBe(200);
    managerToken = login.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('cliente: la cuenta acumula las tres tandas (4000) y excluye el borrador (700)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/orders/session/${session.token}`
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Contrato post-fix B03: el bloque `account` agrega el consumo; `order` conserva
    // el carrito (DRAFT) sin romper edición/envío.
    expect(body.account?.consumoMinor).toBe(400000);
    expect(body.account?.tandas).toHaveLength(3);
    expect(body.account?.draft?.totalMinor).toBe(70000);
    expect(body.order?.status).toBe(OrderStatus.DRAFT);
  });

  it('servicio: getSessionAccount agrega sin devolver el borrador como cuenta', async () => {
    const account = await OrderService.getSessionAccount(session.id);
    expect(account.consumoMinor).toBe(400000);
    expect(account.tandas).toHaveLength(3);
    expect(account.saldoMinor).toBe(400000);
    expect(account.draft?.totalMinor).toBe(70000);
    // El carrito conserva su contrato específico (no roto por B03).
    const order = await OrderService.getActiveOrder(session.id);
    expect(order?.status).toBe(OrderStatus.DRAFT);
  });

  it('caja: cuenta agregada por sesión sin borrador cobrable', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${rest.id}/cash-orders`,
      headers: { authorization: `Bearer ${managerToken}` }
    });
    expect(res.statusCode).toBe(200);
    const accounts = res.json().accounts as any[];
    const sessionAccounts = accounts.filter((a) => a.tableSessionId === session.id);
    // Una vista por cuenta de sesión (4000), sin borrador dentro de las tandas.
    expect(sessionAccounts).toHaveLength(1);
    expect(sessionAccounts[0].consumoMinor).toBe(400000);
    expect(sessionAccounts[0].tandas).toHaveLength(3);
    expect(sessionAccounts[0].draft?.totalMinor).toBe(70000);
    // Compatibilidad: las filas legadas por comanda siguen presentes para S08.
    expect(Array.isArray(res.json().orders)).toBe(true);
  });
});

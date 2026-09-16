import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';

describe('E14 — Cocina usable en el segundo puesto (S10 / S17 / S18 / H06 / H07)', () => {
  let app: FastifyInstance;

  // Tenant A: Pizzería & Cocina Alpha
  let restA: any;
  let shiftA: any;
  let tableA1: any;
  let tableA2: any;
  let sessionA1: any;
  let sessionA2: any;
  let catA: any;
  let itemA1: any; // Pizza Margherita (disponible)
  let itemA2: any; // Fideos Sin TACC (con tag GLUTEN_FREE)
  let staffWaiterA: any;
  let tokenWaiterA: string;
  let staffManagerA: any;
  let tokenManagerA: string;

  // Tenant B: Bodegón Beta (aislamiento multi-tenant)
  let restB: any;
  let shiftB: any;
  let tableB1: any;
  let sessionB1: any;
  let staffWaiterB: any;
  let tokenWaiterB: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // Setup Tenant A
    restA = await prisma.restaurant.create({
      data: {
        name: 'Cocina Alpha KDS (Tenant A)',
        slug: `alpha-kds-${Date.now()}-${randomUUID().slice(0, 4)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#f59e0b',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false
          }
        }
      }
    });

    shiftA = await prisma.shift.create({
      data: {
        restaurantId: restA.id,
        openedAt: new Date()
      }
    });

    tableA1 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa KDS-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    tableA2 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa KDS-2',
        sector: 'TERRAZA',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
      }
    });

    sessionA1 = await prisma.tableSession.create({
      data: {
        tableId: tableA1.id,
        shiftId: shiftA.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    sessionA2 = await prisma.tableSession.create({
      data: {
        tableId: tableA2.id,
        shiftId: shiftA.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    catA = await prisma.menuCategory.create({
      data: {
        restaurantId: restA.id,
        name: 'Principales & Pastas',
        orderIndex: 0
      }
    });

    itemA1 = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Pizza Margherita',
        price: 6500,
        priceMinor: 650000,
        isAvailable: true,
        tags: JSON.stringify(['VEGETARIAN'])
      }
    });

    itemA2 = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Fideos de Arroz & Vegetales',
        price: 7200,
        priceMinor: 720000,
        isAvailable: true,
        tags: JSON.stringify(['GLUTEN_FREE', 'VEGAN'])
      }
    });

    const hashedPin = await bcrypt.hash('1234', 10);

    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Juan Salón',
        role: 'WAITER',
        pinHash: hashedPin
      }
    });
    tokenWaiterA = app.jwt.sign({
      sub: staffWaiterA.id,
      role: staffWaiterA.role,
      restaurantId: restA.id,
      name: staffWaiterA.name
    });

    staffManagerA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Encargada María',
        role: 'MANAGER',
        pinHash: hashedPin
      }
    });
    tokenManagerA = app.jwt.sign({
      sub: staffManagerA.id,
      role: staffManagerA.role,
      restaurantId: restA.id,
      name: staffManagerA.name
    });

    // Setup Tenant B (aislamiento)
    restB = await prisma.restaurant.create({
      data: {
        name: 'Bodegón Beta (Tenant B)',
        slug: `beta-kds-${Date.now()}-${randomUUID().slice(0, 4)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#3b82f6'
      }
    });

    shiftB = await prisma.shift.create({
      data: {
        restaurantId: restB.id,
        openedAt: new Date()
      }
    });

    tableB1 = await prisma.table.create({
      data: {
        restaurantId: restB.id,
        label: 'Mesa B-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    sessionB1 = await prisma.tableSession.create({
      data: {
        tableId: tableB1.id,
        shiftId: shiftB.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    staffWaiterB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo Pedro Beta',
        role: 'WAITER',
        pinHash: hashedPin
      }
    });
    tokenWaiterB = app.jwt.sign({
      sub: staffWaiterB.id,
      role: staffWaiterB.role,
      restaurantId: restB.id,
      name: staffWaiterB.name
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /staff/restaurants/:id/kitchen-orders devuelve comandas activas con alérgenos (tags) y notas preservadas', async () => {
    const order = await prisma.order.create({
      data: {
        tableSessionId: sessionA1.id,
        status: OrderStatus.IN_KITCHEN,
        totalAmount: 13700,
        totalAmountMinor: 1370000,
        source: 'STAFF_TERMINAL',
        items: {
          create: [
            {
              menuItemId: itemA1.id,
              quantity: 1,
              unitPrice: 6500,
              unitPriceMinor: 650000,
              notes: 'Poco orégano, bien dorada',
              addedByGuest: 'staff-mozo'
            },
            {
              menuItemId: itemA2.id,
              quantity: 1,
              unitPrice: 7200,
              unitPriceMinor: 720000,
              notes: 'ALERGIA SEVERA: plato y sartén exclusivo',
              guestName: 'Martina',
              addedByGuest: 'guest-session'
            }
          ]
        }
      }
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
      headers: { authorization: `Bearer ${tokenWaiterA}` }
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.orders).toBeDefined();
    expect(body.orders.length).toBeGreaterThanOrEqual(1);

    const targetOrder = body.orders.find((o: any) => o.id === order.id);
    expect(targetOrder).toBeDefined();
    expect(targetOrder.tableLabel).toBe('Mesa KDS-1');
    expect(targetOrder.sector).toBe('SALON');
    expect(targetOrder.status).toBe(OrderStatus.IN_KITCHEN);
    expect(targetOrder.urgency).toBeDefined();

    expect(targetOrder.items.length).toBe(2);
    const pastaItem = targetOrder.items.find((i: any) => i.name === 'Fideos de Arroz & Vegetales');
    expect(pastaItem).toBeDefined();
    expect(pastaItem.notes).toBe('ALERGIA SEVERA: plato y sartén exclusivo');
    expect(pastaItem.guestName).toBe('Martina');
    expect(pastaItem.tags).toContain('GLUTEN_FREE');
    expect(pastaItem.tags).toContain('VEGAN');
  });

  it('Rechaza con 403 STAFF_TENANT_MISMATCH si staff de otro restaurante intenta consultar cocina', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
      headers: { authorization: `Bearer ${tokenWaiterB}` }
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
  });

  it('Cocina actualiza IN_KITCHEN -> READY_TO_SERVE; Listo avisa al salón sin marcar comanda como entregada', async () => {
    const order = await prisma.order.create({
      data: {
        tableSessionId: sessionA2.id,
        status: OrderStatus.IN_KITCHEN,
        totalAmount: 6500,
        totalAmountMinor: 650000,
        source: 'GUEST_QR',
        items: {
          create: [
            {
              menuItemId: itemA1.id,
              quantity: 1,
              unitPrice: 6500,
              unitPriceMinor: 650000,
              addedByGuest: 'guest-session'
            }
          ]
        }
      }
    });

    await prisma.table.update({
      where: { id: tableA2.id },
      data: { currentState: TableFSMState.ORDER_IN_KITCHEN }
    });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${order.id}/status`,
      headers: { authorization: `Bearer ${tokenWaiterA}` },
      payload: { status: OrderStatus.READY_TO_SERVE }
    });

    expect(patchRes.statusCode).toBe(200);
    const updatedOrder = patchRes.json();
    expect(updatedOrder.status).toBe(OrderStatus.READY_TO_SERVE);

    const tableAfterReady = await prisma.table.findUnique({ where: { id: tableA2.id } });
    expect(tableAfterReady?.currentState).toBe(TableFSMState.ORDER_IN_KITCHEN);

    const wsRes = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restA.id}/service-workspace`,
      headers: { authorization: `Bearer ${tokenWaiterA}` }
    });

    expect(wsRes.statusCode).toBe(200);
    const ws = wsRes.json();
    const deliveryTask = ws.tasks.find((t: any) => t.kind === 'ORDER_DELIVERY' && t.targetId === order.id);
    expect(deliveryTask).toBeDefined();
    expect(deliveryTask.action).toBe('SERVE_ORDER');
    expect(deliveryTask.title).toBe('Entregar a mesa');
  });

  it('Mozo en salón ejecuta SERVE_ORDER: comanda pasa a SERVED y mesa transiciona a EATING', async () => {
    const order = await prisma.order.create({
      data: {
        tableSessionId: sessionA2.id,
        status: OrderStatus.READY_TO_SERVE,
        totalAmount: 6500,
        totalAmountMinor: 650000,
        source: 'STAFF_TERMINAL',
        items: {
          create: [
            {
              menuItemId: itemA1.id,
              quantity: 1,
              unitPrice: 6500,
              unitPriceMinor: 650000,
              addedByGuest: 'staff-session'
            }
          ]
        }
      }
    });

    const actRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/restaurants/${restA.id}/service-tasks/act`,
      headers: { authorization: `Bearer ${tokenWaiterA}` },
      payload: {
        taskKey: `task:ORDER_DELIVERY:${order.id}`,
        action: 'SERVE_ORDER'
      }
    });

    expect(actRes.statusCode).toBe(200);
    const actBody = actRes.json();
    expect(actBody.success).toBe(true);
    expect(actBody.status).toBe(OrderStatus.SERVED);

    const tableAfterServe = await prisma.table.findUnique({ where: { id: tableA2.id } });
    expect(tableAfterServe?.currentState).toBe(TableFSMState.EATING);
  });

  it('Cocina puede devolver una comanda READY_TO_SERVE a IN_KITCHEN si se requiere rehacerla', async () => {
    const order = await prisma.order.create({
      data: {
        tableSessionId: sessionA1.id,
        status: OrderStatus.READY_TO_SERVE,
        totalAmount: 7200,
        totalAmountMinor: 720000,
        source: 'STAFF_TERMINAL',
        items: {
          create: [
            {
              menuItemId: itemA2.id,
              quantity: 1,
              unitPrice: 7200,
              unitPriceMinor: 720000,
              addedByGuest: 'staff-session'
            }
          ]
        }
      }
    });

    const revertRes = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${order.id}/status`,
      headers: { authorization: `Bearer ${tokenWaiterA}` },
      payload: { status: OrderStatus.IN_KITCHEN, reason: 'Rehecho en cocina por plato frío' }
    });

    expect(revertRes.statusCode).toBe(200);
    expect(revertRes.json().status).toBe(OrderStatus.IN_KITCHEN);

    const wsRes = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restA.id}/service-workspace`,
      headers: { authorization: `Bearer ${tokenWaiterA}` }
    });
    const ws = wsRes.json();
    const deliveryTask = ws.tasks.find((t: any) => t.kind === 'ORDER_DELIVERY' && t.targetId === order.id);
    expect(deliveryTask).toBeUndefined();
  });

  it('Dos pantallas enviando READY_TO_SERVE concurrentemente responden 200 OK con estado idempotente', async () => {
    const order = await prisma.order.create({
      data: {
        tableSessionId: sessionA1.id,
        status: OrderStatus.IN_KITCHEN,
        totalAmount: 6500,
        totalAmountMinor: 650000,
        source: 'GUEST_QR',
        items: {
          create: [
            {
              menuItemId: itemA1.id,
              quantity: 1,
              unitPrice: 6500,
              unitPriceMinor: 650000,
              addedByGuest: 'guest-session'
            }
          ]
        }
      }
    });

    const [res1, res2] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${order.id}/status`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { status: OrderStatus.READY_TO_SERVE }
      }),
      app.inject({
        method: 'PATCH',
        url: `/v1/staff/orders/${order.id}/status`,
        headers: { authorization: `Bearer ${tokenManagerA}` },
        payload: { status: OrderStatus.READY_TO_SERVE }
      })
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);
    expect(res1.json().status).toBe(OrderStatus.READY_TO_SERVE);
    expect(res2.json().status).toBe(OrderStatus.READY_TO_SERVE);
  });

  it('Si la comanda fue cancelada en salón, intento posterior de marcar READY_TO_SERVE rechaza con 409 ORDER_FINAL_STATE', async () => {
    const order = await prisma.order.create({
      data: {
        tableSessionId: sessionA2.id,
        status: OrderStatus.IN_KITCHEN,
        totalAmount: 6500,
        totalAmountMinor: 650000,
        source: 'STAFF_TERMINAL',
        items: {
          create: [
            {
              menuItemId: itemA1.id,
              quantity: 1,
              unitPrice: 6500,
              unitPriceMinor: 650000,
              addedByGuest: 'staff-session'
            }
          ]
        }
      }
    });

    const cancelRes = await app.inject({
      method: 'POST',
      url: `/v1/staff/orders/${order.id}/reject`,
      headers: { authorization: `Bearer ${tokenWaiterA}` },
      payload: { reason: 'Comensal se retiró antes de preparar' }
    });
    expect(cancelRes.statusCode).toBe(200);
    expect(cancelRes.json().status).toBe(OrderStatus.CANCELLED);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/staff/orders/${order.id}/status`,
      headers: { authorization: `Bearer ${tokenWaiterA}` },
      payload: { status: OrderStatus.READY_TO_SERVE }
    });

    expect(patchRes.statusCode).toBe(409);
    expect(patchRes.json().code).toBe('ORDER_FINAL_STATE');

    const listRes = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restA.id}/kitchen-orders`,
      headers: { authorization: `Bearer ${tokenWaiterA}` }
    });
    const list = listRes.json();
    const found = list.orders.find((o: any) => o.id === order.id);
    expect(found).toBeUndefined();
  });
});

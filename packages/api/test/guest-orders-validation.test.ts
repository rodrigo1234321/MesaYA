import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { randomUUID } from 'crypto';

describe('Etapa 14 — Validación de pedidos del comensal, anti-tampering e idempotencia', () => {
  let app: FastifyInstance;

  // Tenant A: Trattoria Alpha (requireWaiterValidation: true, allowOrdering: true)
  let restA: any;
  let shiftA: any;
  let tableA1: any;
  let sessionA1: any;
  let staffA: any;
  let tokenStaffA: string;
  let catA: any;
  let itemA1: any; // Empanada Criolla ($1500)
  let itemA2: any; // Provoleta Ahumada ($3200)
  let itemUnavailableA: any; // Bife Agotado ($9500, isAvailable: false)

  // Tenant B: Trattoria Beta (para cruce de tenant)
  let restB: any;
  let shiftB: any;
  let tableB1: any;
  let sessionB1: any;
  let staffB: any;
  let tokenStaffB: string;
  let catB: any;
  let itemB1: any; // Ravioles del Bosque ($4500)

  // Tenant C: Carta Informativa (allowOrdering: false)
  let restC: any;
  let shiftC: any;
  let tableC1: any;
  let sessionC1: any;
  let catC: any;
  let itemC1: any;

  // Tenant D: Directo a cocina (requireWaiterValidation: false, allowOrdering: true)
  let restD: any;
  let shiftD: any;
  let tableD1: any;
  let sessionD1: any;
  let catD: any;
  let itemD1: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // ─────────────────────────────────────────────────────────────
    // 1. Setup Tenant A
    // ─────────────────────────────────────────────────────────────
    restA = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Alpha (Tenant A)',
        slug: `alpha-order-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#3b82f6',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: true
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
        label: 'Mesa A-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
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

    staffA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Alpha',
        pinHash: await bcrypt.hash('1111', 10),
        role: 'WAITER'
      }
    });

    catA = await prisma.menuCategory.create({
      data: {
        restaurantId: restA.id,
        name: 'Entradas Alpha',
        orderIndex: 0
      }
    });

    itemA1 = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Empanada Criolla',
        price: 1500,
        isAvailable: true
      }
    });

    itemA2 = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Provoleta Ahumada',
        price: 3200,
        isAvailable: true
      }
    });

    itemUnavailableA = await prisma.menuItem.create({
      data: {
        categoryId: catA.id,
        name: 'Bife Agotado',
        price: 9500,
        isAvailable: false
      }
    });

    const loginResA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '1111' }
    });
    expect(loginResA.statusCode).toBe(200);
    tokenStaffA = loginResA.json().token;

    // ─────────────────────────────────────────────────────────────
    // 2. Setup Tenant B
    // ─────────────────────────────────────────────────────────────
    restB = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Beta (Tenant B)',
        slug: `beta-order-${Date.now()}`,
        templateId: 'COASTAL_BEACH',
        themeColor: '#10b981',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
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
        sector: 'TERRAZA',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
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

    staffB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo Beta',
        pinHash: await bcrypt.hash('2222', 10),
        role: 'WAITER'
      }
    });

    catB = await prisma.menuCategory.create({
      data: {
        restaurantId: restB.id,
        name: 'Pastas Beta',
        orderIndex: 0
      }
    });

    itemB1 = await prisma.menuItem.create({
      data: {
        categoryId: catB.id,
        name: 'Ravioles del Bosque',
        price: 4500,
        isAvailable: true
      }
    });

    const loginResB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '2222' }
    });
    expect(loginResB.statusCode).toBe(200);
    tokenStaffB = loginResB.json().token;

    // ─────────────────────────────────────────────────────────────
    // 3. Setup Tenant C (Carta Informativa: allowOrdering: false)
    // ─────────────────────────────────────────────────────────────
    restC = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Gamma (Carta Informativa)',
        slug: `gamma-order-${Date.now()}`,
        templateId: 'NEO_BRUTALIST',
        themeColor: '#f59e0b',
        moduleConfig: {
          create: {
            allowOrdering: false,
            requireWaiterValidation: false
          }
        }
      }
    });

    shiftC = await prisma.shift.create({
      data: {
        restaurantId: restC.id,
        openedAt: new Date()
      }
    });

    tableC1 = await prisma.table.create({
      data: {
        restaurantId: restC.id,
        label: 'Mesa C-1',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 4
      }
    });

    sessionC1 = await prisma.tableSession.create({
      data: {
        tableId: tableC1.id,
        shiftId: shiftC.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    catC = await prisma.menuCategory.create({
      data: {
        restaurantId: restC.id,
        name: 'Platos Gamma',
        orderIndex: 0
      }
    });

    itemC1 = await prisma.menuItem.create({
      data: {
        categoryId: catC.id,
        name: 'Milanesa Gamma',
        price: 3000,
        isAvailable: true
      }
    });

    // ─────────────────────────────────────────────────────────────
    // 4. Setup Tenant D (Directo a Cocina: requireWaiterValidation: false)
    // ─────────────────────────────────────────────────────────────
    restD = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Delta (Directo Cocina)',
        slug: `delta-order-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#ef4444',
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false
          }
        }
      }
    });

    shiftD = await prisma.shift.create({
      data: {
        restaurantId: restD.id,
        openedAt: new Date()
      }
    });

    tableD1 = await prisma.table.create({
      data: {
        restaurantId: restD.id,
        label: 'Mesa D-1',
        sector: 'BARRA',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
      }
    });

    sessionD1 = await prisma.tableSession.create({
      data: {
        tableId: tableD1.id,
        shiftId: shiftD.id,
        token: randomUUID(),
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    catD = await prisma.menuCategory.create({
      data: {
        restaurantId: restD.id,
        name: 'Barra Delta',
        orderIndex: 0
      }
    });

    itemD1 = await prisma.menuItem.create({
      data: {
        categoryId: catD.id,
        name: 'Cocktail Delta',
        price: 2500,
        isAvailable: true
      }
    });
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 1: Validación centralizada de sesión activa para pedidos
  // ─────────────────────────────────────────────────────────────
  describe('1. Validación centralizada de sesión activa para pedidos', () => {
    it('Rechaza consultar comanda activa con token inexistente (404)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${randomUUID()}`
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('SESSION_NOT_FOUND');
    });

    it('Rechaza consultar comanda activa con placeholder inválido (404)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/orders/session/demo-token'
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('SESSION_NOT_FOUND');
    });

    it('Rechaza consultar comanda activa si la sesión ya fue cerrada (410)', async () => {
      const closedSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60000),
          closedAt: new Date()
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${closedSession.token}`
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_CLOSED');
    });

    it('Rechaza consultar comanda activa si la sesión está expirada en tiempo (410)', async () => {
      const expiredSession = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() - 3600000) // Expiró hace 1 hora
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${expiredSession.token}`
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_EXPIRED');
    });

    it('Rechaza consultar comanda si la mesa se encuentra en TO_CLEAN (410)', async () => {
      const tableCleaning = await prisma.table.create({
        data: {
          restaurantId: restA.id,
          label: 'Mesa Limpieza',
          sector: 'SALON',
          currentState: TableFSMState.TO_CLEAN,
          capacity: 4
        }
      });

      const sessionCleaning = await prisma.tableSession.create({
        data: {
          tableId: tableCleaning.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60000)
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionCleaning.token}`
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SESSION_CLOSED');
    });

    it('Rechaza consultar comanda si el turno del restaurante fue cerrado (410)', async () => {
      const shiftClosed = await prisma.shift.create({
        data: {
          restaurantId: restA.id,
          openedAt: new Date(Date.now() - 86400000),
          closedAt: new Date()
        }
      });

      const sessionClosedShift = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftClosed.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60000)
        }
      });

      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionClosedShift.token}`
      });
      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe('SHIFT_CLOSED');
    });

    it('Rechaza una sesión sin turno antes de leer o crear pedidos (410)', async () => {
      const sessionWithoutShift = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60000)
        }
      });

      const readRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionWithoutShift.token}`
      });
      expect(readRes.statusCode).toBe(410);
      expect(readRes.json().code).toBe('SHIFT_INACTIVE');

      const addRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionWithoutShift.token,
          menuItemId: itemA1.id,
          quantity: 1
        }
      });
      expect(addRes.statusCode).toBe(410);
      expect(addRes.json().code).toBe('SHIFT_INACTIVE');

      expect(await prisma.order.count({ where: { tableSessionId: sessionWithoutShift.id } })).toBe(0);
      expect(await prisma.orderItem.count({ where: { order: { tableSessionId: sessionWithoutShift.id } } })).toBe(0);
    });

    it('Rechaza un turno de otro restaurante antes de leer o crear pedidos (410)', async () => {
      const sessionWithForeignShift = await prisma.tableSession.create({
        data: {
          tableId: tableA1.id,
          shiftId: shiftB.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60000)
        }
      });

      const readRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionWithForeignShift.token}`
      });
      expect(readRes.statusCode).toBe(410);
      expect(readRes.json().code).toBe('SHIFT_INACTIVE');

      const addRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionWithForeignShift.token,
          menuItemId: itemA1.id,
          quantity: 1
        }
      });
      expect(addRes.statusCode).toBe(410);
      expect(addRes.json().code).toBe('SHIFT_INACTIVE');

      expect(await prisma.order.count({ where: { tableSessionId: sessionWithForeignShift.id } })).toBe(0);
      expect(await prisma.orderItem.count({ where: { order: { tableSessionId: sessionWithForeignShift.id } } })).toBe(0);
    });

    it('Retorna null y los flags del restaurante para sesión activa válida sin comanda previa', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionA1.token}`
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.order).toBeNull();
      expect(data.allowOrdering).toBe(true);
      expect(data.requireWaiterValidation).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 2: Aislamiento de Tenant y Disponibilidad de Menú
  // ─────────────────────────────────────────────────────────────
  describe('2. Aislamiento de Tenant y Disponibilidad de Menú', () => {
    it('CRUCIAL: Un plato de Tenant B jamás entra en la cuenta de Tenant A (404 ITEM_NOT_FOUND)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemB1.id, // Plato de Trattoria Beta intentado en Mesa de Trattoria Alpha
          quantity: 2
        }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('ITEM_NOT_FOUND');

      // Verificar en BD que no se creó ninguna comanda ni ítem
      const orders = await prisma.order.findMany({
        where: { tableSessionId: sessionA1.id }
      });
      expect(orders.length).toBe(0);
    });

    it('Rechaza agregar un plato que no está disponible (isAvailable: false) (422)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemUnavailableA.id,
          quantity: 1
        }
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe('ITEM_NOT_AVAILABLE');
    });

    it('Rechaza agregar ítems si el restaurante tiene comandas digitales desactivadas (403 ORDERING_DISABLED)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionC1.token,
          menuItemId: itemC1.id,
          quantity: 1
        }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('ORDERING_DISABLED');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 3: Validación estricta de Cantidades y Límite Explícito
  // ─────────────────────────────────────────────────────────────
  describe('3. Validación estricta de Cantidades y Límite Explícito', () => {
    it('Rechaza cantidad 0 (400 INVALID_QUANTITY)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemA1.id,
          quantity: 0
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_QUANTITY');
    });

    it('Rechaza cantidad negativa -1 (400 INVALID_QUANTITY)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemA1.id,
          quantity: -1
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_QUANTITY');
    });

    it('Rechaza cantidad fraccionaria 1.5 (400 INVALID_QUANTITY)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemA1.id,
          quantity: 1.5
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_QUANTITY');
    });

    it('Rechaza cantidad mayor al límite permitido de 50 unidades (400 QUANTITY_LIMIT_EXCEEDED)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemA1.id,
          quantity: 51
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('QUANTITY_LIMIT_EXCEEDED');
    });

    it('Rechaza notas que superen 500 caracteres (400 NOTES_TOO_LONG)', async () => {
      const longNote = 'A'.repeat(501);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemA1.id,
          quantity: 1,
          notes: longNote
        }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('NOTES_TOO_LONG');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 4: Anti-tampering de Precios y Totales Calculados en Servidor
  // ─────────────────────────────────────────────────────────────
  describe('4. Anti-tampering de Precios y Totales Calculados en Servidor', () => {
    it('Ignora precio y total manipulados enviados por el cliente y usa el valor de BD', async () => {
      // Cliente malicioso intenta enviar unitPrice: 0.01 y totalAmount: 0.02
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemA1.id, // Precio en BD = 1500
          quantity: 2,
          unitPrice: 0.01,
          totalAmount: 0.02,
          price: 1
        }
      });

      expect(res.statusCode).toBe(201);
      const order = res.json();
      expect(order.items.length).toBe(1);
      // unitPrice debe ser exactamente 1500 (precio de BD de itemA1)
      expect(order.items[0].unitPrice).toBe(1500);
      expect(order.items[0].quantity).toBe(2);
      // totalAmount debe ser 1500 * 2 = 3000, jamás el valor enviado por el cliente
      expect(order.totalAmount).toBe(3000);

      // Agregar segundo ítem para verificar suma acumulada en servidor
      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionA1.token,
          menuItemId: itemA2.id, // Precio en BD = 3200
          quantity: 1,
          unitPrice: -500 // Intento de precio negativo
        }
      });

      expect(res2.statusCode).toBe(201);
      const order2 = res2.json();
      expect(order2.items.length).toBe(2);
      // Total debe ser 3000 + 3200 = 6200
      expect(order2.totalAmount).toBe(6200);
      expect(order2.totalAmount).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 5: Restricción de Modificación a DRAFT Propio y Eliminación
  // ─────────────────────────────────────────────────────────────
  describe('5. Restricción de Modificación a DRAFT Propio y Eliminación', () => {
    it('Rechaza eliminar ítem inexistente o perteneciente a otra sesión (404)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/v1/orders/items/${randomUUID()}?sessionToken=${sessionA1.token}`
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('ITEM_NOT_FOUND');
    });

    it('Permite eliminar un ítem de DRAFT propio y recalcula el total correctamente', async () => {
      // Obtener orden actual de sessionA1
      const orderRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionA1.token}`
      });
      const order = orderRes.json().order;
      expect(order.items.length).toBe(2);

      // Eliminar el segundo ítem (Provoleta $3200)
      const itemToDelete = order.items.find((it: any) => it.menuItemId === itemA2.id);
      const delRes = await app.inject({
        method: 'DELETE',
        url: `/v1/orders/items/${itemToDelete.id}?sessionToken=${sessionA1.token}`
      });
      expect(delRes.statusCode).toBe(200);
      const updatedOrder = delRes.json();
      expect(updatedOrder.items.length).toBe(1);
      // El nuevo total debe ser sólo 3000 (2 empanadas de $1500)
      expect(updatedOrder.totalAmount).toBe(3000);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 6: Envío de Comanda (submitOrder), Flags e Idempotencia
  // ─────────────────────────────────────────────────────────────
  describe('6. Envío de Comanda, Flags e Idempotencia (Doble Envío)', () => {
    it('Rechaza enviar comanda vacía sin ítems (400 EMPTY_ORDER)', async () => {
      // Usar sesión limpia B1 sin ítems
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken: sessionB1.token }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('EMPTY_ORDER');
    });

    it('Con requireWaiterValidation: true, submitOrder pasa a PENDING_VALIDATION', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken: sessionA1.token }
      });
      expect(res.statusCode).toBe(200);
      const order = res.json();
      expect(order.status).toBe(OrderStatus.PENDING_VALIDATION);
      expect(order.items.length).toBe(1);
    });

    it('IDEMPOTENCIA: Doble envío devuelve la misma comanda sin duplicar líneas ni pedidos', async () => {
      const resFirst = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionA1.token}`
      });
      const orderFirst = resFirst.json().order;
      const initialOrderId = orderFirst.id;
      const initialItemsCount = orderFirst.items.length;

      // Segundo submit inmediato (reintento o doble click)
      const resSecond = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken: sessionA1.token }
      });

      expect(resSecond.statusCode).toBe(200);
      const orderSecond = resSecond.json();
      expect(orderSecond.id).toBe(initialOrderId);
      expect(orderSecond.items.length).toBe(initialItemsCount);
      expect(orderSecond.status).toBe(OrderStatus.PENDING_VALIDATION);

      // Verificar en BD que sigue existiendo exactamente 1 sola orden y 1 solo ítem para esta sesión
      const allOrders = await prisma.order.findMany({
        where: { tableSessionId: sessionA1.id }
      });
      expect(allOrders.length).toBe(1);

      const allItems = await prisma.orderItem.findMany({
        where: { orderId: initialOrderId }
      });
      expect(allItems.length).toBe(initialItemsCount);
    });

    it('Prohíbe modificar o eliminar ítems de una comanda ya enviada (409 ORDER_NOT_IN_DRAFT)', async () => {
      // Tomamos la comanda que ya fue enviada a cocina/validación en sessionA1
      const orderRes = await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionA1.token}`
      });
      const submittedOrder = orderRes.json().order;
      expect(submittedOrder.status).toBe(OrderStatus.PENDING_VALIDATION);
      const submittedItemId = submittedOrder.items[0].id;

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/v1/orders/items/${submittedItemId}?sessionToken=${sessionA1.token}`
      });
      expect(delRes.statusCode).toBe(409);
      expect(delRes.json().code).toBe('ORDER_NOT_IN_DRAFT');
    });

    it('Con requireWaiterValidation: false (Tenant D), submitOrder pasa directamente a IN_KITCHEN', async () => {
      // Agregar ítem en Tenant D
      const addRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/items',
        payload: {
          sessionToken: sessionD1.token,
          menuItemId: itemD1.id,
          quantity: 2
        }
      });
      expect(addRes.statusCode).toBe(201);

      // Enviar comanda
      const submitRes = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken: sessionD1.token }
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe(OrderStatus.IN_KITCHEN);
    });

    it('Rechaza submit de orden en estado final (PAID o CANCELLED) (409 ORDER_FINAL_STATE)', async () => {
      // Crear una mesa y sesión con orden en estado PAID
      const tablePaid = await prisma.table.create({
        data: {
          restaurantId: restA.id,
          label: 'Mesa Pagada',
          sector: 'SALON',
          currentState: TableFSMState.OCCUPIED_ORDERED,
          capacity: 2
        }
      });

      const sessionPaid = await prisma.tableSession.create({
        data: {
          tableId: tablePaid.id,
          shiftId: shiftA.id,
          token: randomUUID(),
          expiresAt: new Date(Date.now() + 60000)
        }
      });

      await prisma.order.create({
        data: {
          tableSessionId: sessionPaid.id,
          status: OrderStatus.PAID,
          totalAmount: 5000
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/submit',
        payload: { sessionToken: sessionPaid.token }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ORDER_FINAL_STATE');
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 7: Acciones de Staff (Validación y Agregado de Ítems)
  // ─────────────────────────────────────────────────────────────
  describe('7. Acciones de Staff (Validación y Agregado de Ítems)', () => {
    it('Staff valida comanda en PENDING_VALIDATION y pasa a IN_KITCHEN', async () => {
      // Obtener orden de sessionA1
      const orderA1 = (await app.inject({
        method: 'GET',
        url: `/v1/orders/session/${sessionA1.token}`
      })).json().order;

      const validateRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderA1.id}/validate`,
        headers: { authorization: `Bearer ${tokenStaffA}` }
      });
      expect(validateRes.statusCode).toBe(200);
      expect(validateRes.json().status).toBe(OrderStatus.IN_KITCHEN);

      // Re-validación es idempotente
      const revalidateRes = await app.inject({
        method: 'POST',
        url: `/v1/staff/orders/${orderA1.id}/validate`,
        headers: { authorization: `Bearer ${tokenStaffA}` }
      });
      expect(revalidateRes.statusCode).toBe(200);
      expect(revalidateRes.json().status).toBe(OrderStatus.IN_KITCHEN);
    });

    it('Staff no puede agregar plato de Tenant B a mesa de Tenant A (404 ITEM_NOT_FOUND)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenStaffA}` },
        payload: {
          menuItemId: itemB1.id, // Ítem de restaurante B
          quantity: 1
        }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toContain('menú');
    });

    it('Staff rechaza cantidades inválidas (0 o negativas) al cargar ítems (400)', async () => {
      const resZero = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenStaffA}` },
        payload: {
          menuItemId: itemA1.id,
          quantity: 0
        }
      });
      expect(resZero.statusCode).toBe(400);

      const resNeg = await app.inject({
        method: 'POST',
        url: `/v1/staff/tables/${tableA1.id}/orders/items`,
        headers: { authorization: `Bearer ${tokenStaffA}` },
        payload: {
          menuItemId: itemA1.id,
          quantity: -2
        }
      });
      expect(resNeg.statusCode).toBe(400);
    });
  });

  // ─────────────────────────────────────────────────────────────
  // SUITE 8: Bloqueo de Pagos Digitales (Piloto Presencial)
  // ─────────────────────────────────────────────────────────────
  describe('8. Bloqueo de Pagos Digitales (Piloto Presencial)', () => {
    it('POST /v1/orders/items/claim retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/items/claim',
        payload: {
          orderItemId: randomUUID(),
          guestSessionId: 'guest-1',
          claimVersion: 0
        }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });

    it('POST /v1/orders/:id/split-session retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/orders/${randomUUID()}/split-session`,
        payload: {
          mode: 'EQUAL_PARTS',
          totalParts: 4
        }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });

    it('POST /v1/orders/split-session/:id/pay-part retorna 503 DIGITAL_PAYMENTS_UNAVAILABLE', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/orders/split-session/${randomUUID()}/pay-part`,
        payload: {
          guestSessionId: 'guest-1',
          paymentMethod: 'MERCADO_PAGO'
        }
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    });
  });
});

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { WaitlistStatus, TableFSMState } from '@mesaya/shared';

describe('E07 — Fila virtual y pre-pedido integral', () => {
  let app: FastifyInstance;

  // Tenant 1: Parrilla Costanera (enableWaitlist: true, enableWaitlistPreOrder: true)
  let rest1: any;
  let table1A: any;
  let table1B: any;
  let table1C: any;
  let staffWaiter1: any;
  let tokenWaiter1: string;
  let category1: any;
  let menuItem1A: any;
  let menuItem1B: any;

  // Tenant 2: Café de la Bahía (Tenant aislamiento)
  let rest2: any;
  let table2A: any;
  let staffWaiter2: any;
  let tokenWaiter2: string;

  // Tenant 3: Cantina Central (enableWaitlist: false)
  let rest3: any;

  // Tenant 4: Bistro Norte (enableWaitlist: true, enableWaitlistPreOrder: false)
  let rest4: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // ─────────────────────────────────────────────────────────────
    // Setup Tenant 1 (Parrilla Costanera)
    // ─────────────────────────────────────────────────────────────
    rest1 = await prisma.restaurant.create({
      data: {
        name: 'Parrilla Costanera',
        slug: `costanera-e07-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#ef4444',
        moduleConfig: {
          create: {
            enableWaitlist: true,
            enableWaitlistPreOrder: true,
            enableRewards: false,
            allowOrdering: true,
            requireWaiterValidation: false
          }
        }
      }
    });

    table1A = await prisma.table.create({
      data: {
        restaurantId: rest1.id,
        label: 'Mesa 101',
        sector: 'SALON',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4
      }
    });

    table1B = await prisma.table.create({
      data: {
        restaurantId: rest1.id,
        label: 'Mesa 102',
        sector: 'SALON',
        currentState: TableFSMState.AVAILABLE,
        capacity: 2
      }
    });

    table1C = await prisma.table.create({
      data: {
        restaurantId: rest1.id,
        label: 'Mesa 103',
        sector: 'SALON',
        currentState: TableFSMState.AVAILABLE,
        capacity: 6
      }
    });

    category1 = await prisma.menuCategory.create({
      data: {
        restaurantId: rest1.id,
        name: 'Carnes a las brasas',
        orderIndex: 1
      }
    });

    menuItem1A = await prisma.menuItem.create({
      data: {
        categoryId: category1.id,
        name: 'Ojo de bife 400g',
        price: 9500,
        isAvailable: true
      }
    });

    menuItem1B = await prisma.menuItem.create({
      data: {
        categoryId: category1.id,
        name: 'Papas rústicas con romero',
        price: 3200,
        isAvailable: true
      }
    });

    staffWaiter1 = await prisma.staffUser.create({
      data: {
        restaurantId: rest1.id,
        name: 'Mozo Costanera',
        pinHash: await bcrypt.hash('3333', 10),
        role: 'WAITER'
      }
    });

    const loginRes1 = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: rest1.slug, pin: '3333' }
    });
    tokenWaiter1 = loginRes1.json().token;

    // ─────────────────────────────────────────────────────────────
    // Setup Tenant 2 (Café de la Bahía)
    // ─────────────────────────────────────────────────────────────
    rest2 = await prisma.restaurant.create({
      data: {
        name: 'Café de la Bahía',
        slug: `bahia-e07-${Date.now()}`,
        templateId: 'MINIMAL_CLEAN',
        themeColor: '#0ea5e9',
        moduleConfig: {
          create: {
            enableWaitlist: true,
            enableWaitlistPreOrder: true
          }
        }
      }
    });

    table2A = await prisma.table.create({
      data: {
        restaurantId: rest2.id,
        label: 'Mesa Bahía 1',
        sector: 'VEREDA',
        currentState: TableFSMState.AVAILABLE,
        capacity: 2
      }
    });

    staffWaiter2 = await prisma.staffUser.create({
      data: {
        restaurantId: rest2.id,
        name: 'Mozo Bahía',
        pinHash: await bcrypt.hash('4444', 10),
        role: 'WAITER'
      }
    });

    const loginRes2 = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: rest2.slug, pin: '4444' }
    });
    tokenWaiter2 = loginRes2.json().token;

    // ─────────────────────────────────────────────────────────────
    // Setup Tenant 3 (Waitlist OFF)
    // ─────────────────────────────────────────────────────────────
    rest3 = await prisma.restaurant.create({
      data: {
        name: 'Cantina Central (Waitlist OFF)',
        slug: `cantina-off-${Date.now()}`,
        templateId: 'RUSTIC_WARMTH',
        themeColor: '#78716c',
        moduleConfig: {
          create: {
            enableWaitlist: false,
            enableWaitlistPreOrder: false
          }
        }
      }
    });

    // ─────────────────────────────────────────────────────────────
    // Setup Tenant 4 (PreOrder OFF)
    // ─────────────────────────────────────────────────────────────
    rest4 = await prisma.restaurant.create({
      data: {
        name: 'Bistro Norte (PreOrder OFF)',
        slug: `bistro-nopreorder-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#10b981',
        moduleConfig: {
          create: {
            enableWaitlist: true,
            enableWaitlistPreOrder: false
          }
        }
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // 1. Dos dispositivos, consulta privada y aislamiento de datos
  // ══════════════════════════════════════════════════════════════════════
  describe('1. Dos dispositivos, consulta privada y privacidad del teléfono', () => {
    let ticketDevA: any;
    let ticketDevB: any;

    it('dos dispositivos se registran por separado y reciben sus tickets sin filtración', async () => {
      // Dispositivo A: Familia López
      const resA = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Familia López',
          partySize: 4,
          phone: '223 555-1001',
          consent: true
        }
      });
      expect(resA.statusCode).toBe(201);
      ticketDevA = resA.json();
      expect(ticketDevA.guestName).toBe('Familia López');
      expect(ticketDevA.positionInQueue).toBe(1);
      expect(ticketDevA.phone).toBeUndefined(); // Privacidad: NO expone teléfono

      // Dispositivo B: Dra. Gómez
      const resB = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Dra. Gómez',
          partySize: 2,
          phone: '0223 15-555-2002',
          consent: true
        }
      });
      expect(resB.statusCode).toBe(201);
      ticketDevB = resB.json();
      expect(ticketDevB.guestName).toBe('Dra. Gómez');
      expect(ticketDevB.positionInQueue).toBe(2);
      expect(ticketDevB.phone).toBeUndefined();
    });

    it('consulta privada: cada dispositivo ve únicamente su ticket usando su teléfono', async () => {
      const queryA = await app.inject({
        method: 'GET',
        url: `/v1/waitlist/${ticketDevA.id}/status?phone=2235551001`
      });
      expect(queryA.statusCode).toBe(200);
      expect(queryA.json().id).toBe(ticketDevA.id);
      expect(queryA.json().guestName).toBe('Familia López');
      expect(queryA.json().phone).toBeUndefined();

      const queryB = await app.inject({
        method: 'GET',
        url: `/v1/waitlist/${ticketDevB.id}/status?phone=0223155552002`
      });
      expect(queryB.statusCode).toBe(200);
      expect(queryB.json().id).toBe(ticketDevB.id);
      expect(queryB.json().guestName).toBe('Dra. Gómez');
      expect(queryB.json().phone).toBeUndefined();
    });

    it('consulta privada: dispositivo B intentando consultar ticket A con su propio teléfono es rechazado con 404', async () => {
      const leakAttempt = await app.inject({
        method: 'GET',
        url: `/v1/waitlist/${ticketDevA.id}/status?phone=2235552002`
      });
      expect(leakAttempt.statusCode).toBe(404);
      expect(leakAttempt.json().code).toBe('WAITLIST_TICKET_NOT_FOUND');
    });

    it('dos dispositivos consultando simultáneamente el mismo ticket obtienen estado consistente', async () => {
      const [res1, res2] = await Promise.all([
        app.inject({
          method: 'GET',
          url: `/v1/waitlist/${ticketDevA.id}/status?phone=2235551001`
        }),
        app.inject({
          method: 'GET',
          url: `/v1/waitlist/${ticketDevA.id}/status?phone=2235551001`
        })
      ]);
      expect(res1.statusCode).toBe(200);
      expect(res2.statusCode).toBe(200);
      expect(res1.json().id).toBe(res2.json().id);
      expect(res1.json().positionInQueue).toBe(res2.json().positionInQueue);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 2. Cancelación segura (Cliente público y Staff)
  // ══════════════════════════════════════════════════════════════════════
  describe('2. Cancelación segura por comensal y por staff', () => {
    let cancelTicketA: any;
    let cancelTicketB: any;

    beforeAll(async () => {
      const resA = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Grupo Cancelación Cliente',
          partySize: 3,
          phone: '2235553001',
          consent: true
        }
      });
      cancelTicketA = resA.json();

      const resB = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Grupo Cancelación Staff',
          partySize: 2,
          phone: '2235553002',
          consent: true
        }
      });
      cancelTicketB = resB.json();
    });

    it('rechaza cancelación pública si el teléfono no coincide (404 sin enumeración)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/waitlist/${cancelTicketA.id}/cancel`,
        payload: { phone: '2235559999' }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('WAITLIST_TICKET_NOT_FOUND');

      const entry = await prisma.waitlistEntry.findUnique({ where: { id: cancelTicketA.id } });
      expect(entry?.status).toBe(WaitlistStatus.WAITING);
    });

    it('permite al comensal cancelar su propio turno con teléfono validado', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/waitlist/${cancelTicketA.id}/cancel`,
        payload: { phone: '2235553001' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.CANCELLED);
      expect(res.json().phone).toBeUndefined(); // Sin PII

      const entry = await prisma.waitlistEntry.findUnique({ where: { id: cancelTicketA.id } });
      expect(entry?.status).toBe(WaitlistStatus.CANCELLED);
    });

    it('cancelación repetida es idempotente y retorna 200 sin alterar estado', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/waitlist/${cancelTicketA.id}/cancel`,
        payload: { phone: '2235553001' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.CANCELLED);
    });

    it('rechaza que staff de otro restaurante cancele el turno (403 tenant mismatch)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${cancelTicketB.id}/cancel`,
        headers: { authorization: `Bearer ${tokenWaiter2}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');

      const entry = await prisma.waitlistEntry.findUnique({ where: { id: cancelTicketB.id } });
      expect(entry?.status).toBe(WaitlistStatus.WAITING);
    });

    it('permite al staff del propio restaurante cancelar un turno activo', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${cancelTicketB.id}/cancel`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { reason: 'Comensal avisó que se retira' }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.CANCELLED);

      const entry = await prisma.waitlistEntry.findUnique({ where: { id: cancelTicketB.id } });
      expect(entry?.status).toBe(WaitlistStatus.CANCELLED);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 3. Aviso, No-Show y Expiración Verificable
  // ══════════════════════════════════════════════════════════════════════
  describe('3. Aviso, No-Show explícito y política de expiración', () => {
    let calledTicket: any;
    let staleTicket: any;

    beforeAll(async () => {
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Grupo Para Aviso',
          partySize: 2,
          phone: '2235554001',
          consent: true
        }
      });
      calledTicket = res1.json();

      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Grupo Vencido 35 Minutos',
          partySize: 4,
          phone: '2235554002',
          consent: true
        }
      });
      staleTicket = res2.json();

      // Forzar que staleTicket esté en CALLED hace 35 minutos
      await prisma.waitlistEntry.update({
        where: { id: staleTicket.id },
        data: {
          status: WaitlistStatus.CALLED,
          calledAt: new Date(Date.now() - 35 * 60 * 1000)
        }
      });
    });

    it('staff llama al comensal (aviso de mesa lista: CALLED)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${calledTicket.id}/call`,
        headers: { authorization: `Bearer ${tokenWaiter1}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.CALLED);
      expect(res.json().calledAt).toBeTruthy();
    });

    it('staff puede marcar como no-show un turno llamado que no compareció', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${calledTicket.id}/no-show`,
        headers: { authorization: `Bearer ${tokenWaiter1}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.NO_SHOW);

      const entry = await prisma.waitlistEntry.findUnique({ where: { id: calledTicket.id } });
      expect(entry?.status).toBe(WaitlistStatus.NO_SHOW);
    });

    it('rechaza llamar a un turno marcado como no-show (409)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${calledTicket.id}/call`,
        headers: { authorization: `Bearer ${tokenWaiter1}` }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_WAITLIST_STATUS');
    });

    it('rechaza sentar a un turno marcado como no-show (409) y no ocupa la mesa', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${calledTicket.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { tableId: table1A.id }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_WAITLIST_STATUS');

      const table = await prisma.table.findUnique({ where: { id: table1A.id } });
      expect(table?.currentState).toBe(TableFSMState.AVAILABLE);
    });

    it('política de vencimiento automática: turno llamado hace más de 30m pasa a NO_SHOW al consultar estado o cola', async () => {
      // Consulta pública del propio ticket vencido
      const statusRes = await app.inject({
        method: 'GET',
        url: `/v1/waitlist/${staleTicket.id}/status?phone=2235554002`
      });
      expect(statusRes.statusCode).toBe(200);
      expect(statusRes.json().status).toBe(WaitlistStatus.NO_SHOW);

      // La cola del staff excluye turnos NO_SHOW y CANCELLED
      const queueRes = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${rest1.id}/waitlist`,
        headers: { authorization: `Bearer ${tokenWaiter1}` }
      });
      expect(queueRes.statusCode).toBe(200);
      const ids = queueRes.json().queue.map((q: any) => q.id);
      expect(ids).not.toContain(calledTicket.id);
      expect(ids).not.toContain(staleTicket.id);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 4. Carrera de asignación y repetición (Exactamente una asignación)
  // ══════════════════════════════════════════════════════════════════════
  describe('4. Carrera de asignación concurrente y repetición', () => {
    let raceTicket: any;

    beforeAll(async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Grupo Carrera Seating',
          partySize: 2,
          phone: '2235555001',
          consent: true,
          preOrderData: [{ menuItemId: menuItem1A.id, quantity: 1 }]
        }
      });
      raceTicket = res.json();
    });

    it('resuelve dos intentos simultáneos sobre el mismo turno con exactamente 1 éxito y 1 comanda', async () => {
      const results = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/v1/staff/waitlist/${raceTicket.id}/seat`,
          headers: { authorization: `Bearer ${tokenWaiter1}` },
          payload: { tableId: table1A.id }
        }),
        app.inject({
          method: 'PATCH',
          url: `/v1/staff/waitlist/${raceTicket.id}/seat`,
          headers: { authorization: `Bearer ${tokenWaiter1}` },
          payload: { tableId: table1B.id }
        })
      ]);

      const success = results.filter(r => r.statusCode === 200);
      const failed = results.filter(r => r.statusCode === 409);
      expect(success).toHaveLength(1);
      expect(failed).toHaveLength(1);

      // Exactamente una orden en cocina generada por el pre-pedido
      const orders = await prisma.order.findMany({
        where: {
          tableSession: { tableId: { in: [table1A.id, table1B.id] } }
        },
        include: { items: true }
      });
      expect(orders).toHaveLength(1);
      expect(orders[0].items).toHaveLength(1);
      expect(orders[0].items[0].quantity).toBe(1);
    });

    it('repetición de asignación posterior sobre turno ya SEATED es rechazada con 409 ALREADY_SEATED', async () => {
      const replay = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${raceTicket.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { tableId: table1C.id }
      });
      expect(replay.statusCode).toBe(409);
      expect(replay.json().code).toBe('ALREADY_SEATED');

      // Mesa 1C no se tocó
      const table1CCheck = await prisma.table.findUnique({ where: { id: table1C.id } });
      expect(table1CCheck?.currentState).toBe(TableFSMState.AVAILABLE);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 5. Stock cambiado, reversión segura y camino de recuperación
  // ══════════════════════════════════════════════════════════════════════
  describe('5. Stock cambiado antes de sentar, reversión limpia y recuperación con skipPreOrder', () => {
    let outOfStockItem: any;
    let stockTicket: any;
    let recoveryTable: any;

    beforeAll(async () => {
      recoveryTable = await prisma.table.create({
        data: {
          restaurantId: rest1.id,
          label: `Mesa Recup ${Date.now()}`,
          sector: 'SALON',
          currentState: TableFSMState.AVAILABLE,
          capacity: 4
        }
      });

      outOfStockItem = await prisma.menuItem.create({
        data: {
          categoryId: category1.id,
          name: `Plato especial efímero ${Date.now()}`,
          price: 12000,
          isAvailable: true
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Grupo Stock Cambiado',
          partySize: 3,
          phone: '2235556001',
          consent: true,
          preOrderData: [
            { menuItemId: menuItem1B.id, quantity: 2 },
            { menuItemId: outOfStockItem.id, quantity: 1 }
          ]
        }
      });
      expect(res.statusCode).toBe(201);
      stockTicket = res.json();

      // Cambiamos disponibilidad del ítem a falso antes de sentar
      await prisma.menuItem.update({
        where: { id: outOfStockItem.id },
        data: { isAvailable: false }
      });
    });

    it('al fallar stock en comanda, no deja comanda parcial, revierte la mesa y NO deja el ticket SEATED', async () => {
      const seatAttempt = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${stockTicket.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { tableId: recoveryTable.id }
      });
      expect(seatAttempt.statusCode).toBe(409);
      expect(seatAttempt.json().code).toBe('PREORDER_PROMOTION_FAILED');

      // 1. Cero comandas parciales en la mesa
      const orders = await prisma.order.findMany({
        where: { tableSession: { tableId: recoveryTable.id } }
      });
      expect(orders).toHaveLength(0);

      // 2. Mesa destino revertida a AVAILABLE
      const tableCheck = await prisma.table.findUnique({ where: { id: recoveryTable.id } });
      expect(tableCheck?.currentState).toBe(TableFSMState.AVAILABLE);

      // 3. Ticket NO quedó irrevocablemente SEATED (sigue en WAITING para recuperar)
      const ticketCheck = await prisma.waitlistEntry.findUnique({ where: { id: stockTicket.id } });
      expect(ticketCheck?.status).toBe(WaitlistStatus.WAITING);
      expect(ticketCheck?.seatedAt).toBeNull();
    });

    it('camino de recuperación: el personal puede sentar al grupo con skipPreOrder: true', async () => {
      const recoverySeat = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${stockTicket.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { tableId: recoveryTable.id, skipPreOrder: true, skipReason: 'Motivo auditado recovery manual en mesa' }
      });
      expect(recoverySeat.statusCode).toBe(200);
      expect(recoverySeat.json().status).toBe(WaitlistStatus.SEATED);

      // Mesa ocupada formalmente
      const tableCheck = await prisma.table.findUnique({ where: { id: recoveryTable.id } });
      expect(tableCheck?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);

      // Ticket en SEATED
      const ticketCheck = await prisma.waitlistEntry.findUnique({ where: { id: stockTicket.id } });
      expect(ticketCheck?.status).toBe(WaitlistStatus.SEATED);

      // Cero comandas generadas automáticamente (el mozo toma pedido manual)
      const orders = await prisma.order.findMany({
        where: { tableSession: { tableId: recoveryTable.id } }
      });
      expect(orders).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 6. Precio actualizado en catálogo operativo E01
  // ══════════════════════════════════════════════════════════════════════
  describe('6. Precio modificado en catálogo operativo E01 se respeta al sentar', () => {
    let priceItem: any;
    let priceTicket: any;
    let priceTable: any;

    beforeAll(async () => {
      priceTable = await prisma.table.create({
        data: {
          restaurantId: rest1.id,
          label: `Mesa Precio ${Date.now()}`,
          sector: 'SALON',
          currentState: TableFSMState.AVAILABLE,
          capacity: 4
        }
      });

      priceItem = await prisma.menuItem.create({
        data: {
          categoryId: category1.id,
          name: `Corte premium precio variable ${Date.now()}`,
          price: 5000,
          isAvailable: true
        }
      });

      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest1.slug,
          guestName: 'Grupo Precio Dinámico',
          partySize: 2,
          phone: '2235557001',
          consent: true,
          preOrderData: [{ menuItemId: priceItem.id, quantity: 2 }]
        }
      });
      priceTicket = res.json();

      // El restaurante actualiza el precio del plato a 6200 en el catálogo operativo E01
      await prisma.menuItem.update({
        where: { id: priceItem.id },
        data: { price: 6200, priceMinor: 620000 }
      });
    });

    it('la comanda generada al sentar utiliza el precio vigente en el catálogo, no el precio congelado previo', async () => {
      const seat = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${priceTicket.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { tableId: priceTable.id }
      });
      expect(seat.statusCode).toBe(200);
      expect(seat.json().status).toBe(WaitlistStatus.SEATED);

      const order = await prisma.order.findFirst({
        where: { tableSession: { tableId: priceTable.id } },
        include: { items: true }
      });
      expect(order).toBeDefined();
      expect(order?.items[0].unitPrice).toBe(6200);
      expect(order?.items[0].quantity).toBe(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 7. Módulo apagado: sin acciones falsas
  // ══════════════════════════════════════════════════════════════════════
  describe('7. Módulos apagados sin acciones falsas (Fila y Pre-Order)', () => {
    it('restaurante con enableWaitlist: false rechaza ingreso con 403 WAITLIST_DISABLED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest3.slug,
          guestName: 'Intento en local apagado',
          partySize: 2,
          phone: '2235558001',
          consent: true
        }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('WAITLIST_DISABLED');
    });

    it('restaurante con enableWaitlistPreOrder: false rechaza pre-pedido con 403 PREORDER_DISABLED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: rest4.slug,
          guestName: 'Intento pre-pedido apagado',
          partySize: 2,
          phone: '2235558002',
          consent: true,
          preOrderData: [{ menuItemId: menuItem1A.id, quantity: 1 }]
        }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('PREORDER_DISABLED');
    });

    it('si el encargado apaga pre-order mientras hay tickets con pre-orden, al sentar rechaza promoción y permite recuperación', async () => {
      // 1. Crear restaurante con pre-order inicialmente activo
      const dynamicRest = await prisma.restaurant.create({
        data: {
          name: 'Restaurante Toggle PreOrder',
          slug: `toggle-preorder-${Date.now()}`,
          templateId: 'GOURMET_OBSIDIAN',
          themeColor: '#eab308',
          moduleConfig: {
            create: {
              enableWaitlist: true,
              enableWaitlistPreOrder: true
            }
          }
        }
      });
      const dynTable = await prisma.table.create({
        data: {
          restaurantId: dynamicRest.id,
          label: 'Mesa Toggle 1',
          currentState: TableFSMState.AVAILABLE,
          capacity: 4
        }
      });
      const dynCat = await prisma.menuCategory.create({
        data: { restaurantId: dynamicRest.id, name: 'General', orderIndex: 0 }
      });
      const dynItem = await prisma.menuItem.create({
        data: { categoryId: dynCat.id, name: 'Plato toggle', price: 4000, isAvailable: true }
      });
      const dynStaff = await prisma.staffUser.create({
        data: {
          restaurantId: dynamicRest.id,
          name: 'Mozo Dyn',
          pinHash: await bcrypt.hash('5555', 10),
          role: 'WAITER'
        }
      });
      const login = await app.inject({
        method: 'POST',
        url: '/v1/staff/login',
        payload: { restaurantSlug: dynamicRest.slug, pin: '5555' }
      });
      const dynToken = login.json().token;

      // 2. Comensal ingresa a fila con pre-pedido válido
      const joinRes = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: dynamicRest.slug,
          guestName: 'Comensal PreOrder Toggle',
          partySize: 2,
          phone: '2235558003',
          consent: true,
          preOrderData: [{ menuItemId: dynItem.id, quantity: 1 }]
        }
      });
      expect(joinRes.statusCode).toBe(201);
      const ticketId = joinRes.json().id;

      // 3. El encargado desactiva el pre-pedido en el módulo
      await prisma.restaurantModuleConfig.update({
        where: { restaurantId: dynamicRest.id },
        data: { enableWaitlistPreOrder: false }
      });

      // 4. Al sentar, la promoción de pre-pedido falla con 409
      const seatFail = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${ticketId}/seat`,
        headers: { authorization: `Bearer ${dynToken}` },
        payload: { tableId: dynTable.id }
      });
      expect(seatFail.statusCode).toBe(409);
      expect(seatFail.json().code).toBe('PREORDER_PROMOTION_FAILED');

      // 5. Mesa y ticket se mantienen libres y no bloqueados
      const tableAfter = await prisma.table.findUnique({ where: { id: dynTable.id } });
      expect(tableAfter?.currentState).toBe(TableFSMState.AVAILABLE);

      const ticketAfter = await prisma.waitlistEntry.findUnique({ where: { id: ticketId } });
      expect(ticketAfter?.status).toBe(WaitlistStatus.WAITING);

      // 6. Se sienta con skipPreOrder: true, skipReason: 'Motivo auditado recovery manual en mesa' exitosamente
      const seatRecover = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${ticketId}/seat`,
        headers: { authorization: `Bearer ${dynToken}` },
        payload: { tableId: dynTable.id, skipPreOrder: true, skipReason: 'Motivo auditado recovery manual en mesa' }
      });
      expect(seatRecover.statusCode).toBe(200);
      expect(seatRecover.json().status).toBe(WaitlistStatus.SEATED);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // 8. Intentos sobre tickets cancelados o no-show no generan comanda
  // ══════════════════════════════════════════════════════════════════════
  describe('8. Tickets cancelados o no-show no generan comanda ni alteran mesa', () => {
    it('ticket cancelado con preOrderData no genera comanda ni altera mesa al intentar sentar', async () => {
      const cancelEntry = await prisma.waitlistEntry.create({
        data: {
          restaurantId: rest1.id,
          guestName: 'Grupo Cancelado PreOrder',
          partySize: 2,
          phone: '+5492235559922',
          status: WaitlistStatus.CANCELLED,
          preOrderData: JSON.stringify([{ menuItemId: menuItem1A.id, quantity: 2 }])
        }
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${cancelEntry.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { tableId: table1C.id }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_WAITLIST_STATUS');

      const tableCheck = await prisma.table.findUnique({ where: { id: table1C.id } });
      expect(tableCheck?.currentState).toBe(TableFSMState.AVAILABLE);

      const orders = await prisma.order.findMany({
        where: { tableSession: { tableId: table1C.id } }
      });
      expect(orders).toHaveLength(0);
    });

    it('ticket marcado como no-show con preOrderData no genera comanda ni altera mesa al intentar sentar', async () => {
      const noShowEntry = await prisma.waitlistEntry.create({
        data: {
          restaurantId: rest1.id,
          guestName: 'Grupo NoShow PreOrder',
          partySize: 2,
          phone: '+5492235559933',
          status: WaitlistStatus.NO_SHOW,
          preOrderData: JSON.stringify([{ menuItemId: menuItem1A.id, quantity: 2 }])
        }
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${noShowEntry.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiter1}` },
        payload: { tableId: table1C.id }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_WAITLIST_STATUS');

      const tableCheck = await prisma.table.findUnique({ where: { id: table1C.id } });
      expect(tableCheck?.currentState).toBe(TableFSMState.AVAILABLE);

      const orders = await prisma.order.findMany({
        where: { tableSession: { tableId: table1C.id } }
      });
      expect(orders).toHaveLength(0);
    });
  });
});

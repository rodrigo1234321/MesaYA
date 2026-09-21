import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { WaitlistStatus, TableFSMState } from '@mesaya/shared';

describe('Etapa 16 — Cerrar lista de espera y módulos incompletos', () => {
  let app: FastifyInstance;

  // Tenant A: Trattoria Alpha (enableWaitlist: true, enableWaitlistPreOrder: false, enableRewards: false)
  let restA: any;
  let tableA1: any; // Disponible
  let tableA2: any; // Ocupada
  let staffWaiterA: any;
  let tokenWaiterA: string;

  // Tenant B: Bodegón Beta (para pruebas de aislamiento de tenant y pre-pedido)
  let restB: any;
  let tableB1: any;
  let tableB2: any;
  let staffWaiterB: any;
  let tokenWaiterB: string;
  let preOrderItemB: any;
  let publicTicketA: any;
  let preOrderTicketB: any;

  // Tenant C: Restaurante con Fila Desactivada (enableWaitlist: false)
  let restC: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    // ─────────────────────────────────────────────────────────────
    // 1. Setup Tenant A
    // ─────────────────────────────────────────────────────────────
    restA = await prisma.restaurant.create({
      data: {
        name: 'Trattoria Alpha (Waitlist A)',
        slug: `alpha-waitlist-${Date.now()}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#3b82f6',
          moduleConfig: {
          create: {
            enableWaitlist: true,
          enableWaitlistPreOrder: false,
            enableRewards: false,
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
      }
    });

    tableA1 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa W-1',
        sector: 'SALON',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4
      }
    });

    tableA2 = await prisma.table.create({
      data: {
        restaurantId: restA.id,
        label: 'Mesa W-2',
        sector: 'SALON',
        currentState: TableFSMState.OCCUPIED_NO_ORDER,
        capacity: 2
      }
    });

    staffWaiterA = await prisma.staffUser.create({
      data: {
        restaurantId: restA.id,
        name: 'Mozo Alpha',
        pinHash: await bcrypt.hash('1111', 10),
        role: 'WAITER'
      }
    });

    const loginResA = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restA.slug, pin: '1111' }
    });
    expect(loginResA.statusCode).toBe(200);
    tokenWaiterA = loginResA.json().token;

    // ─────────────────────────────────────────────────────────────
    // 2. Setup Tenant B
    // ─────────────────────────────────────────────────────────────
    restB = await prisma.restaurant.create({
      data: {
        name: 'Bodegón Beta (Waitlist B)',
        slug: `beta-waitlist-${Date.now()}`,
        templateId: 'RUSTIC_WARMTH',
        themeColor: '#10b981',
        moduleConfig: {
          create: {
            enableWaitlist: true,
            enableWaitlistPreOrder: true,
            enableRewards: false,
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
      }
    });

    tableB1 = await prisma.table.create({
      data: {
        restaurantId: restB.id,
        label: 'Mesa B-1',
        sector: 'TERRAZA',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4
      }
    });

    tableB2 = await prisma.table.create({
      data: {
        restaurantId: restB.id,
        label: 'Mesa B-2',
        sector: 'TERRAZA',
        currentState: TableFSMState.AVAILABLE,
        capacity: 4
      }
    });

    const categoryB = await prisma.menuCategory.create({
      data: { restaurantId: restB.id, name: 'Cocina de prueba', orderIndex: 0 }
    });
    preOrderItemB = await prisma.menuItem.create({
      data: {
        categoryId: categoryB.id,
        name: 'Plato de fila',
        price: 4500,
        isAvailable: true
      }
    });

    staffWaiterB = await prisma.staffUser.create({
      data: {
        restaurantId: restB.id,
        name: 'Mozo Beta',
        pinHash: await bcrypt.hash('2222', 10),
        role: 'WAITER'
      }
    });

    const loginResB = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restB.slug, pin: '2222' }
    });
    expect(loginResB.statusCode).toBe(200);
    tokenWaiterB = loginResB.json().token;

    // ─────────────────────────────────────────────────────────────
    // 3. Setup Tenant C (Fila virtual apagada)
    // ─────────────────────────────────────────────────────────────
    restC = await prisma.restaurant.create({
      data: {
        name: 'Cafetería Gamma (Waitlist OFF)',
        slug: `gamma-waitlist-${Date.now()}`,
        templateId: 'MINIMAL_CLEAN',
        themeColor: '#6b7280',
        moduleConfig: {
          create: {
            enableWaitlist: false,
            enableWaitlistPreOrder: false,
            enableRewards: false
          }
        }
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 1: Join público, validaciones, consentimiento y privacidad (Checklist 2)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 1: Join público, validaciones y no filtración de datos (Checklist 2)', () => {
    it('Rechaza con 400 si falta el restaurantSlug', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { guestName: 'Familia Perez', partySize: 3, phone: '2235551234' }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('SLUG_REQUIRED');
    });

    it('Rechaza con 404 si el restaurante no existe', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: 'slug-inexistente-12345', guestName: 'Lopez', partySize: 2, phone: '2235550001' }
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe('RESTAURANT_NOT_FOUND');
    });

    it('Rechaza con 403 si la fila virtual está desactivada para el restaurante (Feature apagada)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restC.slug, guestName: 'Lopez', partySize: 2, phone: '2235550002' }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('WAITLIST_DISABLED');
    });

    it('Rechaza con 400 si el nombre es inválido (vacío, muy corto o muy largo)', async () => {
      // Nombre vacío
      const resEmpty = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: '   ', partySize: 2, phone: '2235550003' }
      });
      expect(resEmpty.statusCode).toBe(400);
      expect(resEmpty.json().code).toBe('INVALID_GUEST_NAME');

      // Nombre de 1 caracter
      const resShort = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: 'A', partySize: 2, phone: '2235550004' }
      });
      expect(resShort.statusCode).toBe(400);

      // Nombre mayor a 50 caracteres
      const resLong = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: 'X'.repeat(51), partySize: 2, phone: '2235550005' }
      });
      expect(resLong.statusCode).toBe(400);
    });

    it('Rechaza con 400 si el partySize es inválido (<=0, decimal o >20)', async () => {
      // 0
      const resZero = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: 'Gomez', partySize: 0, phone: '2235550006' }
      });
      expect(resZero.statusCode).toBe(400);
      expect(resZero.json().code).toBe('INVALID_PARTY_SIZE');

      // Decimal
      const resFloat = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: 'Gomez', partySize: 2.5, phone: '2235550007' }
      });
      expect(resFloat.statusCode).toBe(400);

      // > 20
      const resTooBig = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: 'Gomez', partySize: 21, phone: '2235550008' }
      });
      expect(resTooBig.statusCode).toBe(400);
    });

    it('Rechaza con 400 si el teléfono es inválido o tiene menos de 8 dígitos', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: 'Gomez', partySize: 4, phone: '123' }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('INVALID_PHONE');
    });

    it('Rechaza con 400 si el consentimiento es explícitamente rechazado (consent: false)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: { restaurantSlug: restA.slug, guestName: 'Gomez', partySize: 4, phone: '2235559876', consent: false }
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('CONSENT_REQUIRED');
    });

    it('Permite registro válido en fila virtual y retorna ticket individual sin exponer lista de personas ni teléfonos', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: restA.slug,
          guestName: 'Familia Rossi',
          partySize: 3,
          phone: '223 555-1122',
          consent: true
        }
      });
      expect(res.statusCode).toBe(201);
      const ticket = res.json();
      publicTicketA = { ...ticket, phone: '223 555-1122' };
      expect(ticket.id).toBeDefined();
      expect(ticket.restaurantId).toBe(restA.id);
      expect(ticket.guestName).toBe('Familia Rossi');
      expect(ticket.partySize).toBe(3);
      expect(ticket.status).toBe(WaitlistStatus.WAITING);
      expect(ticket.positionInQueue).toBe(1);
      expect(ticket.estimatedWaitMinutes).toBeGreaterThanOrEqual(7);

      // PRIVACIDAD: La respuesta pública del ticket NO devuelve teléfono ni listado de otros comensales
      expect(ticket.phone).toBeUndefined();
      expect(ticket.queue).toBeUndefined();
      expect(ticket.entries).toBeUndefined();
    });

    it('permite consultar el propio ticket con teléfono y no lo revela con otro teléfono', async () => {
      const ok = await app.inject({
        method: 'GET',
        url: `/v1/waitlist/${publicTicketA.id}/status?phone=2235551122`
      });
      expect(ok.statusCode).toBe(200);
      expect(ok.json().id).toBe(publicTicketA.id);
      expect(ok.json().phone).toBeUndefined();

      const wrongPhone = await app.inject({
        method: 'GET',
        url: `/v1/waitlist/${publicTicketA.id}/status?phone=2235559999`
      });
      expect(wrongPhone.statusCode).toBe(404);
      expect(wrongPhone.json().code).toBe('WAITLIST_TICKET_NOT_FOUND');
    });

    it('valida el pre-pedido contra el menú del tenant y lo devuelve en el ticket', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: restB.slug,
          guestName: 'Grupo con pedido',
          partySize: 2,
          phone: '2235557788',
          consent: true,
          preOrderData: [{ menuItemId: preOrderItemB.id, quantity: 2, notes: 'Sin sal' }]
        }
      });
      expect(res.statusCode).toBe(201);
      preOrderTicketB = res.json();
      expect(res.json().preOrderData).toEqual([{ menuItemId: preOrderItemB.id, quantity: 2, notes: 'Sin sal' }]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 2: Aislamiento tenant/staff en list/call/seat (Checklist 1)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 2: Aislamiento tenant/staff en list, call y seat (Checklist 1)', () => {
    let entryA: any;

    beforeAll(async () => {
      // Creamos una entrada de prueba en Tenant A
      entryA = await prisma.waitlistEntry.create({
        data: {
          restaurantId: restA.id,
          guestName: 'Grupo Bianchi',
          partySize: 4,
          phone: '+5492235553344',
          status: WaitlistStatus.WAITING,
          estimatedWaitMinutes: 14
        }
      });
    });

    it('Rechaza con 401 consulta de lista de espera sin token de staff (anónimo no lee teléfonos ni la lista)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/waitlist`
      });
      expect(res.statusCode).toBe(401);
    });

    it('Rechaza con 403 consulta de lista de espera con staff de otro tenant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/waitlist`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');
    });

    it('Permite a staff autenticado de su propio restaurante consultar la lista con teléfonos operativos', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/staff/restaurants/${restA.id}/waitlist`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().queue).toBeDefined();
      expect(Array.isArray(res.json().queue)).toBe(true);
      expect(res.json().queue.length).toBeGreaterThanOrEqual(1);

      const found = res.json().queue.find((q: any) => q.id === entryA.id);
      expect(found).toBeDefined();
      expect(found.phone).toBe('+5492235553344');
    });

    it('Rechaza con 401 llamar a comensal sin token (anónimo)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/call`
      });
      expect(res.statusCode).toBe(401);
    });

    it('Rechaza con 403 si staff de Tenant B intenta llamar a comensal de Tenant A', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/call`,
        headers: { authorization: `Bearer ${tokenWaiterB}` }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');

      // Comprobar ausencia de escrituras: sigue en WAITING
      const unmodified = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
      expect(unmodified?.status).toBe(WaitlistStatus.WAITING);
    });

    it('Permite a staff de Tenant A llamar al comensal (transición a CALLED)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/call`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.CALLED);
      expect(res.json().calledAt).toBeDefined();

      const updated = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
      expect(updated?.status).toBe(WaitlistStatus.CALLED);
      expect(updated?.calledAt).toBeTruthy();
    });

    it('Rechaza con 401 sentar a comensal sin token (anónimo no asigna mesa)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/seat`,
        payload: { tableId: tableA1.id }
      });
      expect(res.statusCode).toBe(401);
    });

    it('Rechaza con 403 si staff de Tenant B intenta sentar a comensal de Tenant A', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { tableId: tableB1.id }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('STAFF_TENANT_MISMATCH');

      // Sigue CALLED
      const check = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
      expect(check?.status).toBe(WaitlistStatus.CALLED);
    });

    it('Rechaza con 403 si staff de Tenant A intenta asignar una mesa perteneciente a Tenant B (mesa ajena)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { tableId: tableB1.id } // Mesa de Bodegón Beta
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('TABLE_RESTAURANT_MISMATCH');

      // La mesa ajena sigue AVAILABLE sin alterarse
      const checkTable = await prisma.table.findUnique({ where: { id: tableB1.id } });
      expect(checkTable?.currentState).toBe(TableFSMState.AVAILABLE);

      // El turno sigue CALLED
      const checkEntry = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
      expect(checkEntry?.status).toBe(WaitlistStatus.CALLED);
    });

    it('Rechaza con 409 si la mesa destino seleccionada no está disponible (ej: ya ocupada)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { tableId: tableA2.id } // Mesa W-2 (OCCUPIED_NO_ORDER)
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('TABLE_NOT_AVAILABLE');

      // El turno sigue CALLED
      const checkEntry = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
      expect(checkEntry?.status).toBe(WaitlistStatus.CALLED);
    });

    it('Rechaza con 400 TABLE_ID_REQUIRED si se intenta sentar una entrada WAITING sin tableId (la entrada y las mesas no cambian)', async () => {
      const waitingEntry = await prisma.waitlistEntry.create({
        data: {
          restaurantId: restA.id,
          guestName: 'Familia Perez (Sin Mesa)',
          partySize: 3,
          phone: '+5492235559988',
          status: WaitlistStatus.WAITING
        }
      });

      const tableA1Before = await prisma.table.findUnique({ where: { id: tableA1.id } });
      const tableA2Before = await prisma.table.findUnique({ where: { id: tableA2.id } });

      // Intento sin body / sin tableId
      const res1 = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${waitingEntry.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(res1.statusCode).toBe(400);
      expect(res1.json().code).toBe('TABLE_ID_REQUIRED');

      // Intento con tableId vacío / sólo espacios
      const res2 = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${waitingEntry.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { tableId: '   ' }
      });
      expect(res2.statusCode).toBe(400);
      expect(res2.json().code).toBe('TABLE_ID_REQUIRED');

      // Comprobar persistencia intacta: la entrada sigue en WAITING, sin fecha de sentado
      const checkEntry = await prisma.waitlistEntry.findUnique({ where: { id: waitingEntry.id } });
      expect(checkEntry?.status).toBe(WaitlistStatus.WAITING);
      expect(checkEntry?.seatedAt).toBeNull();

      // Comprobar que ninguna mesa cambió de estado
      const tableA1After = await prisma.table.findUnique({ where: { id: tableA1.id } });
      const tableA2After = await prisma.table.findUnique({ where: { id: tableA2.id } });
      expect(tableA1After?.currentState).toBe(tableA1Before?.currentState);
      expect(tableA2After?.currentState).toBe(tableA2Before?.currentState);
    });

    it('Rechaza con 400 TABLE_ID_REQUIRED si se intenta sentar una entrada CALLED sin tableId (la entrada y las mesas no cambian)', async () => {
      const entryBefore = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
      expect(entryBefore?.status).toBe(WaitlistStatus.CALLED);

      const tableA1Before = await prisma.table.findUnique({ where: { id: tableA1.id } });
      const tableA2Before = await prisma.table.findUnique({ where: { id: tableA2.id } });

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: {} // objeto vacío sin tableId
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('TABLE_ID_REQUIRED');

      // Comprobar persistencia intacta: sigue en CALLED, seatedAt sigue null
      const checkEntry = await prisma.waitlistEntry.findUnique({ where: { id: entryA.id } });
      expect(checkEntry?.status).toBe(WaitlistStatus.CALLED);
      expect(checkEntry?.seatedAt).toBeNull();

      // Ninguna mesa cambió de estado
      const tableA1After = await prisma.table.findUnique({ where: { id: tableA1.id } });
      const tableA2After = await prisma.table.findUnique({ where: { id: tableA2.id } });
      expect(tableA1After?.currentState).toBe(tableA1Before?.currentState);
      expect(tableA2After?.currentState).toBe(tableA2Before?.currentState);
    });

    it('Permite a staff de Tenant A sentar comensal en mesa disponible de su propio restaurante y actualiza FSM a OCCUPIED_NO_ORDER', async () => {
      // Mesa A1 está AVAILABLE
      const beforeTable = await prisma.table.findUnique({ where: { id: tableA1.id } });
      expect(beforeTable?.currentState).toBe(TableFSMState.AVAILABLE);

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${entryA.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { tableId: tableA1.id }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.SEATED);
      expect(res.json().seatedAt).toBeDefined();

      // Mesa A1 pasa a OCCUPIED_NO_ORDER
      const afterTable = await prisma.table.findUnique({ where: { id: tableA1.id } });
      expect(afterTable?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 3: Impedir doble asignación y seating secuencial (Checklist 3)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 3: Impedir doble asignación y seating secuencial (Checklist 3)', () => {
    let seatedEntry: any;

    beforeAll(async () => {
      seatedEntry = await prisma.waitlistEntry.create({
        data: {
          restaurantId: restA.id,
          guestName: 'Grupo Martinez',
          partySize: 2,
          phone: '+5492235556677',
          status: WaitlistStatus.SEATED,
          seatedAt: new Date()
        }
      });
    });

    it('Rechaza con 409 segundo intento de sentar a un comensal ya sentado (doble seating secuencial)', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${seatedEntry.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { tableId: tableA1.id }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ALREADY_SEATED');
    });

    it('Rechaza con 409 intento de llamar a un comensal que ya fue sentado', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${seatedEntry.id}/call`,
        headers: { authorization: `Bearer ${tokenWaiterA}` }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_WAITLIST_STATUS');
    });

    it('Rechaza con 409 sentar a un turno cancelado', async () => {
      const cancelledEntry = await prisma.waitlistEntry.create({
        data: {
          restaurantId: restA.id,
          guestName: 'Grupo Cancelado',
          partySize: 2,
          phone: '+5492235558899',
          status: WaitlistStatus.CANCELLED
        }
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${cancelledEntry.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterA}` },
        payload: { tableId: tableA1.id }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('INVALID_WAITLIST_STATUS');
    });

    it('convierte el pre-pedido validado en una comanda de cocina al sentar', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${preOrderTicketB.id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { tableId: tableB1.id }
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe(WaitlistStatus.SEATED);

      const order = await prisma.order.findFirst({
        where: { tableSession: { tableId: tableB1.id } },
        include: { items: true }
      });
      expect(order?.status).toBe('IN_KITCHEN');
      expect(order?.items).toHaveLength(1);
      expect(order?.items[0].quantity).toBe(2);
      expect(order?.items[0].unitPrice).toBe(4500);
    });

    it('no deja una comanda parcial si el stock cambia antes de promover el pre-pedido', async () => {
      const atomicTable = await prisma.table.create({
        data: {
          restaurantId: restB.id,
          label: `Mesa B-atomic-${Date.now()}`,
          sector: 'TERRAZA',
          currentState: TableFSMState.AVAILABLE,
          capacity: 4
        }
      });
      const secondItem = await prisma.menuItem.create({
        data: {
          categoryId: preOrderItemB.categoryId,
          name: `Segundo plato ${Date.now()}`,
          price: 3100,
          isAvailable: true
        }
      });
      const join = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: restB.slug,
          guestName: 'Grupo stock mutable',
          partySize: 2,
          phone: '2235559900',
          consent: true,
          preOrderData: [
            { menuItemId: preOrderItemB.id, quantity: 1 },
            { menuItemId: secondItem.id, quantity: 1 }
          ]
        }
      });
      expect(join.statusCode).toBe(201);
      await prisma.menuItem.update({ where: { id: secondItem.id }, data: { isAvailable: false } });

      const seat = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${join.json().id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { tableId: atomicTable.id }
      });
      expect(seat.statusCode).toBe(409);
      expect(seat.json().code).toBe('PREORDER_PROMOTION_FAILED');

      const partialOrder = await prisma.order.findFirst({
        where: { tableSession: { tableId: atomicTable.id } },
        include: { items: true }
      });
      expect(partialOrder).toBeNull();

      // Invariante E07: Si falla la promoción, la mesa no queda ocupada ni el ticket SEATED sin camino de recuperación
      const revertedTable = await prisma.table.findUnique({ where: { id: atomicTable.id } });
      expect(revertedTable?.currentState).toBe(TableFSMState.AVAILABLE);

      const revertedEntry = await prisma.waitlistEntry.findUnique({ where: { id: join.json().id } });
      expect(revertedEntry?.status).toBe(WaitlistStatus.WAITING);
      expect(revertedEntry?.seatedAt).toBeNull();

      // Camino de recuperación: el personal puede sentar al grupo con skipPreOrder: true, skipReason: 'Motivo auditado recovery manual en mesa'
      const recoverySeat = await app.inject({
        method: 'PATCH',
        url: `/v1/staff/waitlist/${join.json().id}/seat`,
        headers: { authorization: `Bearer ${tokenWaiterB}` },
        payload: { tableId: atomicTable.id, skipPreOrder: true, skipReason: 'Motivo auditado recovery manual en mesa' }
      });
      expect(recoverySeat.statusCode).toBe(200);
      expect(recoverySeat.json().status).toBe(WaitlistStatus.SEATED);

      const seatedTable = await prisma.table.findUnique({ where: { id: atomicTable.id } });
      expect(seatedTable?.currentState).toBe(TableFSMState.OCCUPIED_NO_ORDER);
    });

    it('resuelve dos intentos simultáneos sobre el mismo turno con una sola asignación', async () => {
      const concurrentEntry = await prisma.waitlistEntry.create({
        data: {
          restaurantId: restB.id,
          guestName: 'Grupo concurrente',
          partySize: 2,
          phone: '+5492235559911',
          status: WaitlistStatus.CALLED
        }
      });
      const results = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/v1/staff/waitlist/${concurrentEntry.id}/seat`,
          headers: { authorization: `Bearer ${tokenWaiterB}` },
          payload: { tableId: tableB2.id }
        }),
        app.inject({
          method: 'PATCH',
          url: `/v1/staff/waitlist/${concurrentEntry.id}/seat`,
          headers: { authorization: `Bearer ${tokenWaiterB}` },
          payload: { tableId: tableB2.id }
        })
      ]);
      expect(results.filter((result) => result.statusCode === 200)).toHaveLength(1);
      expect(results.filter((result) => result.statusCode === 409)).toHaveLength(1);
      const stored = await prisma.waitlistEntry.findUnique({ where: { id: concurrentEntry.id } });
      expect(stored?.status).toBe(WaitlistStatus.SEATED);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // BLOQUE 4: Preorden y recompensas desactivadas para piloto (Checklist 4)
  // ══════════════════════════════════════════════════════════════════════
  describe('Bloque 4: Preorden y fidelización desactivadas en piloto (Checklist 4)', () => {
    it('Rechaza con 403 intento de enviar preOrderData al unirse a la fila virtual (no se acepta JSON arbitrario)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/waitlist/join',
        payload: {
          restaurantSlug: restA.slug,
          guestName: 'Familia Gonzalez',
          partySize: 2,
          phone: '2235557766',
          preOrderData: [
            { menuItemId: 'fake-item-1', quantity: 2, notes: 'Bien cocido' }
          ]
        }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('PREORDER_DISABLED');

      // Comprobar ausencia de escrituras: no se creó entrada con preOrderData
      const found = await prisma.waitlistEntry.findFirst({
        where: { guestName: 'Familia Gonzalez' }
      });
      expect(found).toBeNull();
    });

    it('Calculador de fidelización responde enabled: false si enableRewards está apagado (Feature apagada en API directa)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/restaurants/${restA.slug}/rewards/calculate?amount=15000`
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.enabled).toBe(false);
      expect(data.points).toBe(0);
      expect(data.message).toContain('no activo');
    });
  });
});

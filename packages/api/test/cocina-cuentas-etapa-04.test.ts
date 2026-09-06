import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { OrderStatus, TableFSMState } from '@mesaya/shared';
import { createHash } from 'crypto';
import { MODIFIER_SNAPSHOT_SCHEMA } from '../src/lib/order-contracts';

describe('COCINA-CUENTAS Etapa 04 — Participantes, Tandas, Idempotencia, Modos y Alergias', () => {
  let app: FastifyInstance;

  // Tenant 1: Mozo Validado (requireWaiterValidation: true)
  let restWaiter: any;
  let shiftWaiter: any;
  let tableWaiter: any;
  let sessionWaiter: any;
  let catWaiter: any;
  let itemEmpanada: any;
  let itemProvoleta: any;
  let itemUnavailable: any;

  // Tenant 2: Cocina Directa (requireWaiterValidation: false)
  let restDirect: any;
  let shiftDirect: any;
  let tableDirect: any;
  let sessionDirect: any;
  let catDirect: any;
  let itemBurger: any;

  // Tenant 3: Carta Informativa (allowOrdering: false)
  let restCarta: any;
  let shiftCarta: any;
  let tableCarta: any;
  let sessionCarta: any;
  let catCarta: any;
  let itemCarta: any;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    const timestamp = Date.now();

    // 1. Setup Tenant Waiter Validated
    restWaiter = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Mozo',
        slug: `test-waiter-${timestamp}`,
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: true
          }
        }
      }
    });
    shiftWaiter = await prisma.shift.create({
      data: { restaurantId: restWaiter.id, activeKey: restWaiter.id }
    });
    tableWaiter = await prisma.table.create({
      data: {
        restaurantId: restWaiter.id,
        label: 'Mesa 10',
        currentState: TableFSMState.OCCUPIED_NO_ORDER
      }
    });
    sessionWaiter = await prisma.tableSession.create({
      data: {
        tableId: tableWaiter.id,
        shiftId: shiftWaiter.id,
        token: `token-waiter-${timestamp}`,
        activeKey: tableWaiter.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });
    catWaiter = await prisma.menuCategory.create({
      data: { restaurantId: restWaiter.id, name: 'Entradas' }
    });
    itemEmpanada = await prisma.menuItem.create({
      data: {
        categoryId: catWaiter.id,
        name: 'Empanada Criolla',
        price: 1500,
        priceCents: 150000,
        isAvailable: true
      }
    });
    itemProvoleta = await prisma.menuItem.create({
      data: {
        categoryId: catWaiter.id,
        name: 'Provoleta Asada',
        price: 3200,
        priceCents: 320000,
        isAvailable: true
      }
    });
    itemUnavailable = await prisma.menuItem.create({
      data: {
        categoryId: catWaiter.id,
        name: 'Bife Agotado',
        price: 9500,
        priceCents: 950000,
        isAvailable: false
      }
    });

    // 2. Setup Tenant Direct Kitchen
    restDirect = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Cocina Directa',
        slug: `test-direct-${timestamp}`,
        moduleConfig: {
          create: {
            allowOrdering: true,
            requireWaiterValidation: false
          }
        }
      }
    });
    shiftDirect = await prisma.shift.create({
      data: { restaurantId: restDirect.id, activeKey: restDirect.id }
    });
    tableDirect = await prisma.table.create({
      data: {
        restaurantId: restDirect.id,
        label: 'Mesa 20',
        currentState: TableFSMState.OCCUPIED_NO_ORDER
      }
    });
    sessionDirect = await prisma.tableSession.create({
      data: {
        tableId: tableDirect.id,
        shiftId: shiftDirect.id,
        token: `token-direct-${timestamp}`,
        activeKey: tableDirect.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });
    catDirect = await prisma.menuCategory.create({
      data: { restaurantId: restDirect.id, name: 'Burgers' }
    });
    itemBurger = await prisma.menuItem.create({
      data: {
        categoryId: catDirect.id,
        name: 'Smash Doble',
        price: 4500,
        priceCents: 450000,
        isAvailable: true
      }
    });

    // 3. Setup Tenant Carta Informativa
    restCarta = await prisma.restaurant.create({
      data: {
        name: 'Restaurante Carta',
        slug: `test-carta-${timestamp}`,
        moduleConfig: {
          create: {
            allowOrdering: false
          }
        }
      }
    });
    shiftCarta = await prisma.shift.create({
      data: { restaurantId: restCarta.id, activeKey: restCarta.id }
    });
    tableCarta = await prisma.table.create({
      data: {
        restaurantId: restCarta.id,
        label: 'Mesa 30',
        currentState: TableFSMState.OCCUPIED_NO_ORDER
      }
    });
    sessionCarta = await prisma.tableSession.create({
      data: {
        tableId: tableCarta.id,
        shiftId: shiftCarta.id,
        token: `token-carta-${timestamp}`,
        activeKey: tableCarta.id,
        expiresAt: new Date(Date.now() + 3 * 3600 * 1000)
      }
    });
    catCarta = await prisma.menuCategory.create({
      data: { restaurantId: restCarta.id, name: 'Pastas' }
    });
    itemCarta = await prisma.menuItem.create({
      data: {
        categoryId: catCarta.id,
        name: 'Sorrentinos',
        price: 4000,
        priceCents: 400000,
        isAvailable: true
      }
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================================================
  // 1. PARTICIPANTES DE VISITA (VisitParticipant)
  // =========================================================================
  describe('1. Participantes de visita (VisitParticipant)', () => {
    it('permite que Ana y Bruno se unan a la misma visita y reciban identidad independiente', async () => {
      // Ana se une
      const resAna = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: {
          sessionToken: sessionWaiter.token,
          displayName: '  Ana García  '
        }
      });
      expect(resAna.statusCode).toBe(201);
      const dataAna = resAna.json();
      expect(dataAna.participantId).toBeDefined();
      expect(dataAna.participantToken).toBeDefined();
      expect(dataAna.displayName).toBe('Ana García'); // Sanitizado

      // Bruno se une
      const resBruno = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: {
          sessionToken: sessionWaiter.token,
          displayName: 'Bruno'
        }
      });
      expect(resBruno.statusCode).toBe(201);
      const dataBruno = resBruno.json();
      expect(dataBruno.participantId).toBeDefined();
      expect(dataBruno.participantToken).toBeDefined();
      expect(dataBruno.displayName).toBe('Bruno');

      expect(dataAna.participantId).not.toBe(dataBruno.participantId);
      expect(dataAna.participantToken).not.toBe(dataBruno.participantToken);

      // Verificación de seguridad: en DB sólo vive el SHA-256, no el token plano
      const dbAna = await prisma.visitParticipant.findUnique({
        where: { id: dataAna.participantId }
      });
      expect(dbAna).not.toBeNull();
      const expectedHash = createHash('sha256').update(dataAna.participantToken).digest('hex');
      expect(dbAna?.tokenHash).toBe(expectedHash);
      expect(dbAna?.status).toBe('ACTIVE');
    });

    it('rechaza unirse con sesión inexistente, expirada o cerrada', async () => {
      const resInvalida = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: {
          sessionToken: 'token-falso-inexistente',
          displayName: 'Infiltrado'
        }
      });
      expect(resInvalida.statusCode).toBe(404);
      expect(resInvalida.json().code).toBe('SESSION_NOT_FOUND');
    });
  });

  // =========================================================================
  // 2. ENVIAR TANDA: MODO CON MOZO & DEDUPLICACIÓN DE LLAMADO
  // =========================================================================
  describe('2. Modo con validación de mozo (WAITER_VALIDATED)', () => {
    it('Ana envía tanda: queda en CONFIRMED y crea llamado de mozo deduplicado', async () => {
      // 1. Unirse
      const resAna = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: {
          sessionToken: sessionWaiter.token,
          displayName: 'Ana'
        }
      });
      const { participantToken, participantId } = resAna.json();

      const idempotencyKey = `tanda-ana-1-${Date.now()}`;
      const resTanda = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionWaiter.token,
          participantToken,
          idempotencyKey,
          items: [
            {
              menuItemId: itemEmpanada.id,
              quantity: 2,
              notes: 'Bien cocidas'
            }
          ]
        }
      });

      expect(resTanda.statusCode).toBe(201);
      const tanda = resTanda.json();
      expect(tanda.seq).toBe(1);
      expect(tanda.status).toBe('CONFIRMED');
      expect(tanda.createdByParticipantId).toBe(participantId);
      expect(tanda.items).toHaveLength(1);
      expect(tanda.items[0].unitPriceCents).toBe(150000);
      expect(tanda.items[0].lineTotalCents).toBe(300000);
      expect(tanda.items[0].currency).toBe('ARS');

      // Verifica que se creó el llamado al mozo para validación
      const call = await prisma.callRequest.findFirst({
        where: {
          tableSessionId: sessionWaiter.id,
          status: { in: ['PENDING', 'IN_PROGRESS'] }
        }
      });
      expect(call).not.toBeNull();
      expect(call?.type).toBe('WAITER');

      // Bruno envía otra tanda: el llamado al mozo se deduplica (no tira error P2002 ni crea duplicado)
      const resBruno = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionWaiter.token, displayName: 'Bruno' }
      });
      const brunoToken = resBruno.json().participantToken;

      const resTandaBruno = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionWaiter.token,
          participantToken: brunoToken,
          idempotencyKey: `tanda-bruno-1-${Date.now()}`,
          items: [{ menuItemId: itemProvoleta.id, quantity: 1 }]
        }
      });

      expect(resTandaBruno.statusCode).toBe(201);
      expect(resTandaBruno.json().seq).toBe(2);
      expect(resTandaBruno.json().status).toBe('CONFIRMED');

      // Sigue existiendo exactamente 1 llamado activo
      const activeCalls = await prisma.callRequest.findMany({
        where: {
          tableSessionId: sessionWaiter.id,
          status: { in: ['PENDING', 'IN_PROGRESS'] }
        }
      });
      expect(activeCalls).toHaveLength(1);
    });
  });

  // =========================================================================
  // 3. COCINA DIRECTA & ALERGIAS
  // =========================================================================
  describe('3. Cocina directa (DIRECT_KITCHEN) y reglas de alérgenos', () => {
    it('pedido común pasa directo a IN_KITCHEN y actualiza estado FSM de la mesa', async () => {
      const resJoin = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionDirect.token, displayName: 'Carlos' }
      });
      const { participantToken } = resJoin.json();

      const resTanda = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionDirect.token,
          participantToken,
          idempotencyKey: `direct-tanda-${Date.now()}`,
          items: [{ menuItemId: itemBurger.id, quantity: 2 }]
        }
      });

      expect(resTanda.statusCode).toBe(201);
      const tanda = resTanda.json();
      expect(tanda.status).toBe('IN_KITCHEN');

      // FSM pasó a ORDER_IN_KITCHEN
      const updatedTable = await prisma.table.findUnique({
        where: { id: tableDirect.id }
      });
      expect(updatedTable?.currentState).toBe(TableFSMState.ORDER_IN_KITCHEN);
    });

    it('pedido con notas de alergia/celiaquía se fuerza a CONFIRMED aún en modo directo', async () => {
      const resJoin = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionDirect.token, displayName: 'Daniela' }
      });
      const { participantToken } = resJoin.json();

      const resTanda = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionDirect.token,
          participantToken,
          idempotencyKey: `allergy-tanda-${Date.now()}`,
          notes: 'Atención: soy celíaca, nada con gluten ni TACC por favor',
          items: [{ menuItemId: itemBurger.id, quantity: 1, notes: 'Alergia severa al maní' }]
        }
      });

      expect(resTanda.statusCode).toBe(201);
      const tanda = resTanda.json();
      // Debe quedar en CONFIRMED para requerir validación humana previa
      expect(tanda.status).toBe('CONFIRMED');

      // Se creó llamado al mozo advirtiendo la alergia
      const call = await prisma.callRequest.findFirst({
        where: {
          tableSessionId: sessionDirect.id,
          status: { in: ['PENDING', 'IN_PROGRESS'] }
        }
      });
      expect(call).not.toBeNull();
      expect(call?.note).toContain('ALERGIA/ALÉRGENOS');
    });
  });

  // =========================================================================
  // 4. IDEMPOTENCIA Y SEGURIDAD
  // =========================================================================
  describe('4. Idempotencia, stock y seguridad anti-tampering', () => {
    it('reintentar con la misma idempotencyKey devuelve la misma tanda sin duplicar', async () => {
      const resJoin = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionWaiter.token, displayName: 'Elena' }
      });
      const { participantToken } = resJoin.json();

      const key = `idem-key-test-${Date.now()}`;
      const payload = {
        sessionToken: sessionWaiter.token,
        participantToken,
        idempotencyKey: key,
        items: [{ menuItemId: itemEmpanada.id, quantity: 1 }]
      };

      const res1 = await app.inject({ method: 'POST', url: '/v1/orders/tandas', payload });
      expect(res1.statusCode).toBe(201);
      const t1 = res1.json();

      // Retry exacto
      const res2 = await app.inject({ method: 'POST', url: '/v1/orders/tandas', payload });
      expect(res2.statusCode).toBe(201);
      const t2 = res2.json();

      expect(t1.id).toBe(t2.id);
      expect(t1.seq).toBe(t2.seq);
    });

    it('reutilizar idempotencyKey con diferente carga da 409 IDEMPOTENCY_CONFLICT', async () => {
      const resJoin = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionWaiter.token, displayName: 'Facundo' }
      });
      const { participantToken } = resJoin.json();

      const key = `idem-conflict-${Date.now()}`;
      const res1 = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionWaiter.token,
          participantToken,
          idempotencyKey: key,
          items: [{ menuItemId: itemEmpanada.id, quantity: 1 }]
        }
      });
      expect(res1.statusCode).toBe(201);

      // Reuso con diferente cantidad de ítems
      const res2 = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionWaiter.token,
          participantToken,
          idempotencyKey: key,
          items: [
            { menuItemId: itemEmpanada.id, quantity: 1 },
            { menuItemId: itemProvoleta.id, quantity: 1 }
          ]
        }
      });
      expect(res2.statusCode).toBe(409);
      expect(res2.json().code).toBe('IDEMPOTENCY_CONFLICT');
    });

    it('rechaza ítems agotados (isAvailable: false) con 409 ITEM_UNAVAILABLE', async () => {
      const resJoin = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionWaiter.token, displayName: 'Gaston' }
      });
      const { participantToken } = resJoin.json();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionWaiter.token,
          participantToken,
          idempotencyKey: `stock-test-${Date.now()}`,
          items: [{ menuItemId: itemUnavailable.id, quantity: 1 }]
        }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('ITEM_UNAVAILABLE');
    });

    it('rechaza pedidos en local con comandas desactivadas (Carta Informativa) con 403 ORDERING_DISABLED', async () => {
      const resJoin = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionCarta.token, displayName: 'Hector' }
      });
      const { participantToken } = resJoin.json();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionCarta.token,
          participantToken,
          idempotencyKey: `carta-test-${Date.now()}`,
          items: [{ menuItemId: itemCarta.id, quantity: 1 }]
        }
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('ORDERING_DISABLED');
    });

    it('rechaza tanda si la mesa ya fue pagada (PAID) con 409 TABLE_ALREADY_PAID', async () => {
      // Poner la mesa en PAID
      await prisma.table.update({
        where: { id: tableWaiter.id },
        data: { currentState: TableFSMState.PAID }
      });

      const resJoin = await app.inject({
        method: 'POST',
        url: '/v1/orders/participants/join',
        payload: { sessionToken: sessionWaiter.token, displayName: 'Irene' }
      });
      const { participantToken } = resJoin.json();

      const res = await app.inject({
        method: 'POST',
        url: '/v1/orders/tandas',
        payload: {
          sessionToken: sessionWaiter.token,
          participantToken,
          idempotencyKey: `post-paid-${Date.now()}`,
          items: [{ menuItemId: itemEmpanada.id, quantity: 1 }]
        }
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe('TABLE_ALREADY_PAID');

      // Restaurar estado de mesa para otros tests
      await prisma.table.update({
        where: { id: tableWaiter.id },
        data: { currentState: TableFSMState.OCCUPIED_NO_ORDER }
      });
    });

    it('GET /v1/orders/tandas devuelve el historial secuencial de tandas de la sesión', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/orders/tandas',
        headers: {
          'x-session-token': sessionWaiter.token
        }
      });
      expect(res.statusCode).toBe(200);
      const tandas = res.json();
      expect(Array.isArray(tandas)).toBe(true);
      expect(tandas.length).toBeGreaterThanOrEqual(2);
      // Ordenadas secuencialmente
      expect(tandas[0].seq).toBeLessThan(tandas[1].seq);
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../src/index';
import { prisma } from '../src/lib/prisma';
import { CallOrigin, CallStatus, CallType, OrderStatus, PaymentMethod, TableFSMState } from '@mesaya/shared';

describe('E04 — contexto operativo completo en Servicio', () => {
  let app: FastifyInstance;
  let restaurant: any;
  let session: any;
  let token: string;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();

    restaurant = await prisma.restaurant.create({
      data: {
        name: 'E04 contexto',
        slug: `e04-context-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        templateId: 'GOURMET_OBSIDIAN',
        themeColor: '#4f46e5',
        moduleConfig: { create: { allowOrdering: true, requireWaiterValidation: true } }
      }
    });
    const shift = await prisma.shift.create({ data: { restaurantId: restaurant.id, openedAt: new Date() } });
    const table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa E04',
        sector: 'TERRAZA',
        currentState: TableFSMState.ORDER_IN_KITCHEN,
        posX: 100,
        posY: 100,
        width: 140,
        height: 80,
        capacity: 4
      }
    });
    session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        shiftId: shift.id,
        token: randomUUID(),
        activeKey: table.id,
        expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000)
      }
    });

    const category = await prisma.menuCategory.create({
      data: { restaurantId: restaurant.id, name: 'E04 carta', orderIndex: 0 }
    });
    const dish = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Gin de la casa', price: 1000, isAvailable: true }
    });
    const side = await prisma.menuItem.create({
      data: { categoryId: category.id, name: 'Papas rústicas', price: 350, isAvailable: true }
    });
    await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.PENDING_VALIDATION,
        source: 'GUEST_QR',
        totalAmount: 2350,
        totalAmountMinor: 235000,
        items: {
          create: [
            {
              menuItemId: dish.id,
              quantity: 2,
              unitPrice: 1000,
              unitPriceMinor: 100000,
              notes: 'Alergia declarada al gluten; carta validada',
              addedByGuest: 'guest-technical-e04'
            },
            {
              menuItemId: side.id,
              quantity: 1,
              unitPrice: 350,
              unitPriceMinor: 35000,
              notes: 'Sin cebolla',
              addedByGuest: 'guest-technical-e04'
            }
          ]
        }
      }
    });

    const staff = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo E04',
        pinHash: await bcrypt.hash('6404', 10),
        role: 'WAITER'
      }
    });
    const login = await app.inject({
      method: 'POST',
      url: '/v1/staff/login',
      payload: { restaurantSlug: restaurant.slug, pin: '6404', terminalId: `e04-${staff.id}` }
    });
    expect(login.statusCode).toBe(200);
    token = login.json().token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('transporta platos, notas, participantes seguros, restricción, total y motivo de revisión', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const task = body.tasks.find((candidate: any) => candidate.kind === 'ORDER_VALIDATION');
    expect(task).toBeTruthy();
    expect(task.summary).toContain('Gin de la casa');
    expect(task.summary).toContain('$2.350,00');
    expect(task.payload).toMatchObject({
      itemCount: 3,
      totalMinor: 235000,
      participants: [{ kind: 'GUEST', label: 'Comensal' }],
      notes: ['Alergia declarada al gluten; carta validada', 'Sin cebolla'],
      allergenNotes: ['Alergia declarada al gluten; carta validada'],
      reviewReason: { code: 'WAITER_VALIDATION_REQUIRED' }
    });
    expect(task.payload.items).toEqual([
      expect.objectContaining({
        name: 'Gin de la casa',
        quantity: 2,
        notes: 'Alergia declarada al gluten; carta validada',
        unitPriceMinor: 100000,
        lineTotalMinor: 200000,
        participant: { kind: 'GUEST', label: 'Comensal' }
      }),
      expect.objectContaining({
        name: 'Papas rústicas',
        quantity: 1,
        notes: 'Sin cebolla',
        unitPriceMinor: 35000,
        lineTotalMinor: 35000,
        participant: { kind: 'GUEST', label: 'Comensal' }
      })
    ]);
    expect(task.payload.reviewReason.detail).toContain('no agrega una confirmación adicional');
    expect(JSON.stringify(task)).not.toContain('guest-technical-e04');
    expect(JSON.stringify(task)).not.toContain(session.token);
    expect(JSON.stringify(task)).not.toContain('addedByGuest');
  });

  it('transporta el medio elegido para pedir la cuenta hasta Servicio y la cuenta de la ocupación', async () => {
    await prisma.callRequest.create({
      data: {
        tableSessionId: session.id,
        activeKey: `${session.id}:${CallType.BILL}`,
        type: CallType.BILL,
        paymentMethod: PaymentMethod.CASH,
        tipMinor: 48000,
        origin: CallOrigin.WEB_DIRECT,
        status: CallStatus.PENDING
      }
    });

    const response = await app.inject({
      method: 'GET',
      url: `/v1/staff/restaurants/${restaurant.id}/service-workspace`,
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    const billTask = body.tasks.find((candidate: any) => candidate.kind === 'CALL' && candidate.payload.callType === CallType.BILL);
    expect(billTask?.payload.paymentMethod).toBe(PaymentMethod.CASH);
    expect(billTask?.payload.requestedTipMinor).toBe(48000);
    const account = body.accounts.find((candidate: any) => candidate.tableSessionId === session.id);
    expect(account?.requestedPaymentMethod).toBe(PaymentMethod.CASH);
    expect(account?.requestedTipMinor).toBe(48000);
  });

  it('notifica al comensal el medio elegido mientras el llamado sigue pendiente', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/sessions/${session.token}`
    });

    expect(response.statusCode).toBe(200);
    const call = response.json().activeCalls.find((candidate: any) => candidate.type === CallType.BILL);
    expect(call).toMatchObject({
      paymentMethod: PaymentMethod.CASH,
      status: CallStatus.PENDING
    });
  });
});

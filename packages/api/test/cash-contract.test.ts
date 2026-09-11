import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { OrderService } from '../src/services/order.service';

afterEach(() => vi.restoreAllMocks());

describe('Etapa 09 — caja presencial e idempotencia', () => {
  it('reproduce un cobro con la misma clave sin crear otra transacción', async () => {
    const payment = {
      id: 'payment-1',
      orderId: 'order-1',
      idempotencyKey: 'cash-key-1',
      method: 'WAITER_CASH',
      amount: 1250,
      tipAmount: 100,
      status: 'MANUAL_SETTLED',
      guestSessionId: 'manager-1',
      resolvedAt: new Date()
    };
    vi.spyOn(prisma.paymentTransaction, 'findUnique').mockResolvedValue(payment as any);
    const orderLookup = vi.spyOn(prisma.order, 'findUnique').mockResolvedValue({
      id: 'order-1',
      tableSessionId: 'session-1',
      status: 'PAID',
      totalAmount: 1250,
      createdAt: new Date(),
      updatedAt: new Date(),
      items: []
    } as any);
    const createPayment = vi.spyOn(prisma.paymentTransaction, 'create');

    const result = await OrderService.registerManualPayment({
      orderId: 'order-1',
      staffRestaurantId: 'restaurant-1',
      staffRole: 'MANAGER',
      staffUserId: 'manager-1',
      idempotencyKey: 'cash-key-1'
    });

    expect(result.idempotentReplay).toBe(true);
    expect(result.transaction?.id).toBe('payment-1');
    expect(orderLookup).toHaveBeenCalledTimes(1);
    expect(createPayment).not.toHaveBeenCalled();
  });

  it('rechaza reutilizar una clave de idempotencia para otra orden', async () => {
    vi.spyOn(prisma.paymentTransaction, 'findUnique').mockResolvedValue({
      id: 'payment-1',
      orderId: 'order-original',
      idempotencyKey: 'cash-key-reused'
    } as any);

    await expect(OrderService.registerManualPayment({
      orderId: 'order-different',
      staffRestaurantId: 'restaurant-1',
      staffRole: 'MANAGER',
      staffUserId: 'manager-1',
      idempotencyKey: 'cash-key-reused'
    })).rejects.toMatchObject({ statusCode: 409, code: 'IDEMPOTENCY_KEY_REUSED' });
  });

  it('considera MANUAL_SETTLED como saldo pagado antes de liberar la mesa', async () => {
    // B05: hasUnpaidBalance lee la cuenta agregada (servicio) + conteo de llamados.
    vi.spyOn(prisma.tableSession, 'findFirst').mockResolvedValue({ id: 'session-1' } as any);
    vi.spyOn(OrderService, 'getSessionAccount').mockResolvedValue({
      tableSessionId: 'session-1',
      tableId: 'table-1',
      version: 'v1',
      unit: 'ARS_MINOR',
      consumoMinor: 125000,
      paidMinor: 125000,
      tipMinor: 0,
      saldoMinor: 0,
      tandas: [],
      pendingValidation: [],
      draft: null
    } as any);
    vi.spyOn(prisma.callRequest, 'count').mockResolvedValue(0);

    await expect(OrderService.hasUnpaidBalance('table-1')).resolves.toMatchObject({
      hasUnpaid: false,
      remainingAmount: 0,
      remainingMinor: 0,
      pendingBillCalls: 0
    });
  });

  it('expone en caja sólo órdenes activas con saldo pendiente', async () => {
    vi.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({ id: 'restaurant-1', slug: 'local' } as any);
    vi.spyOn(prisma.order, 'findMany').mockResolvedValue([
      {
        id: 'order-1',
        status: 'SERVED',
        totalAmount: 1500,
        createdAt: new Date(),
        tableSession: { tableId: 'table-1', closedAt: null, table: { label: 'Mesa 1', sector: 'SALON' } },
        items: [{ id: 'item-1', quantity: 1, unitPrice: 1500, notes: null, menuItem: { name: 'Plato' } }],
        payments: []
      },
      {
        id: 'order-2',
        status: 'PAID',
        totalAmount: 900,
        createdAt: new Date(),
        tableSession: { tableId: 'table-2', closedAt: null, table: { label: 'Mesa 2', sector: 'SALON' } },
        items: [],
        payments: [{ amount: 900 }]
      }
    ] as any);

    await expect(OrderService.getCashOrders('restaurant-1', 'restaurant-1')).resolves.toEqual([
      expect.objectContaining({ id: 'order-1', remainingAmount: 1500, tableLabel: 'Mesa 1' })
    ]);
  });
});

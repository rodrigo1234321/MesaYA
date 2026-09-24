import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { OrderService } from '../src/services/order.service';

afterEach(() => vi.restoreAllMocks());

describe('cash account snapshot batching', () => {
  it('builds the same account fields for multiple sessions with partial and manual settlements', async () => {
    const createdAt = new Date('2026-09-23T12:00:00.000Z');
    const updatedAt = new Date('2026-09-23T12:05:00.000Z');
    const sessions = [
      { id: 'session-a', tableId: 'table-a' },
      { id: 'session-b', tableId: 'table-b' }
    ];

    vi.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({ id: 'restaurant-1', slug: 'local' } as any);
    const sessionQuery = vi.spyOn(prisma.tableSession, 'findMany').mockResolvedValue(sessions as any);
    const orderQuery = vi.spyOn(prisma.order, 'findMany').mockResolvedValue([
      {
        id: 'served-a',
        tableSessionId: 'session-a',
        status: 'SERVED',
        totalAmount: 10,
        totalAmountMinor: 1000,
        createdAt,
        updatedAt,
        items: [{
          id: 'item-a',
          name: 'Empanadas',
          quantity: 2,
          unitPrice: 5,
          unitPriceMinor: 500,
          createdAt,
          menuItem: { name: 'Empanadas' }
        }],
        payments: [
          {
            id: 'manual-payment-a',
            orderId: 'served-a',
            status: 'MANUAL_SETTLED',
            amount: 3,
            amountMinor: 300,
            tipAmount: 0.25,
            tipAmountMinor: 25,
            createdAt,
            resolvedAt: updatedAt
          },
          {
            id: 'pending-payment-a',
            orderId: 'served-a',
            status: 'PENDING',
            amount: 50,
            amountMinor: 5000,
            tipAmount: 0,
            tipAmountMinor: 0,
            createdAt,
            resolvedAt: null
          }
        ]
      },
      {
        id: 'draft-b',
        tableSessionId: 'session-b',
        status: 'DRAFT',
        totalAmount: 12.345,
        totalAmountMinor: null,
        createdAt,
        updatedAt,
        items: [],
        payments: []
      },
      {
        id: 'pending-a',
        tableSessionId: 'session-a',
        status: 'PENDING_VALIDATION',
        totalAmount: 5,
        totalAmountMinor: 500,
        createdAt,
        updatedAt,
        items: [],
        payments: []
      },
      {
        id: 'cancelled-a',
        tableSessionId: 'session-a',
        status: 'CANCELLED',
        totalAmount: 99,
        totalAmountMinor: 9900,
        createdAt,
        updatedAt,
        items: [],
        payments: []
      }
    ] as any);
    const settlementQuery = vi.spyOn(prisma.accountSettlement, 'findMany').mockResolvedValue([
      {
        id: 'settlement-a',
        tableSessionId: 'session-a',
        status: 'SETTLED',
        amountMinor: 200,
        tipMinor: 40,
        createdAt,
        allocations: [{ orderId: 'served-a', amountMinor: 200 }],
        adjustments: [{ id: 'refund-a', amountMinor: 50, tipMinor: 10, createdAt }]
      }
    ] as any);

    const accounts = await OrderService.getCashAccounts('local', 'restaurant-1');

    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      tableSessionId: 'session-a',
      tableId: 'table-a',
      consumoMinor: 1000,
      paidMinor: 450,
      tipMinor: 55,
      saldoMinor: 550,
      tandas: [{ orderId: 'served-a', totalMinor: 1000, items: [{ itemId: 'item-a', name: 'Empanadas' }] }],
      pendingValidation: [{ orderId: 'pending-a', totalMinor: 500 }],
      draft: null
    });
    expect(accounts[1]).toMatchObject({
      tableSessionId: 'session-b',
      tableId: 'table-b',
      consumoMinor: 0,
      paidMinor: 0,
      tipMinor: 0,
      saldoMinor: 0,
      tandas: [],
      pendingValidation: [],
      draft: { orderId: 'draft-b', totalMinor: 1235 }
    });

    expect(sessionQuery).toHaveBeenCalledTimes(1);
    expect(sessionQuery).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        closedAt: null,
        table: { restaurantId: 'restaurant-1' },
        orders: { some: { status: { not: 'CANCELLED' } } }
      },
      select: { id: true, tableId: true }
    }));
    expect(orderQuery).toHaveBeenCalledTimes(1);
    expect(orderQuery).toHaveBeenCalledWith(expect.objectContaining({
      where: { tableSessionId: { in: ['session-a', 'session-b'] } }
    }));
    expect(settlementQuery).toHaveBeenCalledTimes(1);
    expect(settlementQuery).toHaveBeenCalledWith(expect.objectContaining({
      where: { tableSessionId: { in: ['session-a', 'session-b'] }, status: 'SETTLED' }
    }));
  });

  it('returns no accounts and skips dependent batch queries when there are no eligible sessions', async () => {
    vi.spyOn(prisma.restaurant, 'findFirst').mockResolvedValue({ id: 'restaurant-1', slug: 'local' } as any);
    vi.spyOn(prisma.tableSession, 'findMany').mockResolvedValue([]);
    const orderQuery = vi.spyOn(prisma.order, 'findMany');
    const settlementQuery = vi.spyOn(prisma.accountSettlement, 'findMany');

    await expect(OrderService.getCashAccounts('local', 'restaurant-1')).resolves.toEqual([]);

    expect(orderQuery).not.toHaveBeenCalled();
    expect(settlementQuery).not.toHaveBeenCalled();
  });
});

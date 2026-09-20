import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { OrderService } from '../src/services/order.service';
import { ReceiptService } from '../src/services/receipt.service';
import { OrderStatus } from '@mesaya/shared';

describe('E03 / P0-01 — Convergencia Monetaria e Integridad de Totales', () => {
  let restaurant: any;
  let table: any;
  let session: any;
  let menuItemA: any;
  let menuItemB: any;
  let staffUser: any;

  beforeEach(async () => {
    restaurant = await prisma.restaurant.create({
      data: {
        name: 'P01 Convergence Grill',
        slug: `p01-${Date.now()}`,
        planTier: 'LEAN'
      }
    });

    table = await prisma.table.create({
      data: {
        restaurantId: restaurant.id,
        label: 'Mesa P01',
        sector: 'SALON_PRINCIPAL'
      }
    });

    session = await prisma.tableSession.create({
      data: {
        tableId: table.id,
        token: `session-token-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600000)
      }
    });

    staffUser = await prisma.staffUser.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Mozo Test P01',
        role: 'WAITER',
        pinHash: 'test-hash'
      }
    });

    const category = await prisma.menuCategory.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Platos Principales',
        orderIndex: 1
      }
    });

    menuItemA = await prisma.menuItem.create({
      data: {
        categoryId: category.id,
        name: 'Bife de Chorizo',
        price: 12500,
        priceMinor: 1250000,
        isAvailable: true
      }
    });

    menuItemB = await prisma.menuItem.create({
      data: {
        categoryId: category.id,
        name: 'Papas Fritas',
        price: 4500,
        priceMinor: 450000,
        isAvailable: true
      }
    });
  });

  afterEach(async () => {
    await prisma.restaurant.delete({ where: { id: restaurant.id } }).catch(() => {});
  });

  it('recalcula totales al validar comanda PENDING_VALIDATION y garantiza paridad con recibo y cuenta', async () => {
    // 1. Crear una comanda en PENDING_VALIDATION con totalAmount = 0 y totalAmountMinor = null (emulando fixture desactualizada)
    const order = await prisma.order.create({
      data: {
        tableSessionId: session.id,
        status: OrderStatus.PENDING_VALIDATION,
        totalAmount: 0,
        totalAmountMinor: null,
        source: 'GUEST_QR',
        items: {
          create: [
            {
              menuItemId: menuItemA.id,
              quantity: 2,
              unitPrice: 12500,
              unitPriceMinor: 1250000,
              addedByGuest: 'guest-1'
            },
            {
              menuItemId: menuItemB.id,
              quantity: 1,
              unitPrice: 4500,
              unitPriceMinor: 450000,
              addedByGuest: 'guest-1'
            }
          ]
        }
      }
    });

    // Total esperado: (2 * 1250000) + (1 * 450000) = 2500000 + 450000 = 2950000 centavos ($29.500)
    const expectedTotalMinor = 2950000;

    // 2. Antes de validar: la cuenta NO debe sumar esta comanda (está en PENDING_VALIDATION)
    const accountBefore = await OrderService.getSessionAccount(session.id);
    expect(accountBefore.consumoMinor).toBe(0);
    expect(accountBefore.pendingValidation.length).toBe(1);
    expect(accountBefore.pendingValidation[0].orderId).toBe(order.id);

    // 3. El mozo valida la comanda
    const validatedOrder = await OrderService.validateOrder(order.id, {
      staffRestaurantId: restaurant.id,
      staffUserId: staffUser.id
    });

    expect(validatedOrder.status).toBe(OrderStatus.IN_KITCHEN);
    expect(validatedOrder.totalAmount).toBe(29500);

    // 4. Verificar persistencia atómica en BD
    const orderInDb = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(orderInDb.totalAmountMinor).toBe(expectedTotalMinor);
    expect(orderInDb.totalAmount).toBe(29500);

    // 5. La cuenta de la sesión ahora refleja exactamente el consumo
    const accountAfter = await OrderService.getSessionAccount(session.id);
    expect(accountAfter.consumoMinor).toBe(expectedTotalMinor);
    expect(accountAfter.saldoMinor).toBe(expectedTotalMinor);
    expect(accountAfter.pendingValidation.length).toBe(0);

    // 6. El ticket generado por ReceiptService suma exactamente las mismas líneas
    const receipt = await ReceiptService.getOrCreateReceipt({
      restaurantId: restaurant.id,
      tableSessionId: session.id,
      receiptType: 'PRE_BILL_DETAIL'
    });

    expect(receipt.snapshotData.consumoMinor).toBe(expectedTotalMinor);
    expect(receipt.snapshotData.totalMinor).toBe(expectedTotalMinor);
    expect(receipt.snapshotData.saldoMinor).toBe(expectedTotalMinor);

    // 7. Divergencia contable = 0
    expect(receipt.snapshotData.consumoMinor).toBe(accountAfter.consumoMinor);
    expect(orderInDb.totalAmountMinor).toBe(accountAfter.consumoMinor);
  });
});

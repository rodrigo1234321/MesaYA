import { describe, expect, it, afterEach } from 'vitest';
import { randomUUID } from 'crypto';
import { prisma } from '../src/lib/prisma';
import { RewardsService } from '../src/services/rewards.service';

describe('Rewards ledger', () => {
  const createdRestaurantIds: string[] = [];

  afterEach(async () => {
    for (const restaurantId of createdRestaurantIds.splice(0)) {
      await prisma.rewardRedemption.deleteMany({
        where: { customerLoyalty: { restaurantId } }
      }).catch(() => undefined);
      await prisma.restaurant.delete({ where: { id: restaurantId } }).catch(() => undefined);
    }
  });

  async function fixture(enableRewards = true) {
    const restaurant = await prisma.restaurant.create({
      data: {
        name: 'Rewards Fixture',
        slug: `rewards-${randomUUID()}`,
        moduleConfig: {
          create: {
            enableRewards,
            pointsPerHundredPesos: 2,
            enableWaitlist: true
          }
        }
      }
    });
    createdRestaurantIds.push(restaurant.id);
    const item = await prisma.rewardItem.create({
      data: {
        restaurantId: restaurant.id,
        name: 'Postre de cortesía',
        description: 'Premio de prueba',
        pointsCost: 20
      }
    });
    return { restaurant, item };
  }

  it('acredita puntos una sola vez por idempotencyKey y conserva el ledger', async () => {
    const { restaurant } = await fixture();
    const first = await RewardsService.accrue({
      restaurantId: restaurant.id,
      phone: '223 555 1234',
      points: 25,
      reason: 'Cobro manual de prueba',
      referenceType: 'PAYMENT',
      referenceId: 'payment-1',
      idempotencyKey: 'reward-test-accrual-1'
    });
    const replay = await RewardsService.accrue({
      restaurantId: restaurant.id,
      phone: '+54 9 223 555 1234',
      points: 25,
      reason: 'Reintento',
      idempotencyKey: 'reward-test-accrual-1'
    });

    expect(first.entry.pointsDelta).toBe(25);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.customer.points).toBe(25);
    expect(await prisma.rewardLedgerEntry.count({ where: { restaurantId: restaurant.id } })).toBe(1);
  });

  it('canjea en forma atómica, rechaza saldo insuficiente y revierte un canje', async () => {
    const { restaurant, item } = await fixture();
    const credit = await RewardsService.accrue({
      restaurantId: restaurant.id,
      phone: '2235551234',
      points: 30,
      reason: 'Acreditación inicial',
      idempotencyKey: 'reward-test-accrual-2'
    });
    const redemption = await RewardsService.redeem({
      restaurantId: restaurant.id,
      phone: '2235551234',
      rewardItemId: item.id,
      approvedBy: 'staff-1',
      idempotencyKey: 'reward-test-redemption-1'
    });
    expect(redemption.customer.points).toBe(10);
    expect(redemption.redemption.status).toBe('REDEEMED');

    await expect(RewardsService.redeem({
      restaurantId: restaurant.id,
      phone: '2235551234',
      rewardItemId: item.id,
      approvedBy: 'staff-1',
      idempotencyKey: 'reward-test-redemption-2'
    })).rejects.toMatchObject({ code: 'INSUFFICIENT_REWARD_POINTS' });

    const cancelled = await RewardsService.cancelRedemption({
      restaurantId: restaurant.id,
      redemptionId: redemption.redemption.id,
      approvedBy: 'manager-1',
      reason: 'Cliente desistió'
    });
    expect(cancelled.customer.points).toBe(30);
    expect(cancelled.redemption.status).toBe('CANCELLED');
    expect(await prisma.rewardLedgerEntry.count({ where: { restaurantId: restaurant.id } })).toBe(3);
    expect(credit.customer.points).toBe(30);
  });

  it('acredita automáticamente según la regla versionada al cobrar presencialmente', async () => {
    const { restaurant } = await fixture();
    const result = await RewardsService.accrueForPayment({
      restaurantId: restaurant.id,
      phone: '2235551234',
      amount: 1250,
      paymentId: 'payment-rewards-1'
    });
    expect(result?.entry.pointsDelta).toBe(25);
    expect(result?.entry.ruleVersion).toBe(RewardsService.RULE_VERSION);
  });

  it('no expone ni modifica el saldo cuando el módulo está apagado', async () => {
    const { restaurant } = await fixture(false);
    await expect(RewardsService.accrue({
      restaurantId: restaurant.id,
      phone: '2235551234',
      points: 10,
      reason: 'No debería entrar',
      idempotencyKey: 'reward-disabled-1'
    })).rejects.toMatchObject({ code: 'REWARDS_DISABLED' });
    expect((await RewardsService.getBalance(restaurant.id, '2235551234')).customer).toBeNull();
  });
});

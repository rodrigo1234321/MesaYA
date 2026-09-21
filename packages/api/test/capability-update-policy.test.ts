import { describe, expect, it } from 'vitest';
import { PaymentMode, RestaurantModuleConfigDTO } from '@mesaya/shared';
import { validateCapabilityUpdate } from '../src/services/config.service';

function currentConfig(overrides: Partial<RestaurantModuleConfigDTO> = {}): RestaurantModuleConfigDTO {
  return {
    id: 'config-a',
    restaurantId: 'restaurant-a',
    paymentMode: PaymentMode.WAITER_ONLY,
    allowSplitBill: false,
    allowOrdering: true,
    syncSocialCart: true,
    requireWaiterValidation: true,
    enableUpsell: true,
    enableSmartTips: true,
    suggestedTipPercentages: [10, 15, 20],
    enableReviews: false,
    googlePlaceId: null,
    enableWaitlist: false,
    enableWaitlistPreOrder: false,
    enableRewards: false,
    pointsPerHundredPesos: 1,
    ...overrides
  };
}

describe('Etapa 01 — capability update policy', () => {
  it('permite marcar Mercado Pago como opción informativa', () => {
    expect(() => validateCapabilityUpdate(currentConfig(), { paymentMode: PaymentMode.DIGITAL_MP }))
      .not.toThrow();
    expect(() => validateCapabilityUpdate(currentConfig(), { paymentMode: PaymentMode.HYBRID }))
      .not.toThrow();
  });

  it('allows split_bill activation/deactivation and ledger-backed Rewards and waitlist/pre-order', () => {
    expect(() => validateCapabilityUpdate(currentConfig(), { allowSplitBill: true })).not.toThrow();
    expect(() => validateCapabilityUpdate(currentConfig({ allowSplitBill: true }), { allowSplitBill: false })).not.toThrow();
    expect(() => validateCapabilityUpdate(currentConfig(), { enableRewards: true })).not.toThrow();
    expect(() => validateCapabilityUpdate(currentConfig(), {
      enableWaitlist: true,
      enableWaitlistPreOrder: true
    })).not.toThrow();
  });

  it('permite habilitar upsell ya que ahora tiene consumidor y medición', () => {
    expect(() => validateCapabilityUpdate(currentConfig({ enableUpsell: false }), { enableUpsell: true }))
      .not.toThrow();
    expect(() => validateCapabilityUpdate(currentConfig({ enableSmartTips: false }), { enableSmartTips: true }))
      .not.toThrow();
  });

  it('allows disabling a legacy capability and leaving unchanged flags alone', () => {
    expect(() => validateCapabilityUpdate(currentConfig({ paymentMode: PaymentMode.DIGITAL_MP, allowSplitBill: true }), {
      paymentMode: PaymentMode.WAITER_ONLY,
      allowSplitBill: false,
      enableUpsell: true
    })).not.toThrow();
  });

  it('rejects preorder when waitlist is explicitly disabled in the same update', () => {
    expect(() => validateCapabilityUpdate(currentConfig(), {
      enableWaitlist: false,
      enableWaitlistPreOrder: true
    })).toThrow(/fila virtual/);
  });

  it('allows enabling and disabling enableReviews independently of googlePlaceId', () => {
    expect(() => validateCapabilityUpdate(currentConfig({ enableReviews: false }), { enableReviews: true }))
      .not.toThrow();
    expect(() => validateCapabilityUpdate(currentConfig({ enableReviews: true }), { enableReviews: false }))
      .not.toThrow();
  });
});

import { describe, expect, it } from 'vitest';
import { ConfigService } from '../src/services/config.service';
import { PaymentMode, CapabilityState, RestaurantModuleConfigDTO } from '@mesaya/shared';

function baseConfig(overrides: Partial<RestaurantModuleConfigDTO> = {}): RestaurantModuleConfigDTO {
  return {
    id: 'cfg-1',
    restaurantId: 'restaurant-a',
    paymentMode: PaymentMode.WAITER_ONLY,
    allowSplitBill: false,
    allowOrdering: true,
    syncSocialCart: true,
    requireWaiterValidation: true,
    enableUpsell: true,
    enableSmartTips: true,
    suggestedTipPercentages: [10, 15, 20],
    enableReviews: true,
    googlePlaceId: null,
    enableWaitlist: false,
    enableWaitlistPreOrder: false,
    enableRewards: false,
    pointsPerHundredPesos: 1,
    allowWaitersToCollectCash: false,
    ...overrides
  };
}

describe('Etapa 00 — ConfigService.buildCapabilities (unit)', () => {
  it('ordering AVAILABLE when allowOrdering is true', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ allowOrdering: true }));
    expect(caps.capabilities.ordering.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.ordering.reasonCode).toBe('ORDERING_ENABLED');
    expect(caps.capabilities.ordering.configuredEnabled).toBe(true);
    expect(caps.capabilities.ordering.effectiveEnabled).toBe(true);
  });

  it('ordering remains implemented but is ineffective when disabled by config', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ allowOrdering: false }));
    expect(caps.capabilities.ordering.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.ordering.configuredEnabled).toBe(false);
    expect(caps.capabilities.ordering.effectiveEnabled).toBe(false);
    expect(caps.capabilities.ordering.reasonCode).toBe('ORDERING_DISABLED_BY_CONFIG');
  });

  it('waiter_validation AVAILABLE and reflects requireWaiterValidation', () => {
    const active = ConfigService.buildCapabilities(baseConfig({ requireWaiterValidation: true }));
    expect(active.capabilities.waiter_validation.state).toBe(CapabilityState.AVAILABLE);
    expect(active.capabilities.waiter_validation.configuredEnabled).toBe(true);
    expect(active.capabilities.waiter_validation.effectiveEnabled).toBe(true);
    expect(active.capabilities.waiter_validation.reasonCode).toBe('WAITER_VALIDATION_ACTIVE');

    const optional = ConfigService.buildCapabilities(baseConfig({ requireWaiterValidation: false }));
    expect(optional.capabilities.waiter_validation.state).toBe(CapabilityState.AVAILABLE);
    expect(optional.capabilities.waiter_validation.configuredEnabled).toBe(false);
    expect(optional.capabilities.waiter_validation.effectiveEnabled).toBe(false);
    expect(optional.capabilities.waiter_validation.reasonCode).toBe('WAITER_VALIDATION_OPTIONAL');
  });

  it('digital_payment is an informational option, never an autonomous settlement', () => {
    const waiterOnly = ConfigService.buildCapabilities(baseConfig({ paymentMode: PaymentMode.WAITER_ONLY })).capabilities.digital_payment;
    expect(waiterOnly.state).toBe(CapabilityState.AVAILABLE);
    expect(waiterOnly.effectiveEnabled).toBe(false);
    expect(waiterOnly.reasonCode).toBe('DIGITAL_PAYMENT_OPTION_DISABLED');

    for (const mode of [PaymentMode.DIGITAL_MP, PaymentMode.HYBRID]) {
      const option = ConfigService.buildCapabilities(baseConfig({ paymentMode: mode })).capabilities.digital_payment;
      expect(option.state).toBe(CapabilityState.AVAILABLE);
      expect(option.effectiveEnabled).toBe(true);
      expect(option.reasonCode).toBe('DIGITAL_PAYMENT_OPTION_ACTIVE');
      expect(option.message).toMatch(/cobro se confirma presencialmente/);
    }
  });

  it('split_bill AVAILABLE and effectiveEnabled follows allowSplitBill', () => {
    const disabled = ConfigService.buildCapabilities(baseConfig({ allowSplitBill: false }));
    expect(disabled.capabilities.split_bill.state).toBe(CapabilityState.AVAILABLE);
    expect(disabled.capabilities.split_bill.configuredEnabled).toBe(false);
    expect(disabled.capabilities.split_bill.effectiveEnabled).toBe(false);
    expect(disabled.capabilities.split_bill.reasonCode).toBe('SPLIT_BILL_DISABLED');

    const enabled = ConfigService.buildCapabilities(baseConfig({ allowSplitBill: true }));
    expect(enabled.capabilities.split_bill.state).toBe(CapabilityState.AVAILABLE);
    expect(enabled.capabilities.split_bill.configuredEnabled).toBe(true);
    expect(enabled.capabilities.split_bill.effectiveEnabled).toBe(true);
    expect(enabled.capabilities.split_bill.reasonCode).toBe('SPLIT_BILL_ENABLED');
  });

  it('waitlist is available and effective only when enabled', () => {
    const enabled = ConfigService.buildCapabilities(baseConfig({ enableWaitlist: true })).capabilities.waitlist;
    const disabled = ConfigService.buildCapabilities(baseConfig({ enableWaitlist: false })).capabilities.waitlist;
    expect(enabled.state).toBe(CapabilityState.AVAILABLE);
    expect(enabled.effectiveEnabled).toBe(true);
    expect(disabled.state).toBe(CapabilityState.AVAILABLE);
    expect(disabled.effectiveEnabled).toBe(false);
  });

  it('waitlist_preorder is available only when waitlist and pre-order are enabled', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableWaitlistPreOrder: true }));
    expect(caps.capabilities.waitlist_preorder.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.waitlist_preorder.effectiveEnabled).toBe(false);
    expect(caps.capabilities.waitlist_preorder.reasonCode).toBe('WAITLIST_DISABLED');

    const active = ConfigService.buildCapabilities(baseConfig({ enableWaitlist: true, enableWaitlistPreOrder: true }));
    expect(active.capabilities.waitlist_preorder.state).toBe(CapabilityState.AVAILABLE);
    expect(active.capabilities.waitlist_preorder.effectiveEnabled).toBe(true);
    expect(active.capabilities.waitlist_preorder.reasonCode).toBe('WAITLIST_PREORDER_ACTIVE');
  });

  it('rewards is available only when the ledger-backed module is enabled', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableRewards: true }));
    expect(caps.capabilities.rewards.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.rewards.effectiveEnabled).toBe(true);
    expect(caps.capabilities.rewards.reasonCode).toBe('REWARDS_LEDGER_ACTIVE');
    const disabled = ConfigService.buildCapabilities(baseConfig({ enableRewards: false })).capabilities.rewards;
    expect(disabled.state).toBe(CapabilityState.AVAILABLE);
    expect(disabled.effectiveEnabled).toBe(false);
    expect(disabled.reasonCode).toBe('REWARDS_DISABLED');
  });

  it('upsell queda disponible cuando el restaurante lo habilita y se oculta al deshabilitarlo', () => {
    expect(ConfigService.buildCapabilities(baseConfig({ enableUpsell: true })).capabilities.upsell.state).toBe(CapabilityState.AVAILABLE);
    expect(ConfigService.buildCapabilities(baseConfig({ enableUpsell: true })).capabilities.upsell.effectiveEnabled).toBe(true);
    expect(ConfigService.buildCapabilities(baseConfig({ enableUpsell: false })).capabilities.upsell.effectiveEnabled).toBe(false);
  });

  it('smart_tips queda disponible para cobro manual y se oculta al deshabilitarlo', () => {
    expect(ConfigService.buildCapabilities(baseConfig({ enableSmartTips: true })).capabilities.smart_tips.state).toBe(CapabilityState.AVAILABLE);
    expect(ConfigService.buildCapabilities(baseConfig({ enableSmartTips: true })).capabilities.smart_tips.effectiveEnabled).toBe(true);
    expect(ConfigService.buildCapabilities(baseConfig({ enableSmartTips: false })).capabilities.smart_tips.effectiveEnabled).toBe(false);
  });

  it('reviews mantiene feedback interno aunque Google Place ID no esté configurado', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableReviews: true, googlePlaceId: null }));
    expect(caps.capabilities.reviews.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.reviews.reasonCode).toBe('REVIEWS_INTERNAL_ACTIVE_GOOGLE_UNCONFIGURED');
    expect(caps.capabilities.reviews.effectiveEnabled).toBe(true);
  });

  it('reviews habilita Google además del feedback interno cuando hay Place ID', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableReviews: true, googlePlaceId: 'ChIJ123' }));
    expect(caps.capabilities.reviews.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.reviews.reasonCode).toBe('REVIEWS_INTERNAL_AND_GOOGLE_ACTIVE');
    expect(caps.capabilities.reviews.effectiveEnabled).toBe(true);
  });

  it('reviews AVAILABLE but ineffective when disabled by config', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableReviews: false }));
    expect(caps.capabilities.reviews.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.reviews.configuredEnabled).toBe(false);
    expect(caps.capabilities.reviews.effectiveEnabled).toBe(false);
    expect(caps.capabilities.reviews.reasonCode).toBe('REVIEWS_DISABLED');
  });

  it('manual_payment is available when the shared-screen cash UI exists', () => {
    const caps = ConfigService.buildCapabilities(baseConfig());
    expect(caps.capabilities.manual_payment.state).toBe(CapabilityState.AVAILABLE);
    expect(caps.capabilities.manual_payment.effectiveEnabled).toBe(true);
    expect(caps.capabilities.manual_payment.reasonCode).toBe('MANUAL_PAYMENT_ACTIVE');
  });

  it('all capability messages are in Spanish (no English fragments)', () => {
    const englishFragments = ['the ', ' is ', ' are ', ' not ', ' enabled', ' disabled', ' available'];
    const caps = ConfigService.buildCapabilities(baseConfig());
    for (const entry of Object.values(caps.capabilities)) {
      const lower = entry.message.toLowerCase();
      for (const frag of englishFragments) {
        expect(lower).not.toContain(frag);
      }
    }
  });

  it('all capability reasonCodes are machine-stable (UPPER_SNAKE_CASE)', () => {
    const caps = ConfigService.buildCapabilities(baseConfig());
    for (const entry of Object.values(caps.capabilities)) {
      expect(entry.reasonCode).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });

  it('capabilities object has exactly 12 keys', () => {
    const caps = ConfigService.buildCapabilities(baseConfig());
    expect(Object.keys(caps.capabilities)).toHaveLength(12);
  });

  it('all entries distinguish stored configuration from effective availability', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({
      paymentMode: PaymentMode.DIGITAL_MP,
      allowSplitBill: true
    }));
    for (const entry of Object.values(caps.capabilities)) {
      expect(typeof entry.configuredEnabled).toBe('boolean');
      expect(typeof entry.effectiveEnabled).toBe('boolean');
    }
    expect(caps.capabilities.digital_payment.configuredEnabled).toBe(true);
    expect(caps.capabilities.digital_payment.effectiveEnabled).toBe(true);
  });
});

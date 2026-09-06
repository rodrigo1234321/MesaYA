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

  it('digital_payment always COMING_SOON regardless of paymentMode', () => {
    for (const mode of [PaymentMode.DIGITAL_MP, PaymentMode.HYBRID, PaymentMode.WAITER_ONLY]) {
      const caps = ConfigService.buildCapabilities(baseConfig({ paymentMode: mode }));
      expect(caps.capabilities.digital_payment.state).toBe(CapabilityState.COMING_SOON);
      expect(caps.capabilities.digital_payment.effectiveEnabled).toBe(false);
      expect(caps.capabilities.digital_payment.reasonCode).toBe('DIGITAL_PAYMENTS_UNAVAILABLE');
    }
  });

  it('split_bill always COMING_SOON regardless of allowSplitBill', () => {
    for (const allow of [true, false]) {
      const caps = ConfigService.buildCapabilities(baseConfig({ allowSplitBill: allow }));
      expect(caps.capabilities.split_bill.state).toBe(CapabilityState.COMING_SOON);
      expect(caps.capabilities.split_bill.configuredEnabled).toBe(allow);
      expect(caps.capabilities.split_bill.effectiveEnabled).toBe(false);
      expect(caps.capabilities.split_bill.reasonCode).toBe('SPLIT_BILL_UNAVAILABLE');
    }
  });

  it('waitlist is pilot-only and effective only when enabled', () => {
    const enabled = ConfigService.buildCapabilities(baseConfig({ enableWaitlist: true })).capabilities.waitlist;
    const disabled = ConfigService.buildCapabilities(baseConfig({ enableWaitlist: false })).capabilities.waitlist;
    expect(enabled.state).toBe(CapabilityState.PILOT_ONLY);
    expect(enabled.effectiveEnabled).toBe(true);
    expect(disabled.state).toBe(CapabilityState.PILOT_ONLY);
    expect(disabled.effectiveEnabled).toBe(false);
  });

  it('waitlist_preorder always COMING_SOON', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableWaitlistPreOrder: true }));
    expect(caps.capabilities.waitlist_preorder.state).toBe(CapabilityState.COMING_SOON);
    expect(caps.capabilities.waitlist_preorder.effectiveEnabled).toBe(false);
    expect(caps.capabilities.waitlist_preorder.reasonCode).toBe('WAITLIST_PREORDER_UNAVAILABLE');
  });

  it('rewards always COMING_SOON (only calculator exists)', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableRewards: true }));
    expect(caps.capabilities.rewards.state).toBe(CapabilityState.COMING_SOON);
    expect(caps.capabilities.rewards.effectiveEnabled).toBe(false);
    expect(caps.capabilities.rewards.reasonCode).toBe('REWARDS_NO_LEDGER');
  });

  it('upsell remains PILOT_ONLY and ineffective without a client consumer', () => {
    expect(ConfigService.buildCapabilities(baseConfig({ enableUpsell: true })).capabilities.upsell.state).toBe(CapabilityState.PILOT_ONLY);
    expect(ConfigService.buildCapabilities(baseConfig({ enableUpsell: true })).capabilities.upsell.effectiveEnabled).toBe(false);
    expect(ConfigService.buildCapabilities(baseConfig({ enableUpsell: false })).capabilities.upsell.state).toBe(CapabilityState.PILOT_ONLY);
  });

  it('smart_tips remains PILOT_ONLY and ineffective while payment integration is partial', () => {
    expect(ConfigService.buildCapabilities(baseConfig({ enableSmartTips: true })).capabilities.smart_tips.state).toBe(CapabilityState.PILOT_ONLY);
    expect(ConfigService.buildCapabilities(baseConfig({ enableSmartTips: true })).capabilities.smart_tips.effectiveEnabled).toBe(false);
    expect(ConfigService.buildCapabilities(baseConfig({ enableSmartTips: false })).capabilities.smart_tips.state).toBe(CapabilityState.PILOT_ONLY);
  });

  it('reviews MISCONFIGURED when enabled without googlePlaceId', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableReviews: true, googlePlaceId: null }));
    expect(caps.capabilities.reviews.state).toBe(CapabilityState.MISCONFIGURED);
    expect(caps.capabilities.reviews.reasonCode).toBe('REVIEWS_NO_PLACE_ID');
    expect(caps.capabilities.reviews.effectiveEnabled).toBe(false);
  });

  it('reviews PILOT_ONLY when enabled with googlePlaceId', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableReviews: true, googlePlaceId: 'ChIJ123' }));
    expect(caps.capabilities.reviews.state).toBe(CapabilityState.PILOT_ONLY);
    expect(caps.capabilities.reviews.reasonCode).toBe('REVIEWS_PILOT_ONLY');
    expect(caps.capabilities.reviews.effectiveEnabled).toBe(true);
  });

  it('reviews COMING_SOON when disabled', () => {
    const caps = ConfigService.buildCapabilities(baseConfig({ enableReviews: false }));
    expect(caps.capabilities.reviews.state).toBe(CapabilityState.COMING_SOON);
    expect(caps.capabilities.reviews.effectiveEnabled).toBe(false);
  });

  it('manual_payment is pilot-only and not effective until its staff UI exists', () => {
    const caps = ConfigService.buildCapabilities(baseConfig());
    expect(caps.capabilities.manual_payment.state).toBe(CapabilityState.PILOT_ONLY);
    expect(caps.capabilities.manual_payment.effectiveEnabled).toBe(false);
    expect(caps.capabilities.manual_payment.reasonCode).toBe('MANUAL_PAYMENT_API_ONLY');
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

  it('capabilities object has exactly 11 keys', () => {
    const caps = ConfigService.buildCapabilities(baseConfig());
    expect(Object.keys(caps.capabilities)).toHaveLength(11);
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
    expect(caps.capabilities.digital_payment.effectiveEnabled).toBe(false);
  });
});

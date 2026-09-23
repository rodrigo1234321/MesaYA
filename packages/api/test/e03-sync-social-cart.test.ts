import { describe, expect, it } from 'vitest';
import { PaymentMode, RestaurantModuleConfigDTO } from '@mesaya/shared';
import { normalizeSharedCartConfig, validateCapabilityUpdate } from '../src/services/config.service';

function createMockConfig(overrides: Partial<RestaurantModuleConfigDTO> = {}): RestaurantModuleConfigDTO {
  return {
    id: 'cfg-e03-test',
    restaurantId: 'rest-e03-test',
    paymentMode: PaymentMode.WAITER_ONLY,
    allowSplitBill: false,
    allowWaitersToCollectCash: false,
    allowOrdering: true,
    syncSocialCart: true,
    requireWaiterValidation: true,
    reviewQuantityThreshold: 15,
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

describe('E03 — syncSocialCart canónico y política de carrito compartido', () => {
  describe('normalizeSharedCartConfig', () => {
    it('normaliza forzando syncSocialCart a true cuando la entrada viene en false', () => {
      const raw = createMockConfig({ syncSocialCart: false as any });
      const normalized = normalizeSharedCartConfig(raw);
      expect(normalized.syncSocialCart).toBe(true);
      expect(normalized.restaurantId).toBe('rest-e03-test');
      expect(normalized.allowOrdering).toBe(true);
    });

    it('mantiene syncSocialCart en true cuando la entrada ya es true', () => {
      const raw = createMockConfig({ syncSocialCart: true });
      const normalized = normalizeSharedCartConfig(raw);
      expect(normalized.syncSocialCart).toBe(true);
    });

    it('preserva las demás propiedades de la configuración intactas', () => {
      const raw = createMockConfig({
        paymentMode: PaymentMode.DIGITAL_MP,
        reviewQuantityThreshold: 30,
        suggestedTipPercentages: [10, 20]
      });
      const normalized = normalizeSharedCartConfig(raw);
      expect(normalized.paymentMode).toBe(PaymentMode.DIGITAL_MP);
      expect(normalized.reviewQuantityThreshold).toBe(30);
      expect(normalized.suggestedTipPercentages).toEqual([10, 20]);
      expect(normalized.syncSocialCart).toBe(true);
    });
  });

  describe('validateCapabilityUpdate — rechazo de syncSocialCart: false y tolerancia de true', () => {
    it('rechaza syncSocialCart: false lanzando Error con statusCode 400 y code SYNC_SOCIAL_CART_LEGACY', () => {
      const current = createMockConfig();
      let thrownError: any = null;

      try {
        validateCapabilityUpdate(current, { syncSocialCart: false } as any);
      } catch (err: any) {
        thrownError = err;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError.statusCode).toBe(400);
      expect(thrownError.code).toBe('SYNC_SOCIAL_CART_LEGACY');
      expect(thrownError.message).toMatch(/TableSession/i);
      expect(thrownError.message).toMatch(/individual/i);
    });

    it('acepta syncSocialCart: true sin lanzar error por compatibilidad con clientes existentes', () => {
      const current = createMockConfig();
      expect(() => {
        validateCapabilityUpdate(current, { syncSocialCart: true } as any);
      }).not.toThrow();
    });

    it('acepta actualizaciones normales donde syncSocialCart es omitido (undefined)', () => {
      const current = createMockConfig();
      expect(() => {
        validateCapabilityUpdate(current, { allowOrdering: false });
      }).not.toThrow();
    });
  });
});

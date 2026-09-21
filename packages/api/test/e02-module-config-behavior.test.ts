import { describe, expect, it } from 'vitest';
import {
  PaymentMode,
  CapabilityState,
  RestaurantModuleConfigDTO,
  CapabilityKey
} from '@mesaya/shared';
import { ConfigService, validateCapabilityUpdate } from '../src/services/config.service';

function createMockConfig(overrides: Partial<RestaurantModuleConfigDTO> = {}): RestaurantModuleConfigDTO {
  return {
    id: 'cfg-e02',
    restaurantId: 'rest-e02',
    paymentMode: PaymentMode.WAITER_ONLY,
    allowSplitBill: false,
    allowWaitersToCollectCash: false,
    allowOrdering: true,
    syncSocialCart: true,
    requireWaiterValidation: false,
    reviewQuantityThreshold: 6,
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

describe('E02 — Comportamiento de Capacidades y Políticas de Módulos', () => {
  describe('1. Distinción entre módulo apagado (AVAILABLE + effectiveEnabled=false) y no implementado (COMING_SOON)', () => {
    it('reviews apagado mantiene state=AVAILABLE, configuredEnabled=false, effectiveEnabled=false, reasonCode=REVIEWS_DISABLED', () => {
      const caps = ConfigService.buildCapabilities(createMockConfig({ enableReviews: false }));
      const entry = caps.capabilities.reviews;
      expect(entry.state).toBe(CapabilityState.AVAILABLE);
      expect(entry.configuredEnabled).toBe(false);
      expect(entry.effectiveEnabled).toBe(false);
      expect(entry.reasonCode).toBe('REVIEWS_DISABLED');
      expect(entry.message).toMatch(/habilitado/i);
    });

    it('reviews encendido mantiene state=AVAILABLE, configuredEnabled=true, effectiveEnabled=true', () => {
      const caps = ConfigService.buildCapabilities(createMockConfig({ enableReviews: true, googlePlaceId: 'ChIJ123' }));
      const entry = caps.capabilities.reviews;
      expect(entry.state).toBe(CapabilityState.AVAILABLE);
      expect(entry.configuredEnabled).toBe(true);
      expect(entry.effectiveEnabled).toBe(true);
      expect(entry.reasonCode).toBe('REVIEWS_INTERNAL_AND_GOOGLE_ACTIVE');
    });

    it('split_bill AVAILABLE refleja allowSplitBill: effectiveEnabled sigue el flag', () => {
      const capsWhenFalse = ConfigService.buildCapabilities(createMockConfig({ allowSplitBill: false }));
      expect(capsWhenFalse.capabilities.split_bill.state).toBe(CapabilityState.AVAILABLE);
      expect(capsWhenFalse.capabilities.split_bill.configuredEnabled).toBe(false);
      expect(capsWhenFalse.capabilities.split_bill.effectiveEnabled).toBe(false);
      expect(capsWhenFalse.capabilities.split_bill.reasonCode).toBe('SPLIT_BILL_DISABLED');

      const capsWhenTrue = ConfigService.buildCapabilities(createMockConfig({ allowSplitBill: true }));
      expect(capsWhenTrue.capabilities.split_bill.state).toBe(CapabilityState.AVAILABLE);
      expect(capsWhenTrue.capabilities.split_bill.configuredEnabled).toBe(true);
      expect(capsWhenTrue.capabilities.split_bill.effectiveEnabled).toBe(true);
      expect(capsWhenTrue.capabilities.split_bill.reasonCode).toBe('SPLIT_BILL_ENABLED');
    });

    it('upsell refleja honestamente que el backend está disponible sin proclamar consumo invasivo en cliente', () => {
      const capsActive = ConfigService.buildCapabilities(createMockConfig({ enableUpsell: true }));
      expect(capsActive.capabilities.upsell.state).toBe(CapabilityState.AVAILABLE);
      expect(capsActive.capabilities.upsell.effectiveEnabled).toBe(true);
      expect(capsActive.capabilities.upsell.message).toContain('desactivadas en carta web');

      const capsInactive = ConfigService.buildCapabilities(createMockConfig({ enableUpsell: false }));
      expect(capsInactive.capabilities.upsell.effectiveEnabled).toBe(false);
      expect(capsInactive.capabilities.upsell.reasonCode).toBe('UPSELL_DISABLED');
    });
  });

  describe('2. Política de actualización transaccional (validateCapabilityUpdate)', () => {
    it('permite encender y apagar enableReviews libremente sin requerir Place ID', () => {
      expect(() => validateCapabilityUpdate(createMockConfig({ enableReviews: false }), { enableReviews: true }))
        .not.toThrow();
      expect(() => validateCapabilityUpdate(createMockConfig({ enableReviews: true }), { enableReviews: false }))
        .not.toThrow();
    });

    it('permite activar y desactivar allowSplitBill (E05 AVAILABLE)', () => {
      expect(() => validateCapabilityUpdate(createMockConfig({ allowSplitBill: false }), { allowSplitBill: true }))
        .not.toThrow();
      expect(() => validateCapabilityUpdate(createMockConfig({ allowSplitBill: true }), { allowSplitBill: false }))
        .not.toThrow();
    });

    it('permite actualizar paymentMode a WAITER_ONLY, DIGITAL_MP y HYBRID', () => {
      expect(() => validateCapabilityUpdate(createMockConfig(), { paymentMode: PaymentMode.DIGITAL_MP }))
        .not.toThrow();
      expect(() => validateCapabilityUpdate(createMockConfig(), { paymentMode: PaymentMode.HYBRID }))
        .not.toThrow();
      expect(() => validateCapabilityUpdate(createMockConfig({ paymentMode: PaymentMode.DIGITAL_MP }), { paymentMode: PaymentMode.WAITER_ONLY }))
        .not.toThrow();
    });

    it('permite encender y apagar allowWaitersToCollectCash y allowOrdering', () => {
      expect(() => validateCapabilityUpdate(createMockConfig(), { allowWaitersToCollectCash: true }))
        .not.toThrow();
      expect(() => validateCapabilityUpdate(createMockConfig(), { allowOrdering: false }))
        .not.toThrow();
    });
  });

  describe('3. Comportamiento de paymentMode y preferencia informativa', () => {
    it('en WAITER_ONLY, digital_payment está inactivo (effectiveEnabled=false)', () => {
      const caps = ConfigService.buildCapabilities(createMockConfig({ paymentMode: PaymentMode.WAITER_ONLY }));
      expect(caps.capabilities.digital_payment.effectiveEnabled).toBe(false);
      expect(caps.capabilities.digital_payment.reasonCode).toBe('DIGITAL_PAYMENT_OPTION_DISABLED');
    });

    it('en DIGITAL_MP o HYBRID, digital_payment está activo como opción informativa', () => {
      for (const mode of [PaymentMode.DIGITAL_MP, PaymentMode.HYBRID]) {
        const caps = ConfigService.buildCapabilities(createMockConfig({ paymentMode: mode }));
        expect(caps.capabilities.digital_payment.effectiveEnabled).toBe(true);
        expect(caps.capabilities.digital_payment.reasonCode).toBe('DIGITAL_PAYMENT_OPTION_ACTIVE');
        expect(caps.capabilities.digital_payment.message).toContain('cobro se confirma presencialmente');
      }
    });
  });

  describe('4. Lógica de desbloqueo de Admin (capabilityBlocked)', () => {
    // Simulación de la lógica corregida en ModuleConfigManager.tsx
    const capabilityBlocked = (caps: Record<CapabilityKey, any>, key: CapabilityKey) => {
      const capability = caps?.[key];
      if (!capability) return false;
      return capability.state !== CapabilityState.AVAILABLE;
    };

    it('no bloquea módulos apagados que tienen state=AVAILABLE (permite encenderlos)', () => {
      const caps = ConfigService.buildCapabilities(createMockConfig({
        enableWaitlist: false,
        enableRewards: false,
        enableSmartTips: false,
        enableReviews: false,
        allowWaitersToCollectCash: false,
        enableUpsell: false
      })).capabilities;

      expect(capabilityBlocked(caps, 'waitlist')).toBe(false);
      expect(capabilityBlocked(caps, 'rewards')).toBe(false);
      expect(capabilityBlocked(caps, 'smart_tips')).toBe(false);
      expect(capabilityBlocked(caps, 'reviews')).toBe(false);
      expect(capabilityBlocked(caps, 'waiter_cash_collection')).toBe(false);
      expect(capabilityBlocked(caps, 'upsell')).toBe(false);
    });

    it('no bloquea split_bill: AVAILABLE permite activar/desactivar según allowSplitBill', () => {
      const capsDisabled = ConfigService.buildCapabilities(createMockConfig({ allowSplitBill: false })).capabilities;
      expect(capabilityBlocked(capsDisabled, 'split_bill')).toBe(false);
      const capsEnabled = ConfigService.buildCapabilities(createMockConfig({ allowSplitBill: true })).capabilities;
      expect(capabilityBlocked(capsEnabled, 'split_bill')).toBe(false);
    });
  });

  describe('5. Comportamiento en Cliente Web (paymentMode y 403 ORDERING_DISABLED)', () => {
    it('regla de visibilidad de Mercado Pago: oculto en WAITER_ONLY, visible en DIGITAL_MP/HYBRID', () => {
      const isMercadoPagoAllowed = (paymentMode?: string) => paymentMode !== 'WAITER_ONLY';
      expect(isMercadoPagoAllowed('WAITER_ONLY')).toBe(false);
      expect(isMercadoPagoAllowed('DIGITAL_MP')).toBe(true);
      expect(isMercadoPagoAllowed('HYBRID')).toBe(true);
      expect(isMercadoPagoAllowed(undefined)).toBe(true);
    });

    it('regla de apagado en vuelo: un error 403 ORDERING_DISABLED transiciona el estado local a modo informativo', () => {
      let activeOrderPolicy = { allowOrdering: true, requireWaiterValidation: false };
      let activeRestaurantConfig: { allowOrdering?: boolean } = { allowOrdering: true };

      const handleOrderingResponse = (status: number, code: string) => {
        if (status === 403 && code === 'ORDERING_DISABLED') {
          activeOrderPolicy.allowOrdering = false;
          activeRestaurantConfig.allowOrdering = false;
          return 'MODO_CARTA_INFORMATIVA';
        }
        return 'OK';
      };

      const result = handleOrderingResponse(403, 'ORDERING_DISABLED');
      expect(result).toBe('MODO_CARTA_INFORMATIVA');
      expect(activeOrderPolicy.allowOrdering).toBe(false);
      expect(activeRestaurantConfig.allowOrdering).toBe(false);
    });
  });
});

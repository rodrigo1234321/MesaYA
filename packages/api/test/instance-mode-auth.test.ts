import { describe, expect, it, vi } from 'vitest';
import { getEnvironmentConfig } from '../src/lib/environment';

describe('Etapa 02 — contrato de instancia por restaurante', () => {
  it('mantiene modo multi-tenant por compatibilidad cuando no se configura una instancia', () => {
    const config = getEnvironmentConfig({
      NODE_ENV: 'test',
      CORS_ORIGIN: 'https://app.example.test'
    });
    expect(config.instanceMode).toBe('MULTI_TENANT');
    expect(config.instanceRestaurantId).toBeUndefined();
  });

  it('fija una instancia a un restaurante único', () => {
    const config = getEnvironmentConfig({
      NODE_ENV: 'test',
      CORS_ORIGIN: 'https://app.example.test',
      MESAYA_INSTANCE_MODE: 'SINGLE_RESTAURANT',
      MESAYA_INSTANCE_RESTAURANT_ID: 'restaurant-reference'
    });
    expect(config).toEqual(expect.objectContaining({
      instanceMode: 'SINGLE_RESTAURANT',
      instanceRestaurantId: 'restaurant-reference'
    }));
  });
});

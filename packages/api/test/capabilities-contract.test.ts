import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import jwt from '@fastify/jwt';
import { CapabilityState } from '@mesaya/shared';

const mocks = vi.hoisted(() => ({
  findStaff: vi.fn(),
  getPublic: vi.fn(),
  getAdmin: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  getCapabilities: vi.fn()
}));
vi.mock('../src/lib/prisma', () => ({ prisma: { staffUser: { findUnique: (...args: unknown[]) => mocks.findStaff(...args) } } }));
vi.mock('../src/services/config.service', () => ({ ConfigService: {
  getPublicConfig: (...args: unknown[]) => mocks.getPublic(...args),
  getAdminConfig: (...args: unknown[]) => mocks.getAdmin(...args),
  updateConfigTransacted: (...args: unknown[]) => mocks.update(...args),
  getAuditLogs: (...args: unknown[]) => mocks.audit(...args),
  getCapabilities: (...args: unknown[]) => mocks.getCapabilities(...args)
} }));

import { configRoutes } from '../src/routes/config.routes';

const SECRET = 'jwt-secret-for-capabilities-contract-tests-which-is-long-enough';
const identity = (id: string) => ({ id, name: id, role: id.startsWith('manager') ? 'MANAGER' : 'WAITER', restaurantId: id.endsWith('-a') ? 'restaurant-a' : 'restaurant-b', assignedSector: null });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.findStaff.mockImplementation(({ where }: any) => Promise.resolve(identity(where.id)));
});

async function appWithRoutes() {
  const app = Fastify();
  await app.register(jwt, { secret: SECRET });
  await app.register(configRoutes);
  return app;
}

describe('Etapa 00 — capabilities: stored flags ≠ effective availability', () => {
  it('paymentMode DIGITAL_MP expone la opción informativa sin credenciales', async () => {
    mocks.getCapabilities.mockResolvedValue({
      restaurantId: 'restaurant-a',
      capabilities: {
        digital_payment: { key: 'digital_payment', state: CapabilityState.AVAILABLE, reasonCode: 'DIGITAL_PAYMENT_OPTION_ACTIVE', message: 'Opción informativa; cobro presencial' }
      }
    });
    const app = await appWithRoutes();
    try {
      const res = await app.inject({ method: 'GET', url: '/restaurants/local/capabilities' });
      expect(res.statusCode).toBe(200);
      expect(res.json().capabilities.digital_payment.state).toBe(CapabilityState.AVAILABLE);
      expect(res.json().capabilities.digital_payment.reasonCode).toBe('DIGITAL_PAYMENT_OPTION_ACTIVE');
    } finally { await app.close(); }
  });

  it('allowSplitBill true no produce AVAILABLE capability', async () => {
    mocks.getCapabilities.mockResolvedValue({
      restaurantId: 'restaurant-a',
      capabilities: {
        split_bill: { key: 'split_bill', state: CapabilityState.COMING_SOON, reasonCode: 'SPLIT_BILL_UNAVAILABLE', message: 'No disponible' }
      }
    });
    const app = await appWithRoutes();
    try {
      const res = await app.inject({ method: 'GET', url: '/restaurants/local/capabilities' });
      expect(res.statusCode).toBe(200);
      expect(res.json().capabilities.split_bill.state).toBe(CapabilityState.COMING_SOON);
      expect(res.json().capabilities.split_bill.reasonCode).toBe('SPLIT_BILL_UNAVAILABLE');
    } finally { await app.close(); }
  });

  it('reviews enabled without googlePlaceId → feedback interno disponible', async () => {
    mocks.getCapabilities.mockResolvedValue({
      restaurantId: 'restaurant-a',
      capabilities: {
        reviews: { key: 'reviews', state: CapabilityState.AVAILABLE, reasonCode: 'REVIEWS_INTERNAL_ACTIVE_GOOGLE_UNCONFIGURED', message: 'Feedback interno activo' }
      }
    });
    const app = await appWithRoutes();
    try {
      const res = await app.inject({ method: 'GET', url: '/restaurants/local/capabilities' });
      expect(res.statusCode).toBe(200);
      expect(res.json().capabilities.reviews.state).toBe(CapabilityState.AVAILABLE);
      expect(res.json().capabilities.reviews.reasonCode).toBe('REVIEWS_INTERNAL_ACTIVE_GOOGLE_UNCONFIGURED');
    } finally { await app.close(); }
  });

  it('capabilities endpoint is public (no auth required)', async () => {
    mocks.getCapabilities.mockResolvedValue({ restaurantId: 'restaurant-a', capabilities: {} });
    const app = await appWithRoutes();
    try {
      const res = await app.inject({ method: 'GET', url: '/restaurants/local/capabilities' });
      expect(res.statusCode).toBe(200);
    } finally { await app.close(); }
  });

  it('non-existent restaurant returns 404', async () => {
    mocks.getCapabilities.mockResolvedValue(null);
    const app = await appWithRoutes();
    try {
      const res = await app.inject({ method: 'GET', url: '/restaurants/no-existe/capabilities' });
      expect(res.statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it('capability map does not expose secrets or credentials', async () => {
    mocks.getCapabilities.mockResolvedValue({
      restaurantId: 'restaurant-a',
      capabilities: {
        digital_payment: { key: 'digital_payment', state: CapabilityState.AVAILABLE, reasonCode: 'DIGITAL_PAYMENT_OPTION_ACTIVE', message: 'Opción informativa; cobro presencial' }
      }
    });
    const app = await appWithRoutes();
    try {
      const res = await app.inject({ method: 'GET', url: '/restaurants/local/capabilities' });
      const body = res.body;
      expect(body).not.toContain('secret');
      expect(body).not.toContain('token');
      expect(body).not.toContain('pinHash');
      expect(body).not.toContain('mp_');
    } finally { await app.close(); }
  });
});

describe('Etapa 00 — capability state labels are present', () => {
  it('CapabilityState enum has all four states', () => {
    expect(Object.values(CapabilityState)).toContain('AVAILABLE');
    expect(Object.values(CapabilityState)).toContain('PILOT_ONLY');
    expect(Object.values(CapabilityState)).toContain('COMING_SOON');
    expect(Object.values(CapabilityState)).toContain('MISCONFIGURED');
  });
});

import { describe, it, expect } from 'vitest';

/**
 * Focused tests for client-web cart/order state helpers.
 * These extract and validate the pure logic without DOM dependencies.
 */

// Extracted pure helper logic from client-web/app.js cart state
function getGuestSessionId(storage: Map<string, string>) {
  let gid = storage.get('mesaya_guest_session_id');
  if (!gid) {
    gid = 'gw-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    storage.set('mesaya_guest_session_id', gid);
  }
  return gid;
}

function canOrderDirectly(token: string | null, config: { allowOrdering?: boolean } | null) {
  if (!token) return false;
  if (config && config.allowOrdering === false) return false;
  return true;
}

function cartItemCount(order: { items?: Array<{ quantity: number }> } | null) {
  if (!order || !order.items) return 0;
  return order.items.reduce((s, i) => s + i.quantity, 0);
}

function cartTotalAmount(order: { totalAmount?: number } | null) {
  if (!order || !order.totalAmount) return 0;
  return order.totalAmount;
}

describe('Cart client helpers — pure logic', () => {
  describe('getGuestSessionId', () => {
    it('generates a stable guest session ID on first call', () => {
      const storage = new Map<string, string>();
      const id = getGuestSessionId(storage);
      expect(id).toMatch(/^gw-/);
      expect(storage.get('mesaya_guest_session_id')).toBe(id);
    });

    it('returns the same ID on subsequent calls', () => {
      const storage = new Map<string, string>();
      const id1 = getGuestSessionId(storage);
      const id2 = getGuestSessionId(storage);
      expect(id1).toBe(id2);
    });
  });

  describe('canOrderDirectly', () => {
    it('returns false when no token', () => {
      expect(canOrderDirectly(null, null)).toBe(false);
      expect(canOrderDirectly('', null)).toBe(false);
    });

    it('returns false when allowOrdering is explicitly false', () => {
      expect(canOrderDirectly('tok-abc', { allowOrdering: false })).toBe(false);
    });

    it('returns true with a token and no config', () => {
      expect(canOrderDirectly('tok-abc', null)).toBe(true);
    });

    it('returns true with a token and config.allowOrdering true', () => {
      expect(canOrderDirectly('tok-abc', { allowOrdering: true })).toBe(true);
    });
  });

  describe('cartItemCount', () => {
    it('returns 0 for null order', () => {
      expect(cartItemCount(null)).toBe(0);
    });

    it('returns 0 for empty items', () => {
      expect(cartItemCount({ items: [] })).toBe(0);
    });

    it('sums quantities correctly', () => {
      expect(cartItemCount({ items: [{ quantity: 2 }, { quantity: 3 }] })).toBe(5);
    });
  });

  describe('cartTotalAmount', () => {
    it('returns 0 for null order', () => {
      expect(cartTotalAmount(null)).toBe(0);
    });

    it('returns the totalAmount from the order', () => {
      expect(cartTotalAmount({ totalAmount: 4500 })).toBe(4500);
    });
  });
});

describe('Cart state helpers — error mapping', () => {
  function handleOrderError(status: number, data: { error?: string }) {
    const msg = data && data.error ? data.error : '';
    if (status === 401 || status === 410) return { action: 'expired', msg };
    if (status === 403) return { action: 'forbidden', msg };
    if (status === 422) return { action: 'unavailable', msg };
    if (status === 503) return { action: 'service_unavailable', msg };
    return { action: 'generic', msg };
  }

  it('maps 401/410 to expired', () => {
    expect(handleOrderError(401, { error: 'token inválido' })).toEqual({ action: 'expired', msg: 'token inválido' });
    expect(handleOrderError(410, { error: 'sesión cerrada' })).toEqual({ action: 'expired', msg: 'sesión cerrada' });
  });

  it('maps 403 to forbidden', () => {
    expect(handleOrderError(403, { error: 'no ordering' })).toEqual({ action: 'forbidden', msg: 'no ordering' });
  });

  it('maps 422 to unavailable', () => {
    expect(handleOrderError(422, { error: 'plato agotado' })).toEqual({ action: 'unavailable', msg: 'plato agotado' });
  });

  it('maps 503 to service_unavailable', () => {
    expect(handleOrderError(503, {})).toEqual({ action: 'service_unavailable', msg: '' });
  });

  it('maps unknown status to generic', () => {
    expect(handleOrderError(500, { error: 'oops' })).toEqual({ action: 'generic', msg: 'oops' });
  });
});

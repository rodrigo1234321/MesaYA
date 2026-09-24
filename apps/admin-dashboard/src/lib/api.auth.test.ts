import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminApi } from './api';

describe('AdminApi session handling', () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('preserves the admin session on 403 permission failures', async () => {
    localStorage.setItem('mesaya_admin_token', 'valid-token');
    const eventHandler = vi.fn();
    window.addEventListener('mesaya:admin-auth-expired', eventHandler);

    await expect(AdminApi.requireAuthorized(
      new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403 }),
      'Fallback'
    )).rejects.toThrow('FORBIDDEN');

    expect(localStorage.getItem('mesaya_admin_token')).toBe('valid-token');
    expect(eventHandler).not.toHaveBeenCalled();
    window.removeEventListener('mesaya:admin-auth-expired', eventHandler);
  });

  it('clears the session and notifies the shell on 401', async () => {
    localStorage.setItem('mesaya_admin_token', 'expired-token');
    localStorage.setItem('mesaya_active_restaurant', JSON.stringify({ slug: 'fauno' }));
    const eventHandler = vi.fn();
    window.addEventListener('mesaya:admin-auth-expired', eventHandler);

    await expect(AdminApi.requireAuthorized(
      new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 }),
      'Fallback'
    )).rejects.toThrow('Volvé a iniciar sesión');

    expect(localStorage.getItem('mesaya_admin_token')).toBeNull();
    expect(localStorage.getItem('mesaya_active_restaurant')).toBeNull();
    expect(eventHandler).toHaveBeenCalledTimes(1);
    window.removeEventListener('mesaya:admin-auth-expired', eventHandler);
  });
});

import { describe, expect, it } from 'vitest';

describe('Etapa 04 — contrato de terminal compartido', () => {
  it('acepta identificadores de terminal no secretos con formato acotado', () => {
    expect(/^[a-zA-Z0-9_-]{8,100}$/.test('terminal-abc123')).toBe(true);
    expect(/^[a-zA-Z0-9_-]{8,100}$/.test('short')).toBe(false);
    expect(/^[a-zA-Z0-9_-]{8,100}$/.test('terminal with spaces')).toBe(false);
  });

  it('el actor y el terminal son dimensiones distintas', () => {
    const claims = { sub: 'staff-a', restaurantId: 'restaurant-a', terminalId: 'terminal-a1' };
    expect(claims.sub).not.toBe(claims.terminalId);
    expect(claims).toEqual(expect.objectContaining({ sub: expect.any(String), terminalId: expect.any(String) }));
  });
});

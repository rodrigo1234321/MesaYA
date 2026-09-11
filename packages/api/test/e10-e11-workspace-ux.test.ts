import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(__dirname, '../../..', 'apps/staff-panel/src/components/ServiceWorkspace.tsx'), 'utf8');

describe('E10-E11 ServiceWorkspace UX final', () => {
  it('filtra ACCOUNT_COLLECTION y TABLE_CLEANUP del panel (sin duplicar controles)', () => {
    expect(src).toMatch(/kind !== 'ACCOUNT_COLLECTION' && task\.kind !== 'TABLE_CLEANUP'/);
  });
  it('mantiene el cobro contextual fuera de Todo y lo deja en Cuentas', () => {
    expect(src).toContain("if (filter === 'ALL') return task.kind !== 'ACCOUNT_COLLECTION';");
    expect(src).toContain("if (filter === 'ACCOUNT') return task.kind === 'ACCOUNT_COLLECTION' || task.payload.callType === CallType.BILL;");
  });
  it('labels Pendiente de cobro / Pendiente de limpieza', () => {
    expect(src).toContain('Pendiente de cobro');
    expect(src).toContain('Pendiente de limpieza');
  });
  it('CALL BILL no promete abrir cuenta', () => {
    expect(src).not.toContain('Tomar y abrir cuenta');
    expect(src).toContain('Atender y ver cuenta');
  });
  it('botón cleanup refleja actionBusy clean:tableId', () => {
    expect(src).toContain('clean:${table.id}');
    expect(src).toContain('Guardando…');
  });
  it('conserva filtros Todo/Cuentas/Limpieza', () => {
    expect(src).toContain("'Todo'");
    expect(src).toContain("'Cuentas'");
    expect(src).toContain("'Limpieza'");
  });
  it('muestra la preferencia del cliente y separa el medio por ocupación', () => {
    expect(src).toContain('Cliente pidió pagar con');
    expect(src).toContain('requestedPaymentMethod');
    expect(src).toContain('paymentMethodBySession');
  });
  it('enfoca el contexto de mesa una sola vez por solicitud', () => {
    expect(src).toContain('pendingTableFocusRef');
    expect(src).toContain('target.scrollIntoView');
    expect(src).toContain('preventScroll: true');
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isOrderComputable,
  calculateOrderItemTotalMinor,
  calculateOrderTotalMinor,
  calculateSessionBalance,
  CANONICAL_CONSUMO_STATUSES
} from '../src/contracts/accounting';
import { AppPublicError, StandardErrorCodes } from '../src/contracts/errors';
import { isValidPinFormat } from '../src/contracts/identity';
import { buildCanonicalClientTableUrl } from '../src/contracts/qr';
import { OrderStatus } from '../src/index';

describe('Contracts — E01 Domain Invariants', () => {
  describe('Accounting & Computability', () => {
    it('computes only confirmed/kitchen/served/ready/paid statuses', () => {
      assert.equal(isOrderComputable(OrderStatus.CONFIRMED), true);
      assert.equal(isOrderComputable(OrderStatus.IN_KITCHEN), true);
      assert.equal(isOrderComputable(OrderStatus.READY_TO_SERVE), true);
      assert.equal(isOrderComputable(OrderStatus.SERVED), true);
      assert.equal(isOrderComputable(OrderStatus.PAID), true);

      // NO deben computar
      assert.equal(isOrderComputable(OrderStatus.PENDING_VALIDATION), false);
      assert.equal(isOrderComputable(OrderStatus.DRAFT), false);
      assert.equal(isOrderComputable(OrderStatus.CANCELLED), false);
      assert.equal(isOrderComputable('UNKNOWN_STATUS'), false);
    });

    it('calculates order item total in minor units', () => {
      // 2 unidades a $1500 (150000 centavos) con modificador de $200 (20000 centavos)
      const lineTotal = calculateOrderItemTotalMinor(2, 150000, 20000);
      assert.equal(lineTotal, 320000);
    });

    it('throws error if quantity or price are invalid numbers or floats', () => {
      assert.throws(() => calculateOrderItemTotalMinor(1.5, 10000), TypeError);
      assert.throws(() => calculateOrderItemTotalMinor(2, 150.5), TypeError);
      assert.throws(() => calculateOrderItemTotalMinor(-1, 10000), TypeError);
    });

    it('calculates order total from multiple items', () => {
      const items = [
        { quantity: 2, unitPriceMinor: 10000 }, // 20000
        { quantity: 1, unitPriceMinor: 25000, modifiersMinor: 5000 } // 30000
      ];
      assert.equal(calculateOrderTotalMinor(items), 50000);
    });

    it('calculates session balance correctly with tips and adjustments', () => {
      // Consumo $10000 (1000000 centavos), propina $1000 (100000 centavos), descuento $500 (-50000 centavos)
      const balance = calculateSessionBalance({
        consumoMinor: 1000000,
        paidMinor: 600000,
        tipMinor: 100000,
        adjustmentsMinor: -50000
      });

      // TotalDue = 1000000 + 100000 - 50000 = 1050000
      assert.equal(balance.totalDueMinor, 1050000);
      // Saldo consumo pendiente = (1000000 - 50000) - 600000 = 350000
      assert.equal(balance.saldoMinor, 350000);
      assert.equal(balance.isSettled, false);
    });

    it('marks session as settled when saldoMinor is 0', () => {
      const balance = calculateSessionBalance({
        consumoMinor: 500000,
        paidMinor: 500000
      });
      assert.equal(balance.saldoMinor, 0);
      assert.equal(balance.isSettled, true);
    });

    it('clamps saldoMinor to 0 even if paid exceeds due (overpayment safety)', () => {
      const balance = calculateSessionBalance({
        consumoMinor: 500000,
        paidMinor: 600000
      });
      assert.equal(balance.saldoMinor, 0);
      assert.equal(balance.isSettled, true);
    });
  });

  describe('Errors Contract', () => {
    it('creates AppPublicError with code and approved payload', () => {
      const err = new AppPublicError(StandardErrorCodes.PIN_INVALID, 'El PIN no es válido', 401);
      assert.equal(err.code, 'PIN_INVALID');
      assert.equal(err.statusCode, 401);
      assert.equal(err.message, 'El PIN no es válido');
      assert.equal(err.isPublic, true);
    });
  });

  describe('Identity & PIN Contract', () => {
    it('validates 4-6 digits numeric PINs', () => {
      assert.equal(isValidPinFormat('1234'), true);
      assert.equal(isValidPinFormat('12345'), true);
      assert.equal(isValidPinFormat('123456'), true);

      // Inválidos
      assert.equal(isValidPinFormat('123'), false); // menos de 4
      assert.equal(isValidPinFormat('1234567'), false); // más de 6
      assert.equal(isValidPinFormat('12a4'), false); // letras
      assert.equal(isValidPinFormat(' 1234'), false); // espacios
      assert.equal(isValidPinFormat(1234), false); // no string
      assert.equal(isValidPinFormat(null), false);
    });
  });

  describe('QR Canonical URL Builder', () => {
    it('constructs canonical client table URL cleanly', () => {
      const url = buildCanonicalClientTableUrl(
        'https://mesaya.app/',
        'don-pepe',
        'Mesa 4'
      );
      assert.equal(url, 'https://mesaya.app/r/don-pepe/mesa/Mesa%204');
    });

    it('throws when missing required parameters', () => {
      assert.throws(() => buildCanonicalClientTableUrl('', 'slug', '4'));
      assert.throws(() => buildCanonicalClientTableUrl('https://app.com', '', '4'));
      assert.throws(() => buildCanonicalClientTableUrl('https://app.com', 'slug', ''));
    });
  });
});

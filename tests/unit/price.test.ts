import { describe, expect, it } from 'vitest';
import { formatPaise, parsePriceToPaise } from '@/lib/finance/currency';

describe('price conversion', () => {
  it.each([
    ['0.01', 1n],
    ['0.29', 29n],
    ['1', 100n],
    ['1.5', 150n],
    ['123456.78', 12_345_678n],
  ])('converts %s rupees to exact integer paise', (rupees, paise) => {
    expect(parsePriceToPaise(rupees)).toBe(paise);
  });

  it.each(['0', '0.00', '-1', '1.001', '1e3', 'NaN', 'Infinity', ''])(
    'rejects invalid market price %j',
    (price) => {
      expect(() => parsePriceToPaise(price)).toThrow();
    },
  );

  it('formats integer paise as INR without losing the fractional paise value', () => {
    expect(formatPaise(1n)).toBe('₹0.01');
    expect(formatPaise(123_456n)).toBe('₹1,234.56');
  });
});

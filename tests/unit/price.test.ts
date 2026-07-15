import { describe, expect, it } from 'vitest';
import { formatPaise, parsePriceToPaise } from '@/lib/finance/currency';

describe('price conversion', () => {
  it.each([
    ['0.01', 1],
    ['0.29', 29],
    ['1', 100],
    ['1.5', 150],
    ['123456.78', 12_345_678],
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
    expect(formatPaise(1)).toBe('₹0.01');
    expect(formatPaise(123_456)).toBe('₹1,234.56');
  });
});

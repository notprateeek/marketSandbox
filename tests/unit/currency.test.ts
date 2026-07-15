import { describe, it, expect } from 'vitest';
import { formatINR, formatINRCompact, formatPercentage } from '@/lib/finance/currency';

describe('Currency Formatter', () => {
  describe('formatINR', () => {
    it('formats positive numbers correctly', () => {
      expect(formatINR(50000)).toBe('₹50,000.00');
      expect(formatINR(1234567.89)).toBe('₹12,34,567.89');
    });

    it('formats zero correctly', () => {
      expect(formatINR(0)).toBe('₹0.00');
    });

    it('formats negative numbers correctly', () => {
      expect(formatINR(-500)).toBe('-₹500.00');
      expect(formatINR(-1234567.89)).toBe('-₹12,34,567.89');
    });
  });

  describe('formatINRCompact', () => {
    it('formats large numbers compactly', () => {
      expect(formatINRCompact(50000)).toBe('₹50K'); // K for thousand
      expect(formatINRCompact(1234567)).toBe('₹12.3L'); // L for Lakh
    });
  });

  describe('formatPercentage', () => {
    it('formats positive percentages with + sign', () => {
      expect(formatPercentage(5.25)).toBe('+5.25%');
      expect(formatPercentage(0)).toBe('+0.00%');
    });

    it('formats negative percentages correctly', () => {
      expect(formatPercentage(-2.1)).toBe('-2.10%');
    });
  });
});

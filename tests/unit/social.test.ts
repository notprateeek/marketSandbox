import { describe, expect, it } from 'vitest';

import { normalizeHandle } from '@/lib/social';

describe('normalizeHandle', () => {
  it('strips @, trims and lowercases a valid handle', () => {
    expect(normalizeHandle('  @Trader_1 ')).toBe('trader_1');
    expect(normalizeHandle('ABC')).toBe('abc');
    expect(normalizeHandle('valid_123')).toBe('valid_123');
  });

  it('rejects too-short, too-long, or illegal handles', () => {
    expect(normalizeHandle('ab')).toBeNull();
    expect(normalizeHandle('a'.repeat(21))).toBeNull();
    expect(normalizeHandle('has space')).toBeNull();
    expect(normalizeHandle('bad-dash')).toBeNull();
    expect(normalizeHandle('')).toBeNull();
  });
});

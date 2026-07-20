import { describe, expect, it } from 'vitest';

import { livePricePaise, seedFromId } from '@/lib/finance/price-walk';

const BASE = 1_000_00n; // ₹1,000

describe('livePricePaise', () => {
  const seed = seedFromId('LIVE-TEST');

  it('returns exactly the base close at or before delta 0 (continuous with history)', () => {
    expect(livePricePaise(seed, BASE, 0)).toBe(BASE);
    expect(livePricePaise(seed, BASE, -10)).toBe(BASE);
  });

  it('is deterministic for the same inputs', () => {
    expect(livePricePaise(seed, BASE, 1_234)).toBe(livePricePaise(seed, BASE, 1_234));
  });

  it('moves the price once market time has elapsed', () => {
    expect(livePricePaise(seed, BASE, 600)).not.toBe(BASE);
  });

  it('drifts both up and down across a session and stays within a sane band', () => {
    let sawUp = false;
    let sawDown = false;
    for (const id of ['A', 'B', 'C', 'RELIANCE', 'TCS']) {
      const instrumentSeed = seedFromId(id);
      for (let t = 0; t <= 22_500; t += 30) {
        const price = livePricePaise(instrumentSeed, BASE, t);
        if (price > BASE) sawUp = true;
        if (price < BASE) sawDown = true;
        expect(price).toBeGreaterThan(Number(BASE) * 0.7);
        expect(price).toBeLessThan(Number(BASE) * 1.3);
      }
    }
    expect(sawUp).toBe(true);
    expect(sawDown).toBe(true);
  });

  it('gives different instruments different paths', () => {
    const other = seedFromId('OTHER');
    expect(livePricePaise(other, BASE, 600)).not.toBe(livePricePaise(seed, BASE, 600));
  });
});

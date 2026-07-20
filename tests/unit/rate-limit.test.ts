import { beforeEach, describe, expect, it } from 'vitest';

import { _resetRateLimiter, consumeToken, type RateLimit } from '@/lib/rate-limit';

const LIMIT: RateLimit = { capacity: 3, refillPerSec: 1 }; // 3 burst, then 1/sec

describe('consumeToken', () => {
  beforeEach(() => _resetRateLimiter());

  it('allows a burst up to capacity, then blocks', () => {
    const t = 1_000_000;
    expect(consumeToken('k', LIMIT, t)).toBe(true);
    expect(consumeToken('k', LIMIT, t)).toBe(true);
    expect(consumeToken('k', LIMIT, t)).toBe(true);
    expect(consumeToken('k', LIMIT, t)).toBe(false); // 4th within the same instant
  });

  it('refills over elapsed time', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i += 1) consumeToken('k', LIMIT, t);
    expect(consumeToken('k', LIMIT, t)).toBe(false);
    // 1 second later → exactly one token back.
    expect(consumeToken('k', LIMIT, t + 1_000)).toBe(true);
    expect(consumeToken('k', LIMIT, t + 1_000)).toBe(false);
    // 5 seconds later → refilled but capped at capacity (3), not 5.
    expect(consumeToken('k', LIMIT, t + 6_000)).toBe(true);
    expect(consumeToken('k', LIMIT, t + 6_000)).toBe(true);
    expect(consumeToken('k', LIMIT, t + 6_000)).toBe(true);
    expect(consumeToken('k', LIMIT, t + 6_000)).toBe(false);
  });

  it('tracks keys independently', () => {
    const t = 1_000_000;
    for (let i = 0; i < 3; i += 1) consumeToken('a', LIMIT, t);
    expect(consumeToken('a', LIMIT, t)).toBe(false);
    expect(consumeToken('b', LIMIT, t)).toBe(true); // b has its own full bucket
  });
});

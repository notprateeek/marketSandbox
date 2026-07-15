import { describe, expect, it } from 'vitest';

import { SESSION_SECONDS, isMarketOpen, marketSecondsBetween } from '@/lib/finance/market-hours';

// Helper: build a Date from an IST wall-clock string.
const ist = (value: string) => new Date(`${value}+05:30`);

// 2026-07-15 is a Wednesday; 17 Fri, 18 Sat, 19 Sun, 20 Mon.
describe('isMarketOpen', () => {
  it('is open midday on a weekday and at the open instant', () => {
    expect(isMarketOpen(ist('2026-07-15T10:00:00'))).toBe(true);
    expect(isMarketOpen(ist('2026-07-15T09:15:00'))).toBe(true);
  });

  it('is closed before open, at the close instant, and overnight', () => {
    expect(isMarketOpen(ist('2026-07-15T09:00:00'))).toBe(false);
    expect(isMarketOpen(ist('2026-07-15T15:30:00'))).toBe(false);
    expect(isMarketOpen(ist('2026-07-15T20:00:00'))).toBe(false);
  });

  it('is closed on weekends', () => {
    expect(isMarketOpen(ist('2026-07-18T10:00:00'))).toBe(false); // Saturday
    expect(isMarketOpen(ist('2026-07-19T10:00:00'))).toBe(false); // Sunday
  });
});

describe('marketSecondsBetween', () => {
  it('counts a plain intraday span', () => {
    expect(marketSecondsBetween(ist('2026-07-15T10:00:00'), ist('2026-07-15T11:00:00'))).toBe(3600);
  });

  it('clamps the start to the session open', () => {
    expect(marketSecondsBetween(ist('2026-07-15T09:00:00'), ist('2026-07-15T10:00:00'))).toBe(
      45 * 60,
    );
  });

  it('counts exactly one session across a whole weekday', () => {
    expect(marketSecondsBetween(ist('2026-07-15T00:00:00'), ist('2026-07-16T00:00:00'))).toBe(
      SESSION_SECONDS,
    );
  });

  it('skips overnight and the weekend (Fri 15:00 → Mon 10:00)', () => {
    expect(marketSecondsBetween(ist('2026-07-17T15:00:00'), ist('2026-07-20T10:00:00'))).toBe(
      30 * 60 + 45 * 60,
    );
  });

  it('is zero when from >= to or the span is entirely closed', () => {
    expect(marketSecondsBetween(ist('2026-07-15T11:00:00'), ist('2026-07-15T10:00:00'))).toBe(0);
    expect(marketSecondsBetween(ist('2026-07-18T10:00:00'), ist('2026-07-18T14:00:00'))).toBe(0);
  });
});

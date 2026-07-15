import { describe, expect, it } from 'vitest';

import {
  evaluatePendingOrder,
  type Candle,
  type PendingOrderTerms,
} from '@/lib/finance/pending-order';

const SUBMIT = new Date('2026-06-01T00:00:00.000Z');
const MIN = 60_000;
const at = (n: number) => new Date(SUBMIT.getTime() + n * MIN);
const NOW = at(100);

function candle(n: number, open: number, high: number, low: number): Candle {
  return { timestamp: at(n), openPaise: open, highPaise: high, lowPaise: low };
}

function terms(overrides: Partial<PendingOrderTerms>): PendingOrderTerms {
  return {
    orderType: 'LIMIT',
    side: 'BUY',
    status: 'PENDING',
    limitPricePaise: null,
    stopPricePaise: null,
    submissionTimestamp: SUBMIT,
    triggeredAt: null,
    expiryTimestamp: null,
    ...overrides,
  };
}

describe('evaluatePendingOrder — LIMIT', () => {
  it('buy limit fills at the limit when the candle range dips to it', () => {
    const decision = evaluatePendingOrder(
      terms({ side: 'BUY', limitPricePaise: 10_000 }),
      [candle(1, 10_300, 10_400, 9_900)], // low 9,900 ≤ 10,000
      NOW,
    );
    expect(decision).toEqual({
      kind: 'FILL',
      pricePaise: 10_000,
      triggeredAt: at(1),
      executedAt: at(1),
    });
  });

  it('buy limit fills at the OPEN when the candle gaps below the limit', () => {
    const decision = evaluatePendingOrder(
      terms({ side: 'BUY', limitPricePaise: 10_000 }),
      [candle(1, 9_500, 9_800, 9_400)], // gapped open 9,500 < limit
      NOW,
    );
    expect(decision).toMatchObject({ kind: 'FILL', pricePaise: 9_500 });
  });

  it('sell limit fills at the OPEN when the candle gaps above the limit', () => {
    const decision = evaluatePendingOrder(
      terms({ side: 'SELL', limitPricePaise: 20_000 }),
      [candle(1, 21_000, 21_200, 20_800)], // gapped open above limit
      NOW,
    );
    expect(decision).toMatchObject({ kind: 'FILL', pricePaise: 21_000 });
  });

  it('skips non-triggering candles and fills on the first that qualifies', () => {
    const decision = evaluatePendingOrder(
      terms({ side: 'BUY', limitPricePaise: 10_000 }),
      [
        candle(1, 10_500, 10_600, 10_200), // above limit — skipped
        candle(2, 10_400, 10_450, 10_100), // still above — skipped
        candle(3, 10_300, 10_350, 9_950), // dips to limit
      ],
      NOW,
    );
    expect(decision).toMatchObject({ kind: 'FILL', pricePaise: 10_000, executedAt: at(3) });
  });

  it('ignores candles at or before submission', () => {
    const decision = evaluatePendingOrder(
      terms({ side: 'BUY', limitPricePaise: 10_000 }),
      [candle(0, 9_000, 9_100, 8_900)], // at submission — must be ignored
      NOW,
    );
    expect(decision.kind).toBe('NONE');
  });

  it('expires when the limit is never reached before expiry', () => {
    const decision = evaluatePendingOrder(
      terms({ side: 'BUY', limitPricePaise: 10_000, expiryTimestamp: at(5) }),
      [candle(1, 10_500, 10_600, 10_200)],
      NOW,
    );
    expect(decision.kind).toBe('EXPIRE');
  });
});

describe('evaluatePendingOrder — STOP_LOSS (sell)', () => {
  const stop = terms({
    orderType: 'STOP_LOSS',
    side: 'SELL',
    stopPricePaise: 9_000,
    limitPricePaise: null,
  });

  it('triggers then executes at the next candle open', () => {
    const decision = evaluatePendingOrder(
      stop,
      [
        candle(1, 9_500, 9_600, 8_900), // low 8,900 ≤ stop → trigger here
        candle(2, 9_100, 9_150, 9_000), // next candle → execute at open 9,100
      ],
      NOW,
    );
    expect(decision).toEqual({
      kind: 'FILL',
      pricePaise: 9_100,
      triggeredAt: at(1),
      executedAt: at(2),
    });
  });

  it('stays TRIGGERED when there is no later candle to execute against', () => {
    const decision = evaluatePendingOrder(
      stop,
      [candle(1, 9_500, 9_600, 8_900)],
      at(1), // now is exactly the trigger candle; no next candle yet
    );
    expect(decision).toEqual({ kind: 'TRIGGER', triggeredAt: at(1) });
  });

  it('executes an already-triggered order at the next available open (gap honoured)', () => {
    const decision = evaluatePendingOrder(
      terms({
        orderType: 'STOP_LOSS',
        side: 'SELL',
        status: 'TRIGGERED',
        stopPricePaise: 9_000,
        triggeredAt: at(1),
      }),
      [candle(2, 8_000, 8_100, 7_900)], // gap down; still fills at open 8,000
      NOW,
    );
    expect(decision).toMatchObject({ kind: 'FILL', pricePaise: 8_000, executedAt: at(2) });
  });
});

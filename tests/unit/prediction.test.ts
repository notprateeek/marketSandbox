import { describe, expect, it } from 'vitest';

import {
  computePredictionStreak,
  evaluatePrediction,
  predictionProgress,
  summarizeAccuracy,
  targetPriceFor,
  type PredictionRecord,
  type PriceBar,
} from '@/lib/finance/prediction';

const T0 = new Date('2026-06-01T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1_000;
const day = (n: number) => new Date(T0.getTime() + n * DAY);

function bars(entries: [number, number, number][]): PriceBar[] {
  return entries.map(([dayIndex, high, low]) => ({
    timestamp: day(dayIndex),
    highPaise: BigInt(high),
    lowPaise: BigInt(low),
  }));
}

describe('targetPriceFor', () => {
  it('derives target prices from direction and percentage', () => {
    expect(targetPriceFor('UP', 100_000n, 5)).toBe(105_000n);
    expect(targetPriceFor('DOWN', 100_000n, 5)).toBe(95_000n);
    expect(targetPriceFor('FLAT', 100_000n, 2)).toBe(100_000n);
  });
});

describe('evaluatePrediction — worked example', () => {
  // "Tata Motors will increase 5% within one week." Actual: +2.3%.
  const terms = {
    direction: 'UP' as const,
    startingPricePaise: 100_000n,
    targetPricePaise: 105_000n,
    targetPercentage: 5,
    predictionTimestamp: T0,
  };

  it('marks the direction correct but the target not reached', () => {
    // Highs over the week never touch 105,000; ends at 102,300 (+2.3%).
    const outcome = evaluatePrediction(
      terms,
      102_300n,
      bars([
        [1, 102_000, 100_500],
        [3, 103_000, 101_000],
        [7, 102_300, 101_500],
      ]),
    );
    expect(outcome.directionCorrect).toBe(true);
    expect(outcome.targetReached).toBe(false);
    expect(outcome.actualMovementPercent).toBeCloseTo(2.3, 5);
    expect(outcome.absolutePercentageErrorPercent).toBeCloseTo(2.7, 5); // |2.3 - 5|
    expect(outcome.timeToTargetMs).toBeNull();
  });

  it('detects an intraday touch of the target and records the time to reach it', () => {
    const outcome = evaluatePrediction(
      terms,
      102_300n, // closes below target...
      bars([
        [1, 102_000, 100_500],
        [3, 106_000, 101_000], // ...but spikes above 105,000 on day 3
        [7, 102_300, 101_500],
      ]),
    );
    expect(outcome.targetReached).toBe(true);
    expect(outcome.timeToTargetMs).toBe(3 * DAY);
  });
});

describe('evaluatePrediction — directions', () => {
  it('handles a correct DOWN prediction that misses its target', () => {
    const outcome = evaluatePrediction(
      {
        direction: 'DOWN',
        startingPricePaise: 100_000n,
        targetPricePaise: 95_000n,
        targetPercentage: 5,
        predictionTimestamp: T0,
      },
      97_000n, // -3%
      bars([[2, 99_000, 96_000]]), // low never reaches 95,000
    );
    expect(outcome.directionCorrect).toBe(true);
    expect(outcome.targetReached).toBe(false);
    expect(outcome.absolutePercentageErrorPercent).toBeCloseTo(2, 5); // |-3 - (-5)|
  });

  it('marks a wrong direction', () => {
    const outcome = evaluatePrediction(
      {
        direction: 'UP',
        startingPricePaise: 100_000n,
        targetPricePaise: 105_000n,
        targetPercentage: 5,
        predictionTimestamp: T0,
      },
      98_000n,
      [],
    );
    expect(outcome.directionCorrect).toBe(false);
  });

  it('treats FLAT as staying within the tolerance band', () => {
    const flat = {
      direction: 'FLAT' as const,
      startingPricePaise: 100_000n,
      targetPricePaise: 100_000n,
      targetPercentage: 2,
      predictionTimestamp: T0,
    };
    expect(evaluatePrediction(flat, 101_000n, []).directionCorrect).toBe(true); // +1% within ±2%
    expect(evaluatePrediction(flat, 101_000n, []).targetReached).toBe(true);
    expect(evaluatePrediction(flat, 103_000n, []).directionCorrect).toBe(false); // +3% outside band
  });
});

describe('summarizeAccuracy', () => {
  const records: PredictionRecord[] = [
    {
      status: 'RESOLVED',
      instrumentSymbol: 'TATAMOTORS',
      directionCorrect: true,
      targetReached: false,
      durationMs: DAY,
    },
    {
      status: 'RESOLVED',
      instrumentSymbol: 'TATAMOTORS',
      directionCorrect: true,
      targetReached: true,
      durationMs: DAY,
    },
    {
      status: 'RESOLVED',
      instrumentSymbol: 'TCS',
      directionCorrect: false,
      targetReached: false,
      durationMs: 10 * DAY,
    },
    {
      status: 'CANCELLED',
      instrumentSymbol: 'TCS',
      directionCorrect: null,
      targetReached: null,
      durationMs: DAY,
    },
    {
      status: 'OPEN',
      instrumentSymbol: 'INFY',
      directionCorrect: null,
      targetReached: null,
      durationMs: DAY,
    },
  ];

  it('counts only resolved predictions and excludes cancelled/open', () => {
    const summary = summarizeAccuracy(records);
    expect(summary.total).toBe(3); // the two cancelled/open are excluded
    expect(summary.directionAccuracyPercent).toBeCloseTo(66.667, 2); // 2 of 3
    expect(summary.targetAccuracyPercent).toBeCloseTo(33.333, 2); // 1 of 3
  });

  it('breaks accuracy down by stock and by duration', () => {
    const summary = summarizeAccuracy(records);
    const tata = summary.byStock.find((bucket) => bucket.key === 'TATAMOTORS');
    expect(tata?.total).toBe(2);
    expect(tata?.directionAccuracyPercent).toBe(100);
    expect(tata?.targetAccuracyPercent).toBe(50);

    expect(summary.byDuration.find((b) => b.key === 'intraday')?.total).toBe(2);
    expect(summary.byDuration.find((b) => b.key === 'month')?.total).toBe(1);
  });

  it('returns nulls when there are no resolved predictions', () => {
    const summary = summarizeAccuracy([records[3], records[4]]); // cancelled + open only
    expect(summary.total).toBe(0);
    expect(summary.directionAccuracyPercent).toBeNull();
    expect(summary.byStock).toEqual([]);
  });
});

describe('predictionProgress — live standing of an open prediction', () => {
  const up = { direction: 'UP' as const, startingPricePaise: 100_000n, targetPricePaise: 110_000n, targetPercentage: 10 };

  it('tracks partial progress toward an UP target', () => {
    const p = predictionProgress(up, 105_000n); // halfway
    expect(p.currentMovementPercent).toBeCloseTo(5);
    expect(p.progressPercent).toBeCloseTo(50);
    expect(p.directionCorrectNow).toBe(true);
    expect(p.targetReachedNow).toBe(false);
  });

  it('flags the target reached once the price hits it', () => {
    const p = predictionProgress(up, 111_000n);
    expect(p.targetReachedNow).toBe(true);
    expect(p.progressPercent).toBeGreaterThanOrEqual(100);
  });

  it('reports negative progress when moving the wrong way', () => {
    const p = predictionProgress(up, 98_000n);
    expect(p.directionCorrectNow).toBe(false);
    expect(p.progressPercent).toBeLessThan(0);
  });

  it('handles a DOWN prediction symmetrically', () => {
    const down = { direction: 'DOWN' as const, startingPricePaise: 100_000n, targetPricePaise: 90_000n, targetPercentage: 10 };
    const p = predictionProgress(down, 95_000n); // halfway down
    expect(p.progressPercent).toBeCloseTo(50);
    expect(p.directionCorrectNow).toBe(true);
    expect(p.targetReachedNow).toBe(false);
    expect(predictionProgress(down, 89_000n).targetReachedNow).toBe(true);
  });

  it('treats FLAT as staying within the tolerance band', () => {
    const flat = { direction: 'FLAT' as const, startingPricePaise: 100_000n, targetPricePaise: 100_000n, targetPercentage: 2 };
    const inside = predictionProgress(flat, 101_000n); // +1% within ±2%
    expect(inside.directionCorrectNow).toBe(true);
    expect(inside.progressPercent).toBeCloseTo(50);
    const outside = predictionProgress(flat, 103_000n); // +3% breaches
    expect(outside.directionCorrectNow).toBe(false);
  });
});

describe('computePredictionStreak — consecutive correct days', () => {
  const c = (day: string) => ({ day, correct: true });
  const w = (day: string) => ({ day, correct: false });

  it('counts a live run ending today', () => {
    const streak = computePredictionStreak(
      [c('2026-07-16'), c('2026-07-17'), c('2026-07-18')],
      '2026-07-18',
    );
    expect(streak.current).toBe(3);
    expect(streak.longest).toBe(3);
    expect(streak.earnedBadges.map((b) => b.key)).toContain('spark');
  });

  it('keeps a run alive with a one-day (yesterday) grace, breaks after a gap', () => {
    expect(
      computePredictionStreak([c('2026-07-16'), c('2026-07-17')], '2026-07-18').current,
    ).toBe(2); // last hit yesterday → still live
    expect(
      computePredictionStreak([c('2026-07-15'), c('2026-07-16')], '2026-07-18').current,
    ).toBe(0); // last hit was 2 days ago → not live
  });

  it('ignores incorrect days and de-dupes multiple predictions on a day', () => {
    const streak = computePredictionStreak(
      [c('2026-07-17'), c('2026-07-17'), w('2026-07-18'), c('2026-07-18')],
      '2026-07-18',
    );
    expect(streak.current).toBe(2); // one correct on each of 17th and 18th
    expect(streak.longest).toBe(2);
  });

  it('tracks the longest historical run even when the current streak is dead', () => {
    const streak = computePredictionStreak(
      [c('2026-06-01'), c('2026-06-02'), c('2026-06-03'), c('2026-06-04'), c('2026-07-01')],
      '2026-07-18',
    );
    expect(streak.longest).toBe(4);
    expect(streak.current).toBe(0);
    expect(streak.nextBadge?.key).toBe('sharp'); // earned spark (3), next is 7
  });
});

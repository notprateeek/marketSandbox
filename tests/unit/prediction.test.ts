import { describe, expect, it } from 'vitest';

import {
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
    highPaise: high,
    lowPaise: low,
  }));
}

describe('targetPriceFor', () => {
  it('derives target prices from direction and percentage', () => {
    expect(targetPriceFor('UP', 100_000, 5)).toBe(105_000);
    expect(targetPriceFor('DOWN', 100_000, 5)).toBe(95_000);
    expect(targetPriceFor('FLAT', 100_000, 2)).toBe(100_000);
  });
});

describe('evaluatePrediction — worked example', () => {
  // "Tata Motors will increase 5% within one week." Actual: +2.3%.
  const terms = {
    direction: 'UP' as const,
    startingPricePaise: 100_000,
    targetPricePaise: 105_000,
    targetPercentage: 5,
    predictionTimestamp: T0,
  };

  it('marks the direction correct but the target not reached', () => {
    // Highs over the week never touch 105,000; ends at 102,300 (+2.3%).
    const outcome = evaluatePrediction(
      terms,
      102_300,
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
      102_300, // closes below target...
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
        startingPricePaise: 100_000,
        targetPricePaise: 95_000,
        targetPercentage: 5,
        predictionTimestamp: T0,
      },
      97_000, // -3%
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
        startingPricePaise: 100_000,
        targetPricePaise: 105_000,
        targetPercentage: 5,
        predictionTimestamp: T0,
      },
      98_000,
      [],
    );
    expect(outcome.directionCorrect).toBe(false);
  });

  it('treats FLAT as staying within the tolerance band', () => {
    const flat = {
      direction: 'FLAT' as const,
      startingPricePaise: 100_000,
      targetPricePaise: 100_000,
      targetPercentage: 2,
      predictionTimestamp: T0,
    };
    expect(evaluatePrediction(flat, 101_000, []).directionCorrect).toBe(true); // +1% within ±2%
    expect(evaluatePrediction(flat, 101_000, []).targetReached).toBe(true);
    expect(evaluatePrediction(flat, 103_000, []).directionCorrect).toBe(false); // +3% outside band
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
  const up = { direction: 'UP' as const, startingPricePaise: 100_000, targetPricePaise: 110_000, targetPercentage: 10 };

  it('tracks partial progress toward an UP target', () => {
    const p = predictionProgress(up, 105_000); // halfway
    expect(p.currentMovementPercent).toBeCloseTo(5);
    expect(p.progressPercent).toBeCloseTo(50);
    expect(p.directionCorrectNow).toBe(true);
    expect(p.targetReachedNow).toBe(false);
  });

  it('flags the target reached once the price hits it', () => {
    const p = predictionProgress(up, 111_000);
    expect(p.targetReachedNow).toBe(true);
    expect(p.progressPercent).toBeGreaterThanOrEqual(100);
  });

  it('reports negative progress when moving the wrong way', () => {
    const p = predictionProgress(up, 98_000);
    expect(p.directionCorrectNow).toBe(false);
    expect(p.progressPercent).toBeLessThan(0);
  });

  it('handles a DOWN prediction symmetrically', () => {
    const down = { direction: 'DOWN' as const, startingPricePaise: 100_000, targetPricePaise: 90_000, targetPercentage: 10 };
    const p = predictionProgress(down, 95_000); // halfway down
    expect(p.progressPercent).toBeCloseTo(50);
    expect(p.directionCorrectNow).toBe(true);
    expect(p.targetReachedNow).toBe(false);
    expect(predictionProgress(down, 89_000).targetReachedNow).toBe(true);
  });

  it('treats FLAT as staying within the tolerance band', () => {
    const flat = { direction: 'FLAT' as const, startingPricePaise: 100_000, targetPricePaise: 100_000, targetPercentage: 2 };
    const inside = predictionProgress(flat, 101_000); // +1% within ±2%
    expect(inside.directionCorrectNow).toBe(true);
    expect(inside.progressPercent).toBeCloseTo(50);
    const outside = predictionProgress(flat, 103_000); // +3% breaches
    expect(outside.directionCorrectNow).toBe(false);
  });
});

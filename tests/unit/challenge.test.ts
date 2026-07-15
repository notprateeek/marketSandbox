import { describe, expect, it } from 'vitest';

import { rankChallenge, type ScoreInput } from '@/lib/finance/challenge';

function entry(overrides: Partial<ScoreInput> & Pick<ScoreInput, 'participantId'>): ScoreInput {
  return {
    returnPercent: 0,
    maxDrawdownPercent: 0,
    predictionAccuracyPercent: null,
    joinedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('rankChallenge — one metric per method', () => {
  it('ranks RETURN with the highest percentage first', () => {
    const ranked = rankChallenge(
      [
        entry({ participantId: 'a', returnPercent: 5 }),
        entry({ participantId: 'b', returnPercent: 12 }),
        entry({ participantId: 'c', returnPercent: -3 }),
      ],
      'RETURN',
    );
    expect(ranked.map((e) => e.participantId)).toEqual(['b', 'a', 'c']);
    expect(ranked.map((e) => e.rank)).toEqual([1, 2, 3]);
  });

  it('ranks DRAWDOWN with the lowest maximum drawdown first', () => {
    const ranked = rankChallenge(
      [
        entry({ participantId: 'a', maxDrawdownPercent: 18 }),
        entry({ participantId: 'b', maxDrawdownPercent: 4 }),
        entry({ participantId: 'c', maxDrawdownPercent: 9 }),
      ],
      'DRAWDOWN',
    );
    expect(ranked.map((e) => e.participantId)).toEqual(['b', 'c', 'a']);
  });

  it('ranks PREDICTION_ACCURACY highest first and puts no-prediction entries last', () => {
    const ranked = rankChallenge(
      [
        entry({ participantId: 'a', predictionAccuracyPercent: 60 }),
        entry({ participantId: 'b', predictionAccuracyPercent: null }), // never predicted
        entry({ participantId: 'c', predictionAccuracyPercent: 80 }),
      ],
      'PREDICTION_ACCURACY',
    );
    expect(ranked.map((e) => e.participantId)).toEqual(['c', 'a', 'b']);
  });
});

describe('rankChallenge — deterministic tie-break', () => {
  const early = new Date('2026-06-01T09:00:00.000Z');
  const late = new Date('2026-06-01T15:00:00.000Z');

  it('breaks equal scores by earliest join, then participant id', () => {
    const ranked = rankChallenge(
      [
        entry({ participantId: 'z', returnPercent: 10, joinedAt: late }),
        entry({ participantId: 'y', returnPercent: 10, joinedAt: early }),
        entry({ participantId: 'a', returnPercent: 10, joinedAt: late }), // same score+time as z → id wins
      ],
      'RETURN',
    );
    // y joined earliest; then a and z tie on time, id 'a' < 'z'.
    expect(ranked.map((e) => e.participantId)).toEqual(['y', 'a', 'z']);
  });

  it('is reproducible regardless of input order', () => {
    const inputs = [
      entry({ participantId: 'a', returnPercent: 7 }),
      entry({
        participantId: 'b',
        returnPercent: 7,
        joinedAt: new Date('2026-06-02T00:00:00.000Z'),
      }),
      entry({ participantId: 'c', returnPercent: 15 }),
    ];
    const forward = rankChallenge(inputs, 'RETURN').map((e) => `${e.participantId}:${e.rank}`);
    const reversed = rankChallenge([...inputs].reverse(), 'RETURN').map(
      (e) => `${e.participantId}:${e.rank}`,
    );
    expect(forward).toEqual(reversed);
    expect(forward).toEqual(['c:1', 'a:2', 'b:3']); // a & b tie on 7; a joined earlier
  });
});

/**
 * Pure, deterministic challenge scoring and ranking. No I/O — ranks are a
 * function of the frozen inputs only, so a leaderboard is fully reproducible.
 *
 * Each challenge uses exactly ONE scoring method; unlike metrics are never
 * blended into a single score:
 *   • RETURN              → higher percentage return wins.
 *   • DRAWDOWN            → lower maximum drawdown wins.
 *   • PREDICTION_ACCURACY → higher direction accuracy wins (no predictions ⇒ last).
 *
 * Tie-break (documented, deterministic): equal scores are ordered by the
 * earliest join time, and if those tie, by participant id ascending. Every
 * entry therefore gets a unique rank.
 */

export type ChallengeScoringMethod = 'RETURN' | 'DRAWDOWN' | 'PREDICTION_ACCURACY';

export interface ScoreInput {
  participantId: string;
  returnPercent: number;
  maxDrawdownPercent: number;
  predictionAccuracyPercent: number | null;
  joinedAt: Date;
}

export interface RankedEntry extends ScoreInput {
  score: number;
  rank: number;
}

/** The single metric a scoring method ranks on. */
export function scoreFor(method: ChallengeScoringMethod, entry: ScoreInput): number {
  switch (method) {
    case 'RETURN':
      return entry.returnPercent;
    case 'DRAWDOWN':
      return entry.maxDrawdownPercent;
    case 'PREDICTION_ACCURACY':
      // No resolved predictions ranks below any real accuracy.
      return entry.predictionAccuracyPercent ?? -1;
  }
}

/** True when a higher score is better for the given method. */
export function higherIsBetter(method: ChallengeScoringMethod): boolean {
  return method !== 'DRAWDOWN';
}

export function rankChallenge(
  entries: ScoreInput[],
  method: ChallengeScoringMethod,
): RankedEntry[] {
  const betterHigher = higherIsBetter(method);

  return entries
    .map((entry) => ({ ...entry, score: scoreFor(method, entry) }))
    .sort((a, b) => {
      if (a.score !== b.score) return betterHigher ? b.score - a.score : a.score - b.score;
      // Tie-break: earliest join first, then participant id ascending.
      const joinDelta = a.joinedAt.getTime() - b.joinedAt.getTime();
      if (joinDelta !== 0) return joinDelta;
      return a.participantId < b.participantId ? -1 : a.participantId > b.participantId ? 1 : 0;
    })
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

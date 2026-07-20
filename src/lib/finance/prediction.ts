/**
 * Pure market-prediction math: derive a target price, evaluate an outcome
 * against actual prices, and summarize accuracy. No I/O, no wall-clock — every
 * result is a function of its inputs, so the resolution and accuracy rules are
 * directly unit-testable.
 *
 * Prices are integer paise; movements/errors are percentages (plain numbers).
 */

export type PredictionDirection = 'UP' | 'DOWN' | 'FLAT';
export type PredictionStatus = 'OPEN' | 'RESOLVED' | 'EXPIRED' | 'CANCELLED';

/** The target price implied by a starting price, a magnitude %, and a direction. */
export function targetPriceFor(
  direction: PredictionDirection,
  startingPricePaise: bigint,
  targetPercentage: number,
): bigint {
  const start = Number(startingPricePaise);
  if (direction === 'UP') return BigInt(Math.round(start * (1 + targetPercentage / 100)));
  if (direction === 'DOWN') return BigInt(Math.round(start * (1 - targetPercentage / 100)));
  return startingPricePaise; // FLAT: target is "stay near the start"
}

export interface PredictionTerms {
  direction: PredictionDirection;
  startingPricePaise: bigint;
  targetPricePaise: bigint;
  /** Magnitude of the predicted move (UP/DOWN) or the flat tolerance band. */
  targetPercentage: number;
  predictionTimestamp: Date;
}

export interface PriceBar {
  timestamp: Date;
  highPaise: bigint;
  lowPaise: bigint;
}

export interface PredictionOutcome {
  actualMovementPercent: number;
  directionCorrect: boolean;
  targetReached: boolean;
  absolutePercentageErrorPercent: number;
  timeToTargetMs: number | null;
}

/**
 * Evaluates a prediction against the ending price and the price bars observed
 * over its life. Direction correctness uses the ending price; target-reached
 * uses whether any bar touched the target (so an intraday spike counts), and
 * time-to-target is the first such touch. Only bars strictly after the
 * prediction instant are considered.
 */
export function evaluatePrediction(
  terms: PredictionTerms,
  endingPricePaise: bigint,
  bars: PriceBar[],
): PredictionOutcome {
  const start = terms.startingPricePaise;
  const actualMovementPercent =
    start === 0n ? 0 : (Number(endingPricePaise - start) / Number(start)) * 100;
  const signedTargetPercent =
    terms.direction === 'UP'
      ? terms.targetPercentage
      : terms.direction === 'DOWN'
        ? -terms.targetPercentage
        : 0;

  const directionCorrect = isDirectionCorrect(terms, actualMovementPercent);
  const touch = firstTargetTouch(terms, bars);

  const targetReached = terms.direction === 'FLAT' ? directionCorrect : touch !== null;
  const timeToTargetMs =
    touch === null ? null : touch.getTime() - terms.predictionTimestamp.getTime();

  return {
    actualMovementPercent,
    directionCorrect,
    targetReached,
    absolutePercentageErrorPercent: Math.abs(actualMovementPercent - signedTargetPercent),
    timeToTargetMs,
  };
}

function isDirectionCorrect(terms: PredictionTerms, actualMovementPercent: number): boolean {
  if (terms.direction === 'UP') return actualMovementPercent > 0;
  if (terms.direction === 'DOWN') return actualMovementPercent < 0;
  return Math.abs(actualMovementPercent) <= terms.targetPercentage; // FLAT band
}

/** Timestamp of the first bar that touches the target price, or null. */
function firstTargetTouch(terms: PredictionTerms, bars: PriceBar[]): Date | null {
  if (terms.direction === 'FLAT') return null;

  const after = bars
    .filter((bar) => bar.timestamp.getTime() > terms.predictionTimestamp.getTime())
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  for (const bar of after) {
    const touched =
      terms.direction === 'UP'
        ? bar.highPaise >= terms.targetPricePaise
        : bar.lowPaise <= terms.targetPricePaise;
    if (touched) return bar.timestamp;
  }
  return null;
}

// ─── Live progress (open predictions) ───────────────────────────────────────

export interface PredictionProgress {
  /** Move from the starting price to the current price, as a percentage. */
  currentMovementPercent: number;
  /**
   * How far the current price has travelled from start toward target, as a
   * percentage: 0 at the start, 100 at the target. Can be negative (moving the
   * wrong way) or above 100 (overshot). For FLAT it's how much of the tolerance
   * band is used (0–100+).
   */
  progressPercent: number;
  /** Is the price currently moving in the predicted direction? */
  directionCorrectNow: boolean;
  /** Has the current price already reached the target (FLAT: still in band)? */
  targetReachedNow: boolean;
}

/** Live standing of an open prediction against the latest price. Pure. */
export function predictionProgress(
  terms: Pick<
    PredictionTerms,
    'direction' | 'startingPricePaise' | 'targetPricePaise' | 'targetPercentage'
  >,
  currentPricePaise: bigint,
): PredictionProgress {
  const start = terms.startingPricePaise;
  const move = start === 0n ? 0 : (Number(currentPricePaise - start) / Number(start)) * 100;

  if (terms.direction === 'FLAT') {
    const withinBand = Math.abs(move) <= terms.targetPercentage;
    const bandUsed = terms.targetPercentage === 0 ? 0 : (Math.abs(move) / terms.targetPercentage) * 100;
    return {
      currentMovementPercent: move,
      progressPercent: bandUsed,
      directionCorrectNow: withinBand,
      targetReachedNow: withinBand,
    };
  }

  const span = terms.targetPricePaise - start;
  return {
    currentMovementPercent: move,
    progressPercent: span === 0n ? 0 : (Number(currentPricePaise - start) / Number(span)) * 100,
    directionCorrectNow:
      terms.direction === 'UP' ? currentPricePaise > start : currentPricePaise < start,
    targetReachedNow:
      terms.direction === 'UP'
        ? currentPricePaise >= terms.targetPricePaise
        : currentPricePaise <= terms.targetPricePaise,
  };
}

// ─── Accuracy ───────────────────────────────────────────────────────────────

export interface PredictionRecord {
  status: PredictionStatus;
  instrumentSymbol: string;
  directionCorrect: boolean | null;
  targetReached: boolean | null;
  durationMs: number;
}

export interface AccuracyBucket {
  key: string;
  label: string;
  total: number;
  directionAccuracyPercent: number | null;
  targetAccuracyPercent: number | null;
}

export interface AccuracySummary {
  total: number;
  directionAccuracyPercent: number | null;
  targetAccuracyPercent: number | null;
  byStock: AccuracyBucket[];
  byDuration: AccuracyBucket[];
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const DURATION_BUCKETS: { key: string; label: string; maxMs: number }[] = [
  { key: 'intraday', label: 'Within a day', maxMs: DAY_MS },
  { key: 'week', label: 'Within a week', maxMs: 7 * DAY_MS },
  { key: 'month', label: 'Within a month', maxMs: 31 * DAY_MS },
  { key: 'long', label: 'Over a month', maxMs: Infinity },
];

/**
 * Aggregates accuracy over predictions. Only RESOLVED predictions count —
 * OPEN, EXPIRED and CANCELLED are excluded, so cancelling never distorts the
 * numbers.
 */
export function summarizeAccuracy(predictions: PredictionRecord[]): AccuracySummary {
  const resolved = predictions.filter((prediction) => prediction.status === 'RESOLVED');

  const byStock = groupAccuracy(resolved, (prediction) => ({
    key: prediction.instrumentSymbol,
    label: prediction.instrumentSymbol,
  }));
  const byDuration = DURATION_BUCKETS.map((bucket) => {
    const inBucket = resolved.filter(
      (prediction) => bucketFor(prediction.durationMs) === bucket.key,
    );
    return { key: bucket.key, label: bucket.label, ...accuracyOf(inBucket) };
  }).filter((bucket) => bucket.total > 0);

  return {
    ...accuracyOf(resolved),
    byStock,
    byDuration,
  };
}

function accuracyOf(records: PredictionRecord[]): {
  total: number;
  directionAccuracyPercent: number | null;
  targetAccuracyPercent: number | null;
} {
  const total = records.length;
  if (total === 0) {
    return { total: 0, directionAccuracyPercent: null, targetAccuracyPercent: null };
  }
  const directionHits = records.filter((record) => record.directionCorrect === true).length;
  const targetHits = records.filter((record) => record.targetReached === true).length;
  return {
    total,
    directionAccuracyPercent: (directionHits / total) * 100,
    targetAccuracyPercent: (targetHits / total) * 100,
  };
}

function groupAccuracy(
  records: PredictionRecord[],
  keyOf: (record: PredictionRecord) => { key: string; label: string },
): AccuracyBucket[] {
  const groups = new Map<string, { label: string; records: PredictionRecord[] }>();
  for (const record of records) {
    const { key, label } = keyOf(record);
    const group = groups.get(key) ?? { label, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .map(([key, group]) => ({ key, label: group.label, ...accuracyOf(group.records) }))
    .sort((a, b) => b.total - a.total);
}

function bucketFor(durationMs: number): string {
  return DURATION_BUCKETS.find((bucket) => durationMs <= bucket.maxMs)?.key ?? 'long';
}

// ─── Streaks & badges ────────────────────────────────────────────────────────

export interface StreakBadge {
  key: string;
  label: string;
  threshold: number;
}

export interface PredictionStreak {
  /** Length of the run of consecutive days ending today/yesterday, else 0. */
  current: number;
  /** Longest run of consecutive days ever recorded. */
  longest: number;
  earnedBadges: StreakBadge[];
  /** The next badge to aim for, or null once all are earned. */
  nextBadge: StreakBadge | null;
}

const STREAK_BADGES: StreakBadge[] = [
  { key: 'spark', label: 'On a roll (3 days)', threshold: 3 },
  { key: 'sharp', label: 'Sharp week (7 days)', threshold: 7 },
  { key: 'fortnight', label: 'Two-week read (14 days)', threshold: 14 },
  { key: 'oracle', label: 'Oracle (30 days)', threshold: 30 },
];

/**
 * A prediction "streak" is consecutive IST calendar days each having at least
 * one correct resolved prediction. Pure: `today` is passed in (the IST day key of
 * "now"), so there's no hidden clock. Badges are fixed thresholds on the longest
 * run, so once earned they stay earned.
 */
export function computePredictionStreak(
  resolved: { day: string; correct: boolean }[],
  today: string,
): PredictionStreak {
  const hitDays = [...new Set(resolved.filter((r) => r.correct).map((r) => r.day))].sort();

  let longest = 0;
  let run = 0;
  let previous: string | null = null;
  for (const day of hitDays) {
    run = previous !== null && dayDiff(previous, day) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }

  // Current streak: only "live" if the most recent hit was today or yesterday.
  let current = 0;
  const last = hitDays.at(-1);
  if (last && dayDiff(last, today) <= 1) {
    current = 1;
    for (let i = hitDays.length - 2; i >= 0; i -= 1) {
      if (dayDiff(hitDays[i], hitDays[i + 1]) !== 1) break;
      current += 1;
    }
  }

  const earnedBadges = STREAK_BADGES.filter((badge) => longest >= badge.threshold);
  return {
    current,
    longest,
    earnedBadges,
    nextBadge: STREAK_BADGES.find((badge) => longest < badge.threshold) ?? null,
  };
}

/** Whole days between two "YYYY-MM-DD" IST day keys (b − a). */
function dayDiff(a: string, b: string): number {
  const start = Date.parse(`${a}T00:00:00Z`);
  const end = Date.parse(`${b}T00:00:00Z`);
  return Math.round((end - start) / DAY_MS);
}

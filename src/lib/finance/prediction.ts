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
  startingPricePaise: number,
  targetPercentage: number,
): number {
  if (direction === 'UP') return Math.round(startingPricePaise * (1 + targetPercentage / 100));
  if (direction === 'DOWN') return Math.round(startingPricePaise * (1 - targetPercentage / 100));
  return startingPricePaise; // FLAT: target is "stay near the start"
}

export interface PredictionTerms {
  direction: PredictionDirection;
  startingPricePaise: number;
  targetPricePaise: number;
  /** Magnitude of the predicted move (UP/DOWN) or the flat tolerance band. */
  targetPercentage: number;
  predictionTimestamp: Date;
}

export interface PriceBar {
  timestamp: Date;
  highPaise: number;
  lowPaise: number;
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
  endingPricePaise: number,
  bars: PriceBar[],
): PredictionOutcome {
  const start = terms.startingPricePaise;
  const actualMovementPercent = start === 0 ? 0 : ((endingPricePaise - start) / start) * 100;
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

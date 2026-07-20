/**
 * Pure candle-based execution policy for pending LIMIT and STOP_LOSS orders.
 * No I/O — given an order and the candles observed since it was placed, it
 * decides what should happen. This is the single, testable home of the
 * documented assumptions below.
 *
 * ── Candle assumptions ──────────────────────────────────────────────────────
 * • A candle "reaches" a price if that price lies within its [low, high] range
 *   (intra-candle touch), so a wick through the level counts.
 * • Only candles strictly AFTER the order's placement are considered — a candle
 *   at or before submission never fills it.
 * • Gaps are honoured: if a candle opens beyond the target (the market gapped
 *   through it), the fill uses the OPEN, which may be better (limits) or worse
 *   (stops) than the target. Otherwise the fill uses the target price.
 *
 * ── LIMIT ───────────────────────────────────────────────────────────────────
 * • BUY:  triggers when low ≤ limit; fills at min(open, limit).
 * • SELL: triggers when high ≥ limit; fills at max(open, limit).
 * • Limits trigger and fill within the same candle.
 *
 * ── STOP_LOSS (sell only) ─────────────────────────────────────────────────────
 * • Triggers when low ≤ stop. It then becomes a market order and executes at
 *   the NEXT eligible candle's open (the "next eligible simulated price"). If no
 *   later candle exists yet, it stays TRIGGERED and executes on a later advance.
 *
 * ── Expiry ───────────────────────────────────────────────────────────────────
 * • If the trigger has not occurred by the expiry time, the order EXPIRES.
 *
 * Partial fills are NOT implemented: an order fills its full quantity or is
 * rejected at execution (see executePendingOrder). PARTIALLY_FILLED is never set.
 */

export type PendingOrderType = 'LIMIT' | 'STOP_LOSS';
export type PendingOrderSide = 'BUY' | 'SELL';
export type PendingOrderStatus = 'PENDING' | 'TRIGGERED';

export interface PendingOrderTerms {
  orderType: PendingOrderType;
  side: PendingOrderSide;
  status: PendingOrderStatus;
  limitPricePaise: bigint | null;
  stopPricePaise: bigint | null;
  /** When the order was placed (simulation time); candles at or before are ignored. */
  submissionTimestamp: Date;
  triggeredAt: Date | null;
  expiryTimestamp: Date | null;
}

export interface Candle {
  timestamp: Date;
  openPaise: bigint;
  highPaise: bigint;
  lowPaise: bigint;
}

export type PendingOrderDecision =
  | { kind: 'FILL'; pricePaise: bigint; triggeredAt: Date; executedAt: Date }
  | { kind: 'TRIGGER'; triggeredAt: Date }
  | { kind: 'EXPIRE' }
  | { kind: 'NONE' };

/**
 * Decides what should happen to a pending order given the candles available up
 * to the current simulation time `now`. Candles must be ascending by timestamp.
 */
export function evaluatePendingOrder(
  terms: PendingOrderTerms,
  candles: Candle[],
  now: Date,
): PendingOrderDecision {
  const nowMs = now.getTime();
  const expiryMs = terms.expiryTimestamp?.getTime() ?? Infinity;
  const triggerDeadlineMs = Math.min(nowMs, expiryMs);

  // Candles strictly after submission and no later than "now", ascending.
  const observed = candles
    .filter((candle) => candle.timestamp.getTime() > terms.submissionTimestamp.getTime())
    .filter((candle) => candle.timestamp.getTime() <= nowMs)
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  if (terms.orderType === 'LIMIT') {
    const limit = terms.limitPricePaise;
    if (limit === null) return { kind: 'NONE' };

    const hit = observed.find(
      (candle) =>
        candle.timestamp.getTime() <= triggerDeadlineMs &&
        (terms.side === 'BUY' ? candle.lowPaise <= limit : candle.highPaise >= limit),
    );
    if (hit) {
      const pricePaise =
        terms.side === 'BUY'
          ? hit.openPaise < limit
            ? hit.openPaise
            : limit
          : hit.openPaise > limit
            ? hit.openPaise
            : limit;
      return { kind: 'FILL', pricePaise, triggeredAt: hit.timestamp, executedAt: hit.timestamp };
    }
    return expiredBy(nowMs, expiryMs) ? { kind: 'EXPIRE' } : { kind: 'NONE' };
  }

  // STOP_LOSS (sell). Two phases: trigger, then execute at the next candle open.
  const stop = terms.stopPricePaise;
  if (stop === null) return { kind: 'NONE' };

  let triggeredAt = terms.status === 'TRIGGERED' ? terms.triggeredAt : null;
  if (triggeredAt === null) {
    const trigger = observed.find(
      (candle) => candle.timestamp.getTime() <= triggerDeadlineMs && candle.lowPaise <= stop,
    );
    if (!trigger) {
      return expiredBy(nowMs, expiryMs) ? { kind: 'EXPIRE' } : { kind: 'NONE' };
    }
    triggeredAt = trigger.timestamp;
  }

  const executionCandle = observed.find(
    (candle) => candle.timestamp.getTime() > triggeredAt!.getTime(),
  );
  if (executionCandle) {
    return {
      kind: 'FILL',
      pricePaise: executionCandle.openPaise,
      triggeredAt,
      executedAt: executionCandle.timestamp,
    };
  }
  // Triggered, but no later candle to execute against yet.
  return { kind: 'TRIGGER', triggeredAt };
}

function expiredBy(nowMs: number, expiryMs: number): boolean {
  return expiryMs <= nowMs;
}

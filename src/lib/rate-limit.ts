/**
 * A minimal token-bucket rate limiter. Pure except for `Date.now()` (injectable
 * for tests): every key gets a bucket that refills continuously, so it allows
 * short bursts up to `capacity` and a steady `refillPerSec` thereafter.
 *
 * ponytail: in-memory, per-process — correct for a single Node instance (this
 * app runs one Next server behind nginx). Move the store to Redis/KV before
 * running multiple instances or on edge, where this Map neither persists nor
 * shares. This is the "in-memory first" step called for in the roadmap.
 */

export interface RateLimit {
  /** Maximum tokens (burst size). */
  capacity: number;
  /** Tokens replenished per second once below capacity. */
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

// Bound the store so the limiter itself can't be turned into a memory-exhaustion
// vector by an attacker rotating keys; idle buckets are reclaimed past this size.
const MAX_TRACKED = 20_000;

const buckets = new Map<string, Bucket>();

function refilledTokens(bucket: Bucket, limit: RateLimit, now: number): number {
  const elapsedSec = Math.max(0, now - bucket.updatedAt) / 1000;
  return Math.min(limit.capacity, bucket.tokens + elapsedSec * limit.refillPerSec);
}

/**
 * Attempts to spend one token for `key`. Returns true if allowed, false if the
 * bucket is empty (i.e. the caller is over the limit).
 */
export function consumeToken(key: string, limit: RateLimit, now: number = Date.now()): boolean {
  const existing = buckets.get(key);
  const tokens = existing ? refilledTokens(existing, limit, now) : limit.capacity;

  if (tokens < 1) {
    buckets.set(key, { tokens, updatedAt: now });
    return false;
  }

  buckets.set(key, { tokens: tokens - 1, updatedAt: now });
  if (buckets.size > MAX_TRACKED) evictIdle(limit, now);
  return true;
}

/** Drops buckets that have refilled to capacity — an idle key carries no state. */
function evictIdle(limit: RateLimit, now: number): void {
  for (const [key, bucket] of buckets) {
    if (refilledTokens(bucket, limit, now) >= limit.capacity) buckets.delete(key);
  }
}

/** Test-only: clear all buckets so cases don't leak state into each other. */
export function _resetRateLimiter(): void {
  buckets.clear();
}

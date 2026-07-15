/**
 * Deterministic intraday price path for the live (synthetic) market feed.
 *
 * Given the last real close and the NSE-session seconds elapsed since it,
 * `livePricePaise` returns "where the price is now": a smooth multi-octave
 * value-noise walk that drifts both up and down and stays within a realistic
 * band around the anchor. It is pure and seedable, so the same instant always
 * yields the same price (reloads never flicker), and it needs no ticker
 * process — the price is simply a function of elapsed market time.
 */

// ponytail: single volatility knob. Higher = livelier swings. ~0.012 gives
// roughly ±1–2% of intraday movement for a typical stock; raise it for a
// punchier demo.
const VOLATILITY = 0.012;

const OCTAVES = [
  { periodSeconds: 21_600, amplitude: 1.0 }, // ~6h slow drift
  { periodSeconds: 2_400, amplitude: 0.55 }, // ~40m swings
  { periodSeconds: 420, amplitude: 0.3 }, // ~7m moves
  { periodSeconds: 75, amplitude: 0.15 }, // ~75s tick jitter
];

const MAX_PAISE = 2_147_483_647;

/** Stable per-instrument seed (FNV-1a) so each stock has its own price path. */
export function seedFromId(id: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i += 1) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function livePricePaise(seed: number, baseClosePaise: number, deltaSeconds: number): number {
  if (deltaSeconds <= 0) return baseClosePaise;
  const price = Math.round(baseClosePaise * Math.exp(VOLATILITY * walk(seed, deltaSeconds)));
  return Math.min(MAX_PAISE, Math.max(1, price));
}

/** Sum of value-noise octaves, anchored to exactly 0 at t = 0. */
function walk(seed: number, t: number): number {
  let value = 0;
  OCTAVES.forEach((octave, index) => {
    const octaveSeed = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
    value +=
      octave.amplitude *
      (valueNoise(octaveSeed, t / octave.periodSeconds) - valueNoise(octaveSeed, 0));
  });
  return value;
}

/** Smoothly-interpolated value noise in [-1, 1]. */
function valueNoise(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const smooth = f * f * (3 - 2 * f);
  const a = hashUnit(seed, i) * 2 - 1;
  const b = hashUnit(seed, i + 1) * 2 - 1;
  return a + (b - a) * smooth;
}

/** Deterministic hash of (seed, n) → [0, 1). */
function hashUnit(seed: number, n: number): number {
  let h = (seed ^ Math.imul(n | 0, 0x9e3779b9)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

/**
 * Pure simulation-clock advancement. No I/O, no wall-clock — given the current
 * simulation time it computes the next time deterministically, so replaying the
 * same steps always lands on the same instants.
 */

export type AdvanceStep = 'MINUTE' | 'HOUR' | 'TRADING_DAY' | 'WEEK' | 'CUSTOM';

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
// IST is a fixed UTC+5:30 offset (no daylight saving), so weekend detection is exact.
const IST_OFFSET_MS = 5 * HOUR_MS + 30 * MINUTE_MS;

export interface AdvanceResult {
  timestamp: Date;
  completed: boolean;
}

/**
 * Advances `current` by one step, clamped to `[current, end]`. The clock only
 * moves forward: a CUSTOM target at or before `current` is ignored (stays put),
 * and any step past `end` stops exactly at `end` and marks the run completed.
 */
export function advanceSimulationTime(
  current: Date,
  end: Date,
  step: AdvanceStep,
  customTimestamp?: Date | null,
): AdvanceResult {
  const proposed = proposedTime(current, step, customTimestamp);
  // Never rewind.
  const forward = proposed.getTime() < current.getTime() ? current : proposed;
  const clamped = forward.getTime() >= end.getTime() ? end : forward;
  return { timestamp: clamped, completed: clamped.getTime() >= end.getTime() };
}

function proposedTime(current: Date, step: AdvanceStep, customTimestamp?: Date | null): Date {
  switch (step) {
    case 'MINUTE':
      return new Date(current.getTime() + MINUTE_MS);
    case 'HOUR':
      return new Date(current.getTime() + HOUR_MS);
    case 'WEEK':
      return new Date(current.getTime() + 7 * DAY_MS);
    case 'TRADING_DAY':
      return nextTradingDay(current);
    case 'CUSTOM':
      if (!customTimestamp) throw new Error('A custom timestamp is required for a CUSTOM step');
      return customTimestamp;
  }
}

/**
 * One calendar day forward, skipping Saturday and Sunday in IST. Public
 * holidays are not modelled (ponytail: valuation always uses the last price at
 * or before the clock, so landing on a holiday still shows the right value; add
 * a holiday calendar if step accuracy ever matters).
 */
function nextTradingDay(current: Date): Date {
  let candidate = new Date(current.getTime() + DAY_MS);
  while (isWeekendInIST(candidate)) {
    candidate = new Date(candidate.getTime() + DAY_MS);
  }
  return candidate;
}

function isWeekendInIST(date: Date): boolean {
  const istWeekday = new Date(date.getTime() + IST_OFFSET_MS).getUTCDay();
  return istWeekday === 0 || istWeekday === 6; // Sunday or Saturday
}

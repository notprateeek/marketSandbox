/**
 * NSE trading-session helpers, in India Standard Time (UTC+05:30, no DST).
 * Regular equity session is 09:15–15:30 IST, Monday–Friday.
 *
 * ponytail: no exchange-holiday calendar — weekends only. Add a holiday set
 * here if holiday-accurate freezing ever matters.
 */

const IST_OFFSET_MS = (5 * 60 + 30) * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const OPEN_SECOND = (9 * 60 + 15) * 60; // 09:15 IST, seconds from IST midnight
const CLOSE_SECOND = (15 * 60 + 30) * 60; // 15:30 IST

/** Seconds in one full NSE session (09:15–15:30). */
export const SESSION_SECONDS = CLOSE_SECOND - OPEN_SECOND;

/** IST calendar day index (days since 1970-01-01 IST) for an instant. */
function istDayIndex(at: Date): number {
  return Math.floor((at.getTime() + IST_OFFSET_MS) / DAY_MS);
}

// 1970-01-01 (day index 0) was a Thursday, whose getUTCDay() is 4.
function weekdayOf(dayIndex: number): number {
  return (((dayIndex + 4) % 7) + 7) % 7;
}

function isWeekend(weekday: number): boolean {
  return weekday === 0 || weekday === 6;
}

export function isMarketOpen(at: Date = new Date()): boolean {
  const dayIndex = istDayIndex(at);
  if (isWeekend(weekdayOf(dayIndex))) return false;
  const secondOfDay = (at.getTime() + IST_OFFSET_MS - dayIndex * DAY_MS) / 1000;
  return secondOfDay >= OPEN_SECOND && secondOfDay < CLOSE_SECOND;
}

/**
 * Total NSE session seconds elapsed within the half-open interval (from, to].
 * Counts only time inside weekday 09:15–15:30 IST windows, so it freezes
 * overnight and on weekends. Returns 0 when from >= to.
 */
export function marketSecondsBetween(from: Date, to: Date): number {
  const start = from.getTime();
  const end = to.getTime();
  if (start >= end) return 0;

  let seconds = 0;
  for (let day = istDayIndex(from); day <= istDayIndex(to); day += 1) {
    if (isWeekend(weekdayOf(day))) continue;
    const istMidnightUtc = day * DAY_MS - IST_OFFSET_MS;
    const overlapStart = Math.max(start, istMidnightUtc + OPEN_SECOND * 1000);
    const overlapEnd = Math.min(end, istMidnightUtc + CLOSE_SECOND * 1000);
    if (overlapEnd > overlapStart) seconds += (overlapEnd - overlapStart) / 1000;
  }
  return Math.floor(seconds);
}

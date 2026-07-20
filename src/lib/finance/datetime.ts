/**
 * Date/time formatter for Indian Standard Time (Asia/Kolkata).
 * All formatting uses the IST timezone regardless of the user's locale.
 */

const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Formats a Date object in IST with customizable options.
 *
 * @example
 * formatIST(new Date())
 * // "14/7/2026, 12:30:00 pm"
 *
 * formatIST(new Date(), { dateStyle: 'long', timeStyle: 'short' })
 * // "14 July 2026 at 12:30 pm"
 */
export function formatIST(date: Date, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TIMEZONE,
    ...options,
  }).format(date);
}

/**
 * Formats a Date as a short date string in IST.
 *
 * @example
 * formatISTDate(new Date()) // "14 Jul 2026"
 */
export function formatISTDate(date: Date): string {
  return formatIST(date, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Formats a Date as a time string in IST.
 *
 * @example
 * formatISTTime(new Date()) // "12:30:00 pm"
 */
export function formatISTTime(date: Date): string {
  return formatIST(date, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

/**
 * Formats a Date as a full datetime string in IST.
 *
 * @example
 * formatISTDateTime(new Date()) // "14 Jul 2026, 12:30 pm"
 */
export function formatISTDateTime(date: Date): string {
  return formatIST(date, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Formats a Date as an IST `<input type="datetime-local">` value
 * ("YYYY-MM-DDTHH:mm"), so pickers show market time regardless of the
 * browser's timezone.
 */
export function toISTInputValue(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

const istDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The IST calendar day of a Date as an ISO "YYYY-MM-DD" string. */
export function istDayKey(date: Date): string {
  return istDayFormatter.format(date);
}

/** The instant of IST midnight (00:00 +05:30) that starts `date`'s IST day. */
export function istDayStart(date: Date): Date {
  return new Date(`${istDayKey(date)}T00:00:00+05:30`);
}

/**
 * Parses an IST `datetime-local` value ("YYYY-MM-DDTHH:mm") back into a Date,
 * interpreting it as IST (+05:30). Returns null on malformed input.
 */
export function parseISTInputValue(value: string): Date | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(:\d{2})?$/.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T${match[2]}${match[3] ?? ':00'}+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

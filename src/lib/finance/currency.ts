/**
 * Indian currency formatter using Intl.NumberFormat.
 * Formats numbers in the Indian numbering system with ₹ symbol.
 *
 * Money is stored and computed as integer paise in `bigint` (Postgres int8), so
 * per-value amounts are bounded only by int8 (~₹9.2 × 10¹⁶), not the old 32-bit
 * cap. Formatters convert to a `number` of rupees purely for display.
 *
 * @example
 * formatINR(50000)    // "₹50,000.00"
 * formatINR(1234567)  // "₹12,34,567.00"
 * formatINR(-500)     // "-₹500.00"
 */

/** Signed 64-bit integer bounds — the real per-value paise range on Postgres. */
export const MAX_PAISE = 9_223_372_036_854_775_807n;
export const MIN_PAISE = -9_223_372_036_854_775_808n;

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(amount: number): string {
  return inrFormatter.format(amount);
}

export function formatPaise(paise: bigint): string {
  return formatINR(Number(paise) / 100);
}

/**
 * Formats paise with an explicit gain/loss sign, e.g. "+₹500.00" / "-₹500.00".
 * Use for profit & loss figures where the direction matters.
 */
export function formatSignedPaise(paise: bigint): string {
  return `${paise >= 0n ? '+' : '-'}${formatPaise(paise < 0n ? -paise : paise)}`;
}

/**
 * Parses a rupee amount string ("1234.56") into integer paise. Rejects anything
 * that is not a positive amount within the int8 storage range.
 */
export function parsePriceToPaise(value: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());

  if (!match) {
    throw new Error(`Invalid price: ${value}`);
  }

  const paise = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));

  if (paise <= 0n || paise > MAX_PAISE) {
    throw new RangeError(`Price is outside the supported range: ${value}`);
  }

  return paise;
}

/**
 * Formats a number as a compact INR value.
 *
 * @example
 * formatINRCompact(50000)     // "₹50K"
 * formatINRCompact(1234567)   // "₹12L"
 */
const inrCompactFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatINRCompact(amount: number): string {
  return inrCompactFormatter.format(amount);
}

/**
 * Formats a percentage value with sign indicator.
 *
 * @example
 * formatPercentage(5.25)   // "+5.25%"
 * formatPercentage(-2.1)   // "-2.10%"
 */
export function formatPercentage(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

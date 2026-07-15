/**
 * Indian currency formatter using Intl.NumberFormat.
 * Formats numbers in the Indian numbering system with ₹ symbol.
 *
 * @example
 * formatINR(50000)    // "₹50,000.00"
 * formatINR(1234567)  // "₹12,34,567.00"
 * formatINR(-500)     // "-₹500.00"
 */

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatINR(amount: number): string {
  return inrFormatter.format(amount);
}

export function formatPaise(paise: number): string {
  return formatINR(paise / 100);
}

/**
 * Formats paise with an explicit gain/loss sign, e.g. "+₹500.00" / "-₹500.00".
 * Use for profit & loss figures where the direction matters.
 */
export function formatSignedPaise(paise: number): string {
  return `${paise >= 0 ? '+' : '-'}${formatPaise(Math.abs(paise))}`;
}

const MAX_DATABASE_INT = BigInt(2_147_483_647);

export function parsePriceToPaise(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());

  if (!match) {
    throw new Error(`Invalid price: ${value}`);
  }

  const paise = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? '').padEnd(2, '0'));

  if (paise <= BigInt(0) || paise > MAX_DATABASE_INT) {
    throw new RangeError(`Price is outside the supported range: ${value}`);
  }

  return Number(paise);
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

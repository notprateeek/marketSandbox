/**
 * Pure portfolio valuation math. No database, no React, no I/O — every input
 * is supplied by the caller so this module is trivially unit-testable and is
 * the single source of truth for portfolio numbers (nothing here is duplicated
 * in components).
 *
 * All money is in integer paise. Percentages are returned as plain numbers, or
 * `null` when the denominator is zero (never Infinity or NaN).
 */

export type PriceStatus = 'OK' | 'STALE' | 'MISSING';

/** One open holding (quantity > 0) with its resolved valuation price. */
export interface PositionInput {
  instrumentId: string;
  symbol: string;
  companyName: string;
  quantity: number;
  averageBuyPricePaise: bigint;
  /** Remaining cost basis of the shares still held. */
  totalCostPaise: bigint;
  /** Latest price at or before the valuation timestamp; null when unavailable. */
  currentPricePaise: bigint | null;
  priceTimestamp: Date | null;
  priceStatus: PriceStatus;
}

export interface PortfolioInput {
  startingBalancePaise: bigint;
  availableCashPaise: bigint;
  /** Total realized P&L across all positions, including fully-closed ones. */
  realizedPnlPaise: bigint;
  /** Open holdings only. Closed positions contribute solely to realizedPnlPaise. */
  positions: PositionInput[];
}

export interface HoldingValuation extends PositionInput {
  /** quantity × currentPrice; null when the price is missing. */
  marketValuePaise: bigint | null;
  /** marketValue − remaining cost basis; null when the price is missing. */
  unrealizedPnlPaise: bigint | null;
  /** unrealized P&L ÷ remaining cost basis × 100; null on a zero denominator. */
  returnPercent: number | null;
  /** Share of total portfolio value; null when portfolio value is zero. */
  allocationPercent: number | null;
}

export interface PortfolioSummary {
  startingBalancePaise: bigint;
  availableCashPaise: bigint;
  /** Sum of remaining cost basis across open holdings (price-independent). */
  investedValuePaise: bigint;
  /** Sum of priced holding market values. */
  holdingsValuePaise: bigint;
  /** availableCash + holdingsValue. */
  portfolioValuePaise: bigint;
  realizedPnlPaise: bigint;
  unrealizedPnlPaise: bigint;
  /** portfolioValue − startingBalance. */
  totalPnlPaise: bigint;
  totalReturnPercent: number | null;
  unrealizedReturnPercent: number | null;
  cashAllocationPercent: number | null;
  holdings: HoldingValuation[];
  best: HoldingValuation | null;
  worst: HoldingValuation | null;
  largestAllocation: HoldingValuation | null;
  pricedCount: number;
  missingPriceCount: number;
  stalePriceCount: number;
  /** True when at least one holding has no usable price — totals are partial. */
  hasPricingGaps: boolean;
  /** Freshest price timestamp actually used to value the portfolio. */
  priceDataTimestamp: Date | null;
}

/**
 * Percentage, or null when the denominator is zero (never Infinity/NaN). The
 * ratio is computed in floating point — paise (bigint) are the only place money
 * leaves integer arithmetic, and a percentage never needs int8 precision.
 */
export function percentageOrNull(numerator: bigint, denominator: bigint): number | null {
  return denominator === 0n ? null : (Number(numerator) / Number(denominator)) * 100;
}

export function calculatePortfolio(input: PortfolioInput): PortfolioSummary {
  const priced = input.positions.filter(isPriced);

  const holdingsValuePaise = sum(
    priced.map((position) => BigInt(position.quantity) * position.currentPricePaise),
  );
  const portfolioValuePaise = input.availableCashPaise + holdingsValuePaise;
  const investedValuePaise = sum(input.positions.map((position) => position.totalCostPaise));
  const pricedCostBasisPaise = sum(priced.map((position) => position.totalCostPaise));
  const unrealizedPnlPaise = holdingsValuePaise - pricedCostBasisPaise;
  const totalPnlPaise = portfolioValuePaise - input.startingBalancePaise;

  const holdings = input.positions.map((position) => valueHolding(position, portfolioValuePaise));
  const rankable = holdings.filter((holding) => holding.returnPercent !== null);

  return {
    startingBalancePaise: input.startingBalancePaise,
    availableCashPaise: input.availableCashPaise,
    investedValuePaise,
    holdingsValuePaise,
    portfolioValuePaise,
    realizedPnlPaise: input.realizedPnlPaise,
    unrealizedPnlPaise,
    totalPnlPaise,
    totalReturnPercent: percentageOrNull(totalPnlPaise, input.startingBalancePaise),
    unrealizedReturnPercent: percentageOrNull(unrealizedPnlPaise, pricedCostBasisPaise),
    cashAllocationPercent: percentageOrNull(input.availableCashPaise, portfolioValuePaise),
    holdings,
    best: pickBy(rankable, (a, b) => b.returnPercent! - a.returnPercent!),
    worst: pickBy(rankable, (a, b) => a.returnPercent! - b.returnPercent!),
    largestAllocation: pickBy(holdings.filter(isValued), (a, b) =>
      Number(b.marketValuePaise! - a.marketValuePaise!),
    ),
    pricedCount: priced.length,
    missingPriceCount: input.positions.filter((position) => position.priceStatus === 'MISSING')
      .length,
    stalePriceCount: input.positions.filter((position) => position.priceStatus === 'STALE').length,
    hasPricingGaps: input.positions.some((position) => !isPriced(position)),
    priceDataTimestamp: latestTimestamp(priced),
  };
}

function valueHolding(position: PositionInput, portfolioValuePaise: bigint): HoldingValuation {
  if (!isPriced(position)) {
    return {
      ...position,
      marketValuePaise: null,
      unrealizedPnlPaise: null,
      returnPercent: null,
      allocationPercent: null,
    };
  }

  const marketValuePaise = BigInt(position.quantity) * position.currentPricePaise;
  const unrealizedPnlPaise = marketValuePaise - position.totalCostPaise;

  return {
    ...position,
    marketValuePaise,
    unrealizedPnlPaise,
    returnPercent: percentageOrNull(unrealizedPnlPaise, position.totalCostPaise),
    allocationPercent: percentageOrNull(marketValuePaise, portfolioValuePaise),
  };
}

type PricedPosition = PositionInput & { currentPricePaise: bigint };

function isPriced(position: PositionInput): position is PricedPosition {
  return position.currentPricePaise !== null && position.priceStatus !== 'MISSING';
}

function isValued(
  holding: HoldingValuation,
): holding is HoldingValuation & { marketValuePaise: bigint } {
  return holding.marketValuePaise !== null;
}

function sum(values: bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

function pickBy<T>(items: T[], compare: (a: T, b: T) => number): T | null {
  return items.length === 0 ? null : [...items].sort(compare)[0];
}

function latestTimestamp(positions: PositionInput[]): Date | null {
  const times = positions
    .map((position) => position.priceTimestamp)
    .filter((timestamp): timestamp is Date => timestamp !== null);
  return times.length === 0 ? null : new Date(Math.max(...times.map((time) => time.getTime())));
}

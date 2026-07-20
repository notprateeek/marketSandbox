import {
  calculatePortfolio,
  type PortfolioSummary,
  type PositionInput,
  type PriceStatus,
} from '@/lib/finance/portfolio';
import type { PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import {
  marketDataProvider,
  type MarketDataProvider,
  type MarketPrice,
} from '@/server/market-data';
import { getActiveAccountId } from '@/server/services/accounts';

// ponytail: a holding whose latest candle lags the freshest holding by more
// than this is flagged STALE. One day suits daily/minute NSE candles; widen it
// if a market's data cadence is slower.
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;

export interface PortfolioView extends PortfolioSummary {
  account: { name: string; status: string };
  /** The "as of" instant used to pick prices — never a future price is used. */
  valuationTimestamp: Date;
}

export interface LoadPortfolioOptions {
  valuationTimestamp?: Date;
  staleAfterMs?: number;
}

const ACCOUNT_SELECT = {
  name: true,
  status: true,
  startingBalancePaise: true,
  availableCashPaise: true,
  positions: {
    select: {
      instrumentId: true,
      quantity: true,
      averageBuyPricePaise: true,
      totalCostPaise: true,
      realizedPnlPaise: true,
      instrument: { select: { symbol: true, companyName: true } },
    },
  },
} as const;

type LoadedAccount = {
  name: string;
  status: string;
  startingBalancePaise: bigint;
  availableCashPaise: bigint;
  positions: {
    instrumentId: string;
    quantity: number;
    averageBuyPricePaise: bigint;
    totalCostPaise: bigint;
    realizedPnlPaise: bigint;
    instrument: { symbol: string; companyName: string };
  }[];
};

/**
 * Values the user's active portfolio at (or before) the valuation timestamp.
 * Returns null when the user has no open portfolio.
 */
export async function loadPortfolioSummary(
  userId: string,
  options: LoadPortfolioOptions = {},
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
): Promise<PortfolioView | null> {
  const accountId = await getActiveAccountId(userId, database);
  if (!accountId) return null;

  const account = await database.virtualAccount.findUnique({
    where: { id: accountId },
    select: ACCOUNT_SELECT,
  });
  return account ? summarizeAccount(account, options, prices) : null;
}

/**
 * Values a specific virtual account (e.g. a simulation account) at (or before)
 * the valuation timestamp. Returns null when the account does not exist.
 */
export async function loadPortfolioForAccount(
  virtualAccountId: string,
  options: LoadPortfolioOptions = {},
  database: PrismaClient = prisma,
  prices: MarketDataProvider = marketDataProvider,
): Promise<PortfolioView | null> {
  const account = await database.virtualAccount.findUnique({
    where: { id: virtualAccountId },
    select: ACCOUNT_SELECT,
  });
  return account ? summarizeAccount(account, options, prices) : null;
}

async function summarizeAccount(
  account: LoadedAccount,
  options: LoadPortfolioOptions,
  prices: MarketDataProvider,
): Promise<PortfolioView> {
  const valuationTimestamp = options.valuationTimestamp ?? new Date();
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  // Realized P&L spans every position, including fully-closed ones (quantity 0);
  // only open positions are valued as holdings.
  const realizedPnlPaise = account.positions.reduce(
    (total, position) => total + position.realizedPnlPaise,
    0n,
  );
  const openPositions = account.positions.filter((position) => position.quantity > 0);

  const resolved = await Promise.all(
    openPositions.map(async (position) => ({
      position,
      price: await prices.getPriceAt(position.instrumentId, valuationTimestamp),
    })),
  );

  // Freshest price actually used — staleness is measured relative to this.
  const referenceTime = resolved.reduce(
    (latest, { price }) => (price ? Math.max(latest, price.timestamp.getTime()) : latest),
    0,
  );

  const positions: PositionInput[] = resolved.map(({ position, price }) => ({
    instrumentId: position.instrumentId,
    symbol: position.instrument.symbol,
    companyName: position.instrument.companyName,
    quantity: position.quantity,
    averageBuyPricePaise: position.averageBuyPricePaise,
    totalCostPaise: position.totalCostPaise,
    currentPricePaise: price?.pricePaise ?? null,
    priceTimestamp: price?.timestamp ?? null,
    priceStatus: priceStatusFor(price, referenceTime, staleAfterMs),
  }));

  const summary = calculatePortfolio({
    startingBalancePaise: account.startingBalancePaise,
    availableCashPaise: account.availableCashPaise,
    realizedPnlPaise,
    positions,
  });

  return {
    ...summary,
    account: { name: account.name, status: account.status },
    valuationTimestamp,
  };
}

function priceStatusFor(
  price: MarketPrice | null,
  referenceTime: number,
  staleAfterMs: number,
): PriceStatus {
  if (!price) return 'MISSING';
  return referenceTime - price.timestamp.getTime() > staleAfterMs ? 'STALE' : 'OK';
}

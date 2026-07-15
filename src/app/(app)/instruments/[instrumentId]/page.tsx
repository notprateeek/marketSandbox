import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { HistoricalPriceChart } from '@/features/market-data/components/HistoricalPriceChart';
import { PriceSummary } from '@/features/market-data/components/PriceSummary';
import { PriceUnavailable } from '@/features/market-data/components/PriceUnavailable';
import { TradeTicket } from '@/features/trading/components/TradeTicket';
import { prisma } from '@/lib/prisma';
import { getActiveAccountId } from '@/server/services/accounts';
import {
  CandleInterval,
  MarketDataUnavailableError,
  marketDataProvider,
} from '@/server/market-data';

export const metadata: Metadata = {
  title: 'Instrument details',
};

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

export default async function InstrumentDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ instrumentId: string }>;
  searchParams: Promise<{ interval?: string | string[] }>;
}) {
  const [{ instrumentId }, resolvedSearchParams, session] = await Promise.all([
    params,
    searchParams,
    auth(),
  ]);
  if (!session?.user?.id) redirect('/sign-in');

  const requestedInterval = firstValue(resolvedSearchParams.interval);
  const interval =
    requestedInterval === CandleInterval.ONE_MINUTE
      ? CandleInterval.ONE_MINUTE
      : CandleInterval.ONE_DAY;
  const activeAccountId = await getActiveAccountId(session.user.id);
  const [instrument, latestPrice, account] = await Promise.all([
    marketDataProvider.getInstrument(instrumentId),
    getLatestPriceOrNull(instrumentId),
    activeAccountId
      ? prisma.virtualAccount.findUnique({
          where: { id: activeAccountId },
          select: {
            availableCashPaise: true,
            status: true,
            positions: {
              where: { instrumentId },
              take: 1,
              select: { quantity: true },
            },
          },
        })
      : Promise.resolve(null),
  ]);

  if (!instrument) notFound();

  const ownedQuantity = account?.positions[0]?.quantity ?? 0;
  const disabledReason = !account
    ? 'Your virtual account is unavailable.'
    : account.status !== 'ACTIVE'
      ? 'Your virtual account is not active.'
      : latestPrice == null
        ? 'A latest price is unavailable for this instrument.'
        : undefined;

  if (!latestPrice) {
    return (
      <DetailsPageFrame instrument={instrument}>
        <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="mt-8 min-w-0">
            <PriceUnavailable />
          </div>
          <aside
            aria-label="Trade ticket"
            className="mt-6 lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1 lg:mt-8 lg:self-start"
          >
            <TradeTicket
              instrumentId={instrumentId}
              symbol={instrument.symbol}
              pricePaise={null}
              availableCashPaise={account?.availableCashPaise ?? null}
              ownedQuantity={ownedQuantity}
              disabledReason={disabledReason}
            />
          </aside>
        </div>
      </DetailsPageFrame>
    );
  }

  const to = new Date(latestPrice.timestamp.getTime() + DAY_IN_MS);
  const from = new Date(0);
  const dailyCandlesPromise = marketDataProvider.getCandles(
    instrumentId,
    from,
    to,
    CandleInterval.ONE_DAY,
  );
  const selectedCandlesPromise =
    interval === CandleInterval.ONE_DAY
      ? dailyCandlesPromise
      : marketDataProvider.getCandles(instrumentId, from, to, CandleInterval.ONE_MINUTE);
  const [dailyCandles, selectedCandles] = await Promise.all([
    dailyCandlesPromise,
    selectedCandlesPromise,
  ]);
  const sortedDailyCandles = [...dailyCandles].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const sortedSelectedCandles = [...selectedCandles].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const previousDailyCandle =
    latestPrice.interval === CandleInterval.ONE_DAY
      ? sortedDailyCandles.at(-2)
      : sortedDailyCandles
          .filter((candle) => candle.timestamp.getTime() < latestPrice.timestamp.getTime())
          .at(-1);

  return (
    <DetailsPageFrame instrument={instrument}>
      <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <PriceSummary
          pricePaise={latestPrice.pricePaise}
          timestamp={latestPrice.timestamp}
          openPaise={latestPrice.openPaise}
          highPaise={latestPrice.highPaise}
          lowPaise={latestPrice.lowPaise}
          previousClosePaise={previousDailyCandle?.closePaise}
          volume={latestPrice.volume}
        />

        <aside
          aria-label="Trade ticket"
          className="mt-6 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:mt-5 lg:self-start"
        >
          <TradeTicket
            instrumentId={instrumentId}
            symbol={instrument.symbol}
            pricePaise={latestPrice.pricePaise}
            availableCashPaise={account?.availableCashPaise ?? null}
            ownedQuantity={ownedQuantity}
            disabledReason={disabledReason}
          />
        </aside>

        <section aria-labelledby="price-history-heading" className="min-w-0 pt-6 lg:col-start-1">
          <h3 id="price-history-heading" className="text-heading-card text-primary">
            Price history
          </h3>
          <nav aria-label="Price history interval" className="mt-3 flex items-center gap-2">
            <IntervalLink href="?interval=ONE_DAY" active={interval === CandleInterval.ONE_DAY}>
              1 day
            </IntervalLink>
            <IntervalLink
              href="?interval=ONE_MINUTE"
              active={interval === CandleInterval.ONE_MINUTE}
            >
              1 minute
            </IntervalLink>
          </nav>

          {sortedSelectedCandles.length > 0 ? (
            <div className="mt-4">
              <HistoricalPriceChart
                points={sortedSelectedCandles.map((candle) => ({
                  timestamp: candle.timestamp,
                  closePaise: candle.closePaise,
                }))}
                interval={interval}
                source={Array.from(
                  new Set(sortedSelectedCandles.map((candle) => candle.source)),
                ).join(', ')}
              />
            </div>
          ) : (
            <div className="mt-5">
              <PriceUnavailable
                title={
                  interval === CandleInterval.ONE_MINUTE
                    ? 'One-minute data unavailable'
                    : 'Daily price data unavailable'
                }
                message={`No ${interval === CandleInterval.ONE_MINUTE ? 'one-minute' : 'daily'} candles have been imported for this instrument yet.`}
                actionHref={
                  interval === CandleInterval.ONE_MINUTE ? '?interval=ONE_DAY' : '/instruments'
                }
                actionLabel={
                  interval === CandleInterval.ONE_MINUTE ? 'View daily prices' : 'Back to markets'
                }
              />
            </div>
          )}
        </section>
      </div>
    </DetailsPageFrame>
  );
}

async function getLatestPriceOrNull(instrumentId: string) {
  try {
    return await marketDataProvider.getLatestPrice(instrumentId);
  } catch (error) {
    if (error instanceof MarketDataUnavailableError) return null;
    throw error;
  }
}

function DetailsPageFrame({
  instrument,
  children,
}: {
  instrument: {
    symbol: string;
    companyName: string;
    exchange: string;
  };
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-7">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link
          href="/instruments"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Markets
        </Link>
        <svg
          className="h-4 w-4 text-muted"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m6 3.5 4.5 4.5L6 12.5" />
        </svg>
        <span className="text-body-muted" aria-current="page">
          {instrument.symbol}
        </span>
      </nav>

      <header className="mt-6">
        <h2 className="font-display text-3xl tracking-tight text-primary md:text-4xl">
          {instrument.companyName}
        </h2>
        <p className="mt-2 text-base text-body-muted">
          {instrument.exchange} · {instrument.symbol}
        </p>
      </header>

      {children}
    </div>
  );
}

function IntervalLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={`rounded-xs px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? 'border border-action-blue text-action-blue'
          : 'border border-transparent text-action-blue hover:bg-pale-blue'
      }`}
    >
      {children}
    </Link>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

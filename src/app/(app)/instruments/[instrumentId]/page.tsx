import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { CandlestickChart } from '@/features/market-data/components/CandlestickChart';
import { LivePriceRefresher } from '@/features/market-data/components/LivePriceRefresher';
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
}: {
  params: Promise<{ instrumentId: string }>;
}) {
  const [{ instrumentId }, session] = await Promise.all([params, auth()]);
  if (!session?.user?.id) redirect('/sign-in');

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
  const [dailyCandles, minuteCandles] = await Promise.all([
    marketDataProvider.getCandles(instrumentId, from, to, CandleInterval.ONE_DAY),
    marketDataProvider.getCandles(instrumentId, from, to, CandleInterval.ONE_MINUTE),
  ]);
  const sortedDailyCandles = [...dailyCandles].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const sortedMinuteCandles = [...minuteCandles].sort(
    (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
  );
  const chartSource = Array.from(
    new Set([...dailyCandles, ...minuteCandles].map((candle) => candle.source)),
  ).join(', ');
  const hasChartData = sortedDailyCandles.length > 0 || sortedMinuteCandles.length > 0;
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

          {hasChartData ? (
            <div className="mt-4">
              <CandlestickChart
                intraday={sortedMinuteCandles}
                daily={sortedDailyCandles}
                source={chartSource}
              />
            </div>
          ) : (
            <div className="mt-5">
              <PriceUnavailable
                title="Price data unavailable"
                message="No candles have been imported for this instrument yet."
                actionHref="/instruments"
                actionLabel="Back to markets"
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
      <LivePriceRefresher />
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

import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  AllocationDonut,
  type AllocationSegment,
} from '@/features/portfolio/components/AllocationDonut';
import { GainLossBars } from '@/features/portfolio/components/GainLossBars';
import { TimeSeriesChart } from '@/features/analytics/components/TimeSeriesChart';
import { formatINRCompact, formatPercentage } from '@/lib/finance/currency';
import { formatISTDate, parseISTInputValue, toISTInputValue } from '@/lib/finance/datetime';
import type { PortfolioAnalytics } from '@/lib/finance/analytics';
import type { Insight } from '@/lib/finance/insights';
import { loadAnalytics } from '@/server/services/portfolio-analytics';

export const metadata: Metadata = {
  title: 'Analytics',
};

const SLICE_COLORS = [
  'var(--color-deep-green)',
  'var(--color-action-blue)',
  'var(--color-coral)',
  'var(--color-dark-navy)',
  'var(--color-focus-blue)',
  'var(--color-slate)',
];
const CASH_COLOR = '#b8b8c2';

export default async function AnalyticsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const [{ id }, query, session] = await Promise.all([params, searchParams, auth()]);
  const userId = session?.user?.id;
  if (!userId) redirect('/sign-in');

  const view = await loadAnalytics(id, userId, {
    from: parseISTInputValue(query.from ?? '') ?? undefined,
    to: parseISTInputValue(query.to ?? '') ?? undefined,
  });
  if (!view) notFound();

  const { session: sim, analytics, insights } = view;
  const basePath = `/simulations/${id}/analytics`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm">
        <Link
          href="/simulations"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Simulations
        </Link>
        <span className="mx-2 text-muted">/</span>
        <Link
          href={`/simulations/${id}`}
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          {sim.name}
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">Analytics</span>
      </nav>

      <header className="mb-6">
        <p className="text-mono-label text-muted">Analytics</p>
        <h2 className="mt-2 text-display-section text-primary">How your portfolio changed</h2>
        <p className="mt-2 text-body-large text-body-muted">
          Snapshots from {formatISTDate(view.range.from)} to {formatISTDate(view.range.to)}.
        </p>
      </header>

      <DateRangeSelector basePath={basePath} from={view.range.from} to={view.range.to} />

      {analytics.valueSeries.length === 0 ? (
        <section className="mt-6 rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No snapshots in this range.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Advance the simulation clock or place a trade to record portfolio snapshots, then return
            here.
          </p>
          <Link
            href={`/simulations/${id}`}
            className="mt-5 inline-block rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
          >
            Back to simulation
          </Link>
        </section>
      ) : (
        <>
          <PerformanceSummary analytics={analytics} />

          {insights.length > 0 ? <InsightList insights={insights} /> : null}

          <section className="mt-8 grid gap-5 lg:grid-cols-2">
            <ChartCard title="Portfolio value">
              <TimeSeriesChart
                points={analytics.valueSeries.map((point) => ({
                  timestamp: point.timestamp,
                  value: point.portfolioValuePaise,
                }))}
                color="var(--color-deep-green)"
                ariaLabel="Portfolio value over time"
                formatValue={(value) => formatINRCompact(value / 100)}
              />
            </ChartCard>

            <ChartCard title="Cumulative profit & loss">
              <TimeSeriesChart
                points={analytics.cumulativeSeries.map((point) => ({
                  timestamp: point.timestamp,
                  value: point.totalPnlPaise,
                }))}
                color="var(--color-action-blue)"
                ariaLabel="Cumulative profit and loss over time"
                formatValue={(value) => formatINRCompact(value / 100)}
                zeroBaseline
              />
            </ChartCard>

            <ChartCard title="Drawdown">
              <TimeSeriesChart
                points={analytics.drawdownSeries.map((point) => ({
                  timestamp: point.timestamp,
                  value: point.drawdownPercent,
                }))}
                color="var(--color-loss)"
                ariaLabel="Drawdown percentage over time"
                formatValue={(value) => `${value.toFixed(0)}%`}
                zeroBaseline
              />
            </ChartCard>

            <ChartCard title="Contribution to P&L">
              {analytics.contributions.length > 0 ? (
                <GainLossBars
                  items={analytics.contributions.map((contribution) => ({
                    label: contribution.symbol,
                    valuePaise: contribution.pnlPaise,
                  }))}
                />
              ) : (
                <Empty>No holdings to attribute P&L to yet.</Empty>
              )}
            </ChartCard>

            <ChartCard title="Allocation by holding">
              <AllocationDonut
                segments={holdingSegments(analytics)}
                centerLabel="Cash"
                centerValue={
                  analytics.cashAllocationPercent === null
                    ? '—'
                    : `${analytics.cashAllocationPercent.toFixed(0)}%`
                }
              />
            </ChartCard>

            <ChartCard title="Allocation by sector">
              <AllocationDonut
                segments={sectorSegments(analytics)}
                centerLabel="Sectors"
                centerValue={`${analytics.sectorConcentration.length}`}
              />
            </ChartCard>
          </section>
        </>
      )}
    </div>
  );
}

function PerformanceSummary({ analytics }: { analytics: PortfolioAnalytics }) {
  return (
    <section
      aria-label="Performance summary"
      className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-3 lg:grid-cols-6"
    >
      <Stat
        label="Total return"
        value={pct(analytics.portfolioReturnPercent)}
        tone={toneOf(analytics.portfolioReturnPercent)}
      />
      <Stat
        label="Max drawdown"
        value={
          analytics.maxDrawdown ? `-${analytics.maxDrawdown.magnitudePercent.toFixed(1)}%` : '—'
        }
        tone={
          analytics.maxDrawdown && analytics.maxDrawdown.magnitudePercent > 0 ? 'loss' : undefined
        }
      />
      <Stat
        label="Volatility"
        value={
          analytics.volatilityPercent === null ? '—' : `${analytics.volatilityPercent.toFixed(1)}%`
        }
      />
      <Stat
        label="Best day"
        value={analytics.bestDay ? formatPercentage(analytics.bestDay.returnPercent) : '—'}
        tone={analytics.bestDay ? toneOf(analytics.bestDay.returnPercent) : undefined}
      />
      <Stat
        label="Worst day"
        value={analytics.worstDay ? formatPercentage(analytics.worstDay.returnPercent) : '—'}
        tone={analytics.worstDay ? toneOf(analytics.worstDay.returnPercent) : undefined}
      />
      <Stat label="Cash" value={pct(analytics.cashAllocationPercent)} />
    </section>
  );
}

function InsightList({ insights }: { insights: Insight[] }) {
  return (
    <section aria-labelledby="insights-heading" className="mt-6">
      <h3 id="insights-heading" className="mb-3 text-heading-feature text-primary">
        What the numbers say
      </h3>
      <ul className="space-y-2">
        {insights.map((insight) => (
          <li
            key={insight.id}
            className={`flex items-start gap-3 rounded-sm border px-4 py-3 text-sm ${
              insight.severity === 'warning'
                ? 'border-coral/40 bg-coral/5 text-primary'
                : 'border-hairline bg-soft-stone/30 text-primary'
            }`}
          >
            <span
              aria-hidden="true"
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                insight.severity === 'warning' ? 'bg-coral' : 'bg-slate'
              }`}
            />
            {insight.message}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DateRangeSelector({ basePath, from, to }: { basePath: string; from: Date; to: Date }) {
  return (
    <form
      method="get"
      action={basePath}
      className="flex flex-wrap items-end gap-3 rounded-sm border border-hairline bg-canvas px-4 py-3"
    >
      <div>
        <label htmlFor="range-from" className="text-xs text-muted">
          From (IST)
        </label>
        <input
          id="range-from"
          name="from"
          type="datetime-local"
          defaultValue={toISTInputValue(from)}
          className="mt-1 h-10 rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary focus:border-focus-blue"
        />
      </div>
      <div>
        <label htmlFor="range-to" className="text-xs text-muted">
          To (IST)
        </label>
        <input
          id="range-to"
          name="to"
          type="datetime-local"
          defaultValue={toISTInputValue(to)}
          className="mt-1 h-10 rounded-sm border border-hairline bg-canvas px-3 text-sm text-primary focus:border-focus-blue"
        />
      </div>
      <button
        type="submit"
        className="h-10 rounded-pill bg-primary px-4 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
      >
        Apply
      </button>
      <Link
        href={basePath}
        className="h-10 rounded-pill border border-hairline px-4 text-sm font-medium leading-10 text-primary transition-colors hover:border-slate"
      >
        Full run
      </Link>
    </form>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-hairline bg-canvas p-5">
      <h3 className="text-mono-label text-muted">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const toneClass = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-primary';
  return (
    <div className="bg-canvas px-4 py-4">
      <p className="text-mono-label text-muted">{label}</p>
      <p className={`mt-2 font-mono text-base font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-sm border border-dashed border-hairline px-4 py-8 text-center text-sm text-body-muted">
      {children}
    </p>
  );
}

function holdingSegments(analytics: PortfolioAnalytics): AllocationSegment[] {
  const holdings = analytics.holdingConcentration.map((holding, index) => ({
    label: holding.label,
    percent: holding.allocationPercent,
    color: SLICE_COLORS[index % SLICE_COLORS.length],
  }));
  return [...holdings, cashSegment(analytics)];
}

function sectorSegments(analytics: PortfolioAnalytics): AllocationSegment[] {
  const sectors = analytics.sectorConcentration.map((sector, index) => ({
    label: sector.label,
    percent: sector.allocationPercent,
    color: SLICE_COLORS[index % SLICE_COLORS.length],
  }));
  return [...sectors, cashSegment(analytics)];
}

function cashSegment(analytics: PortfolioAnalytics): AllocationSegment {
  return { label: 'Cash', percent: analytics.cashAllocationPercent ?? 0, color: CASH_COLOR };
}

function pct(value: number | null): string {
  return value === null ? '—' : formatPercentage(value);
}

function toneOf(value: number | null): 'gain' | 'loss' | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? 'gain' : 'loss';
}

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
import { formatINRCompact, formatPercentage, formatSignedPaise } from '@/lib/finance/currency';
import { formatISTDate, parseISTInputValue, toISTInputValue } from '@/lib/finance/datetime';
import type { PortfolioAnalytics } from '@/lib/finance/analytics';
import type { Insight } from '@/lib/finance/insights';
import { loadAnalytics } from '@/server/services/portfolio-analytics';
import { loadScenarioForSession } from '@/server/services/scenario';

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
  const scenario = await loadScenarioForSession(sim.scenarioPackId);
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

      {scenario ? (
        <section className="mb-6 rounded-sm border border-action-blue/30 bg-pale-blue/40 px-5 py-4">
          <p className="text-mono-label text-action-blue">Scenario debrief</p>
          <h3 className="mt-1 text-heading-card text-primary">{scenario.title}</h3>
          <p className="mt-2 text-body-muted">
            How you traded through {formatISTDate(scenario.startTimestamp)} –{' '}
            {formatISTDate(scenario.endTimestamp)}. The numbers below are your run; the insights call
            out what to learn from it.
          </p>
        </section>
      ) : null}

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-mono-label text-muted">{scenario ? 'Debrief' : 'Analytics'}</p>
          <h2 className="mt-2 text-display-section text-primary">How your portfolio changed</h2>
          <p className="mt-2 text-body-large text-body-muted">
            Snapshots from {formatISTDate(view.range.from)} to {formatISTDate(view.range.to)}.
          </p>
        </div>
        <Link
          href={`/simulations/${id}/coach`}
          className="rounded-pill border border-action-blue px-4 py-1.5 text-sm font-medium text-action-blue transition-colors hover:bg-pale-blue"
        >
          Coach
        </Link>
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
                  value: Number(point.portfolioValuePaise),
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
                  value: Number(point.totalPnlPaise),
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

          <TradeStatsSection analytics={analytics} />
        </>
      )}
    </div>
  );
}

function TradeStatsSection({ analytics }: { analytics: PortfolioAnalytics }) {
  const stats = analytics.tradeStats;
  if (stats.closedTradeCount === 0) return null;

  return (
    <section aria-labelledby="trade-stats-heading" className="mt-10">
      <h3 id="trade-stats-heading" className="mb-3 text-heading-feature text-primary">
        Trading performance
      </h3>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Round-trips" value={`${stats.closedTradeCount}`} />
        <Stat
          label="Win rate"
          value={stats.winRatePercent === null ? '—' : `${stats.winRatePercent.toFixed(0)}%`}
        />
        <Stat
          label="Profit factor"
          value={stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}
          tone={stats.profitFactor !== null && stats.profitFactor >= 1 ? 'gain' : 'loss'}
        />
        <Stat
          label="Avg win"
          value={stats.avgWinPaise === null ? '—' : formatSignedPaise(stats.avgWinPaise)}
          tone={stats.avgWinPaise === null ? undefined : 'gain'}
        />
        <Stat
          label="Avg loss"
          value={stats.avgLossPaise === null ? '—' : formatSignedPaise(-stats.avgLossPaise)}
          tone={stats.avgLossPaise === null ? undefined : 'loss'}
        />
        <Stat
          label="Net realized"
          value={formatSignedPaise(stats.netRealizedPnlPaise)}
          tone={toneOf(Number(stats.netRealizedPnlPaise))}
        />
      </div>

      {stats.byStrategy.length > 0 || stats.byEmotion.length > 0 ? (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          {stats.byStrategy.length > 0 ? (
            <TagTable title="P&L by strategy" rows={stats.byStrategy} />
          ) : null}
          {stats.byEmotion.length > 0 ? (
            <TagTable title="P&L by emotion" rows={stats.byEmotion} />
          ) : null}
        </div>
      ) : (
        <p className="mt-4 text-sm text-body-muted">
          Tag your trades in the journal (strategy &amp; emotion) to see which approaches pay off.
        </p>
      )}
    </section>
  );
}

function TagTable({
  title,
  rows,
}: {
  title: string;
  rows: PortfolioAnalytics['tradeStats']['byStrategy'];
}) {
  return (
    <div className="overflow-hidden rounded-sm border border-hairline bg-canvas">
      <h4 className="border-b border-hairline px-4 py-3 text-mono-label text-muted">{title}</h4>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-4 py-2 font-medium">Tag</th>
            <th className="px-4 py-2 text-right font-medium">Trades</th>
            <th className="px-4 py-2 text-right font-medium">Win %</th>
            <th className="px-4 py-2 text-right font-medium">Net P&L</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {rows.map((row) => (
            <tr key={row.tag}>
              <td className="px-4 py-2 font-medium text-primary">{row.tag}</td>
              <td className="px-4 py-2 text-right font-mono text-body-muted">{row.trades}</td>
              <td className="px-4 py-2 text-right font-mono text-body-muted">
                {row.winRatePercent.toFixed(0)}%
              </td>
              <td
                className={`px-4 py-2 text-right font-mono ${row.netPnlPaise >= 0n ? 'text-gain' : 'text-loss'}`}
              >
                {formatSignedPaise(row.netPnlPaise)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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

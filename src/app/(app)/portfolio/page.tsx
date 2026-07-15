import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  AllocationDonut,
  type AllocationSegment,
} from '@/features/portfolio/components/AllocationDonut';
import { GainLossBars } from '@/features/portfolio/components/GainLossBars';
import { HoldingsTable } from '@/features/portfolio/components/HoldingsTable';
import {
  formatINRCompact,
  formatPaise,
  formatPercentage,
  formatSignedPaise,
} from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import type { HoldingValuation } from '@/lib/finance/portfolio';
import { loadPortfolioSummary, type PortfolioView } from '@/server/services/portfolio';

export const metadata: Metadata = {
  title: 'Portfolio',
};

// Categorical hues for allocation slices — brand tones, never the semantic
// gain/loss red/green (reserved for P&L). Cash gets a neutral grey.
const SLICE_COLORS = [
  'var(--color-deep-green)',
  'var(--color-action-blue)',
  'var(--color-coral)',
  'var(--color-dark-navy)',
  'var(--color-focus-blue)',
  'var(--color-slate)',
];
const CASH_COLOR = '#b8b8c2';

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ asOf?: string | string[] }>;
}) {
  const [session, resolvedSearchParams] = await Promise.all([auth(), searchParams]);
  const userId = session?.user?.id;
  if (!userId) redirect('/sign-in');

  const summary = await loadPortfolioSummary(userId, {
    valuationTimestamp: parseValuationTimestamp(resolvedSearchParams.asOf),
  });

  if (!summary) {
    return (
      <PageFrame>
        <section className="rounded-sm border border-hairline bg-soft-stone/30 p-6">
          <p className="text-mono-label text-muted">Portfolio unavailable</p>
          <h2 className="mt-2 text-heading-card text-primary">Your virtual account is missing.</h2>
          <p className="mt-2 max-w-xl text-body-muted">
            We could not find the trading account linked to this user. Please contact support.
          </p>
        </section>
      </PageFrame>
    );
  }

  const asOf = summary.priceDataTimestamp ?? summary.valuationTimestamp;

  if (summary.holdings.length === 0) {
    return (
      <PageFrame>
        <EmptyPortfolio summary={summary} />
      </PageFrame>
    );
  }

  const gain = summary.totalPnlPaise >= 0;
  const segments = buildAllocationSegments(summary);

  return (
    <PageFrame>
      {/* Hero: total portfolio value, total gain/loss, return % */}
      <section className="overflow-hidden rounded-sm border border-hairline bg-deep-green px-5 py-6 text-white md:px-8 md:py-8">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-mono-label text-white/55">Total portfolio value</p>
            <p className="mt-2 font-display text-4xl tracking-tight md:text-5xl">
              {formatPaise(summary.portfolioValuePaise)}
            </p>
            <p className={`mt-3 text-lg font-medium ${gain ? 'text-pale-green' : 'text-coral'}`}>
              {gain ? '▲' : '▼'} {formatSignedPaise(summary.totalPnlPaise)}
              <span className="ml-2">({formatPct(summary.totalReturnPercent)})</span>
            </p>
          </div>
          <div className="text-sm text-white/70 md:text-right">
            <p>
              Valued at{' '}
              <time dateTime={asOf.toISOString()} className="text-white/90">
                {formatISTDateTime(asOf)} IST
              </time>
            </p>
            <p className="mt-1">Starting balance {formatPaise(summary.startingBalancePaise)}</p>
          </div>
        </div>
      </section>

      {summary.hasPricingGaps || summary.stalePriceCount > 0 ? (
        <PricingNotice missing={summary.missingPriceCount} stale={summary.stalePriceCount} />
      ) : null}

      {/* Secondary metrics */}
      <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline lg:grid-cols-4">
        <Metric
          label="Available cash"
          value={formatPaise(summary.availableCashPaise)}
          hint={`${formatPct(summary.cashAllocationPercent)} of portfolio`}
        />
        <Metric label="Invested value" value={formatPaise(summary.investedValuePaise)} />
        <Metric
          label="Realized P&L"
          value={formatSignedPaise(summary.realizedPnlPaise)}
          tone={summary.realizedPnlPaise >= 0 ? 'gain' : 'loss'}
        />
        <Metric
          label="Unrealized P&L"
          value={formatSignedPaise(summary.unrealizedPnlPaise)}
          tone={summary.unrealizedPnlPaise >= 0 ? 'gain' : 'loss'}
          hint={formatPct(summary.unrealizedReturnPercent)}
        />
      </section>

      {/* Charts */}
      <section className="mt-6 grid gap-5 lg:grid-cols-2">
        <Card title="Allocation">
          <AllocationDonut
            segments={segments}
            centerLabel="Value"
            centerValue={formatINRCompact(summary.portfolioValuePaise / 100)}
          />
          {summary.largestAllocation?.allocationPercent != null ? (
            <p className="mt-5 border-t border-hairline pt-4 text-sm text-body-muted">
              Largest holding:{' '}
              <span className="font-medium text-primary">{summary.largestAllocation.symbol}</span> ·{' '}
              {summary.largestAllocation.allocationPercent.toFixed(1)}% of portfolio
            </p>
          ) : null}
        </Card>

        <Card title="Gain / loss by holding">
          <GainLossBars
            items={summary.holdings.map((holding) => ({
              label: holding.symbol,
              valuePaise: holding.unrealizedPnlPaise,
            }))}
          />
        </Card>
      </section>

      {/* Best / worst performers */}
      {summary.best || summary.worst ? (
        <section className="mt-6 grid gap-5 sm:grid-cols-2">
          <PerformerCard label="Best performer" holding={summary.best} />
          <PerformerCard label="Worst performer" holding={summary.worst} />
        </section>
      ) : null}

      {/* Holdings table */}
      <section className="mt-8" aria-labelledby="holdings-heading">
        <h3 id="holdings-heading" className="mb-3 text-heading-feature text-primary">
          Holdings
        </h3>
        <div className="rounded-sm border border-hairline">
          <HoldingsTable holdings={summary.holdings} />
        </div>
      </section>
    </PageFrame>
  );
}

function parseValuationTimestamp(value: string | string[] | undefined): Date | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : new Date(parsed);
}

function buildAllocationSegments(summary: PortfolioView): AllocationSegment[] {
  const holdingSegments = summary.holdings
    .filter((holding) => holding.allocationPercent !== null)
    .sort((a, b) => (b.allocationPercent ?? 0) - (a.allocationPercent ?? 0))
    .map((holding, index) => ({
      label: holding.symbol,
      percent: holding.allocationPercent ?? 0,
      color: SLICE_COLORS[index % SLICE_COLORS.length],
    }));

  const cash: AllocationSegment = {
    label: 'Cash',
    percent: summary.cashAllocationPercent ?? 0,
    color: CASH_COLOR,
  };

  return [...holdingSegments, cash];
}

function formatPct(value: number | null): string {
  return value === null ? '—' : formatPercentage(value);
}

function PageFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <p className="text-mono-label text-muted">Portfolio</p>
        <h2 className="mt-2 text-display-section text-primary">Your holdings</h2>
        <p className="mt-2 text-body-large text-body-muted">
          What your simulated investments are worth right now.
        </p>
      </header>
      {children}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'gain' | 'loss';
}) {
  const toneClass = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-primary';
  return (
    <div className="bg-canvas px-4 py-4 md:px-5">
      <p className="text-mono-label text-muted">{label}</p>
      <p className={`mt-2 font-mono text-lg font-medium ${toneClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-sm border border-hairline bg-canvas p-5">
      <h3 className="text-mono-label text-muted">{title}</h3>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function PerformerCard({ label, holding }: { label: string; holding: HoldingValuation | null }) {
  return (
    <div className="rounded-sm border border-hairline bg-canvas p-5">
      <p className="text-mono-label text-muted">{label}</p>
      {holding && holding.returnPercent !== null ? (
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-medium text-primary">{holding.companyName}</p>
            <p className="mt-0.5 font-mono text-sm text-body-muted">{holding.symbol}</p>
          </div>
          <div className="text-right">
            <p
              className={`font-mono text-xl font-medium ${holding.returnPercent >= 0 ? 'text-gain' : 'text-loss'}`}
            >
              {formatPercentage(holding.returnPercent)}
            </p>
            <p
              className={`mt-0.5 font-mono text-sm ${(holding.unrealizedPnlPaise ?? 0) >= 0 ? 'text-gain' : 'text-loss'}`}
            >
              {formatSignedPaise(holding.unrealizedPnlPaise ?? 0)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-body-muted">No priced holdings yet.</p>
      )}
    </div>
  );
}

function PricingNotice({ missing, stale }: { missing: number; stale: number }) {
  const parts: string[] = [];
  if (missing > 0) {
    parts.push(
      `${missing} holding${missing === 1 ? '' : 's'} ${missing === 1 ? 'has' : 'have'} no recent price and ${missing === 1 ? 'is' : 'are'} excluded from the totals above`,
    );
  }
  if (stale > 0) {
    parts.push(`${stale} holding${stale === 1 ? '' : 's'} priced from older data`);
  }

  return (
    <div
      role="status"
      className="mt-4 flex items-start gap-3 rounded-sm border border-coral/40 bg-coral/5 px-4 py-3 text-sm text-primary"
    >
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-coral"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10 6.5v4m0 3h.01M10 2.5 1.5 17h17L10 2.5Z"
        />
      </svg>
      <p>{parts.join('; ')}.</p>
    </div>
  );
}

function EmptyPortfolio({ summary }: { summary: PortfolioView }) {
  return (
    <section className="rounded-sm border border-hairline bg-canvas">
      <div className="border-b border-hairline bg-soft-stone/30 px-6 py-8 text-center">
        <p className="text-mono-label text-muted">No holdings yet</p>
        <h3 className="mt-2 text-heading-card text-primary">Your portfolio is empty.</h3>
        <p className="mx-auto mt-2 max-w-md text-body-muted">
          You have {formatPaise(summary.availableCashPaise)} in available cash. Buy your first
          instrument to start building a portfolio.
        </p>
        <Link
          href="/instruments"
          className="mt-5 inline-block rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
        >
          Explore markets
        </Link>
      </div>
      {summary.realizedPnlPaise !== 0 ? (
        <div className="px-6 py-4 text-center text-sm text-body-muted">
          Realized P&L to date:{' '}
          <span
            className={`font-mono ${summary.realizedPnlPaise >= 0 ? 'text-gain' : 'text-loss'}`}
          >
            {formatSignedPaise(summary.realizedPnlPaise)}
          </span>
        </div>
      ) : null}
    </section>
  );
}

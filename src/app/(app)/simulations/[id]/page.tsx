import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { GainLossBars } from '@/features/portfolio/components/GainLossBars';
import { HoldingsTable } from '@/features/portfolio/components/HoldingsTable';
import { PendingOrdersTable } from '@/features/simulation/components/PendingOrdersTable';
import { PlaybackControls } from '@/features/simulation/components/PlaybackControls';
import { ResetDialog } from '@/features/simulation/components/ResetDialog';
import { SimulationTimeline } from '@/features/simulation/components/SimulationTimeline';
import { SimulationTradeTicket } from '@/features/simulation/components/SimulationTradeTicket';
import { formatPaise, formatPercentage, formatSignedPaise } from '@/lib/finance/currency';
import { formatISTDateTime, toISTInputValue } from '@/lib/finance/datetime';
import type { PortfolioView } from '@/server/services/portfolio';
import { prisma } from '@/lib/prisma';
import { loadSimulation } from '@/server/services/simulation';
import { checkpointAt, loadScenarioForSession } from '@/server/services/scenario';

export const metadata: Metadata = {
  title: 'Simulation',
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-pale-green text-deep-green',
  PAUSED: 'bg-soft-stone text-body-muted',
  COMPLETED: 'bg-pale-blue text-action-blue',
  DRAFT: 'bg-soft-stone text-body-muted',
};

export default async function SimulationCockpitPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, authSession] = await Promise.all([params, auth()]);
  const userId = authSession?.user?.id;
  if (!userId) redirect('/sign-in');

  const [detail, instruments] = await Promise.all([
    loadSimulation(id, userId),
    prisma.instrument.findMany({
      where: { isActive: true },
      select: { id: true, symbol: true, companyName: true },
      orderBy: { symbol: 'asc' },
    }),
  ]);
  if (!detail) notFound();

  const { session: sim, portfolio, timeline } = detail;
  const scenario = await loadScenarioForSession(sim.scenarioPackId);
  const checkpoint = scenario ? checkpointAt(scenario.checkpoints, sim.currentTimestamp) : null;
  const progress = clampProgress(sim.startTimestamp, sim.currentTimestamp, sim.endTimestamp);
  const tradeDisabledReason =
    sim.status === 'COMPLETED'
      ? 'This simulation is complete. Reset it to trade again.'
      : sim.status !== 'ACTIVE'
        ? 'Resume the simulation to place orders.'
        : undefined;

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
        <span className="text-body-muted">{sim.name}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-display-section text-primary">{sim.name}</h2>
        <div className="flex items-center gap-3">
          <Link
            href={`/simulations/${sim.id}/analytics`}
            className="rounded-pill border border-hairline px-4 py-1.5 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
          >
            {scenario ? 'Debrief' : 'Analytics'}
          </Link>
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[sim.status] ?? ''}`}
          >
            {sim.status}
          </span>
        </div>
      </header>

      {checkpoint ? <CheckpointCard title={checkpoint.title} body={checkpoint.body} /> : null}

      {sim.status === 'COMPLETED' && portfolio ? (
        <CompletedSummary sim={sim} portfolio={portfolio} />
      ) : null}

      {/* Simulation clock */}
      <section className="overflow-hidden rounded-sm border border-hairline bg-deep-green px-5 py-6 text-white md:px-8">
        <p className="text-mono-label text-white/55">Current simulation time</p>
        <p className="mt-2 font-display text-3xl tracking-tight md:text-4xl">
          {formatISTDateTime(sim.currentTimestamp)} IST
        </p>
        <div className="mt-5">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-white/70" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 flex justify-between text-xs text-white/60">
            <span>{formatISTDateTime(sim.startTimestamp)}</span>
            <span>{formatISTDateTime(sim.endTimestamp)}</span>
          </div>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        {/* Portfolio at the selected time */}
        <div className="min-w-0 space-y-6">
          <section aria-labelledby="sim-portfolio-heading">
            <h3 id="sim-portfolio-heading" className="mb-3 text-heading-feature text-primary">
              Portfolio at this time
            </h3>
            {portfolio ? (
              <PortfolioPanel portfolio={portfolio} />
            ) : (
              <p className="text-sm text-body-muted">Portfolio data is unavailable.</p>
            )}
          </section>

          <section aria-labelledby="sim-pending-heading">
            <h3 id="sim-pending-heading" className="mb-3 text-heading-feature text-primary">
              Pending orders
            </h3>
            <PendingOrdersTable sessionId={sim.id} orders={detail.pendingOrders} />
          </section>

          <section aria-labelledby="sim-timeline-heading">
            <h3 id="sim-timeline-heading" className="mb-4 text-heading-feature text-primary">
              Timeline
            </h3>
            <SimulationTimeline events={timeline} />
          </section>
        </div>

        {/* Controls + trading */}
        <aside className="space-y-6">
          <section className="rounded-sm border border-hairline p-5">
            <h3 className="mb-4 text-heading-feature text-primary">Playback</h3>
            <PlaybackControls
              sessionId={sim.id}
              status={sim.status}
              customMin={toISTInputValue(sim.currentTimestamp)}
              customMax={toISTInputValue(sim.endTimestamp)}
            />
            <div className="mt-5 border-t border-hairline pt-4">
              <ResetDialog sessionId={sim.id} />
            </div>
          </section>

          <SimulationTradeTicket
            sessionId={sim.id}
            instruments={instruments}
            disabledReason={tradeDisabledReason}
          />
        </aside>
      </div>
    </div>
  );
}

function CheckpointCard({ title, body }: { title: string; body: string }) {
  return (
    <section
      aria-label="Scenario checkpoint"
      className="mb-6 rounded-sm border-l-4 border-l-action-blue border-y border-r border-hairline bg-pale-blue/40 px-5 py-4"
    >
      <p className="text-mono-label text-action-blue">Checkpoint</p>
      <h3 className="mt-1 text-heading-card text-primary">{title}</h3>
      <p className="mt-2 text-body-muted">{body}</p>
    </section>
  );
}

function PortfolioPanel({ portfolio }: { portfolio: PortfolioView }) {
  const gain = portfolio.totalPnlPaise >= 0;

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline lg:grid-cols-4">
        <Stat label="Portfolio value" value={formatPaise(portfolio.portfolioValuePaise)} />
        <Stat
          label="Total P&L"
          value={formatSignedPaise(portfolio.totalPnlPaise)}
          tone={gain ? 'gain' : 'loss'}
          hint={
            portfolio.totalReturnPercent === null
              ? undefined
              : formatPercentage(portfolio.totalReturnPercent)
          }
        />
        <Stat label="Available cash" value={formatPaise(portfolio.availableCashPaise)} />
        <Stat label="Invested" value={formatPaise(portfolio.investedValuePaise)} />
      </dl>

      {portfolio.hasPricingGaps ? (
        <p className="rounded-sm border border-coral/40 bg-coral/5 px-4 py-2.5 text-sm text-primary">
          {portfolio.missingPriceCount} holding(s) had no price at this time and are excluded from
          the totals.
        </p>
      ) : null}

      {portfolio.holdings.length === 0 ? (
        <p className="rounded-sm border border-hairline bg-soft-stone/30 px-4 py-5 text-sm text-body-muted">
          No holdings yet — place a buy order to start investing at this point in time.
        </p>
      ) : (
        <>
          <div className="rounded-sm border border-hairline bg-canvas p-5">
            <h4 className="text-mono-label text-muted">Gain / loss by holding</h4>
            <div className="mt-4">
              <GainLossBars
                items={portfolio.holdings.map((holding) => ({
                  label: holding.symbol,
                  valuePaise: holding.unrealizedPnlPaise,
                }))}
              />
            </div>
          </div>
          <div className="rounded-sm border border-hairline">
            <HoldingsTable holdings={portfolio.holdings} />
          </div>
        </>
      )}
    </div>
  );
}

function CompletedSummary({
  sim,
  portfolio,
}: {
  sim: { startTimestamp: Date; endTimestamp: Date };
  portfolio: PortfolioView;
}) {
  const gain = portfolio.totalPnlPaise >= 0;
  return (
    <section className="mb-6 rounded-sm border border-action-blue/30 bg-pale-blue px-5 py-5">
      <p className="text-mono-label text-action-blue">Simulation complete</p>
      <div className="mt-3 grid gap-4 sm:grid-cols-3">
        <Summary label="Final value" value={formatPaise(portfolio.portfolioValuePaise)} />
        <Summary
          label="Total P&L"
          value={formatSignedPaise(portfolio.totalPnlPaise)}
          tone={gain ? 'gain' : 'loss'}
        />
        <Summary
          label="Return"
          value={
            portfolio.totalReturnPercent === null
              ? '—'
              : formatPercentage(portfolio.totalReturnPercent)
          }
          tone={gain ? 'gain' : 'loss'}
        />
      </div>
      <p className="mt-4 text-sm text-body-muted">
        Ran from {formatISTDateTime(sim.startTimestamp)} to {formatISTDateTime(sim.endTimestamp)}{' '}
        IST.
        {portfolio.best ? ` Best: ${portfolio.best.symbol}.` : ''}
        {portfolio.worst ? ` Worst: ${portfolio.worst.symbol}.` : ''}
      </p>
    </section>
  );
}

function Stat({
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
    <div className="bg-canvas px-4 py-4">
      <dt className="text-mono-label text-muted">{label}</dt>
      <dd className={`mt-2 font-mono text-base font-medium ${toneClass}`}>{value}</dd>
      {hint ? <dd className={`mt-0.5 text-xs ${toneClass}`}>{hint}</dd> : null}
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const toneClass = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-primary';
  return (
    <div>
      <p className="text-xs text-body-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl tracking-tight ${toneClass}`}>{value}</p>
    </div>
  );
}

function clampProgress(start: Date, current: Date, end: Date): number {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return 100;
  const ratio = (current.getTime() - start.getTime()) / span;
  return Math.min(100, Math.max(0, ratio * 100));
}

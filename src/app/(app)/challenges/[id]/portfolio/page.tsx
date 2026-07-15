import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { resetChallengeAccountAction } from '@/app/actions/challenge';
import { ChallengeTradeTicket } from '@/features/challenge/components/ChallengeTradeTicket';
import { HoldingsTable } from '@/features/portfolio/components/HoldingsTable';
import { formatPaise, formatPercentage } from '@/lib/finance/currency';
import { loadChallengePortfolio } from '@/server/services/challenge';

export const metadata: Metadata = {
  title: 'Challenge portfolio',
};

export default async function ChallengePortfolioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  if (!session?.user?.id) redirect('/sign-in');

  const data = await loadChallengePortfolio(id, session.user.id);
  if (!data) notFound();

  const { challenge, portfolio, tradeCount, instruments, tradingOpen } = data;
  const gain = (portfolio?.totalPnlPaise ?? 0) >= 0;
  const disabledReason = tradingOpen
    ? undefined
    : 'This challenge is not accepting trades right now.';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm">
        <Link
          href="/challenges"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Challenges
        </Link>
        <span className="mx-2 text-muted">/</span>
        <Link
          href={`/challenges/${id}`}
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          {challenge.name}
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">Portfolio</span>
      </nav>

      <header className="mb-6">
        <p className="text-mono-label text-muted">Challenge portfolio</p>
        <h2 className="mt-2 text-display-section text-primary">{challenge.name}</h2>
        <p className="mt-1 text-sm text-body-muted">
          Trades used: {tradeCount}
          {challenge.maxTrades === null ? '' : ` / ${challenge.maxTrades}`}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-6">
          {portfolio ? (
            <>
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline sm:grid-cols-4">
                <Stat label="Value" value={formatPaise(portfolio.portfolioValuePaise)} />
                <Stat
                  label="Total P&L"
                  value={formatPaise(portfolio.totalPnlPaise)}
                  tone={gain ? 'gain' : 'loss'}
                  hint={
                    portfolio.totalReturnPercent === null
                      ? undefined
                      : formatPercentage(portfolio.totalReturnPercent)
                  }
                />
                <Stat label="Cash" value={formatPaise(portfolio.availableCashPaise)} />
                <Stat label="Invested" value={formatPaise(portfolio.investedValuePaise)} />
              </dl>

              {portfolio.holdings.length === 0 ? (
                <p className="rounded-sm border border-hairline bg-soft-stone/30 px-4 py-5 text-sm text-body-muted">
                  No holdings yet — place a trade to get started.
                </p>
              ) : (
                <div className="rounded-sm border border-hairline">
                  <HoldingsTable holdings={portfolio.holdings} />
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-body-muted">Portfolio data is unavailable.</p>
          )}
        </div>

        <aside className="space-y-6">
          <ChallengeTradeTicket
            challengeId={id}
            instruments={instruments}
            disabledReason={disabledReason}
          />
          {challenge.resetAllowed && tradingOpen ? (
            <form
              action={resetChallengeAccountAction}
              className="rounded-sm border border-hairline p-5"
            >
              <input type="hidden" name="challengeId" value={id} />
              <p className="text-sm text-body-muted">
                Reset clears your challenge trades and returns to the opening balance.
              </p>
              <button
                type="submit"
                className="mt-3 rounded-pill border border-loss/40 px-4 py-2 text-sm font-medium text-loss transition-colors hover:bg-loss/5"
              >
                Reset challenge account
              </button>
            </form>
          ) : null}
        </aside>
      </div>
    </div>
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

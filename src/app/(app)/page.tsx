import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { setActiveAccountAction } from '@/app/actions/accounts';
import {
  ClosePortfolioDialog,
  CreatePortfolioForm,
} from '@/features/accounts/components/PortfolioForms';
import { formatINR } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { prisma } from '@/lib/prisma';
import { getActiveAccountId, listPortfolios } from '@/server/services/accounts';

export const metadata: Metadata = {
  title: 'Portfolios',
};

export default async function AccountsPage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/sign-in');

  const [portfolios, activeId] = await Promise.all([
    listPortfolios(userId),
    getActiveAccountId(userId),
  ]);
  const active = portfolios.find((portfolio) => portfolio.id === activeId) ?? portfolios[0];

  const openingCredit = active
    ? await prisma.ledgerEntry.findFirst({
        where: { virtualAccountId: active.id, type: 'INITIAL_CREDIT' },
        select: { amountPaise: true, balanceAfterPaise: true, description: true, createdAt: true },
      })
    : null;

  const displayName = session.user.name?.trim().split(/\s+/)[0] ?? 'Trader';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <section className="mb-8">
        <p className="text-mono-label text-muted">Virtual portfolios</p>
        <h2 className="mt-2 text-display-section text-primary">Welcome, {displayName}</h2>
        <p className="mt-2 text-body-large text-body-muted">
          Run several independent portfolios. The active one is used for trading, the dashboard and
          your journal.
        </p>
      </section>

      {active ? (
        <section className="mb-6 overflow-hidden rounded-sm border border-hairline bg-canvas">
          <div className="bg-deep-green px-5 py-6 text-white md:px-7 md:py-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-mono-label text-white/55">Active portfolio · {active.name}</p>
                <p className="mt-2 font-display text-4xl tracking-tight md:text-5xl">
                  {formatINR(active.availableCashPaise / 100)}
                </p>
                <p className="mt-1 text-sm text-white/70">Available cash</p>
              </div>
              <span className="w-fit rounded-pill bg-white/10 px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-white/85">
                {active.status}
              </span>
            </div>
          </div>
          <dl className="grid divide-y divide-hairline sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            <Detail label="Starting balance" value={formatINR(active.startingBalancePaise / 100)} />
            <Detail label="Opened" value={formatISTDateTime(active.createdAt)} />
          </dl>
        </section>
      ) : null}

      <section aria-labelledby="portfolios-heading" className="mb-8">
        <h3 id="portfolios-heading" className="mb-3 text-heading-feature text-primary">
          Your portfolios
        </h3>
        <ul className="space-y-2">
          {portfolios.map((portfolio) => {
            const isActive = portfolio.id === active?.id;
            return (
              <li
                key={portfolio.id}
                className={`flex flex-wrap items-center justify-between gap-3 rounded-sm border px-4 py-3 ${
                  isActive ? 'border-action-blue bg-pale-blue/40' : 'border-hairline bg-canvas'
                }`}
              >
                <div>
                  <p className="font-medium text-primary">
                    {portfolio.name}
                    {isActive ? (
                      <span className="ml-2 text-xs font-medium text-action-blue">Active</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 font-mono text-sm text-body-muted">
                    {formatINR(portfolio.availableCashPaise / 100)} cash
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  {isActive ? null : (
                    <form action={setActiveAccountAction}>
                      <input type="hidden" name="accountId" value={portfolio.id} />
                      <button
                        type="submit"
                        className="rounded-pill border border-hairline px-4 py-1.5 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
                      >
                        Switch to
                      </button>
                    </form>
                  )}
                  {portfolios.length > 1 ? (
                    <ClosePortfolioDialog accountId={portfolio.id} accountName={portfolio.name} />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <CreatePortfolioForm />

        {openingCredit ? (
          <section
            aria-labelledby="ledger-heading"
            className="rounded-sm border border-hairline bg-canvas p-5"
          >
            <h3 id="ledger-heading" className="text-heading-feature text-primary">
              Opening credit
            </h3>
            <p className="mt-1 text-xs text-muted">Immutable ledger record · auditable</p>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-hairline pt-4">
              <div>
                <p className="font-medium text-primary">
                  {openingCredit.description || 'Initial virtual cash credit'}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {formatISTDateTime(openingCredit.createdAt)}
                </p>
              </div>
              <p className="font-mono text-lg font-medium text-gain">
                +{formatINR(openingCredit.amountPaise / 100)}
              </p>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-5 py-4 md:px-6">
      <dt className="text-mono-label text-muted">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium text-primary">{value}</dd>
    </div>
  );
}

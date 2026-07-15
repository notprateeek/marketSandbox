import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { formatPaise, formatSignedPaise } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { prisma } from '@/lib/prisma';
import { getActiveAccountId } from '@/server/services/accounts';

export const metadata: Metadata = {
  title: 'History',
};

const LEDGER_LABEL: Record<string, string> = {
  INITIAL_CREDIT: 'Opening credit',
  BUY_DEBIT: 'Buy',
  SELL_CREDIT: 'Sell',
  DIVIDEND_CREDIT: 'Dividend',
  FEE_DEBIT: 'Fee',
  ADJUSTMENT: 'Adjustment',
};

export default async function HistoryPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const accountId = await getActiveAccountId(userId);
  if (!accountId) {
    return (
      <Frame>
        <p className="rounded-sm border border-hairline bg-soft-stone/30 px-4 py-6 text-body-muted">
          No active portfolio.
        </p>
      </Frame>
    );
  }

  const [account, orders, ledger] = await Promise.all([
    prisma.virtualAccount.findUnique({ where: { id: accountId }, select: { name: true } }),
    prisma.order.findMany({
      where: { virtualAccountId: accountId, status: 'FILLED' },
      orderBy: { submittedAt: 'desc' },
      include: {
        instrument: { select: { symbol: true } },
        execution: { select: { pricePaise: true, grossAmountPaise: true, quantity: true } },
      },
    }),
    prisma.ledgerEntry.findMany({
      where: { virtualAccountId: accountId },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const empty = orders.length === 0 && ledger.length <= 1;

  return (
    <Frame subtitle={account ? `${account.name} · trades and cash ledger` : undefined}>
      {empty ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No activity yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Your trades and cash movements for this portfolio will appear here.
          </p>
          <Link
            href="/instruments"
            className="mt-5 inline-block rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
          >
            Explore markets
          </Link>
        </section>
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="trades-heading">
            <h3 id="trades-heading" className="mb-3 text-heading-feature text-primary">
              Trades
            </h3>
            {orders.length === 0 ? (
              <p className="text-sm text-body-muted">No trades yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-sm border border-hairline">
                <table className="w-full min-w-[40rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-hairline text-left text-mono-label text-muted">
                      <Th className="text-left">Trade</Th>
                      <Th>Qty</Th>
                      <Th>Price</Th>
                      <Th>Value</Th>
                      <Th>When</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => (
                      <tr key={order.id} className="border-b border-hairline last:border-0">
                        <Td className="text-left">
                          <span
                            className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                              order.side === 'BUY'
                                ? 'bg-pale-green text-deep-green'
                                : 'bg-pale-blue text-action-blue'
                            }`}
                          >
                            {order.side === 'BUY' ? 'Buy' : 'Sell'}
                          </span>
                          <span className="font-medium text-primary">
                            {order.instrument.symbol}
                          </span>
                        </Td>
                        <Td className="font-mono">
                          {order.execution?.quantity ?? order.filledQuantity}
                        </Td>
                        <Td className="font-mono">
                          {order.execution ? formatPaise(order.execution.pricePaise) : '—'}
                        </Td>
                        <Td className="font-mono">
                          {order.execution ? formatPaise(order.execution.grossAmountPaise) : '—'}
                        </Td>
                        <Td className="text-xs text-body-muted">
                          {formatISTDateTime(order.simulationTimestamp ?? order.submittedAt)} IST
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="ledger-heading">
            <h3 id="ledger-heading" className="mb-1 text-heading-feature text-primary">
              Cash ledger
            </h3>
            <p className="mb-3 text-xs text-muted">
              Immutable, auditable record of every cash movement.
            </p>
            <div className="overflow-x-auto rounded-sm border border-hairline">
              <table className="w-full min-w-[40rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-hairline text-left text-mono-label text-muted">
                    <Th className="text-left">Entry</Th>
                    <Th>Amount</Th>
                    <Th>Balance after</Th>
                    <Th>When</Th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((entry) => (
                    <tr key={entry.id} className="border-b border-hairline last:border-0">
                      <Td className="text-left">
                        <span className="font-medium text-primary">
                          {LEDGER_LABEL[entry.type] ?? entry.type}
                        </span>
                        {entry.description ? (
                          <span className="ml-2 text-body-muted">{entry.description}</span>
                        ) : null}
                      </Td>
                      <Td
                        className={`font-mono ${entry.amountPaise >= 0 ? 'text-gain' : 'text-loss'}`}
                      >
                        {formatSignedPaise(entry.amountPaise)}
                      </Td>
                      <Td className="font-mono">{formatPaise(entry.balanceAfterPaise)}</Td>
                      <Td className="text-xs text-body-muted">
                        {formatISTDateTime(entry.createdAt)} IST
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Frame>
  );
}

function Frame({ subtitle, children }: { subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <p className="text-mono-label text-muted">Activity</p>
        <h2 className="mt-2 text-display-section text-primary">History</h2>
        {subtitle ? <p className="mt-2 text-body-large text-body-muted">{subtitle}</p> : null}
      </header>
      {children}
    </div>
  );
}

function Th({
  children,
  className = 'text-right',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <th className={`px-3 py-2.5 font-normal ${className}`}>{children}</th>;
}

function Td({
  children,
  className = 'text-right',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-3 align-top ${className}`}>{children}</td>;
}

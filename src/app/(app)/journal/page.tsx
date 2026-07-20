import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { JournalEntryForm } from '@/features/journal/components/JournalEntryForm';
import { formatPaise } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { getActiveAccountId } from '@/server/services/accounts';
import { loadJournal, type JournalTradeView } from '@/server/services/journal';

export const metadata: Metadata = {
  title: 'Journal',
};

export default async function JournalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const accountId = await getActiveAccountId(userId);
  const trades = accountId ? await loadJournal({ userId, virtualAccountId: accountId }) : [];

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <p className="text-mono-label text-muted">Investment journal</p>
        <h2 className="mt-2 text-display-section text-primary">Record your reasoning</h2>
        <p className="mt-2 text-body-large text-body-muted">
          Capture the thesis behind each buy and the lesson from each sell for your active
          portfolio.
        </p>
      </header>

      {trades.length === 0 ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No trades to journal yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Once you place a trade in your active portfolio, it appears here for you to annotate.
          </p>
          <Link
            href="/instruments"
            className="mt-5 inline-block rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
          >
            Explore markets
          </Link>
        </section>
      ) : (
        <ul className="space-y-4">
          {trades.map((trade) => (
            <li key={trade.orderId} id={trade.orderId} className="scroll-mt-24">
              <TradeJournal trade={trade} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TradeJournal({ trade }: { trade: JournalTradeView }) {
  const isBuy = trade.side === 'BUY';
  const hasEntry = trade.entry !== null;

  return (
    <details className="rounded-sm border border-hairline bg-canvas" open={hasEntry}>
      <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-5 py-4">
        <span>
          <span
            className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${isBuy ? 'bg-pale-green text-deep-green' : 'bg-pale-blue text-action-blue'}`}
          >
            {isBuy ? 'Buy' : 'Sell'}
          </span>
          <span className="font-medium text-primary">
            {trade.quantity} {trade.symbol}
          </span>
          <span className="ml-2 text-sm text-body-muted">
            {trade.pricePaise === null ? '' : `@ ${formatPaise(trade.pricePaise)}`}
          </span>
        </span>
        <span className="flex items-center gap-3 text-xs text-muted">
          {hasEntry ? <span className="text-deep-green">Journaled</span> : <span>Add notes</span>}
          {formatISTDateTime(trade.timestamp)} IST
        </span>
      </summary>
      <div className="border-t border-hairline px-5 pb-5">
        <JournalEntryForm orderId={trade.orderId} side={trade.side} entry={trade.entry} />
      </div>
    </details>
  );
}

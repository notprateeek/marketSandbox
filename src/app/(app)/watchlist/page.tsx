import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  deleteWatchlistAction,
  moveWatchlistItemAction,
  removeWatchlistItemAction,
} from '@/app/actions/watchlist';
import { LivePriceRefresher } from '@/features/market-data/components/LivePriceRefresher';
import {
  AddInstrumentForm,
  CreateWatchlistForm,
} from '@/features/watchlist/components/WatchlistForms';
import { formatPaise, formatPercentage } from '@/lib/finance/currency';
import { prisma } from '@/lib/prisma';
import {
  listWatchlists,
  loadWatchlistItems,
  type WatchlistItemView,
} from '@/server/services/watchlist';

export const metadata: Metadata = {
  title: 'Watchlist',
};

export default async function WatchlistPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const watchlists = await listWatchlists(userId);

  const [lists, instruments] = await Promise.all([
    Promise.all(
      watchlists.map(async (watchlist) => ({
        ...watchlist,
        items: await loadWatchlistItems(watchlist.id, userId),
      })),
    ),
    prisma.instrument.findMany({
      where: { isActive: true },
      select: { id: true, symbol: true, companyName: true },
      orderBy: { symbol: 'asc' },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <LivePriceRefresher />
      <header className="mb-6">
        <p className="text-mono-label text-muted">Watchlists</p>
        <h2 className="mt-2 text-display-section text-primary">Stocks you&apos;re following</h2>
      </header>

      <div className="mb-6 rounded-sm border border-hairline bg-canvas p-4">
        <CreateWatchlistForm />
      </div>

      {lists.length === 0 ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No watchlists yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Create a watchlist above to start following stocks.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {lists.map((list, listIndex) => (
            <li key={list.id}>
              <WatchlistSection list={list} instruments={instruments} defaultOpen={listIndex === 0} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WatchlistSection({
  list,
  instruments,
  defaultOpen,
}: {
  list: { id: string; name: string; _count: { items: number }; items: WatchlistItemView[] };
  instruments: { id: string; symbol: string; companyName: string }[];
  defaultOpen: boolean;
}) {
  return (
    <details className="rounded-sm border border-hairline bg-canvas" open={defaultOpen}>
      <summary className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4">
        <span className="text-heading-feature text-primary">{list.name}</span>
        <span className="text-sm text-muted">
          {list._count.items} {list._count.items === 1 ? 'stock' : 'stocks'}
        </span>
      </summary>

      <div className="border-t border-hairline">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-3">
          <AddInstrumentForm watchlistId={list.id} instruments={instruments} />
          <form action={deleteWatchlistAction}>
            <input type="hidden" name="watchlistId" value={list.id} />
            <button
              type="submit"
              className="text-sm font-medium text-body-muted transition-colors hover:text-loss"
            >
              Delete watchlist
            </button>
          </form>
        </div>

        {list.items.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-body-muted">
            This watchlist is empty. Add an instrument above.
          </p>
        ) : (
          <ul className="divide-y divide-hairline">
            {list.items.map((item, index) => (
              <WatchlistRow
                key={item.itemId}
                item={item}
                isFirst={index === 0}
                isLast={index === list.items.length - 1}
              />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function WatchlistRow({
  item,
  isFirst,
  isLast,
}: {
  item: WatchlistItemView;
  isFirst: boolean;
  isLast: boolean;
}) {
  const gain = (item.changePercent ?? 0) >= 0;
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-3">
      <div className="flex flex-col">
        <MoveButton itemId={item.itemId} direction="UP" disabled={isFirst} />
        <MoveButton itemId={item.itemId} direction="DOWN" disabled={isLast} />
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-medium text-primary">{item.symbol}</p>
        <p className="truncate text-xs text-body-muted">{item.companyName}</p>
      </div>

      <div className="text-right">
        <p className="font-mono text-sm text-primary">
          {item.pricePaise === null ? '—' : formatPaise(item.pricePaise)}
        </p>
        <p
          className={`font-mono text-xs ${item.changePercent === null ? 'text-muted' : gain ? 'text-gain' : 'text-loss'}`}
        >
          {item.changePercent === null ? 'No data' : formatPercentage(item.changePercent)}
        </p>
      </div>

      <Link
        href={`/instruments/${item.instrumentId}`}
        className="rounded-pill border border-hairline px-3 py-1.5 text-sm font-medium text-action-blue transition-colors hover:bg-pale-blue"
      >
        Trade
      </Link>

      <form action={removeWatchlistItemAction}>
        <input type="hidden" name="itemId" value={item.itemId} />
        <button
          type="submit"
          aria-label={`Remove ${item.symbol}`}
          className="rounded-full border border-hairline px-2 py-1 text-sm text-body-muted transition-colors hover:border-loss hover:text-loss"
        >
          ✕
        </button>
      </form>
    </li>
  );
}

function MoveButton({
  itemId,
  direction,
  disabled,
}: {
  itemId: string;
  direction: 'UP' | 'DOWN';
  disabled: boolean;
}) {
  return (
    <form action={moveWatchlistItemAction}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="direction" value={direction} />
      <button
        type="submit"
        disabled={disabled}
        aria-label={direction === 'UP' ? 'Move up' : 'Move down'}
        className="px-1 text-xs text-muted transition-colors hover:text-primary disabled:opacity-30"
      >
        {direction === 'UP' ? '▲' : '▼'}
      </button>
    </form>
  );
}

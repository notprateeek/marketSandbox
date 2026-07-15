import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import {
  deleteWatchlistAction,
  moveWatchlistItemAction,
  removeWatchlistItemAction,
} from '@/app/actions/watchlist';
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

export default async function WatchlistPage({
  searchParams,
}: {
  searchParams: Promise<{ list?: string }>;
}) {
  const [session, query] = await Promise.all([auth(), searchParams]);
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const watchlists = await listWatchlists(userId);
  const selected = watchlists.find((watchlist) => watchlist.id === query.list) ?? watchlists[0];

  const [items, instruments] = await Promise.all([
    selected ? loadWatchlistItems(selected.id, userId) : Promise.resolve([]),
    prisma.instrument.findMany({
      where: { isActive: true },
      select: { id: true, symbol: true, companyName: true },
      orderBy: { symbol: 'asc' },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <p className="text-mono-label text-muted">Watchlists</p>
        <h2 className="mt-2 text-display-section text-primary">Stocks you&apos;re following</h2>
      </header>

      <div className="mb-6 rounded-sm border border-hairline bg-canvas p-4">
        <p className="mb-2 text-mono-label text-muted">Your watchlists</p>
        <div className="flex flex-wrap items-center gap-2">
          {watchlists.map((watchlist) => (
            <Link
              key={watchlist.id}
              href={`/watchlist?list=${watchlist.id}`}
              aria-current={selected?.id === watchlist.id ? 'page' : undefined}
              className={`rounded-pill border px-4 py-1.5 text-sm font-medium transition-colors ${
                selected?.id === watchlist.id
                  ? 'border-action-blue text-action-blue'
                  : 'border-hairline text-body-muted hover:border-slate'
              }`}
            >
              {watchlist.name} ({watchlist._count.items})
            </Link>
          ))}
        </div>
        <div className="mt-3 border-t border-hairline pt-3">
          <CreateWatchlistForm />
        </div>
      </div>

      {!selected ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No watchlists yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Create a watchlist above to start following stocks.
          </p>
        </section>
      ) : (
        <section
          aria-labelledby="watchlist-heading"
          className="rounded-sm border border-hairline bg-canvas"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline px-5 py-4">
            <h3 id="watchlist-heading" className="text-heading-feature text-primary">
              {selected.name}
            </h3>
            <form action={deleteWatchlistAction}>
              <input type="hidden" name="watchlistId" value={selected.id} />
              <button
                type="submit"
                className="text-sm font-medium text-body-muted transition-colors hover:text-loss"
              >
                Delete watchlist
              </button>
            </form>
          </div>

          <div className="border-b border-hairline px-5 py-3">
            <AddInstrumentForm watchlistId={selected.id} instruments={instruments} />
          </div>

          {items.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-body-muted">
              This watchlist is empty. Add an instrument above.
            </p>
          ) : (
            <ul className="divide-y divide-hairline">
              {items.map((item, index) => (
                <WatchlistRow
                  key={item.itemId}
                  item={item}
                  isFirst={index === 0}
                  isLast={index === items.length - 1}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
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

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { formatPercentage } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { loadFollowingFeed, type FeedItem } from '@/server/services/social';

export const metadata: Metadata = {
  title: 'Feed',
};

export default async function FeedPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const items = await loadFollowingFeed(session.user.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <p className="text-mono-label text-muted">Following</p>
        <h2 className="mt-2 text-display-section text-primary">Your feed</h2>
        <p className="mt-2 text-body-large text-body-muted">
          Recent challenge results and resolved predictions from the traders you follow.
        </p>
      </header>

      {items.length === 0 ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">Nothing here yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Follow public traders from their profile (/u/&lt;handle&gt;) to see their activity here.
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => (
            <li key={index}>
              <FeedRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedRow({ item }: { item: FeedItem }) {
  return (
    <article className="rounded-sm border border-hairline bg-canvas px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/u/${item.handle}`} className="text-sm font-medium text-action-blue hover:underline">
          @{item.handle}
        </Link>
        <span className="text-xs text-muted">{formatISTDateTime(item.timestamp)} IST</span>
      </div>
      {item.kind === 'CHALLENGE' ? (
        <p className="mt-1 text-sm text-primary">
          Finished <span className="font-medium">#{item.rank}</span> in {item.challengeName} at{' '}
          <span className={item.returnPercent >= 0 ? 'text-gain' : 'text-loss'}>
            {formatPercentage(item.returnPercent)}
          </span>
          .
        </p>
      ) : (
        <p className="mt-1 text-sm text-primary">
          Prediction on <span className="font-medium">{item.symbol}</span> resolved{' '}
          <span className={item.correct ? 'text-gain' : 'text-loss'}>
            {item.correct ? 'correct' : 'wrong'}
          </span>
          .
        </p>
      )}
    </article>
  );
}

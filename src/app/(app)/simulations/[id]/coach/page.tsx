import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { RegenerateReviewButton } from '@/features/coach/components/RegenerateReviewButton';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { loadCoachView } from '@/server/services/coach';

export const metadata: Metadata = {
  title: 'Coach',
};

export default async function CoachPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, session] = await Promise.all([params, auth()]);
  if (!session?.user?.id) redirect('/sign-in');

  const view = await loadCoachView(id, session.user.id);
  if (!view) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm">
        <Link href="/simulations" className="font-medium text-action-blue underline-offset-4 hover:underline">
          Simulations
        </Link>
        <span className="mx-2 text-muted">/</span>
        <Link
          href={`/simulations/${id}`}
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          {view.session.name}
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">Coach</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-mono-label text-muted">AI trading coach</p>
          <h2 className="mt-2 text-display-section text-primary">Your review</h2>
        </div>
        <Link
          href={`/simulations/${id}/analytics`}
          className="rounded-pill border border-hairline px-4 py-1.5 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
        >
          Analytics
        </Link>
      </header>

      {!view.hasKey ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-8">
          <h3 className="text-heading-card text-primary">The AI coach isn’t configured.</h3>
          <p className="mt-2 text-body-muted">
            Set <code className="rounded bg-soft-stone px-1">ANTHROPIC_API_KEY</code> on the server to
            enable AI-written reviews. Until then, the rule-based insights on the{' '}
            <Link href={`/simulations/${id}/analytics`} className="text-action-blue hover:underline">
              analytics page
            </Link>{' '}
            cover the essentials for free.
          </p>
        </section>
      ) : view.review ? (
        <>
          <article className="rounded-sm border border-hairline bg-canvas p-6">
            <div className="space-y-3 whitespace-pre-line text-body-large leading-relaxed text-primary">
              {view.review.markdown}
            </div>
            <p className="mt-5 border-t border-hairline pt-3 text-xs text-muted">
              Generated {formatISTDateTime(view.review.createdAt)} IST · {view.review.model} · after{' '}
              {view.review.tradeCountAtGeneration} closed trade
              {view.review.tradeCountAtGeneration === 1 ? '' : 's'} · educational, not financial advice.
            </p>
          </article>
          <div className="mt-5">
            <RegenerateReviewButton sessionId={id} label="Regenerate review" />
          </div>
        </>
      ) : (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-8">
          <h3 className="text-heading-card text-primary">No review yet.</h3>
          <p className="mt-2 mb-4 text-body-muted">
            Close a few trades in this simulation, then ask the coach for a review of how you did.
          </p>
          <RegenerateReviewButton sessionId={id} label="Ask the coach" />
        </section>
      )}
    </div>
  );
}

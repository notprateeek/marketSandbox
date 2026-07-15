import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { PredictionResultCard } from '@/features/prediction/components/PredictionResultCard';
import { loadResolvedPredictions } from '@/server/services/prediction';

export const metadata: Metadata = {
  title: 'Resolved predictions',
};

export default async function ResolvedPredictionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const predictions = await loadResolvedPredictions(session.user.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm">
        <Link
          href="/predictions"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Predictions
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">Resolved</span>
      </nav>

      <header className="mb-6">
        <p className="text-mono-label text-muted">Predictions</p>
        <h2 className="mt-2 text-display-section text-primary">Resolved predictions</h2>
        <p className="mt-2 text-body-large text-body-muted">
          How your calls turned out against the actual market.
        </p>
      </header>

      {predictions.length === 0 ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">Nothing resolved yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Predictions appear here once they pass their expiry (or you cancel them).
          </p>
          <Link
            href="/predictions"
            className="mt-5 inline-block rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
          >
            Record a prediction
          </Link>
        </section>
      ) : (
        <ul className="space-y-4">
          {predictions.map((prediction) => (
            <li key={prediction.id}>
              <PredictionResultCard prediction={prediction} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

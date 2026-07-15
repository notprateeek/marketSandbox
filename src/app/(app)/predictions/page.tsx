import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { cancelPredictionAction } from '@/app/actions/prediction';
import { AccuracyDashboard } from '@/features/prediction/components/AccuracyDashboard';
import { PredictionForm } from '@/features/prediction/components/PredictionForm';
import { LivePriceRefresher } from '@/features/market-data/components/LivePriceRefresher';
import { formatPaise, formatPercentage } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { prisma } from '@/lib/prisma';
import { loadPredictionsOverview, type PredictionView } from '@/server/services/prediction';

export const metadata: Metadata = {
  title: 'Predictions',
};

const DIRECTION_VERB: Record<string, string> = { UP: 'rise', DOWN: 'fall', FLAT: 'stay within' };

export default async function PredictionsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const [overview, instruments, simulations] = await Promise.all([
    loadPredictionsOverview(userId),
    prisma.instrument.findMany({
      where: { isActive: true },
      select: { id: true, symbol: true, companyName: true },
      orderBy: { symbol: 'asc' },
    }),
    prisma.simulationSession.findMany({
      where: { userId },
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <LivePriceRefresher />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-mono-label text-muted">Predictions</p>
          <h2 className="mt-2 text-display-section text-primary">Call the market</h2>
          <p className="mt-2 text-body-large text-body-muted">
            Record where you think a stock is headed, then compare it with what actually happened.
            Predictions never touch your cash or holdings.
          </p>
        </div>
        <Link
          href="/predictions/resolved"
          className="rounded-pill border border-hairline px-5 py-3 text-sm font-medium text-primary transition-colors hover:border-slate hover:bg-soft-stone"
        >
          Resolved ({overview.resolvedCount})
        </Link>
      </header>

      <div className="grid gap-8 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <PredictionForm instruments={instruments} simulations={simulations} />

        <div className="space-y-8">
          <AccuracyDashboard accuracy={overview.accuracy} />

          <section aria-labelledby="open-heading">
            <h3 id="open-heading" className="mb-3 text-heading-feature text-primary">
              Open predictions
            </h3>
            {overview.open.length === 0 ? (
              <p className="rounded-sm border border-dashed border-hairline px-4 py-8 text-center text-sm text-body-muted">
                No open predictions. Record one on the left.
              </p>
            ) : (
              <ul className="space-y-3">
                {overview.open.map((prediction) => (
                  <OpenPredictionRow key={prediction.id} prediction={prediction} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function OpenPredictionRow({ prediction }: { prediction: PredictionView }) {
  const hasLive = prediction.currentPricePaise != null;
  const reached = prediction.targetReachedNow === true;
  const onTrack = prediction.directionCorrectNow === true;
  const barWidth = Math.max(0, Math.min(100, prediction.progressPercent ?? 0));
  const fillClass = reached ? 'bg-gain' : onTrack ? 'bg-action-blue' : 'bg-loss';
  const move = prediction.currentMovementPercent;

  return (
    <li className="rounded-sm border border-hairline bg-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-primary">
            <Link href={`/instruments/${prediction.instrumentId}`} className="hover:underline">
              {prediction.symbol}
            </Link>{' '}
            <span className="font-normal text-body-muted">
              to {DIRECTION_VERB[prediction.direction]} {prediction.targetPercentage}% → target{' '}
              {formatPaise(prediction.targetPricePaise)}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {prediction.simulationName ? `Simulation: ${prediction.simulationName} · ` : ''}
            From {formatPaise(prediction.startingPricePaise)} · Expires{' '}
            {formatISTDateTime(prediction.expiryTimestamp)} IST
          </p>
        </div>
        {hasLive ? (
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              reached
                ? 'bg-pale-green text-deep-green'
                : onTrack
                  ? 'bg-pale-blue text-action-blue'
                  : 'bg-loss/10 text-loss'
            }`}
          >
            {reached ? 'Target hit' : onTrack ? 'On track' : 'Off track'}
          </span>
        ) : null}
      </div>

      {hasLive ? (
        <div className="mt-3">
          <div className="flex items-baseline justify-between gap-3">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-lg text-primary">
                {formatPaise(prediction.currentPricePaise!)}
              </span>
              {move != null ? (
                <span className={`text-sm font-medium ${move >= 0 ? 'text-gain' : 'text-loss'}`}>
                  {formatPercentage(move)}
                </span>
              ) : null}
            </div>
            <span className="text-xs text-muted">
              {Math.round(prediction.progressPercent ?? 0)}% to target
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-soft-stone">
            <div className={`h-full rounded-full ${fillClass}`} style={{ width: `${barWidth}%` }} />
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">Live price unavailable.</p>
      )}

      <div className="mt-3 flex justify-end">
        <form action={cancelPredictionAction}>
          <input type="hidden" name="predictionId" value={prediction.id} />
          <button
            type="submit"
            className="rounded-pill border border-hairline px-4 py-1.5 text-sm font-medium text-body-muted transition-colors hover:border-loss hover:text-loss"
          >
            Cancel
          </button>
        </form>
      </div>
    </li>
  );
}

import { formatPaise, formatPercentage } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import type { PredictionView } from '@/server/services/prediction';

const DIRECTION_VERB: Record<string, string> = {
  UP: 'rise',
  DOWN: 'fall',
  FLAT: 'stay within',
};

export function PredictionResultCard({ prediction }: { prediction: PredictionView }) {
  return (
    <article className="rounded-sm border border-hairline bg-canvas p-5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium text-primary">
            {prediction.symbol}{' '}
            <span className="font-normal text-body-muted">
              predicted to {DIRECTION_VERB[prediction.direction]} {prediction.targetPercentage}%
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {prediction.simulationName ? `Simulation: ${prediction.simulationName} · ` : ''}
            {formatISTDateTime(prediction.predictionTimestamp)} →{' '}
            {formatISTDateTime(prediction.expiryTimestamp)} IST
          </p>
        </div>
        <StatusBadge prediction={prediction} />
      </header>

      {prediction.status === 'RESOLVED' ? (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <Detail label="Start" value={formatPaise(prediction.startingPricePaise)} />
            <Detail label="Target" value={formatPaise(prediction.targetPricePaise)} />
            <Detail
              label="Ending"
              value={
                prediction.endingPricePaise === null
                  ? '—'
                  : formatPaise(prediction.endingPricePaise)
              }
            />
            <Detail
              label="Actual move"
              value={
                prediction.actualMovementPercent === null
                  ? '—'
                  : formatPercentage(prediction.actualMovementPercent)
              }
              tone={toneOf(prediction.actualMovementPercent)}
            />
          </dl>

          <div className="mt-4 flex flex-wrap gap-2">
            <ResultChip ok={prediction.directionCorrect === true} label="Direction" />
            <ResultChip ok={prediction.targetReached === true} label="Target" />
            {prediction.absolutePercentageErrorPercent !== null ? (
              <span className="rounded-full bg-soft-stone/70 px-3 py-1 text-xs text-body-muted">
                Error {prediction.absolutePercentageErrorPercent.toFixed(1)}%
              </span>
            ) : null}
            {prediction.timeToTargetMs !== null ? (
              <span className="rounded-full bg-soft-stone/70 px-3 py-1 text-xs text-body-muted">
                Reached in {formatDuration(prediction.timeToTargetMs)}
              </span>
            ) : null}
          </div>
        </>
      ) : (
        <p className="mt-3 text-sm text-body-muted">
          {prediction.status === 'CANCELLED'
            ? 'Cancelled — excluded from accuracy.'
            : 'Expired without a price to evaluate against.'}
        </p>
      )}

      {prediction.notes ? (
        <p className="mt-4 border-t border-hairline pt-3 text-sm text-body-muted">
          {prediction.notes}
        </p>
      ) : null}
    </article>
  );
}

function StatusBadge({ prediction }: { prediction: PredictionView }) {
  if (prediction.status !== 'RESOLVED') {
    return (
      <span className="rounded-full bg-soft-stone px-3 py-1 text-xs font-medium text-body-muted">
        {prediction.status}
      </span>
    );
  }
  const correct = prediction.directionCorrect === true;
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${correct ? 'bg-pale-green text-deep-green' : 'bg-loss/10 text-loss'}`}
    >
      {correct ? 'Direction correct' : 'Direction wrong'}
    </span>
  );
}

function ResultChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
        ok ? 'bg-pale-green text-deep-green' : 'bg-soft-stone/70 text-body-muted'
      }`}
    >
      <span aria-hidden="true">{ok ? '✓' : '×'}</span>
      {label} {ok ? 'hit' : 'missed'}
    </span>
  );
}

function Detail({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const toneClass = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-primary';
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 font-mono ${toneClass}`}>{value}</dd>
    </div>
  );
}

function toneOf(value: number | null): 'gain' | 'loss' | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? 'gain' : 'loss';
}

function formatDuration(ms: number): string {
  const hours = Math.round(ms / (60 * 60 * 1_000));
  if (hours < 1) return '<1 hour';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

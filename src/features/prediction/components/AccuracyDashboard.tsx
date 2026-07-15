import type { AccuracyBucket, AccuracySummary } from '@/lib/finance/prediction';

export function AccuracyDashboard({ accuracy }: { accuracy: AccuracySummary }) {
  if (accuracy.total === 0) {
    return (
      <section aria-labelledby="accuracy-heading">
        <h3 id="accuracy-heading" className="mb-3 text-heading-feature text-primary">
          Accuracy
        </h3>
        <p className="rounded-sm border border-dashed border-hairline px-4 py-8 text-center text-sm text-body-muted">
          No resolved predictions yet. Accuracy appears once your predictions pass their expiry.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="accuracy-heading">
      <h3 id="accuracy-heading" className="mb-3 text-heading-feature text-primary">
        Accuracy
      </h3>

      <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline">
        <Stat label="Resolved" value={`${accuracy.total}`} />
        <Stat label="Direction" value={pct(accuracy.directionAccuracyPercent)} />
        <Stat label="Target" value={pct(accuracy.targetAccuracyPercent)} />
      </dl>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <BucketTable title="By stock" heading="Stock" buckets={accuracy.byStock} />
        <BucketTable title="By duration" heading="Horizon" buckets={accuracy.byDuration} />
      </div>
    </section>
  );
}

function BucketTable({
  title,
  heading,
  buckets,
}: {
  title: string;
  heading: string;
  buckets: AccuracyBucket[];
}) {
  return (
    <div className="rounded-sm border border-hairline bg-canvas p-4">
      <h4 className="text-mono-label text-muted">{title}</h4>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[22rem] text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-xs text-muted">
              <th className="py-2 pr-3 font-normal">{heading}</th>
              <th className="py-2 pr-3 text-right font-normal">N</th>
              <th className="py-2 pr-3 text-right font-normal">Direction</th>
              <th className="py-2 text-right font-normal">Target</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((bucket) => (
              <tr key={bucket.key} className="border-b border-hairline last:border-0">
                <td className="py-2 pr-3 text-primary">{bucket.label}</td>
                <td className="py-2 pr-3 text-right font-mono text-body-muted">{bucket.total}</td>
                <td className="py-2 pr-3 text-right font-mono text-primary">
                  {pct(bucket.directionAccuracyPercent)}
                </td>
                <td className="py-2 text-right font-mono text-primary">
                  {pct(bucket.targetAccuracyPercent)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-canvas px-4 py-4">
      <dt className="text-mono-label text-muted">{label}</dt>
      <dd className="mt-2 font-mono text-lg font-medium text-primary">{value}</dd>
    </div>
  );
}

function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(0)}%`;
}

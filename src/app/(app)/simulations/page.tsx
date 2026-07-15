import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { formatPaise } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { listSimulations } from '@/server/services/simulation';

export const metadata: Metadata = {
  title: 'Simulations',
};

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-pale-green text-deep-green',
  PAUSED: 'bg-soft-stone text-body-muted',
  COMPLETED: 'bg-pale-blue text-action-blue',
  DRAFT: 'bg-soft-stone text-body-muted',
};

export default async function SimulationsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const simulations = await listSimulations(session.user.id);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-mono-label text-muted">Historical replay</p>
          <h2 className="mt-2 text-display-section text-primary">Simulations</h2>
          <p className="mt-2 text-body-large text-body-muted">
            Start a virtual portfolio at a past date and move the clock forward.
          </p>
        </div>
        <Link
          href="/simulations/new"
          className="rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
        >
          New simulation
        </Link>
      </header>

      {simulations.length === 0 ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No simulations yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Replay history: pick a starting point, invest virtual cash, and step through time to see
            how your decisions would have played out.
          </p>
          <Link
            href="/simulations/new"
            className="mt-5 inline-block rounded-pill bg-primary px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
          >
            Create your first simulation
          </Link>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {simulations.map((simulation) => (
            <li key={simulation.id}>
              <Link
                href={`/simulations/${simulation.id}`}
                className="block rounded-sm border border-hairline bg-canvas p-5 transition-colors hover:border-slate"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium text-primary">{simulation.name}</h3>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[simulation.status] ?? ''}`}
                  >
                    {simulation.status}
                  </span>
                </div>
                <dl className="mt-4 space-y-1.5 text-sm">
                  <Row
                    label="Clock at"
                    value={`${formatISTDateTime(simulation.currentTimestamp)} IST`}
                  />
                  <Row
                    label="Started from"
                    value={`${formatISTDateTime(simulation.startTimestamp)} IST`}
                  />
                  <Row
                    label="Opening balance"
                    value={formatPaise(simulation.initialBalancePaise)}
                  />
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-body-muted">{label}</dt>
      <dd className="text-right font-medium text-primary">{value}</dd>
    </div>
  );
}

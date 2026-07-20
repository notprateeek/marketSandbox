import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { StartScenarioForm } from '@/features/scenario/components/StartScenarioForm';
import { formatINR } from '@/lib/finance/currency';
import { formatISTDate } from '@/lib/finance/datetime';
import { listScenarioPacks, type ScenarioPackView } from '@/server/services/scenario';

export const metadata: Metadata = {
  title: 'Scenarios',
};

export default async function ScenariosPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const packs = await listScenarioPacks();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6">
        <p className="text-mono-label text-muted">Historical replays</p>
        <h2 className="mt-2 text-display-section text-primary">Trade through market history</h2>
        <p className="mt-2 text-body-large text-body-muted">
          Drop into a real market event with a fixed budget. Advance the clock, place your trades,
          and read the story as it unfolds — then review a debrief of how you did.
        </p>
      </header>

      {packs.length === 0 ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No scenarios loaded yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">
            Run <code className="rounded bg-soft-stone px-1">npm run db:seed:scenarios</code> to load
            the curated event packs.
          </p>
        </section>
      ) : (
        <ul className="space-y-4">
          {packs.map((pack) => (
            <li key={pack.id}>
              <ScenarioCard pack={pack} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioCard({ pack }: { pack: ScenarioPackView }) {
  return (
    <article className="rounded-sm border border-hairline bg-canvas p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-heading-card text-primary">{pack.title}</h3>
          <p className="mt-1 text-sm text-body-muted">
            {formatISTDate(pack.startTimestamp)} – {formatISTDate(pack.endTimestamp)} ·{' '}
            {formatINR(Number(pack.startingBalancePaise) / 100)} to invest ·{' '}
            {pack.checkpoints.length} checkpoints
          </p>
        </div>
        <StartScenarioForm slug={pack.slug} />
      </div>
      <p className="mt-3 text-body-muted">{pack.description}</p>
    </article>
  );
}

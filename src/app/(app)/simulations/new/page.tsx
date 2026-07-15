import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { toISTInputValue } from '@/lib/finance/datetime';
import { SimulationWizard } from '@/features/simulation/components/SimulationWizard';
import { getDataRange } from '@/server/services/simulation';

export const metadata: Metadata = {
  title: 'New simulation',
};

export default async function NewSimulationPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const { min, max } = await getDataRange();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm">
        <Link
          href="/simulations"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Simulations
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">New</span>
      </nav>

      <header className="mb-8">
        <p className="text-mono-label text-muted">Create</p>
        <h2 className="mt-2 text-display-section text-primary">New simulation</h2>
      </header>

      {min && max ? (
        <SimulationWizard
          minLocal={toISTInputValue(min)}
          maxLocal={toISTInputValue(max)}
          defaultLocal={toISTInputValue(min)}
        />
      ) : (
        <p className="rounded-sm border border-hairline bg-soft-stone/30 px-4 py-6 text-body-muted">
          No market data has been imported yet, so a simulation cannot be started.
        </p>
      )}
    </div>
  );
}

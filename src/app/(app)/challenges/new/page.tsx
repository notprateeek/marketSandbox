import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ChallengeExplainer } from '@/features/challenge/components/ChallengeExplainer';
import { CreateChallengeForm } from '@/features/challenge/components/CreateChallengeForm';
import { prisma } from '@/lib/prisma';

export const metadata: Metadata = {
  title: 'New challenge',
};

export default async function NewChallengePage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const instruments = await prisma.instrument.findMany({
    where: { isActive: true },
    select: { id: true, symbol: true, companyName: true },
    orderBy: { symbol: 'asc' },
  });

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm">
        <Link
          href="/challenges"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Challenges
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">New</span>
      </nav>

      <header className="mb-6">
        <p className="text-mono-label text-muted">Create</p>
        <h2 className="mt-2 text-display-section text-primary">New challenge</h2>
        <p className="mt-2 text-body-muted">
          Set the rules below. Participants each get their own virtual account and compete on the
          single metric you pick.
        </p>
      </header>

      <div className="mb-8">
        <ChallengeExplainer />
      </div>

      <CreateChallengeForm instruments={instruments} />
    </div>
  );
}

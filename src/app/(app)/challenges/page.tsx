import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ChallengeExplainer } from '@/features/challenge/components/ChallengeExplainer';
import { JoinByCodeForm } from '@/features/challenge/components/JoinByCodeForm';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { listChallenges } from '@/server/services/challenge';

export const metadata: Metadata = {
  title: 'Challenges',
};

const SCORING_LABEL: Record<string, string> = {
  RETURN: 'Highest return',
  DRAWDOWN: 'Lowest drawdown',
  PREDICTION_ACCURACY: 'Best prediction accuracy',
};
const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-pale-green text-deep-green',
  COMPLETED: 'bg-pale-blue text-action-blue',
  DRAFT: 'bg-soft-stone text-body-muted',
  CANCELLED: 'bg-soft-stone text-body-muted',
};

export default async function ChallengesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');

  const challenges = await listChallenges(session.user.id);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-mono-label text-muted">Educational challenges</p>
          <h2 className="mt-2 text-display-section text-primary">Compete on skill, not money</h2>
          <p className="mt-2 text-body-large text-body-muted">
            Join a challenge to trade an isolated virtual account and climb a leaderboard. No real
            money is ever involved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <JoinByCodeForm />
          <Link
            href="/challenges/new"
            className="rounded-pill bg-primary px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
          >
            New challenge
          </Link>
        </div>
      </header>

      <div className="mb-8">
        <ChallengeExplainer />
      </div>

      {challenges.length === 0 ? (
        <section className="rounded-sm border border-hairline bg-soft-stone/30 px-6 py-10 text-center">
          <h3 className="text-heading-card text-primary">No challenges yet.</h3>
          <p className="mx-auto mt-2 max-w-md text-body-muted">Create one to get started.</p>
        </section>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {challenges.map((challenge) => (
            <li key={challenge.id}>
              <Link
                href={`/challenges/${challenge.id}`}
                className="block rounded-sm border border-hairline bg-canvas p-5 transition-colors hover:border-slate"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium text-primary">{challenge.name}</h3>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[challenge.status] ?? ''}`}
                  >
                    {challenge.status}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-body-muted">{challenge.description}</p>
                {challenge.recurrence || challenge.sponsorName ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {challenge.recurrence ? (
                      <span className="rounded-full bg-pale-green px-2.5 py-0.5 text-xs font-medium text-deep-green">
                        Weekly
                      </span>
                    ) : null}
                    {challenge.sponsorName ? (
                      <span className="rounded-full bg-soft-stone px-2.5 py-0.5 text-xs font-medium text-body-muted">
                        Sponsored by {challenge.sponsorName}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <dl className="mt-4 space-y-1.5 text-sm">
                  <Row
                    label="Scoring"
                    value={SCORING_LABEL[challenge.scoringMethod] ?? challenge.scoringMethod}
                  />
                  <Row label="Participants" value={`${challenge.participantCount}`} />
                  <Row label="Ends" value={`${formatISTDateTime(challenge.endTimestamp)} IST`} />
                </dl>
                {challenge.joined ? (
                  <p className="mt-3 text-xs font-medium text-action-blue">You&apos;ve joined</p>
                ) : null}
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

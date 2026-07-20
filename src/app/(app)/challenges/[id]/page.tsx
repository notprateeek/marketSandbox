import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { joinChallengeAction } from '@/app/actions/challenge';
import { PageNav } from '@/components/PageNav';
import { Leaderboard } from '@/features/challenge/components/Leaderboard';
import { formatPaise } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';
import { getChallenge, loadLeaderboard } from '@/server/services/challenge';

export const metadata: Metadata = {
  title: 'Challenge',
};

const SCORING_LABEL: Record<string, string> = {
  RETURN: 'Highest percentage return',
  DRAWDOWN: 'Lowest maximum drawdown',
  PREDICTION_ACCURACY: 'Best prediction accuracy',
};

export default async function ChallengeDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const [{ id }, { cursor }, session] = await Promise.all([params, searchParams, auth()]);
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;

  const detail = await getChallenge(id, userId);
  if (!detail) notFound();
  const board = await loadLeaderboard(id, userId, { cursor });

  const {
    challenge,
    participation,
    registrationOpen,
    allowedInstrumentCount: allowedCount,
  } = detail;
  const isPrivate = challenge.visibility === 'PRIVATE';
  const canSeeInvite = challenge.creatorId === userId || participation !== null;
  const needsCodeToJoin = isPrivate && !canSeeInvite;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:px-6 md:py-8">
      <nav aria-label="Breadcrumb" className="mb-5 text-sm">
        <Link
          href="/challenges"
          className="font-medium text-action-blue underline-offset-4 hover:underline"
        >
          Challenges
        </Link>
        <span className="mx-2 text-muted">/</span>
        <span className="text-body-muted">{challenge.name}</span>
      </nav>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-mono-label text-muted">{SCORING_LABEL[challenge.scoringMethod]}</p>
          <h2 className="mt-2 text-display-section text-primary">{challenge.name}</h2>
          <p className="mt-2 max-w-2xl text-body-muted">{challenge.description}</p>
        </div>
        <span className="rounded-full bg-soft-stone px-3 py-1 text-xs font-medium text-body-muted">
          {challenge.status}
        </span>
      </header>

      {challenge.sponsorName ? (
        <div className="mb-6 flex items-center gap-3 rounded-sm border border-hairline bg-soft-stone/30 px-4 py-3">
          {challenge.sponsorLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- arbitrary sponsor host; no next/image allowlist
            <img
              src={challenge.sponsorLogoUrl}
              alt={challenge.sponsorName}
              className="h-8 w-auto max-w-[140px] object-contain"
            />
          ) : null}
          <p className="text-sm text-body-muted">
            Sponsored by <span className="font-medium text-primary">{challenge.sponsorName}</span>
          </p>
        </div>
      ) : null}

      {isPrivate && canSeeInvite && challenge.inviteCode ? (
        <div className="mb-6 rounded-sm border border-action-blue/30 bg-pale-blue/40 px-4 py-3">
          <p className="text-mono-label text-action-blue">Invite code</p>
          <p className="mt-1 flex items-center gap-3">
            <code className="rounded bg-canvas px-2 py-1 font-mono text-lg tracking-widest text-primary">
              {challenge.inviteCode}
            </code>
            <span className="text-sm text-body-muted">Share this code so others can join.</span>
          </p>
        </div>
      ) : null}

      {challenge.status === 'COMPLETED' && board ? (
        <section className="mb-6 rounded-sm border border-action-blue/30 bg-pale-blue px-5 py-5">
          <p className="text-mono-label text-action-blue">Challenge complete</p>
          <p className="mt-2 text-body-large text-primary">
            {board.winner ? `🏆 ${board.winner.displayName} finished first.` : 'No participants.'}
          </p>
          {board.personalRank ? (
            <p className="mt-1 text-sm text-body-muted">
              You finished #{board.personalRank} of {board.total}.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Join / participation */}
      <section className="mb-6 rounded-sm border border-hairline bg-canvas p-5">
        {participation ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-primary">
              You joined this challenge
              {board?.personalRank ? ` · currently ranked #${board.personalRank}` : ''}.
            </p>
            <Link
              href={`/challenges/${id}/portfolio`}
              className="rounded-pill bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
            >
              Open challenge portfolio
            </Link>
          </div>
        ) : registrationOpen ? (
          <form
            action={joinChallengeAction}
            className="flex flex-wrap items-center justify-between gap-3"
          >
            <input type="hidden" name="challengeId" value={id} />
            <p className="text-sm text-body-muted">
              Registration closes {formatISTDateTime(challenge.startTimestamp)} IST.
              {needsCodeToJoin ? ' This is a private challenge — enter its invite code to join.' : ''}
            </p>
            <div className="flex items-center gap-2">
              {needsCodeToJoin ? (
                <input
                  name="inviteCode"
                  type="text"
                  required
                  maxLength={16}
                  placeholder="Invite code"
                  aria-label="Invite code"
                  className="h-10 w-40 rounded-sm border border-hairline bg-canvas px-3 text-sm uppercase tracking-wide text-primary focus:border-focus-blue"
                />
              ) : null}
              <button
                type="submit"
                className="rounded-pill bg-primary px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cohere-black"
              >
                Join challenge
              </button>
            </div>
          </form>
        ) : (
          <p className="text-sm text-body-muted">Registration for this challenge is closed.</p>
        )}
      </section>

      {/* Rules (read-only) */}
      <section aria-labelledby="rules-heading" className="mb-8">
        <h3 id="rules-heading" className="mb-3 text-heading-feature text-primary">
          Rules
        </h3>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline sm:grid-cols-3">
          <Rule label="Scoring" value={SCORING_LABEL[challenge.scoringMethod]} />
          <Rule label="Starting balance" value={formatPaise(challenge.startingBalancePaise)} />
          <Rule
            label="Max trades"
            value={challenge.maxTrades === null ? 'Unlimited' : `${challenge.maxTrades}`}
          />
          <Rule label="Starts" value={`${formatISTDateTime(challenge.startTimestamp)} IST`} />
          <Rule label="Ends" value={`${formatISTDateTime(challenge.endTimestamp)} IST`} />
          <Rule label="Reset allowed" value={challenge.resetAllowed ? 'Yes' : 'No'} />
          <Rule
            label="Instruments"
            value={allowedCount === null ? 'All' : `${allowedCount} allowed`}
          />
          <Rule label="Visibility" value={challenge.visibility} />
          <Rule label="Repeats" value={challenge.recurrence === 'WEEKLY' ? 'Weekly' : 'One-off'} />
          <Rule label="Participants" value={`${challenge._count.participants}`} />
        </dl>
        <p className="mt-2 text-xs text-body-muted">
          Rankings use one metric only and are frozen from finalized snapshots. Ties break by
          earliest join time. No real money, deposits or withdrawals are involved.
        </p>
      </section>

      {/* Leaderboard */}
      <section aria-labelledby="leaderboard-heading">
        <h3 id="leaderboard-heading" className="mb-3 text-heading-feature text-primary">
          Leaderboard
        </h3>
        {board ? (
          <>
            <Leaderboard
              rows={board.rows}
              scoringMethod={challenge.scoringMethod}
              finalized={board.finalized}
            />
            <PageNav
              basePath={`/challenges/${id}`}
              cursor={cursor}
              nextCursor={board.nextCursor}
              olderLabel="Show more"
            />
          </>
        ) : null}
      </section>
    </div>
  );
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-canvas px-4 py-3">
      <dt className="text-mono-label text-muted">{label}</dt>
      <dd className="mt-1.5 text-sm font-medium text-primary">{value}</dd>
    </div>
  );
}

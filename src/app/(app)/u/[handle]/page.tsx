import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { auth } from '@/auth';
import { ProfileActions } from '@/features/social/components/ProfileActions';
import { formatPercentage } from '@/lib/finance/currency';
import { formatISTDate } from '@/lib/finance/datetime';
import { loadPublicProfile } from '@/server/services/social';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle}` };
}

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ handle: string }>;
}) {
  const [{ handle }, session] = await Promise.all([params, auth()]);
  if (!session?.user?.id) redirect('/sign-in');

  const profile = await loadPublicProfile(handle, session.user.id);
  if (!profile) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:px-6 md:py-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-deep-green text-2xl font-medium text-white">
            {profile.name.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <h2 className="text-display-section text-primary">{profile.name}</h2>
            <p className="text-sm text-body-muted">
              @{profile.handle} · joined {formatISTDate(profile.joinedAt)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {profile.followerCount} follower{profile.followerCount === 1 ? '' : 's'} ·{' '}
              {profile.followingCount} following
            </p>
          </div>
        </div>
        <ProfileActions
          handle={profile.handle}
          isFollowing={profile.isFollowing}
          isSelf={profile.isSelf}
        />
      </header>

      {profile.bio ? <p className="mb-6 text-body-muted">{profile.bio}</p> : null}

      <section
        aria-label="Performance"
        className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-sm border border-hairline bg-hairline sm:grid-cols-4"
      >
        <Stat
          label="Return"
          value={profile.returnPercent === null ? '—' : formatPercentage(profile.returnPercent)}
          tone={toneOf(profile.returnPercent)}
        />
        <Stat
          label="Win rate"
          value={profile.winRatePercent === null ? '—' : `${profile.winRatePercent.toFixed(0)}%`}
        />
        <Stat label="Round-trips" value={`${profile.closedTrades}`} />
        <Stat label="Best streak" value={`${profile.streakLongest} day${profile.streakLongest === 1 ? '' : 's'}`} />
      </section>

      {profile.badges.length > 0 ? (
        <section className="mb-8">
          <h3 className="mb-2 text-heading-feature text-primary">Badges</h3>
          <ul className="flex flex-wrap gap-2">
            {profile.badges.map((badge) => (
              <li
                key={badge.key}
                className="rounded-pill bg-pale-green px-3 py-1 text-xs font-medium text-deep-green"
              >
                {badge.label}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section>
        <h3 className="mb-3 text-heading-feature text-primary">Challenge history</h3>
        {profile.challengeHistory.length === 0 ? (
          <p className="rounded-sm border border-hairline bg-soft-stone/30 px-4 py-6 text-sm text-body-muted">
            No finished challenges yet.
          </p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-sm border border-hairline bg-canvas">
            {profile.challengeHistory.map((entry, index) => (
              <li key={index} className="flex items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-primary">{entry.challengeName}</p>
                  <p className="text-xs text-muted">{formatISTDate(entry.finalizedAt)}</p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-sm text-primary">#{entry.rank}</p>
                  <p className={`font-mono text-xs ${entry.returnPercent >= 0 ? 'text-gain' : 'text-loss'}`}>
                    {formatPercentage(entry.returnPercent)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'gain' | 'loss' }) {
  const toneClass = tone === 'gain' ? 'text-gain' : tone === 'loss' ? 'text-loss' : 'text-primary';
  return (
    <div className="bg-canvas px-4 py-4">
      <p className="text-mono-label text-muted">{label}</p>
      <p className={`mt-2 font-mono text-base font-medium ${toneClass}`}>{value}</p>
    </div>
  );
}

function toneOf(value: number | null): 'gain' | 'loss' | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? 'gain' : 'loss';
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { BuyFundsCheckout } from '@/features/profile/components/BuyFundsCheckout';
import { ProfileSettingsForm } from '@/features/social/components/ProfileSettingsForm';
import { formatINR } from '@/lib/finance/currency';
import { formatISTDate } from '@/lib/finance/datetime';
import { prisma } from '@/lib/prisma';
import { getActiveAccountId, listPortfolios } from '@/server/services/accounts';

export const metadata: Metadata = {
  title: 'Profile',
};

export default async function ProfilePage() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect('/sign-in');

  const [user, portfolios, activeId] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, createdAt: true, handle: true, bio: true, isPublic: true },
    }),
    listPortfolios(userId),
    getActiveAccountId(userId),
  ]);

  const name = user?.name?.trim() || 'Trader';
  const active = portfolios.find((portfolio) => portfolio.id === activeId) ?? portfolios[0];
  const totalCashPaise = portfolios.reduce(
    (sum, portfolio) => sum + portfolio.availableCashPaise,
    0n,
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      {/* Identity */}
      <section className="mb-8 flex items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-deep-green text-2xl font-medium text-white">
          {initials(name)}
        </div>
        <div>
          <p className="text-mono-label text-muted">Your profile</p>
          <h2 className="mt-1 text-display-section text-primary">{name}</h2>
          <p className="mt-1 text-sm text-body-muted">
            {user?.email}
            {user?.createdAt ? ` · Member since ${formatISTDate(user.createdAt)}` : null}
          </p>
        </div>
      </section>

      {/* Funds summary */}
      <section className="mb-8 grid gap-4 sm:grid-cols-2">
        <div className="rounded-sm border border-hairline bg-canvas p-5">
          <p className="text-mono-label text-muted">Active portfolio cash</p>
          <p className="mt-2 font-display text-3xl tracking-tight text-primary">
            {active ? formatINR(Number(active.availableCashPaise) / 100) : '—'}
          </p>
          <p className="mt-1 text-sm text-body-muted">{active ? active.name : 'No portfolio'}</p>
        </div>
        <div className="rounded-sm border border-hairline bg-canvas p-5">
          <p className="text-mono-label text-muted">Total across portfolios</p>
          <p className="mt-2 font-display text-3xl tracking-tight text-primary">
            {formatINR(Number(totalCashPaise) / 100)}
          </p>
          <p className="mt-1 text-sm text-body-muted">
            {portfolios.length} {portfolios.length === 1 ? 'portfolio' : 'portfolios'}
          </p>
        </div>
      </section>

      {/* Public profile settings */}
      <section className="mb-8 rounded-sm border border-hairline bg-canvas p-5">
        <h3 className="text-heading-feature text-primary">Public profile</h3>
        <p className="mt-1 mb-4 text-sm text-body-muted">
          Claim a handle and choose whether to share your stats. Private by default.
        </p>
        <ProfileSettingsForm
          handle={user?.handle ?? null}
          bio={user?.bio ?? null}
          isPublic={user?.isPublic ?? false}
        />
      </section>

      {/* Buy funds — highlight */}
      <section>
        {active ? (
          <BuyFundsCheckout activePortfolioName={active.name} />
        ) : (
          <div className="rounded-sm border border-hairline bg-canvas p-5">
            <h3 className="text-heading-feature text-primary">Buy virtual funds</h3>
            <p className="mt-2 text-sm text-body-muted">
              You need an open portfolio first.{' '}
              <Link href="/" className="font-medium text-action-blue hover:underline">
                Create one
              </Link>
              .
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'T';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

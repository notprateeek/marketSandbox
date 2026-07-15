'use client';

import { usePathname } from 'next/navigation';
import { signOutAction } from '@/app/actions/auth';
import { MarketStatusBadge } from './MarketStatusBadge';
import { isNavItemActive, navItems } from './navigation';

interface HeaderProps {
  onMenuToggle: () => void;
}

export function Header({ onMenuToggle }: HeaderProps) {
  const pathname = usePathname();

  // Derive page title from current path
  const currentNav = navItems.find((item) => isNavItemActive(pathname, item.href));
  const pageTitle = currentNav?.label ?? 'Dashboard';

  return (
    <header
      id="header"
      className="sticky top-0 z-20 flex h-[var(--header-height)] items-center border-b border-border-light bg-canvas px-4 md:px-6"
    >
      {/* Mobile menu trigger */}
      <button
        id="mobile-menu-trigger"
        type="button"
        onClick={onMenuToggle}
        className="mr-3 flex h-10 w-10 items-center justify-center rounded-sm text-ink transition-colors hover:bg-soft-stone md:hidden"
        aria-label="Open navigation menu"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
          />
        </svg>
      </button>

      {/* Page title */}
      <h1 className="text-heading-card text-primary">{pageTitle}</h1>

      <div className="ml-auto flex items-center gap-3">
        <MarketStatusBadge />
        <form action={signOutAction}>
          <input type="hidden" name="redirectTo" value="/sign-in" />
          <button
            type="submit"
            className="rounded-pill border border-hairline px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:border-slate hover:bg-soft-stone"
          >
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, navItems } from './navigation';

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside
      id="sidebar"
      className="fixed left-0 top-0 z-30 hidden h-full w-[var(--sidebar-width)] flex-col bg-deep-green md:flex"
    >
      {/* Brand */}
      <div className="flex h-[var(--header-height)] items-center px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-white/10">
            <svg
              className="h-5 w-5 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 18 9 11.25l4.306 4.306a11.95 11.95 0 0 1 5.814-5.518l2.74-1.22m0 0-5.94-2.281m5.94 2.28-2.28 5.941"
              />
            </svg>
          </div>
          <span className="font-display text-lg tracking-tight text-white">TradePlay</span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex-1 px-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  id={`nav-${item.label.toLowerCase()}`}
                  className={`
                    flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium transition-colors
                    ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-white/60 hover:bg-white/8 hover:text-white/90'
                    }
                  `}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 px-4 py-4">
        <p className="text-mono-label text-white/40">Paper Trading</p>
      </div>
    </aside>
  );
}

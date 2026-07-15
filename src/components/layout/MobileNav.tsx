'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isNavItemActive, navItems } from './navigation';

interface MobileNavProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileNav({ isOpen, onClose }: MobileNavProps) {
  const pathname = usePathname();

  // Close nav when route changes
  useEffect(() => {
    onClose();
  }, [pathname, onClose]);

  // Prevent body scroll when nav is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  return (
    <>
      {/* Backdrop */}
      <div
        id="mobile-nav-backdrop"
        className={`
          fixed inset-0 z-40 bg-cohere-black/50 transition-opacity duration-300 md:hidden
          ${isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}
        `}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-out panel */}
      <nav
        id="mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Mobile navigation"
        className={`
          fixed left-0 top-0 z-50 flex h-full w-[280px] flex-col bg-deep-green
          transition-transform duration-300 ease-in-out md:hidden
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Header */}
        <div className="flex h-[var(--header-height)] items-center justify-between px-5">
          <span className="font-display text-lg tracking-tight text-white">TradePlay</span>
          <button
            id="mobile-nav-close"
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Close navigation menu"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation items */}
        <ul className="mt-2 flex-1 space-y-0.5 px-3">
          {navItems.map((item) => {
            const isActive = isNavItemActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  prefetch={false}
                  id={`mobile-nav-${item.label.toLowerCase()}`}
                  className={`
                    flex items-center gap-3 rounded-sm px-3 py-3 text-[15px] font-medium transition-colors
                    ${
                      isActive
                        ? 'bg-white/15 text-white'
                        : 'text-white/60 hover:bg-white/8 hover:text-white/90'
                    }
                  `}
                  onClick={onClose}
                >
                  {item.icon}
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Footer */}
        <div className="border-t border-white/10 px-4 py-4">
          <p className="text-mono-label text-white/40">Paper Trading</p>
        </div>
      </nav>
    </>
  );
}

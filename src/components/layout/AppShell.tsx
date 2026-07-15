'use client';

import { useState, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * Application shell that wraps all pages.
 * Provides: fixed sidebar (desktop), sticky header, mobile nav overlay, and main content area.
 */
export function AppShell({ children }: AppShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const handleMenuToggle = useCallback(() => {
    setMobileNavOpen((prev) => !prev);
  }, []);

  const handleMobileNavClose = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  return (
    <>
      <Sidebar />
      <MobileNav isOpen={mobileNavOpen} onClose={handleMobileNavClose} />

      <div className="flex min-h-screen flex-col md:pl-[var(--sidebar-width)]">
        <Header onMenuToggle={handleMenuToggle} />
        <main id="main-content" className="flex-1 bg-canvas">
          {children}
        </main>
      </div>
    </>
  );
}

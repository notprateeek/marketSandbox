'use client';

import { useSyncExternalStore } from 'react';

import { isMarketOpen } from '@/lib/finance/market-hours';

// Re-check every 30s so the badge flips at the open/close boundary on its own.
function subscribe(onChange: () => void) {
  const id = setInterval(onChange, 30_000);
  return () => clearInterval(id);
}

function getSnapshot(): boolean {
  return isMarketOpen();
}

export function MarketStatusBadge() {
  const open = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return (
    <span
      title={open ? 'NSE is open · 09:15–15:30 IST' : 'NSE is closed · prices resume next session'}
      className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${
        open ? 'bg-pale-green text-deep-green' : 'bg-soft-stone text-body-muted'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-gain' : 'bg-muted'}`} />
      {open ? 'Market open' : 'Market closed'}
    </span>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { processQueuedOrdersAction } from '@/app/actions/trading';
import { isMarketOpen } from '@/lib/finance/market-hours';

/**
 * Re-fetches the current server component on an interval so live prices tick on
 * screen without a manual reload. It stays idle unless the NSE session is open
 * (prices are frozen otherwise) AND the tab is actually visible — a background
 * tab has nothing to show and refreshing it only adds churn.
 *
 * The same open-market tick also flushes any orders queued after hours, so they
 * fill shortly after the bell without the user placing a new trade.
 */
export function LivePriceRefresher({ intervalMs = 8000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && isMarketOpen(new Date())) {
        void processQueuedOrdersAction();
        router.refresh();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}

import { formatSignedPaise } from '@/lib/finance/currency';

export interface GainLossItem {
  label: string;
  /** Unrealized P&L in paise; null when the price is missing. */
  valuePaise: number | null;
}

/**
 * Presentational diverging-bar chart of per-holding unrealized P&L. Gains grow
 * to the right (green), losses to the left (red), scaled to the largest
 * magnitude in the set. Bar widths are chart geometry, not portfolio math.
 */
export function GainLossBars({ items }: { items: GainLossItem[] }) {
  const priced = items.filter(
    (item): item is { label: string; valuePaise: number } => item.valuePaise !== null,
  );

  if (priced.length === 0) {
    return <p className="text-sm text-body-muted">No priced holdings to chart.</p>;
  }

  const maxMagnitude = Math.max(1, ...priced.map((item) => Math.abs(item.valuePaise)));

  return (
    <ul className="space-y-3">
      {priced.map((item) => {
        const isGain = item.valuePaise >= 0;
        const halfWidth = (Math.abs(item.valuePaise) / maxMagnitude) * 50; // % of full width

        return (
          <li
            key={item.label}
            className="grid grid-cols-[4rem_1fr_auto] items-center gap-2 sm:gap-3"
          >
            <span className="truncate text-xs text-body-muted sm:text-sm">{item.label}</span>
            <div className="relative h-4 rounded-xs bg-soft-stone/50">
              <span className="absolute inset-y-0 left-1/2 w-px bg-hairline" aria-hidden="true" />
              <span
                className={`absolute inset-y-0.5 rounded-xs ${isGain ? 'bg-gain' : 'bg-loss'}`}
                style={
                  isGain
                    ? { left: '50%', width: `${halfWidth}%` }
                    : { right: '50%', width: `${halfWidth}%` }
                }
              />
            </div>
            <span
              className={`text-right font-mono text-xs sm:text-sm ${isGain ? 'text-gain' : 'text-loss'}`}
            >
              {formatSignedPaise(item.valuePaise)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

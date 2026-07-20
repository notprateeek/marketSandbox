import { formatPaise } from '@/lib/finance/currency';
import { formatISTDateTime } from '@/lib/finance/datetime';

interface PriceSummaryProps {
  pricePaise: bigint;
  timestamp: Date;
  openPaise?: bigint | null;
  highPaise?: bigint | null;
  lowPaise?: bigint | null;
  previousClosePaise?: bigint | null;
  volume?: number | null;
}

const volumeFormatter = new Intl.NumberFormat('en-IN');

export function PriceSummary({
  pricePaise,
  timestamp,
  openPaise,
  highPaise,
  lowPaise,
  previousClosePaise,
  volume,
}: PriceSummaryProps) {
  const changePaise = previousClosePaise == null ? null : pricePaise - previousClosePaise;
  const changePercent =
    changePaise == null || !previousClosePaise
      ? null
      : (Number(changePaise) / Number(previousClosePaise)) * 100;
  const isGain = changePaise != null && changePaise >= 0n;

  return (
    <section aria-label="Latest available price" className="mt-5">
      <div className="flex flex-col gap-3 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-2">
          <p className="font-display text-4xl tracking-tight text-primary md:text-[2.75rem]">
            {formatPaise(pricePaise)}
          </p>
          {changePaise != null && changePercent != null ? (
            <p className={`text-base font-semibold ${isGain ? 'text-gain' : 'text-loss'}`}>
              {isGain ? '+' : '−'}
              {formatPaise(changePaise < 0n ? -changePaise : changePaise)} (
              {Math.abs(changePercent).toFixed(2)}%)
            </p>
          ) : null}
        </div>

        <p className="text-sm text-body-muted">
          Price as of{' '}
          <time dateTime={timestamp.toISOString()}>{formatISTDateTime(timestamp)} IST</time>
        </p>
      </div>

      <dl className="grid grid-cols-2 border-y border-hairline sm:grid-cols-5">
        <SummaryItem label="Open" value={formatOptionalPaise(openPaise)} />
        <SummaryItem label="High" value={formatOptionalPaise(highPaise)} />
        <SummaryItem label="Low" value={formatOptionalPaise(lowPaise)} />
        <SummaryItem label="Previous close" value={formatOptionalPaise(previousClosePaise)} />
        <SummaryItem
          label="Volume"
          value={volume == null ? '—' : volumeFormatter.format(volume)}
          className="col-span-2 sm:col-span-1 sm:border-r-0"
        />
      </dl>
    </section>
  );
}

function formatOptionalPaise(value: bigint | null | undefined): string {
  return value == null ? '—' : formatPaise(value);
}

function SummaryItem({
  label,
  value,
  className = '',
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={`border-r border-hairline px-3 py-4 last:border-r-0 sm:px-5 ${className}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-primary">{value}</dd>
    </div>
  );
}

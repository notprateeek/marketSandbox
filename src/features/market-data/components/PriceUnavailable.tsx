import Link from 'next/link';

interface PriceUnavailableProps {
  title?: string;
  message?: string;
  actionHref?: string;
  actionLabel?: string;
}

export function PriceUnavailable({
  title = 'Price data unavailable',
  message = 'No candles have been imported for this instrument yet.',
  actionHref = '/instruments',
  actionLabel = 'Back to markets',
}: PriceUnavailableProps) {
  return (
    <section
      aria-labelledby="price-unavailable-heading"
      className="flex items-start gap-4 border-y border-hairline py-6"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-sm border border-hairline text-slate">
        <svg
          className="h-7 w-7"
          viewBox="0 0 28 28"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden="true"
        >
          <path strokeLinecap="round" d="M5 22V15m6 7V8m6 14v-9m6 9V5" />
          <path strokeLinecap="round" strokeDasharray="2 3" d="M3 4h22" opacity=".55" />
        </svg>
      </div>
      <div>
        <h3 id="price-unavailable-heading" className="font-medium text-primary">
          {title}
        </h3>
        <p className="mt-1 text-sm text-body-muted">{message}</p>
        <Link
          href={actionHref}
          className="mt-3 inline-block text-sm font-medium text-action-blue underline-offset-4 hover:underline"
        >
          {actionLabel}
        </Link>
      </div>
    </section>
  );
}

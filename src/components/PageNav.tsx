import Link from 'next/link';

/**
 * Server-rendered keyset pagination controls. "Older" carries the next cursor in
 * the URL; "Latest" clears it. No client JS — each window is a fresh request.
 */
export function PageNav({
  basePath,
  cursor,
  nextCursor,
  param = 'cursor',
  olderLabel = 'Show older',
}: {
  basePath: string;
  cursor?: string;
  nextCursor: string | null;
  param?: string;
  olderLabel?: string;
}) {
  if (!cursor && !nextCursor) return null;

  const linkClass =
    'rounded-pill border border-hairline px-4 py-2 text-sm font-medium text-primary transition-colors hover:border-slate';

  return (
    <nav className="mt-4 flex items-center justify-between gap-3" aria-label="Pagination">
      {cursor ? (
        <Link href={basePath} className={linkClass}>
          ← Latest
        </Link>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <Link href={`${basePath}?${param}=${encodeURIComponent(nextCursor)}`} className={linkClass}>
          {olderLabel} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

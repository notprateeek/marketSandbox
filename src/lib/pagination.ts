/**
 * Keyset (cursor) pagination helpers. Pure — no I/O — so the windowing logic is
 * directly unit-testable. The cursor is the last item's stable id; the query
 * fetches one extra row (`take: limit + 1`) to learn whether a next page exists
 * without a second COUNT query.
 */

export const DEFAULT_PAGE_SIZE = 25;

export interface Page<T> {
  items: T[];
  /** Pass back as `?cursor=` to fetch the following window; null when at the end. */
  nextCursor: string | null;
}

/**
 * Prisma `findMany` args for keyset pagination. Combine with a deterministic
 * `orderBy` that ends in a unique column (e.g. `[{ submittedAt: 'desc' }, { id: 'desc' }]`).
 */
export function cursorArgs(cursor: string | undefined, limit: number = DEFAULT_PAGE_SIZE) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * Splits rows fetched with `take: limit + 1` into a page: the extra row (if
 * present) only signals that more exist and sets the next cursor.
 */
export function toPage<T extends { id: string }>(
  rows: T[],
  limit: number = DEFAULT_PAGE_SIZE,
): Page<T> {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  return { items, nextCursor: items[items.length - 1]!.id };
}

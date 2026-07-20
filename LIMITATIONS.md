# Known Limitations

Documented remaining limitations after the public-testing hardening pass. None
block the acceptance criteria; each notes the current behaviour and the upgrade
path.

## Security

- **Rate limiting is in-memory only.** A token-bucket limiter in `src/proxy.ts`
  (Next 16's renamed middleware, Node runtime) throttles auth POSTs to
  `/sign-in`, `/sign-up` (strict, per-IP) and mutation server actions (generous,
  per-session with IP fallback). The bucket store (`src/lib/rate-limit.ts`) lives
  in process memory — correct for the single Node instance behind nginx, but it
  neither persists across restarts nor shares across instances; move it to
  Redis/KV before scaling out or deploying to edge. CSRF is covered by Next.js
  server actions (same-origin enforcement); inputs are validated at each action
  boundary; all DB access is parameterised through Prisma (no string-built SQL —
  the only raw fragments are static partial-index/trigger definitions in
  migrations).
- **Session strategy is JWT.** Sign-out is client-driven; there is no
  server-side session revocation list.

## Performance

- **N+1 reads in a few valuation paths.** Portfolio valuation does one price
  lookup per holding and the watchlist does one per instrument. Fine at the
  current scale (tens of rows); batch these into grouped queries if datasets grow
  large. (The live leaderboard is now batched — `scoreParticipants` values every
  participant in a fixed number of grouped queries.)
- **Pagination.** Instrument search is capped at 50 rows. The order (trade
  history), resolved-prediction and challenge-participant lists use keyset cursor
  pagination (`src/lib/pagination.ts`). Still unbounded but expected to be small:
  the cash ledger and watchlist. The leaderboard paginates its render; its
  scoring read is now batched (`scoreParticipants`) rather than per-participant.
- **Instrument search** uses `LIKE`-style substring matching (case-insensitive
  via Postgres `ILIKE`), which does not use an index for leading-wildcard
  queries. Acceptable for the seeded
  universe; move to FTS or a search service at scale.
- **No server-side response caching.** Every page is per-user dynamic (auth), so
  full-page responses aren't cached. Market-data reads (the best caching
  candidate) now go through an in-process TTL cache (`CachedMarketDataProvider`)
  for the EOD-stable reads; a shared cache (Redis) is only needed once it scales
  horizontally.
- **Chart payloads** are server-rendered SVG with the raw candle series inline
  (up to ~375 minute candles). Consider downsampling for very long ranges.
- **Order-execution concurrency (Postgres).** The global SQLite writer queue is
  gone. Concurrent orders on one account run in parallel and settle cash/holdings
  with optimistic `WHERE availableCashPaise >= …` updates; a losing order retries
  (up to `MAX_TRANSACTION_ATTEMPTS`) and is then cleanly rejected. Under
  pathological contention on a single account the retries can be exhausted (the
  submit then throws); raise the attempt budget or add per-account queuing only
  if that shows up in practice.

## Functional scope

- **Partial fills are not implemented.** Orders fill their full quantity or are
  rejected; the `PARTIALLY_FILLED` status is intentionally unused.
- **Pending (limit/stop) orders are simulation-only** and process as the
  simulation clock advances; they do not run against the live/primary account.
- **Simulation drawdown snapshots are sparse** (captured on trade and on clock
  advance), so a trough occurring strictly between two snapshots is not
  captured.
- **Challenge prediction-accuracy scoring** counts the live predictions a
  participant recorded during the challenge window; predictions are not
  separately tagged to a challenge.
- **Money precision** is integer paise stored as 64-bit `BigInt` (Postgres
  `int8`) and handled as JavaScript `bigint` end-to-end, so per-value amounts are
  bounded by `int8` (~₹9.2 × 10¹⁶) rather than the old ₹2.14 crore 32-bit cap.
  Share counts remain 32-bit `Int`. Percentages/ratios are the only place money
  leaves integer arithmetic (computed in floating point for display).

## Testing

- **Browser end-to-end** (Playwright) covers the auth shell (register → opening
  credit → sign out → sign in). It requires `npx playwright install` and a
  seeded database. The full 10-step trading flow (register → fund → search Tata
  Motors → buy → reduced cash → holding → advance simulation → changed P&L →
  sell → realized P&L → reconciliation) is covered authoritatively and
  deterministically by the service-level integration test
  `tests/integration/core-flow.test.ts`.
- **Reconciliation** (`src/server/services/reconciliation.ts`) can be run over
  production data (`reconcileAllAccounts`) as an operational safety net.

# Known Limitations

Documented remaining limitations after the public-testing hardening pass. None
block the acceptance criteria; each notes the current behaviour and the upgrade
path.

## Security

- **Rate limiting is not implemented.** Auth and order server actions have no
  throttle. For a public deployment, add a limiter (e.g. per-IP/per-user token
  bucket in middleware or an edge KV). CSRF is covered by Next.js server actions
  (same-origin enforcement); inputs are validated at each action boundary; all
  DB access is parameterised through Prisma (no string-built SQL — the only raw
  fragment is a static partial-index predicate in the schema).
- **Session strategy is JWT.** Sign-out is client-driven; there is no
  server-side session revocation list.

## Performance

- **N+1 reads in a few valuation paths.** Portfolio valuation does one price
  lookup per holding; the watchlist does one per instrument; the live
  leaderboard scores one participant at a time. Fine at the current scale (tens
  of rows); batch these into grouped queries if datasets grow large.
- **Pagination.** Instrument search is capped at 50 rows. Order, prediction,
  watchlist and challenge-participant lists are unbounded but expected to be
  small; add cursor pagination before large datasets.
- **Instrument search** uses SQLite `LIKE`-style substring matching, which does
  not use an index for leading-wildcard queries. Acceptable for the seeded
  universe; move to FTS or a search service at scale.
- **No server-side response caching.** Every page is per-user dynamic (auth), so
  nothing is cached. Market-data reads are the best caching candidate.
- **Chart payloads** are server-rendered SVG with the raw candle series inline
  (up to ~375 minute candles). Consider downsampling for very long ranges.
- **SQLite single writer.** Order execution is serialised through a global
  writer queue; move to a server database with row-level locks for real
  concurrency/throughput.

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
- **Money precision** is integer paise bounded by the 32-bit database integer
  range (max ₹21,474,836.47 per stored value); the engine rejects values beyond
  it.

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

# TradePlay Build Roadmap

Feature roadmap agreed 2026-07-17. Ordered by dependency and demo-value-per-week.
Phases 0–3 (~6 weeks) = investor-demo-ready. Estimates assume one full-time dev.

**How to resume:** find the first unchecked box, read that phase's notes, go.
Every feature follows the existing layering (action → zod validation → service →
repository) and gets one service-level integration test in the style of
`tests/integration/core-flow.test.ts`. All money stays integer paise through
`src/lib/finance/currency.ts`. Per `AGENTS.md`: this repo's Next.js has breaking
changes — read `node_modules/next/dist/docs/` before writing code.

## Phase 0 — Hardening (1 week, prerequisite for anything public)

- [x] Postgres migration: swap Prisma datasource, drop `better-sqlite3` adapter
      and the global writer queue (`executePendingOrder` keeps its transaction,
      loses the queue). Move paise columns to `BigInt` while migrating — kills
      the ₹2.1 crore per-value cap documented in `LIMITATIONS.md`.
      Done 2026-07-18: provider→`postgresql`, all `*Paise` columns→`BigInt`
      (paise are `bigint` end-to-end), `PrismaPg` adapter, writer queue removed.
      Concurrent orders now use optimistic WHERE-guarded updates with a bounded
      retry (the loser re-reads and cleanly rejects) instead of the single-writer
      lock. Ported the two hand-written SQLite triggers (INITIAL_CREDIT ledger
      immutability, non-negative cash) to Postgres in a new migration; restored
      case-insensitive instrument search (`mode: 'insensitive'`) and fixed candle
      interval ordering for Postgres enum order. Tests run against per-file
      ephemeral Postgres databases (`tests/helpers/pg.ts`); dev/CI Postgres is a
      Docker `postgres:16` on `localhost:5433` (`DATABASE_URL`). 181 tests green,
      `tsc` clean, `next build` passes.
- [x] Rate limiting: token bucket in middleware on auth + order server actions,
      per-user/IP. In-memory first.
      Done 2026-07-18: Next 16 renamed middleware → `proxy` (Node runtime), so
      `src/proxy.ts` holds a per-instance in-memory token bucket
      (`src/lib/rate-limit.ts`). Strict per-IP bucket on `/sign-in`+`/sign-up`
      POSTs (cap 8, ~8/min); generous per-session (IP fallback) bucket on
      mutation server actions via the `Next-Action` header (cap 40, ~40/min —
      well above the 8s live-price heartbeat and human trading, so only scripted
      abuse is throttled). GET/RSC reads pass through. Verified: rapid POST
      `/sign-in` returns 200×8 then 429; unit test on the bucket math.
- [x] Cursor pagination on the unbounded order/prediction/participant lists.
      Done 2026-07-18: keyset helper `src/lib/pagination.ts` (`cursorArgs` +
      `toPage`, fetch limit+1) and a server-rendered `PageNav` (URL `?cursor=`,
      no client JS). Applied to trades on `/history`, resolved predictions
      (`loadResolvedPredictions` now returns `{ items, nextCursor }`), and the
      leaderboard (`loadLeaderboard` windows the fully-ranked rows, keeping
      winner/total/personalRank). Note: leaderboard windowing bounds the render,
      not the scoring read — reducing that read is the Phase 4 batch-scoring item.
      Unit test on the cursor math + an integration test paging resolved
      predictions across two windows.

## Phase 1 — Analytics 2.0, Journal tags, Prediction streaks (2 weeks)

Cheapest wins; Phases 3/5/6 all consume their output.

- [x] Analytics 2.0: extend `src/lib/finance/analytics.ts` (pure functions) with
      win rate, profit factor, avg win/loss from `TradeExecution` pairs, equity
      curve from existing `PortfolioSnapshot` rows.
- [x] Daily snapshot on first authenticated page-load per day (no cron) — fixes
      the documented sparse-drawdown gap.
- [x] New chart components reusing the existing server-rendered SVG approach.
- [x] Journal tags: add `strategyTag` + `emotionTag` columns to `JournalEntry`
      (plain columns, not a tag system).
- [x] Journal auto-prompt: when a SELL fills in `submit-market-order.ts`, return
      a flag so the client opens the journal form for that order (the 1:1
      order↔journal link already exists in the schema).
- [x] Tag-based rules in `src/lib/finance/insights.ts` ("FOMO-tagged trades lose
      3× more") + per-tag P&L table in analytics.
- [x] Prediction streaks + badges: computed entirely from existing `Prediction`
      rows (consecutive days with a correct resolved prediction); badges are
      thresholds, no schema change. Dashboard "today's prediction" card.
      Skipped: push notifications — add when retention data says so.

  Done 2026-07-18: `computeTradeStats` (pure) walks executions per instrument at
  running average cost → per-SELL realized round-trips, win rate, profit factor,
  avg win/loss, expectancy, and per-`strategyTag`/`emotionTag` P&L; folded into
  `computeAnalytics` and surfaced as stat tiles + two P&L-by-tag tables on the
  analytics page (equity curve was already the value series). `insights.ts` gained
  a tag-loss rule ("FOMO-tagged trades lose N× more") and a win-rate line.
  `captureDailySnapshotIfNeeded` records one live-portfolio snapshot per IST day
  on dashboard load (no cron). Journal gained `strategyTag`/`emotionTag` columns
  (migration `20260718111308_journal_tags`), curated selects in the entry form,
  and a "Reflect on this sell →" deep-link (`promptJournal` flag on SELL fills).
  Prediction streaks/badges via pure `computePredictionStreak` + `loadPredictionStreak`,
  shown as a dashboard streak card. 202 tests green (+21), `tsc`/lint/`next build` clean.

## Phase 2 — Real market data (1–2 weeks)

Seam already exists: `MarketDataProvider` interface, `csv-importer.ts`, and
`live-provider.ts` (deterministic intraday walk from the newest real candle).

- [x] NSE bhavcopy importer on top of `csv-importer.ts` — official, free, EOD
      data. Daily post-market job (6:30pm IST) appends `ONE_DAY` candles.
- [x] Keep the existing intraday walk on top of real daily closes. Real delayed
      quotes later = one new class implementing `MarketDataProvider`.
- [x] Caching on market-data reads (named in `LIMITATIONS.md` as the best
      caching candidate).
- Note: real-time tick data needs exchange licensing; EOD-anchored is standard
  for simulators and legally clean.

  Done 2026-07-18: `bhavcopy-importer.ts` maps the EQ-series rows of an NSE UDiFF
  bhavcopy (`TckrSymb`/`TradDt`/`OpnPric`…) onto the canonical candle CSV and
  reuses `importPriceCandlesCsv` wholesale (pure `parseBhavcopy`/`toCanonicalCsv`
  + `importNseBhavcopy`, which pre-filters to tracked NSE symbols so the summary
  isn't drowned by the ~2,000 it doesn't track); candles land as ONE_DAY at the
  15:30 IST session close. Runnable as a post-market job via
  `npm run import:bhavcopy -- <file.csv>` (scheduling is deployment). The live
  intraday walk already rides whatever the newest real candle is, so bhavcopy
  closes flow straight through — verified by an integration test. Real delayed
  quotes stay a future one-class add (YAGNI). `CachedMarketDataProvider` is a TTL
  decorator memoising the EOD-stable reads (latest price, instrument metadata,
  listings) and is wired *beneath* the live walk in the default provider, so DB
  reads are absorbed while intraday movement stays live. No schema change. +11
  tests, `tsc`/lint clean.

## Phase 3 — Historical event replay packs (2 weeks, half of it content)

Thin wrapper over the existing simulation engine. Flashiest demo item per week
of work.

- [x] Schema: one `ScenarioPack` model — slug, title, description, date window,
      instrument ids (JSON), starting balance, `checkpoints` JSON
      (`[{timestamp, title, body}]`). Static curated content; no CMS.
- [x] Service: `startScenario` creates a normal `SimulationSession` pinned to
      the pack's window; when the clock crosses a checkpoint timestamp the
      simulation view shows the narrative card.
- [x] Debrief screen = existing analytics view + insights, framed.
- [x] Content: import candles for 4–6 windows (COVID crash Mar 2020,
      Adani–Hindenburg week, 2024 election day, Yes Bank collapse) via the
      Phase 2 importer; write checkpoint narratives.

  Done 2026-07-18: `ScenarioPack` model + a nullable `scenarioPackId` link on
  `SimulationSession` (migration `20260718113344_scenario_packs`).
  `scenario.ts` service: `listScenarioPacks`/`loadScenarioPack`/`startScenario`
  (an ordinary `SimulationSession` pinned to the pack window, tagged with the pack)
  and a pure `checkpointAt` (latest checkpoint the clock has crossed). New
  `/scenarios` page + nav entry lists the packs with a start button; the cockpit
  shows the narrative checkpoint card as the clock crosses each timestamp, and the
  analytics view reframes as a "Scenario debrief" for scenario runs. Content:
  `prisma/scenario-packs.ts` (`npm run db:seed:scenarios`) seeds 4 curated packs —
  COVID crash, Adani–Hindenburg, 2024 election results day, Yes Bank collapse —
  with event-shaped daily candles fed through the Phase 2 CSV importer and 3
  checkpoint narratives each. +5 tests (217 total), `tsc`/lint/`next build` clean.

## Phase 4 — Challenges 2.0 (1–2 weeks)

- [x] Invite codes: `inviteCode String? @unique` on `Challenge`; PRIVATE
      challenges (visibility enum already exists) require the code to join.
- [x] Recurring weekly contests: `recurrence` field + lazy rollover — when
      listing challenges, if a recurring one has ended, finalize it and create
      the next instance. No cron. (ponytail: lazy rollover on read; move to a
      cron if listing gets hot.)
- [x] Sponsored challenges: `sponsorName` + `sponsorLogoUrl` nullable columns —
      the whole monetization MVP.
- [x] Batch the leaderboard scoring (the N+1 documented in `LIMITATIONS.md`).

  Done 2026-07-18: migration `20260718120000_challenges_2` adds `inviteCode`
  (`@unique`), a `ChallengeRecurrence` enum + `recurrence`, and `sponsorName`/
  `sponsorLogoUrl`. PRIVATE challenges auto-mint a readable invite code;
  `joinChallenge` enforces it (creator exempt) and `joinChallengeByCode` +
  a "Join by code" form on the list page cover the invited-user flow.
  `rolloverRecurringChallenges` (called from `listChallenges`) finalizes an ended
  weekly challenge, detaches its recurrence so it rolls exactly once, and spawns
  the next instance shifted forward whole weeks — no cron. Sponsor name/logo
  captured in the create form and shown on the card + detail header. Leaderboard
  scoring is now batched: `scoreParticipants` replaces the per-participant loop
  with grouped reads (one valuation via `valueAccountsAt`'s single DISTINCT-ON
  price query + batched positions/cash, one snapshots read, one trade-count
  groupBy, one predictions read) — a fixed query count regardless of participant
  count. +2 tests (219 total); existing reproducible-leaderboard test still green.
  `tsc`/lint/`next build` clean.

## Phase 5 — Social layer (3 weeks)

- [x] Schema: `Follow` (followerId, followingId, unique pair); on `User`:
      `handle @unique`, `bio`, `isPublic Boolean @default(false)`. Private by
      default — trust boundary, not a growth hack.
- [x] Public profile `/u/[handle]`: return %, win rate, streak, badges,
      challenge history — all computed by Phase 1 code.
- [x] Following feed: query-time union of followed users' recent challenge
      results + resolved predictions. (ponytail: query-time feed; fan-out
      tables when follower counts demand it.)
- [x] Clone-to-sandbox: "study this portfolio" creates a `SimulationSession`
      for the viewer with the same instruments and equivalent positions opened
      at current sim prices — pure reuse of simulation + order engine.

  Done 2026-07-18: migration `20260718130000_social` adds the `Follow` model and
  `handle`/`bio`/`isPublic` on `User` (private by default). `social.ts` service:
  `updateProfile` (pure `normalizeHandle` in `src/lib/social.ts`), `loadPublicProfile`
  (return %, win rate & round-trips via `computeTradeStats`, streak/badges via
  `loadPredictionStreak`, challenge history from `ChallengeResult` — all Phase 1
  code), `followByHandle`/`unfollowByHandle` (public-only, no self-follow),
  `loadFollowingFeed` (query-time union of followees' finalized challenge results +
  resolved predictions, newest first), and `cloneToSandbox` (spins up a real
  `SimulationSession` and reproduces each holding with a sized BUY through the order
  engine, filled at the latest open). UI: public-profile settings on `/profile`,
  the `/u/[handle]` profile with Follow / "Study this portfolio", and a `/feed`
  page + nav entry. +4 tests (223 total); `tsc`/lint/`next build` clean.

## Phase 6 — AI trading coach (2 weeks)

Data already captured: closed trades, journal theses vs. outcomes
(`thesisCorrect`, `confidence`, Phase 1 tags), analytics, rule-based insights.

- [x] New service `src/server/services/coach.ts`: assemble compact review
      payload → one Claude API call → persist a `CoachReview` row (account,
      period, markdown) so each review is generated once, not per page view.
- [x] Trigger: on demand + after every N closed trades, rate-limited.
- [x] Rule-based `insights.ts` stays as free tier / no-API-key fallback — the
      app never breaks without the key.
- [x] UI: "Coach" tab on analytics rendering the stored review.

  Done 2026-07-18: migration `20260718160935_coach_reviews` adds `CoachReview`
  (account, period, markdown, model, `tradeCountAtGeneration`). `coach.ts` builds
  a compact already-formatted stats payload from the Phase 1 analytics/insights
  and makes one `@anthropic-ai/sdk` call to `claude-opus-4-8`, persisting the row
  so a review is generated once, not per view. `generateCoachReview` is gated:
  on-demand `force` bypasses the "≥3 new round-trips" gate but both paths honour a
  10-minute cooldown; `loadCoachView` auto-generates on the Coach tab when a fresh
  review is warranted. No key → `coachIsConfigured()` returns false, the service
  short-circuits to `NO_KEY`, and the UI points back to the free rule-based
  insights — the app never breaks without the key. UI: `/simulations/[id]/coach`
  tab (linked from analytics) renders the stored review + a Regenerate button;
  `ANTHROPIC_API_KEY` documented in `.env.example`. +3 tests (226 total; the Claude
  call is mocked so tests never hit the network), `tsc`/lint/`next build` clean.

## Phase 7 — B2B curriculum mode (4+ weeks — GATED)

Do not build speculatively. Sign one design partner (college / NISM-prep
institute) first, then:

- [ ] `Cohort` (name, instructorId, joinCode) + `CohortMember`; an "assignment"
      is a PRIVATE challenge linked to a cohort — isolated `ChallengeAccount`
      plumbing and frozen `ChallengeResult` grading already exist.
- [ ] Instructor dashboard = member list with challenge results + CSV export.
- Skipped: lesson CMS, SSO, billing — add when a paying partner asks.

  Status 2026-07-18: **intentionally not built.** This phase is gated on signing a
  design partner (owner's call, per the phase header) — building it now would be
  the speculative work the roadmap forbids. The groundwork it relies on already
  exists and was hardened in Phases 4–5: PRIVATE challenges with invite codes,
  isolated `ChallengeAccount` plumbing, and frozen `ChallengeResult` grading. Left
  unchecked deliberately; unblock once a partner is committed.

## Timeline

| Milestone                      | Effort   | Cumulative                  |
| ------------------------------ | -------- | --------------------------- |
| Phases 0–3 (demo-ready)        | ~6 weeks | 6 weeks                     |
| Phases 4–6 (growth + AI story) | ~7 weeks | ~3.5 months                 |
| Phase 7                        | 4+ weeks | only with committed partner |

Phases 4–6 parallelize cleanly across two devs.

## Market context (for the pitch)

- SEBI: 91% of retail F&O traders lost money FY24-25, ₹1.8+ lakh crore
  aggregate losses; new F&O restrictions through 2025-26 → regulatory tailwind
  for "practice before you lose real money".
- StockGro at ~25M users proves social + contest mechanics monetize in this
  category.
- F&O/Options simulator was identified as the biggest market gap but is
  deliberately excluded from this roadmap (owner's call, 2026-07-17).

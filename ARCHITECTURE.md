# Architecture

## High-Level Design

TradePlay follows a layered architecture pattern within the Next.js App Router paradigm.

### 1. Presentation Layer (`src/app/`, `src/components/`)

- **Pages & Layouts**: Server Components by default. Data fetching happens here.
- **UI Components**: Dumb, reusable components (styled with Tailwind).
- **Feature Components**: Smart components that may include client-side interactivity (`'use client'`).

### 2. Feature Modules (`src/features/`)

- Encapsulated business domains (e.g., `trading`, `portfolio`).
- Contains domain-specific components, hooks, and localized utilities.

### 3. Business Logic (`src/server/services/`)

- Core business rules and orchestration.
- Called by Next.js Server Actions or API Route Handlers.
- Never imported into Client Components.

### 4. Data Access Layer (`src/server/repositories/`)

- Abstraction over the database (Prisma).
- Keeps Prisma queries isolated from business logic for easier testing and refactoring.

## Data Flow (Server Actions)

1. **Client Action**: User clicks "Buy" in a Client Component.
2. **Server Action**: The component calls a Next.js Server Action (`'use server'`).
3. **Validation**: The Server Action validates input using Zod schemas (`src/lib/validation/`).
4. **Service**: The Server Action calls the relevant Service method.
5. **Repository**: The Service interacts with the database via Repository methods.
6. **Response**: Result/Error is returned to the Client Component, which updates UI or shows a toast.

## Styling (Cohere Design System)

The visual design is based on the [Cohere Design System](../DESIGN.md).
Key aspects:

- Restrained color palette (white, deep green, black).
- Semantic colors (gain/loss) strictly reserved for financial data.
- Tight typography using Space Grotesk (display) and Inter (body).
- Flat components with thin borders, avoiding heavy shadows.

## Pending Order Execution (Simulation)

Limit and stop-loss orders rest until the simulation clock advances onto a
candle that satisfies them. The exact, tested policy lives in
`src/lib/finance/pending-order.ts` (`evaluatePendingOrder`):

- **Trigger** uses a candle's `[low, high]` range (an intra-candle wick counts).
  Only candles strictly after the order was placed are considered.
- **Limit** orders trigger and fill in the same candle: a buy fills at
  `min(open, limit)`, a sell at `max(open, limit)` — so a candle that gaps
  through the limit fills at the (better) open.
- **Stop-loss** (sell only) triggers when `low ≤ stop`, then executes at the
  **next** candle's open (the "next eligible simulated price"); if no later
  candle exists yet it stays `TRIGGERED` until a further advance.
- **Expiry**: if never triggered by its expiry, the order is `EXPIRED`.
- Fills re-check cash/holdings at execution and reject on shortfall. Partial
  fills are **not** implemented (all-or-nothing); `PARTIALLY_FILLED` is never set.
- Execution goes through `executePendingOrder`, which runs in the SQLite writer
  queue inside a transaction and cannot fill the same order twice.

## Educational Challenges

Challenges reuse the accounting engine unchanged. Each participant gets an
isolated `VirtualAccount` (via `ChallengeAccount`); these accounts are excluded
from the personal-portfolio filter, so challenge funds never mix with personal
portfolios and a challenge account can never become the "active" account.

Scoring uses exactly one metric per challenge (never blended), in
`src/lib/finance/challenge.ts`:

- **RETURN** — highest percentage return wins.
- **DRAWDOWN** — lowest maximum drawdown wins.
- **PREDICTION_ACCURACY** — highest direction accuracy of the predictions the
  participant recorded during the challenge window; no predictions ranks last.

**Ranking is reproducible.** When the challenge ends it is finalized: each
participant's score is computed once and frozen into a `ChallengeResult`, and
the leaderboard sorts those frozen rows. **Tie-break (deterministic):** equal
scores are ordered by earliest join time, then by participant id — so every
entry gets a unique, reproducible rank.

Registration closes at the challenge's start timestamp. No monetary prizes,
deposits or withdrawals exist anywhere in the system.

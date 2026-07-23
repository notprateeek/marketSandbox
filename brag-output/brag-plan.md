# Brag Plan: TradePlay

## What is this app?
A paper-trading simulator for the Indian stock market (NSE) — buy and sell real
tickers at real prices with virtual money, so you learn to trade without risking
a single rupee.

## The angle
This isn't a toy. It's a serious, editorial fintech product (Cohere-inspired
design) built around one fearless promise: **real market, fake money.** You can
place a ₹1,00,000 bet on RELIANCE, watch the order fill, and feel every bit of the
market — with zero downside. The brag leans into that confidence: a premium
product film for a market you cannot lose money in. The differentiator that makes
it specific: a **time machine** — rewind to a real historical trading day and
trade the past, step by step.

## Hook (first 2-3 seconds)
Near-black canvas. A mono overline stamps in: `PAPER TRADING · NSE`. Then the
line lands at full display scale: **"Trade the Indian market."** beat —
**"Risk nothing."** The whole value prop in five words before anyone can scroll.

## Key moments (the middle)
- The deep-green portfolio card with **₹1,00,000** available cash counting up — real INR grouping, real dashboard.
- The trade ticket: **Buy RELIANCE → Confirm → "Order filled"** — the pale-green success card sliding in. The product *doing* its thing.
- The **time machine**: pick a historical start date, and the clock steps forward candle by candle. "Rewind the market. Trade the past."
- Compete: a **leaderboard** and a **12-day prediction streak** — you against others, ranked on one honest metric.

## Outro / punchline
Back to near-black. The **TradePlay** wordmark, then the tagline that ties the hook
shut: **"Real market. Fake money. Real skill."** — and the live URL.

## User flow worth showing
entry → key action → result, straight from the app:
1. **Portfolio dashboard** — the active account, ₹1,00,000 virtual cash (`src/app/(app)/page.tsx`).
2. **Place a trade** — trade ticket on an instrument: choose Buy, review, confirm, see "Order filled" (`src/features/trading/components/TradeTicket.tsx`).
3. **Replay history** — simulation wizard: choose a historical start, step the clock forward (`src/features/simulation/components/SimulationWizard.tsx`).
The trade fill is the centerpiece; the time machine is the "wait, it does *that*?" beat.

## Tone
- Preset: polished
- Creative direction: a confident fintech product film for a market you can't lose money in
- Interpretation: fewer scenes, longer holds, generous whitespace, soft slides — restraint is the flex. The product speaks; no jokes, no hype-dump. One idea per scene.

## Format: landscape — 1920x1080
## Duration: 20.5s target

## Visual identity (from the project)
- Background: `#ffffff` canvas / `#17171c` near-black for hook & outro bands
- Accent: `#003c33` deep enterprise green (the signature balance band); `#1863dc` action blue; `#16a34a` gain green / `#dc2626` loss red for money
- Text: `#17171c` primary on light, `#ffffff` on dark
- Display font: Space Grotesk (tight, negative tracking, Cohere-style display)
- Body font: Inter; money/numbers in JetBrains Mono
- Strongest visual element: the deep-green portfolio balance band with the big ₹ figure, and mono uppercase overlines (`text-mono-label`)

## Share copy (draft)
Built TradePlay — a paper-trading sandbox for the Indian market. Trade RELIANCE, rewind real market history, climb leaderboards. Real market, fake money, real skill. 🇮🇳📈

## Audio direction
- Role: warm, confident corporate bed — sparse, motion-matched accents, no clutter
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3` (bundled) — clean, optimistic, ~115 BPM; fits a premium fintech film
- Music treatment: start at 0s, gentle fade-in over ~0.4s, hold at a supportive volume under the visuals, soft fade-out over the last ~0.8s of the outro
- Music cue guidance: see section below
- Audio-reactive treatment: subtle — allow the deep-green balance band and the outro wordmark to breathe slightly with the music's low energy; no waveform bars, no bouncing
- SFX posture: sparse, professional, motion-matched — one soft tick on the count-up settle, one confident low confirm on "Order filled", light steps as the replay clock advances, one clean stamp on the wordmark
- Audio-coupled moments: ₹ count-up settle, the "Order filled" card arrival, the clock stepping forward, the final wordmark stamp
- Restraint rule: audio must never get busy or novelty-driven; if in doubt, quieter. No coin/cash-register clichés — this reads as fintech, not a slot machine.

## Music cue guidance
- Track: `happy-beats-business-moves-vol-9` — ~114.84 BPM (bundled preset available).
- Strong cues to target for major reveals: **4.23s**, **6.34s**, **10.54s**, **12.65s** (align major reveals within ~0.15s).
- Beat-grid window for the replay clock steps (Scene 4): snap steps to the ~0.52s beat grid (12.65 → 13.18 → 13.70 → 14.22…) but hold any readable label to its floor.
- Restraint note: cues are optional timing hints only — readability and the calm, confident pace win over hitting every beat.

## Storyboard

### Scene 1 — Hook: "Trade the Indian market. Risk nothing." — 3.2s
Near-black (`#17171c`) full bleed. Mono overline `PAPER TRADING · NSE` stamps in top-center (muted white). Then the display line lands in two beats: **"Trade the Indian market."** (hold ~1.2s), then **"Risk nothing."** slams in beneath at larger scale (hold ~1.0s). Tight Space Grotesk, negative tracking.
Sequential/interaction: yes — overline first, then line 1, then line 2, each snapping in fast and holding.
Audio intent: music fades in warm and assured; a single soft accent as "Risk nothing." lands.
Audio-coupled idea: beat-aligned reveal of "Risk nothing." near the 4.23s strong cue.
Music: warm confident bed, just started.
Transition mood: soft crossfade → Scene 2

### Scene 2 — Portfolio reveal: ₹1,00,000 virtual cash — 4.3s
White canvas. The signature deep-green (`#003c33`) balance band slides up. Mono overline `ACTIVE PORTFOLIO · Starter`. The big ₹ figure counts up **₹0 → ₹1,00,000** in JetBrains Mono over ~1.1s and settles. Caption "Available cash". A small status pill "OPEN". Below, one faint dashboard row hints at holdings.
Sequential/interaction: yes — band slides in, then the number counts up and settles.
Audio intent: optimistic lift; a soft tick on the count-up settle.
Audio-coupled idea: counter ticks resolving to a single clean settle near the 6.34s cue.
Music: bed continues, gentle build.
Transition mood: soft slide → Scene 3

### Scene 3 — The trade: Buy RELIANCE → Order filled — 4.5s
White canvas, the trade ticket card centered. Header `MARKET ORDER` / "Trade RELIANCE", latest price ₹2,950. The Buy/Sell toggle sits on **Buy**; amount **₹50,000** is present. A cursor clicks **"Confirm buy"** (near-black pill). Beat — the pale-green (`#edfce9`) **"Order filled"** success card slides in: execution price ₹2,950, shares owned 16, cash updated. `text-deep-green` "ORDER FILLED" label.
Sequential/interaction: yes — simulate the cursor clicking "Confirm buy", then the success card arrives.
Audio intent: a confident low confirm exactly as "Order filled" lands — the satisfying beat of the whole video.
Audio-coupled idea: confirm SFX on the success-card arrival near the 10.54s strong cue.
Music: bed steady, supportive.
Transition mood: clean crossfade → Scene 4

### Scene 4 — Time machine: rewind and trade the past — 4.0s
White canvas. Mono overline `HISTORICAL REPLAY`. A datetime field shows a past start (e.g. `2024-11-04 09:15 IST`). Line: **"Rewind the market. Trade the past."** A small candlestick/price readout steps forward — the clock advances 09:15 → 09:16 → 09:17 with candles appearing one by one, price updating. Hint: "You move the clock forward."
Sequential/interaction: yes — the replay clock steps forward and candles appear one at a time.
Audio intent: light, precise steps matching each clock advance; a sense of controlled time.
Audio-coupled idea: soft step tick per clock advance, snapped to the beat grid (12.65 → 13.18 → 13.70…).
Music: bed continues.
Transition mood: soft slide → Scene 5

### Scene 5 — Compete + outro — 4.5s
Two quick holds. First (~2s): a compact **leaderboard** — three rows with handles and returns (e.g. +18.4%, +12.1%, +7.6%), row 1 highlighted, plus a small pale-green streak chip **"12-day streak 🔥"**. Line: "Compete. Predict. Improve." Then cut to near-black outro (~2.5s): the **TradePlay** wordmark stamps in center, tagline beneath: **"Real market. Fake money. Real skill."**, and the URL `marketsandbox-notprateeek.netlify.app` in mono. Hold on calm empty space.
Sequential/interaction: yes — leaderboard rows arrive top-to-bottom, then hard-ish cut to the wordmark stamp.
Audio intent: gentle rise into the wordmark; one clean stamp accent on the logo; music fades out under the tagline hold.
Audio-coupled idea: wordmark stamp SFX; final fade.
Music: resolves and fades over the last ~0.8s.
Transition mood: soft crossfade to black → end

**Music mood for this video:** upbeat-but-restrained corporate/fintech (warm, confident, ~115 BPM).
**Audio summary:** A warm confident bed fades in on the hook, lifts through the ₹ count-up, pays off with a single low confirm on "Order filled", ticks precisely through the replay clock, and resolves with a clean stamp on the wordmark before a soft fade — sparse, professional, never busy.

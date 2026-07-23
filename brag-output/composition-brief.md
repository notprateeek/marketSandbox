# Hyperframes Composition Brief: TradePlay

## Objective
Create a short, polished launch-style brag video for TradePlay — a paper-trading
simulator for the Indian stock market.

## Output
- Composition directory: `brag-output/composition/`
- Rendered video: `brag-output/brag.mp4`
- Format: landscape — 1920x1080
- Duration: ~20.5 seconds

## Source Material
- Project root: `/Users/prateekbhandula/Documents/marketSandbox`
- Primary files read: `README.md`, `DESIGN.md`, `src/app/globals.css`, `src/app/(app)/page.tsx`, `src/features/trading/components/TradeTicket.tsx`, `src/features/simulation/components/SimulationWizard.tsx`, `src/features/challenge/components/ChallengeExplainer.tsx`, `src/components/layout/navigation.tsx`, `prisma/seed.ts`
- Product name: TradePlay
- Tagline / strongest claim: "Real market. Fake money. Real skill."
- Key UI to recreate: the deep-green portfolio balance band (₹ figure), the trade ticket (Buy RELIANCE → Order filled), the historical-replay simulation wizard, a leaderboard + prediction streak.
- Copy that must appear verbatim (or near-verbatim from the app):
  - "Trade the Indian market."
  - "Risk nothing."
  - "Available cash"
  - "Order filled"
  - "Rewind the market. Trade the past."
  - "Real market. Fake money. Real skill."

## Creative Direction
- Tone preset: polished
- Creative direction: a confident fintech product film for a market you can't lose money in
- Interpretation: few scenes, longer holds, generous whitespace, soft slides/crossfades (0.4–0.6s). Restraint is the flex — one idea per scene, no hype-dump, no jokes. The product speaks for itself.
- Angle: This is a serious, editorial fintech product built on one fearless promise — real NSE market, fake money. Bet ₹50,000 on RELIANCE, watch the order fill, feel the market with zero downside. The differentiator that makes it specific: a time machine that replays real historical trading days.
- Hook: near-black canvas, mono overline `PAPER TRADING · NSE`, then "Trade the Indian market." → "Risk nothing." at full display scale.
- Outro / punchline: near-black, TradePlay wordmark, "Real market. Fake money. Real skill.", live URL `marketsandbox-notprateeek.netlify.app`.
- Avoid:
  - Generic SaaS language ("streamline your workflow")
  - Abstract filler visuals / equalizer bars / particle systems
  - Any visual redesign — honor the Cohere-adapted design tokens below
  - Rupee = coin/cash-register cliché SFX

## Visual Identity
- Background: `#ffffff` canvas (light, editorial); `#17171c` near-black bands for hook & outro
- Text: `#17171c` primary on light, `#ffffff` on dark; muted `#93939f` for mono overlines
- Accent: `#003c33` deep enterprise green (signature balance band); `#1863dc` action blue; gain `#16a34a` / loss `#dc2626` for money only; `#edfce9` pale-green success surface
- Display font: Space Grotesk (tight, negative tracking)
- Body font: Inter; money & numbers in JetBrains Mono
- Visual references from the project:
  - Deep-green balance band with big ₹ figure + `text-mono-label` overline + status pill (page.tsx)
  - Trade ticket card: "MARKET ORDER" / "Trade RELIANCE", Buy/Sell toggle, near-black "Confirm buy" pill, pale-green "Order filled" success card (TradeTicket.tsx)
  - Simulation wizard: datetime start, stepping clock (SimulationWizard.tsx)
  - Leaderboard rows + pale-green streak chip (challenge + prediction features)
- Light canvas is deliberate — make it cinematic with 2px+ rules, full-saturation accent hits, subtle grain; do NOT switch to dark for the UI scenes.

## Storyboard
Use the storyboard in `brag-output/brag-plan.md` as the creative contract.

Scene summary:
1. Hook — 3.2s — near-black; `PAPER TRADING · NSE`, then "Trade the Indian market." → "Risk nothing."
2. Portfolio reveal — 4.3s — deep-green balance band, ₹0 → ₹1,00,000 count-up, "Available cash", status pill "OPEN".
3. The trade — 4.5s — trade ticket, "Trade RELIANCE" ₹2,950, cursor clicks "Confirm buy", pale-green "Order filled" card slides in (16 shares).
4. Time machine — 4.0s — `HISTORICAL REPLAY`, datetime `2024-11-04 09:15 IST`, clock steps 09:15→09:16→09:17 with candles appearing, "Rewind the market. Trade the past."
5. Compete + outro — 4.5s — leaderboard (3 rows: +18.4% / +12.1% / +7.6%) + "12-day streak" chip; then near-black wordmark "TradePlay", "Real market. Fake money. Real skill.", URL.

## Audio
- Audio role: warm, confident corporate bed with sparse, motion-matched accents
- Audio arc: fade in on the hook → lift through the ₹ count-up → single low confirm on "Order filled" → precise ticks through the replay clock → clean stamp on the wordmark → soft fade under the tagline
- Music: `happy-beats-business-moves-vol-9-by-ende-dot-app.mp3` (copied to `assets/music/`)
- Music treatment: `data-start="0"`, volume ~0.3, gentle fade-in ~0.4s, soft fade-out over the last ~0.8s. Never above 0.35 for this restrained tone.
- Music cue guidance: bundled preset at `assets/music/cues/happy-beats-business-moves-vol-9-by-ende-dot-app.music-cues.json` (~114.84 BPM). Strong cues: 4.23s, 6.34s, 10.54s, 12.65s. Beat grid ~0.52s spacing. Lock 1–3 major reveals to strong cues (±0.15s): "Risk nothing." near 4.23s, ₹ count-up settle near 6.34s, "Order filled" near 10.54s. Snap the replay clock steps to the beat grid. Cues are hints — readability wins.
- Audio-reactive treatment: subtle — extract audio bands and let the deep-green balance band and the outro wordmark gain a soft presence/glow with overall amplitude. No waveform/equalizer/particles. 3–6% scale max on text.
- Audio-coupled moments:
  - Scene 1 "Risk nothing." — beat-locked reveal near 4.23s
  - Scene 2 ₹ count-up — counter ticks resolving to one clean settle near 6.34s
  - Scene 3 "Confirm buy" click + "Order filled" card — simulated cursor click, then confirm accent near 10.54s
  - Scene 4 replay clock steps — soft step tick per advance, beat-grid snapped
  - Scene 5 wordmark — one clean stamp accent, then fade
- SFX selection guidance (polished = minimal but present, 2–3 subtle cues, volume 0.5–0.7):
  - Simulated cursor click on "Confirm buy": `interface/click_00x.ogg` or `ui/mouseclick1.ogg`
  - "Order filled" success: soft `impact/impactSoft_medium_00x.ogg` or `impact/impactBell_heavy_000.ogg` (one, brief)
  - Wordmark stamp: `interface/bong_001.ogg` or a soft impact — one, low
  - Optional gentle count-up settle: `interface/drop_001.ogg`
- SFX analysis guidance: read `sfx-analysis.md` beside the SFX library; prefer low high-frequency-risk files for this polished tone.
- Exact SFX choice: Hyperframes selects filenames, timestamps, density, and volume based on the implemented animation.
- Audio files: copy the chosen music and any selected SFX into `brag-output/composition/assets/`.

## Hyperframes Instructions
Build with the current Hyperframes workflow (hyperframes-core contract + `data-*` timing, hyperframes-animation for motion, hyperframes-creative for design/beats/audio-reactive, hyperframes-cli to check/render). This is the /brag workflow — not the generic promo interview.

Requirements:
- Show real UI, copy, and visuals from TradePlay (balance band, trade ticket, replay wizard, leaderboard).
- Keep all text readable in the final render — honor the reading-time floor (short label ~0.8s settled; sentence ~0.3s/word).
- Keep the video within 15–25 seconds (~20.5s target).
- Include the music + SFX layer; add subtle audio-reactive presence on the balance band and wordmark, or document extraction failure.
- Music cues are optional timing hints; 1–3 strong-cue locks max; ignore cues that hurt readability or pacing.
- Use local assets for audio; relative paths from `composition/`; never absolute paths.
- Run `npx hyperframes check` before render — brag's single gate.

import Anthropic from '@anthropic-ai/sdk';

import type { CoachReview, PrismaClient } from '@/generated/prisma/client';
import type { PortfolioAnalytics } from '@/lib/finance/analytics';
import { formatPercentage, formatSignedPaise } from '@/lib/finance/currency';
import type { Insight } from '@/lib/finance/insights';
import { prisma } from '@/lib/prisma';
import { loadAnalytics } from '@/server/services/portfolio-analytics';

const COACH_MODEL = 'claude-opus-4-8';
const COACH_MIN_NEW_TRADES = 3; // new round-trips before an auto-review is worthwhile
const COACH_COOLDOWN_MS = 10 * 60 * 1_000; // don't hit the API more than this often per account

/** Whether a Claude API key is configured. Without it, the app falls back to rule-based insights. */
export function coachIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export type CoachGenerationResult =
  | { status: 'GENERATED'; review: CoachReview }
  | { status: 'NO_KEY' }
  | { status: 'RATE_LIMITED' }
  | { status: 'NEEDS_MORE_TRADES'; needed: number }
  | { status: 'NO_DATA' };

/**
 * Generates (or declines to generate) an AI coach review for a simulation's
 * account. One Claude call, persisted as a `CoachReview` row. Gated so it isn't
 * spammed: an on-demand `force` bypasses the "enough new trades" gate but still
 * respects the cooldown; the automatic path (page load) enforces both. Never
 * throws for a missing key — returns `NO_KEY` so callers fall back to insights.
 */
export async function generateCoachReview(
  params: { sessionId: string; userId: string; force?: boolean },
  database: PrismaClient = prisma,
  now: Date = new Date(),
): Promise<CoachGenerationResult> {
  const view = await loadAnalytics(params.sessionId, params.userId, {}, database);
  if (!view) return { status: 'NO_DATA' };

  const accountId = view.session.virtualAccountId;
  const closedTrades = view.analytics.tradeStats.closedTradeCount;
  const last = await loadLatestCoachReview(accountId, database);

  if (last && now.getTime() - last.createdAt.getTime() < COACH_COOLDOWN_MS) {
    return { status: 'RATE_LIMITED' };
  }
  if (!params.force) {
    const newTrades = closedTrades - (last?.tradeCountAtGeneration ?? 0);
    if (newTrades < COACH_MIN_NEW_TRADES) {
      return { status: 'NEEDS_MORE_TRADES', needed: COACH_MIN_NEW_TRADES - newTrades };
    }
  }
  if (!coachIsConfigured()) return { status: 'NO_KEY' };

  const markdown = await requestReview(view.analytics, view.insights, view.session.name);

  const review = await database.coachReview.create({
    data: {
      virtualAccountId: accountId,
      periodStart: view.range.from,
      periodEnd: view.range.to,
      markdown,
      model: COACH_MODEL,
      tradeCountAtGeneration: closedTrades,
    },
  });
  return { status: 'GENERATED', review };
}

export function loadLatestCoachReview(
  virtualAccountId: string,
  database: PrismaClient = prisma,
): Promise<CoachReview | null> {
  return database.coachReview.findFirst({
    where: { virtualAccountId },
    orderBy: { createdAt: 'desc' },
  });
}

export interface CoachView {
  session: { id: string; name: string };
  review: CoachReview | null;
  hasKey: boolean;
  closedTrades: number;
  /** True when a fresh review was just generated on this load. */
  generated: boolean;
}

/**
 * The Coach tab's data: the stored review, plus an on-load auto-generation when a
 * key is set and enough new trades have accrued since the last review (and the
 * cooldown has passed). Falls back to `hasKey: false` so the UI can show the
 * rule-based insights instead — the app never breaks without the key.
 */
export async function loadCoachView(
  sessionId: string,
  userId: string,
  database: PrismaClient = prisma,
): Promise<CoachView | null> {
  const session = await database.simulationSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) return null;

  let review = await loadLatestCoachReview(session.virtualAccountId, database);
  let generated = false;

  if (coachIsConfigured()) {
    const result = await generateCoachReview({ sessionId, userId, force: false }, database);
    if (result.status === 'GENERATED') {
      review = result.review;
      generated = true;
    }
  }

  const closedTrades = await database.tradeExecution.count({
    where: { virtualAccountId: session.virtualAccountId, side: 'SELL' },
  });

  return {
    session: { id: session.id, name: session.name },
    review,
    hasKey: coachIsConfigured(),
    closedTrades,
    generated,
  };
}

const SYSTEM_PROMPT = `You are a trading coach inside TradePlay, an educational paper-trading app for Indian markets (all money is virtual ₹, no real funds). You review a trader's performance and give warm, honest, specific feedback.

Write 2–3 short paragraphs of plain prose (no markdown headings, no bold). Optionally end with 1–2 lines that each start with "- " suggesting one concrete thing to try next. Cover: what went well, the biggest risk or pattern to watch, and a next step. Be encouraging but candid; never hedge with generic disclaimers. Keep it under 180 words. Use ₹ for money.`;

/** Assembles a compact, already-formatted stats payload and makes one Claude call. */
async function requestReview(
  analytics: PortfolioAnalytics,
  insights: Insight[],
  simulationName: string,
): Promise<string> {
  const stats = analytics.tradeStats;
  const lines: string[] = [
    `Simulation: ${simulationName}`,
    `Total return: ${analytics.portfolioReturnPercent === null ? 'n/a' : formatPercentage(analytics.portfolioReturnPercent)}`,
    `Max drawdown: ${analytics.maxDrawdown ? `-${analytics.maxDrawdown.magnitudePercent.toFixed(1)}%` : 'n/a'}`,
    `Closed round-trips: ${stats.closedTradeCount} (wins ${stats.wins}, losses ${stats.losses})`,
    `Win rate: ${stats.winRatePercent === null ? 'n/a' : `${stats.winRatePercent.toFixed(0)}%`}`,
    `Profit factor: ${stats.profitFactor === null ? 'n/a' : stats.profitFactor.toFixed(2)}`,
    `Avg win: ${stats.avgWinPaise === null ? 'n/a' : formatSignedPaise(stats.avgWinPaise)}`,
    `Avg loss: ${stats.avgLossPaise === null ? 'n/a' : formatSignedPaise(-stats.avgLossPaise)}`,
    `Net realized: ${formatSignedPaise(stats.netRealizedPnlPaise)}`,
    `Cash allocation: ${analytics.cashAllocationPercent === null ? 'n/a' : `${analytics.cashAllocationPercent.toFixed(0)}%`}`,
  ];

  const tagLine = (label: string, tags: PortfolioAnalytics['tradeStats']['byStrategy']) =>
    tags.length === 0
      ? null
      : `${label}: ${tags
          .map((tag) => `${tag.tag} ${formatSignedPaise(tag.netPnlPaise)} over ${tag.trades}`)
          .join('; ')}`;
  const strategy = tagLine('P&L by strategy tag', stats.byStrategy);
  const emotion = tagLine('P&L by emotion tag', stats.byEmotion);
  if (strategy) lines.push(strategy);
  if (emotion) lines.push(emotion);
  if (insights.length > 0) {
    lines.push(`Rule-based observations: ${insights.map((insight) => insight.message).join(' ')}`);
  }
  if (analytics.contributions.length > 0) {
    const worst = analytics.contributions[0];
    lines.push(`Biggest P&L contributor: ${worst.symbol} ${formatSignedPaise(worst.pnlPaise)}`);
  }

  const client = new Anthropic();
  const message = await client.messages.create({
    model: COACH_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `Here are my stats:\n${lines.join('\n')}` }],
  });

  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

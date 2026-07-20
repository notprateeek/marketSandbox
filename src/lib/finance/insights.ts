/**
 * Deterministic, rule-based educational insights derived purely from computed
 * analytics — no generative AI, no randomness. Each rule reads real numbers and
 * emits a fixed-shape sentence, so the same portfolio always yields the same
 * insights.
 */

import type { PortfolioAnalytics, TradeStats } from './analytics';

export interface Insight {
  id: string;
  severity: 'info' | 'warning';
  message: string;
}

const CONCENTRATION_WARN = 40; // % of portfolio in one holding
const LOSS_SHARE_MIN = 40; // % of total loss from one holding to be worth calling out
const DRAWDOWN_WARN = 15; // % max drawdown
const CASH_CUSHION = 20; // % cash the what-if suggests
const TAG_MIN_TRADES = 3; // closed trades a tag needs before it's worth a call-out
const TAG_LOSS_RATIO = 2; // a tag must lose at least this many × the average to flag

export function deriveInsights(analytics: PortfolioAnalytics): Insight[] {
  const insights: Insight[] = [];

  const drawdown = analytics.maxDrawdown;
  if (drawdown && drawdown.magnitudePercent >= 0.05) {
    insights.push({
      id: 'max-drawdown',
      severity: drawdown.magnitudePercent >= DRAWDOWN_WARN ? 'warning' : 'info',
      message: `The portfolio reached a maximum drawdown of ${round(drawdown.magnitudePercent)}%.`,
    });
  }

  const largest = analytics.largestHolding;
  if (largest) {
    insights.push({
      id: 'largest-holding',
      severity: largest.allocationPercent >= CONCENTRATION_WARN ? 'warning' : 'info',
      message: `Your largest holding (${largest.label}) represents ${round(largest.allocationPercent)}% of the portfolio.`,
    });
  }

  const lossInsight = lossContribution(analytics);
  if (lossInsight) insights.push(lossInsight);

  const tagInsight = tagLoss(analytics.tradeStats);
  if (tagInsight) insights.push(tagInsight);

  const winRateInsight = winRate(analytics.tradeStats);
  if (winRateInsight) insights.push(winRateInsight);

  if (
    analytics.portfolioReturnPercent !== null &&
    analytics.portfolioReturnPercent < 0 &&
    analytics.cashAllocationPercent !== null &&
    analytics.cashAllocationPercent < CASH_CUSHION
  ) {
    insights.push({
      id: 'cash-cushion',
      severity: 'info',
      message: `Keeping ${CASH_CUSHION}% in cash would have reduced the portfolio decline.`,
    });
  }

  const crowdedSector = analytics.sectorConcentration.find((sector) => sector.count >= 2);
  if (crowdedSector) {
    insights.push({
      id: 'sector-overlap',
      severity: 'info',
      message: `${crowdedSector.count} holdings belong to the same sector (${crowdedSector.label}).`,
    });
  }

  return insights;
}

function lossContribution(analytics: PortfolioAnalytics): Insight | null {
  const losers = analytics.contributions.filter((contribution) => contribution.pnlPaise < 0n);
  const grossLoss = losers.reduce((sum, contribution) => sum + contribution.pnlPaise, 0n);
  if (grossLoss >= 0n || losers.length === 0) return null;

  const worst = losers[0]; // contributions are sorted most-negative first
  const share = (Number(worst.pnlPaise) / Number(grossLoss)) * 100; // both negative -> positive
  if (share < LOSS_SHARE_MIN) return null;

  return {
    id: 'loss-contribution',
    severity: 'warning',
    message: `${worst.symbol} contributed ${round(share)}% of your total loss.`,
  };
}

/**
 * Flags the strategy/emotion tag whose trades lose most heavily relative to the
 * account's average trade — e.g. "FOMO-tagged trades lose 3× more". Requires a
 * few trades per tag and a losing average both overall and for the tag.
 */
function tagLoss(stats: TradeStats): Insight | null {
  if (stats.expectancyPaise === null || stats.expectancyPaise >= 0n) return null; // avg trade profits
  const averageLoss = Number(-stats.expectancyPaise); // positive magnitude

  const worst = [...stats.byStrategy, ...stats.byEmotion]
    .filter((tag) => tag.trades >= TAG_MIN_TRADES && tag.avgPnlPaise < 0n)
    .sort((a, b) => Number(a.avgPnlPaise - b.avgPnlPaise))[0];
  if (!worst) return null;

  const ratio = Number(-worst.avgPnlPaise) / averageLoss;
  if (ratio < TAG_LOSS_RATIO) return null;

  return {
    id: 'tag-loss',
    severity: 'warning',
    message: `${worst.tag}-tagged trades lose ${round(ratio)}× more than your average trade.`,
  };
}

function winRate(stats: TradeStats): Insight | null {
  if (stats.winRatePercent === null || stats.closedTradeCount < TAG_MIN_TRADES) return null;
  return {
    id: 'win-rate',
    severity: stats.winRatePercent < 40 ? 'warning' : 'info',
    message: `You closed ${round(stats.winRatePercent)}% of your ${stats.closedTradeCount} round-trips at a profit.`,
  };
}

function round(value: number): number {
  return Math.round(value);
}

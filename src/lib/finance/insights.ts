/**
 * Deterministic, rule-based educational insights derived purely from computed
 * analytics — no generative AI, no randomness. Each rule reads real numbers and
 * emits a fixed-shape sentence, so the same portfolio always yields the same
 * insights.
 */

import type { PortfolioAnalytics } from './analytics';

export interface Insight {
  id: string;
  severity: 'info' | 'warning';
  message: string;
}

const CONCENTRATION_WARN = 40; // % of portfolio in one holding
const LOSS_SHARE_MIN = 40; // % of total loss from one holding to be worth calling out
const DRAWDOWN_WARN = 15; // % max drawdown
const CASH_CUSHION = 20; // % cash the what-if suggests

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
  const losers = analytics.contributions.filter((contribution) => contribution.pnlPaise < 0);
  const grossLoss = losers.reduce((sum, contribution) => sum + contribution.pnlPaise, 0);
  if (grossLoss >= 0 || losers.length === 0) return null;

  const worst = losers[0]; // contributions are sorted most-negative first
  const share = (worst.pnlPaise / grossLoss) * 100; // both negative -> positive
  if (share < LOSS_SHARE_MIN) return null;

  return {
    id: 'loss-contribution',
    severity: 'warning',
    message: `${worst.symbol} contributed ${round(share)}% of your total loss.`,
  };
}

function round(value: number): number {
  return Math.round(value);
}

import { OrderSide, OrderStatus, type PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

export class JournalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JournalError';
  }
}

export interface JournalFields {
  reason?: string | null;
  expectedOutcome?: string | null;
  intendedHoldingPeriod?: string | null;
  riskConsidered?: string | null;
  confidence?: number | null;
  whatHappened?: string | null;
  whatLearned?: string | null;
  thesisCorrect?: boolean | null;
  strategyTag?: string | null;
  emotionTag?: string | null;
}

export interface JournalTradeView {
  orderId: string;
  side: OrderSide;
  symbol: string;
  companyName: string;
  quantity: number;
  pricePaise: bigint | null;
  timestamp: Date;
  entry: JournalFields | null;
}

/**
 * Creates or updates the journal entry attached to a trade. Keyed on the order,
 * so each trade has exactly one journal entry and the note stays connected to
 * the trade it reflects on.
 */
export async function saveJournalEntry(
  params: { userId: string; orderId: string; fields: JournalFields },
  database: PrismaClient = prisma,
) {
  const order = await database.order.findFirst({
    where: { id: params.orderId, virtualAccount: { userId: params.userId } },
    select: { id: true },
  });
  if (!order) throw new JournalError('Trade not found.');

  const confidence = normalizeConfidence(params.fields.confidence);
  const data = { ...params.fields, confidence };

  return database.journalEntry.upsert({
    where: { orderId: params.orderId },
    create: { userId: params.userId, orderId: params.orderId, ...data },
    update: data,
  });
}

/** Filled trades for an account, each with its journal entry (if any). */
export async function loadJournal(
  params: { userId: string; virtualAccountId: string },
  database: PrismaClient = prisma,
): Promise<JournalTradeView[]> {
  const orders = await database.order.findMany({
    where: {
      virtualAccountId: params.virtualAccountId,
      virtualAccount: { userId: params.userId },
      status: OrderStatus.FILLED,
    },
    orderBy: { submittedAt: 'desc' },
    include: {
      instrument: { select: { symbol: true, companyName: true } },
      execution: { select: { pricePaise: true, quantity: true } },
      journalEntry: true,
    },
  });

  return orders.map((order) => ({
    orderId: order.id,
    side: order.side,
    symbol: order.instrument.symbol,
    companyName: order.instrument.companyName,
    quantity: order.execution?.quantity ?? order.filledQuantity,
    pricePaise: order.execution?.pricePaise ?? null,
    timestamp: order.simulationTimestamp ?? order.submittedAt,
    entry: order.journalEntry
      ? {
          reason: order.journalEntry.reason,
          expectedOutcome: order.journalEntry.expectedOutcome,
          intendedHoldingPeriod: order.journalEntry.intendedHoldingPeriod,
          riskConsidered: order.journalEntry.riskConsidered,
          confidence: order.journalEntry.confidence,
          whatHappened: order.journalEntry.whatHappened,
          whatLearned: order.journalEntry.whatLearned,
          thesisCorrect: order.journalEntry.thesisCorrect,
          strategyTag: order.journalEntry.strategyTag,
          emotionTag: order.journalEntry.emotionTag,
        }
      : null,
  }));
}

function normalizeConfidence(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.min(5, Math.max(1, Math.round(value)));
}

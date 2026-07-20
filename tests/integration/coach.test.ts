// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Never hit the network — the coach's one Claude call returns canned text.
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = {
      create: async () => ({
        content: [{ type: 'text', text: 'You traded with discipline. Watch your position sizing.' }],
      }),
    };
  },
}));

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, OrderSide, PrismaClient } from '@/generated/prisma/client';
import {
  generateCoachReview,
  loadCoachView,
  loadLatestCoachReview,
} from '@/server/services/coach';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';
import { advanceSimulation, createSimulation, submitSimulationOrder } from '@/server/services/simulation';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const D1 = new Date('2026-06-01T10:00:00.000Z');
const D3 = new Date('2026-06-03T10:00:00.000Z');

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function simWithOneClosedTrade() {
  const user = await registerUser(
    { name: 'Coach', email: `coach-${randomUUID()}@example.com`, password: 'tradeplay123' },
    database,
  );
  const tata = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `TATA_${randomUUID().slice(0, 8)}`,
      companyName: 'Tata Motors',
      isin: 'INE155A01022',
      sector: 'Auto',
      industry: 'Auto',
      currency: 'INR',
    },
  });
  for (const [timestamp, price] of [
    [D1, 100_000],
    [new Date('2026-06-02T10:00:00.000Z'), 110_000],
    [D3, 130_000],
    [new Date('2026-06-04T10:00:00.000Z'), 125_000],
  ] as const) {
    await database.priceCandle.create({
      data: {
        instrumentId: tata.id,
        interval: CandleInterval.ONE_DAY,
        timestamp,
        openPaise: BigInt(price),
        highPaise: BigInt(price),
        lowPaise: BigInt(price),
        closePaise: BigInt(price),
        volume: 1_000,
        source: 'coach-test',
      },
    });
  }
  const sim = await createSimulation(
    { userId: user.id, name: 'Coaching', startTimestamp: D1, initialBalancePaise: INITIAL_BALANCE_PAISE },
    database,
  );
  await submitSimulationOrder(
    { sessionId: sim.id, userId: user.id, side: OrderSide.BUY, instrumentId: tata.id, amountPaise: 20_000_00n },
    database,
  );
  await advanceSimulation({ sessionId: sim.id, userId: user.id, step: 'CUSTOM', customTimestamp: D3 }, database);
  await submitSimulationOrder(
    { sessionId: sim.id, userId: user.id, side: OrderSide.SELL, instrumentId: tata.id, quantity: 9 },
    database,
  );
  return { sim, userId: user.id };
}

describe('AI coach — gating and persistence', () => {
  it('needs more trades before an automatic review', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const { sim, userId } = await simWithOneClosedTrade();

    const result = await generateCoachReview({ sessionId: sim.id, userId, force: false }, database);
    expect(result.status).toBe('NEEDS_MORE_TRADES');
  });

  it('falls back cleanly with no API key', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const { sim, userId } = await simWithOneClosedTrade();

    const result = await generateCoachReview({ sessionId: sim.id, userId, force: true }, database);
    expect(result.status).toBe('NO_KEY');

    const view = await loadCoachView(sim.id, userId, database);
    expect(view?.hasKey).toBe(false);
    expect(view?.review).toBeNull();
  });

  it('generates, persists, and rate-limits a review when configured', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const { sim, userId } = await simWithOneClosedTrade();
    const accountId = (await database.simulationSession.findUniqueOrThrow({ where: { id: sim.id } }))
      .virtualAccountId;

    const first = await generateCoachReview({ sessionId: sim.id, userId, force: true }, database, D3);
    expect(first.status).toBe('GENERATED');
    if (first.status === 'GENERATED') {
      expect(first.review.markdown).toContain('discipline');
      expect(first.review.model).toBe('claude-opus-4-8');
    }

    // Persisted and served from the row.
    const stored = await loadLatestCoachReview(accountId, database);
    expect(stored?.markdown).toContain('discipline');

    // A second attempt within the cooldown is rate-limited (no second API call).
    const again = await generateCoachReview({ sessionId: sim.id, userId, force: true }, database, D3);
    expect(again.status).toBe('RATE_LIMITED');
    expect(await database.coachReview.count({ where: { virtualAccountId: accountId } })).toBe(1);
  });
});

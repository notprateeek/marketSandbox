// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, OrderSide, PrismaClient } from '@/generated/prisma/client';
import { DatabaseMarketDataProvider } from '@/server/market-data';
import { getActiveAccountId, listPortfolios } from '@/server/services/accounts';
import {
  ChallengeError,
  createChallenge,
  joinChallenge,
  loadLeaderboard,
  submitChallengeOrder,
} from '@/server/services/challenge';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const HOUR = 60 * 60 * 1_000;
const future = (ms: number) => new Date(Date.now() + ms);

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('educational challenges', () => {
  it('isolates challenge accounts from personal portfolios', async () => {
    const user = await createUser();
    const personal = await database.virtualAccount.findFirstOrThrow({ where: { userId: user.id } });
    const instrument = await createInstrument();

    const challenge = await createChallenge(
      {
        creatorId: user.id,
        name: 'Growth sprint',
        description: 'Grow the most in a week.',
        startTimestamp: future(HOUR),
        endTimestamp: future(8 * 24 * HOUR),
        startingBalancePaise: 20_000_00n,
        scoringMethod: 'RETURN',
      },
      database,
    );
    await joinChallenge({ challengeId: challenge.id, userId: user.id }, database);

    // The challenge account is NOT a personal portfolio.
    const portfolios = await listPortfolios(user.id, database);
    expect(portfolios.map((p) => p.id)).toEqual([personal.id]);
    expect(await getActiveAccountId(user.id, database)).toBe(personal.id);

    // Trading in the challenge moves only the challenge account.
    await submitChallengeOrder(
      {
        challengeId: challenge.id,
        userId: user.id,
        side: OrderSide.BUY,
        instrumentId: instrument.id,
        amountPaise: 5_000_00n,
      },
      database,
      new DatabaseMarketDataProvider(database),
    );

    const personalAfter = await database.virtualAccount.findUniqueOrThrow({
      where: { id: personal.id },
    });
    expect(personalAfter.availableCashPaise).toBe(INITIAL_BALANCE_PAISE); // untouched

    const challengeAccount = await challengeVirtualAccount(challenge.id, user.id);
    expect(challengeAccount.availableCashPaise).toBeLessThan(20_000_00n); // spent in the challenge only
  });

  it('closes registration at the start cutoff', async () => {
    const user = await createUser();
    const challenge = await createChallenge(
      {
        creatorId: user.id,
        name: 'Already started',
        description: 'Cannot join.',
        startTimestamp: future(-HOUR), // started an hour ago
        endTimestamp: future(24 * HOUR),
        startingBalancePaise: 20_000_00n,
        scoringMethod: 'RETURN',
      },
      database,
    );

    await expect(
      joinChallenge({ challengeId: challenge.id, userId: user.id }, database),
    ).rejects.toBeInstanceOf(ChallengeError);
  });

  it('produces a reproducible finalized leaderboard', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const challenge = await createChallenge(
      {
        creatorId: alice.id,
        name: 'Return race',
        description: 'Highest return wins.',
        startTimestamp: future(HOUR),
        endTimestamp: future(8 * 24 * HOUR),
        startingBalancePaise: 20_000_00n,
        scoringMethod: 'RETURN',
      },
      database,
    );
    await joinChallenge({ challengeId: challenge.id, userId: alice.id }, database);
    await joinChallenge({ challengeId: challenge.id, userId: bob.id }, database);

    // Simulate Alice ending ahead by crediting her challenge account.
    const aliceAccount = await challengeVirtualAccount(challenge.id, alice.id);
    await database.virtualAccount.update({
      where: { id: aliceAccount.id },
      data: { availableCashPaise: aliceAccount.availableCashPaise + 5_000_00n },
    });

    // Move the end into the past so the challenge finalizes on the next load.
    await database.challenge.update({
      where: { id: challenge.id },
      data: { endTimestamp: future(-HOUR) },
    });

    const board = await loadLeaderboard(challenge.id, alice.id, {}, database);
    expect(board?.finalized).toBe(true);
    expect(board?.rows.map((row) => row.rank)).toEqual([1, 2]);
    expect(board?.rows[0].isMe).toBe(true); // Alice ranks first
    expect(board?.rows[0].returnPercent).toBeGreaterThan(board!.rows[1].returnPercent);
    expect(board?.personalRank).toBe(1);

    // Reproducible: reloading yields identical ranking from the frozen results.
    const again = await loadLeaderboard(challenge.id, bob.id, {}, database);
    expect(again?.rows.map((row) => `${row.participantId}:${row.rank}`)).toEqual(
      board?.rows.map((row) => `${row.participantId}:${row.rank}`),
    );
    const completed = await database.challenge.findUniqueOrThrow({ where: { id: challenge.id } });
    expect(completed.status).toBe('COMPLETED');
  });
});

async function createUser() {
  return registerUser(
    {
      name: `U${randomUUID().slice(0, 6)}`,
      email: `c-${randomUUID()}@example.com`,
      password: 'tradeplay123',
    },
    database,
  );
}

async function createInstrument() {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  const instrument = await database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `CHL-${suffix}`,
      companyName: `Chal ${suffix}`,
      isin: `TEST-${suffix}`,
      sector: 'Testing',
      industry: 'Testing',
      currency: 'INR',
    },
  });
  await database.priceCandle.create({
    data: {
      instrumentId: instrument.id,
      interval: CandleInterval.ONE_MINUTE,
      timestamp: new Date('2026-06-01T04:00:00.000Z'),
      openPaise: 10_000,
      highPaise: 10_000,
      lowPaise: 10_000,
      closePaise: 10_000,
      volume: 1_000,
      source: 'challenge-test',
    },
  });
  return instrument;
}

async function challengeVirtualAccount(challengeId: string, userId: string) {
  const participant = await database.challengeParticipant.findUniqueOrThrow({
    where: { challengeId_userId: { challengeId, userId } },
    include: { account: true },
  });
  return database.virtualAccount.findUniqueOrThrow({
    where: { id: participant.account!.virtualAccountId },
  });
}

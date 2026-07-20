// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { CandleInterval, PredictionDirection, PredictionStatus, PrismaClient } from '@/generated/prisma/client';
import { getActiveAccountId } from '@/server/services/accounts';
import { registerUser } from '@/server/services/register-user';
import {
  SocialError,
  cloneToSandbox,
  followByHandle,
  loadFollowingFeed,
  loadPublicProfile,
  updateProfile,
} from '@/server/services/social';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

async function user(name: string) {
  return registerUser(
    { name, email: `${name}-${randomUUID()}@example.com`, password: 'tradeplay123' },
    database,
  );
}

describe('Phase 5 — social layer', () => {
  it('gates private profiles, follows, and builds a feed', async () => {
    const alice = await user('Alice');
    const bob = await user('Bob');
    const carol = await user('Carol');

    await updateProfile({ userId: alice.id, handle: 'alice', bio: 'hi', isPublic: true }, database);
    await updateProfile({ userId: bob.id, handle: 'bob', isPublic: true }, database);
    await updateProfile({ userId: carol.id, handle: 'carol', isPublic: false }, database);

    // Public profile visible to others; private only to its owner.
    expect(await loadPublicProfile('alice', bob.id, database)).not.toBeNull();
    expect(await loadPublicProfile('carol', bob.id, database)).toBeNull();
    expect(await loadPublicProfile('carol', carol.id, database)).not.toBeNull();

    // Can't follow yourself or a private account; can follow a public one.
    await expect(followByHandle({ followerId: alice.id, handle: 'alice' }, database)).rejects.toBeInstanceOf(SocialError);
    await expect(followByHandle({ followerId: bob.id, handle: 'carol' }, database)).rejects.toBeInstanceOf(SocialError);
    await followByHandle({ followerId: bob.id, handle: 'alice' }, database);

    const aliceFromBob = await loadPublicProfile('alice', bob.id, database);
    expect(aliceFromBob?.isFollowing).toBe(true);
    expect(aliceFromBob?.followerCount).toBe(1);

    // A resolved prediction by Alice shows up in Bob's feed.
    const instrument = await seedInstrument();
    await database.prediction.create({
      data: {
        userId: alice.id,
        instrumentId: instrument.id,
        direction: PredictionDirection.UP,
        startingPricePaise: 100_000n,
        targetPricePaise: 105_000n,
        targetPercentage: 5,
        predictionTimestamp: new Date(),
        expiryTimestamp: new Date(),
        status: PredictionStatus.RESOLVED,
        directionCorrect: true,
        resolvedAt: new Date(),
      },
    });

    const feed = await loadFollowingFeed(bob.id, {}, database);
    expect(feed.some((item) => item.kind === 'PREDICTION' && item.handle === 'alice')).toBe(true);
  });

  it('clones a portfolio into a sandbox simulation at current prices', async () => {
    const alice = await user('Cloner');
    const bob = await user('Viewer');
    await updateProfile({ userId: alice.id, handle: `owner${randomUUID().slice(0, 4)}`, isPublic: true }, database);
    const owner = await database.user.findUniqueOrThrow({ where: { id: alice.id } });

    const instrument = await seedInstrument();
    // Two daily candles so a "next" candle exists after the sim start.
    for (const [timestamp, open] of [
      [new Date('2026-06-10T15:30:00+05:30'), 20_000],
      [new Date('2026-06-11T15:30:00+05:30'), 20_000], // latest → clone fills here
    ] as const) {
      await database.priceCandle.create({
        data: {
          instrumentId: instrument.id,
          interval: CandleInterval.ONE_DAY,
          timestamp,
          openPaise: BigInt(open),
          highPaise: BigInt(open),
          lowPaise: BigInt(open),
          closePaise: BigInt(open),
          volume: 1_000,
          source: 'social-test',
        },
      });
    }

    // Alice holds 5 shares in her active portfolio.
    const aliceAccount = await getActiveAccountId(alice.id, database);
    await database.position.create({
      data: {
        virtualAccountId: aliceAccount!,
        instrumentId: instrument.id,
        quantity: 5,
        averageBuyPricePaise: 20_000n,
        totalCostPaise: 100_000n,
        realizedPnlPaise: 0n,
      },
    });

    const session = await cloneToSandbox({ viewerId: bob.id, handle: owner.handle! }, database);
    expect(session.userId).toBe(bob.id);

    // Bob's sandbox now holds the same 5 shares, bought at the latest open.
    const cloned = await database.position.findFirstOrThrow({
      where: { virtualAccountId: session.virtualAccountId, instrumentId: instrument.id },
    });
    expect(cloned.quantity).toBe(5);
  });
});

async function seedInstrument() {
  return database.instrument.create({
    data: {
      exchange: 'NSE',
      symbol: `SYM_${randomUUID().slice(0, 8)}`,
      companyName: 'Test Co',
      isin: 'INE000A01000',
      sector: 'Test',
      industry: 'Test',
      currency: 'INR',
    },
  });
}

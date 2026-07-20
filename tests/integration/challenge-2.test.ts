// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { ChallengeStatus, PrismaClient } from '@/generated/prisma/client';
import {
  ChallengeError,
  createChallenge,
  joinChallenge,
  joinChallengeByCode,
  rolloverRecurringChallenges,
} from '@/server/services/challenge';
import { registerUser } from '@/server/services/register-user';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

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

describe('Phase 4 — invite codes', () => {
  it('gates PRIVATE joins on the invite code', async () => {
    const alice = await user('alice');
    const bob = await user('bob');
    const challenge = await createChallenge(
      {
        creatorId: alice.id,
        name: 'Private league',
        description: 'invite only',
        startTimestamp: new Date(Date.now() + HOUR),
        endTimestamp: new Date(Date.now() + 8 * DAY),
        startingBalancePaise: 100_000_00n,
        scoringMethod: 'RETURN',
        visibility: 'PRIVATE',
      },
      database,
    );
    expect(challenge.inviteCode).toBeTruthy();

    // No code → rejected; wrong code → rejected; correct code → joins.
    await expect(
      joinChallenge({ challengeId: challenge.id, userId: bob.id }, database),
    ).rejects.toBeInstanceOf(ChallengeError);
    await expect(
      joinChallenge({ challengeId: challenge.id, userId: bob.id, inviteCode: 'WRONG123' }, database),
    ).rejects.toBeInstanceOf(ChallengeError);

    const joined = await joinChallengeByCode(
      { userId: bob.id, inviteCode: challenge.inviteCode!.toLowerCase() },
      database,
    );
    expect(joined.challengeId).toBe(challenge.id);

    // The creator can always join without a code.
    await expect(
      joinChallenge({ challengeId: challenge.id, userId: alice.id }, database),
    ).resolves.toBeTruthy();
  });
});

describe('Phase 4 — recurring rollover', () => {
  it('finalizes an ended weekly challenge and spawns the next instance', async () => {
    const alice = await user('carol');
    const ended = await createChallenge(
      {
        creatorId: alice.id,
        name: 'Weekly sprint',
        description: 'every week',
        startTimestamp: new Date(Date.now() - 8 * DAY),
        endTimestamp: new Date(Date.now() - DAY),
        startingBalancePaise: 100_000_00n,
        scoringMethod: 'RETURN',
        recurrence: 'WEEKLY',
      },
      database,
    );

    await rolloverRecurringChallenges(database);

    const original = await database.challenge.findUniqueOrThrow({ where: { id: ended.id } });
    expect(original.recurrence).toBeNull(); // detached so it only rolls once
    expect(original.status).toBe(ChallengeStatus.COMPLETED);

    const successors = await database.challenge.findMany({
      where: { name: 'Weekly sprint', id: { not: ended.id } },
    });
    expect(successors).toHaveLength(1);
    expect(successors[0].recurrence).toBe('WEEKLY');
    expect(successors[0].endTimestamp.getTime()).toBeGreaterThan(Date.now());

    // Rolling over again is a no-op (the ended one is detached, the new one is future).
    await rolloverRecurringChallenges(database);
    const total = await database.challenge.count({ where: { name: 'Weekly sprint' } });
    expect(total).toBe(2);
  });
});

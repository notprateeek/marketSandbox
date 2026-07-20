// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { LedgerEntryType, PrismaClient } from '@/generated/prisma/client';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

describe('user account initialization', () => {
  it('creates exactly one account with one ₹50,000 opening credit', async () => {
    const user = await registerUser(
      { name: 'Asha Shah', email: 'asha@example.com', password: 'tradeplay123' },
      database,
    );
    const account = await accountFor(user.id);

    expect(account.startingBalancePaise).toBe(INITIAL_BALANCE_PAISE);
    expect(account.availableCashPaise).toBe(INITIAL_BALANCE_PAISE);
    expect(account.ledgerEntries).toHaveLength(1);
    expect(account.ledgerEntries[0]).toMatchObject({
      type: LedgerEntryType.INITIAL_CREDIT,
      amountPaise: INITIAL_BALANCE_PAISE,
      balanceAfterPaise: INITIAL_BALANCE_PAISE,
    });
  });

  it('rejects duplicate registration and any second or mutated opening credit', async () => {
    const input = { name: 'Ravi Kumar', email: 'ravi@example.com', password: 'tradeplay123' };
    const user = await registerUser(input, database);

    await expect(
      registerUser({ ...input, email: ' RAVI@EXAMPLE.COM ' }, database),
    ).rejects.toMatchObject({ code: 'P2002' });

    const account = await accountFor(user.id);
    const openingCredit = account.ledgerEntries[0];

    await expect(
      database.ledgerEntry.create({
        data: {
          virtualAccountId: account.id,
          type: LedgerEntryType.INITIAL_CREDIT,
          amountPaise: INITIAL_BALANCE_PAISE,
          balanceAfterPaise: INITIAL_BALANCE_PAISE * 2n,
        },
      }),
    ).rejects.toBeDefined();

    await expect(
      database.ledgerEntry.update({
        where: { id: openingCredit.id },
        data: { amountPaise: 1n },
      }),
    ).rejects.toBeDefined();

    expect(await database.user.count({ where: { email: input.email } })).toBe(1);
    expect(await database.virtualAccount.count({ where: { userId: user.id } })).toBe(1);
    expect(
      await database.ledgerEntry.count({
        where: { virtualAccountId: account.id, type: LedgerEntryType.INITIAL_CREDIT },
      }),
    ).toBe(1);
  });
});

async function accountFor(userId: string) {
  const account = await database.virtualAccount.findFirst({
    where: { userId },
    include: { ledgerEntries: true },
  });

  if (!account) throw new Error('Expected the user to have a virtual account');
  return account;
}

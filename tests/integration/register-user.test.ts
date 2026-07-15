// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, openSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { LedgerEntryType, PrismaClient } from '@/generated/prisma/client';
import { INITIAL_BALANCE_PAISE, registerUser } from '@/server/services/register-user';

const databasePath = resolve(tmpdir(), `tradeplay-${randomUUID()}.db`);
const databaseUrl = `file:${databasePath}`;
let database: PrismaClient;

beforeAll(() => {
  closeSync(openSync(databasePath, 'a'));
  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'pipe',
    },
  );

  database = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databaseUrl }),
  });
});

afterAll(async () => {
  await database.$disconnect();
  for (const suffix of ['', '-shm', '-wal']) {
    const path = `${databasePath}${suffix}`;
    if (existsSync(path)) unlinkSync(path);
  }
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
          balanceAfterPaise: INITIAL_BALANCE_PAISE * 2,
        },
      }),
    ).rejects.toBeDefined();

    await expect(
      database.ledgerEntry.update({
        where: { id: openingCredit.id },
        data: { amountPaise: 1 },
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

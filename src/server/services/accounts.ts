import { randomUUID } from 'node:crypto';

import { AccountStatus, LedgerEntryType, type PrismaClient } from '@/generated/prisma/client';
import { MAX_PAISE } from '@/lib/finance/currency';
import { prisma } from '@/lib/prisma';

// Virtual cash received per unit paid at the simulated checkout. Paying ₹X
// credits ₹0.5X of virtual funds.
export const PURCHASE_MULTIPLIER = 0.5;

export class AccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccountError';
  }
}

// A "portfolio" is a personal account: not a simulation account, not a challenge
// account, and not closed. This keeps simulation and challenge funds isolated.
const PORTFOLIO_FILTER = {
  simulationSession: { is: null },
  challengeAccount: { is: null },
  status: { not: AccountStatus.CLOSED },
} as const;

export function listPortfolios(userId: string, database: PrismaClient = prisma) {
  return database.virtualAccount.findMany({
    where: { userId, ...PORTFOLIO_FILTER },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      name: true,
      status: true,
      startingBalancePaise: true,
      availableCashPaise: true,
      createdAt: true,
    },
  });
}

/**
 * The user's currently-selected portfolio id: their explicit choice if it is
 * still a valid open portfolio, otherwise their oldest open portfolio. All
 * account-scoped views resolve through here, so switching never mixes accounts.
 */
export async function getActiveAccountId(
  userId: string,
  database: PrismaClient = prisma,
): Promise<string | null> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { activeVirtualAccountId: true },
  });

  if (user?.activeVirtualAccountId) {
    const chosen = await database.virtualAccount.findFirst({
      where: { id: user.activeVirtualAccountId, userId, ...PORTFOLIO_FILTER },
      select: { id: true },
    });
    if (chosen) return chosen.id;
  }

  const fallback = await database.virtualAccount.findFirst({
    where: { userId, ...PORTFOLIO_FILTER },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return fallback?.id ?? null;
}

/**
 * Creates a portfolio and switches to it. Funding never mints free virtual
 * cash: pass `transferFromAccountId` to move `initialBalancePaise` out of an
 * existing owned portfolio (cost basis follows the cash, so both portfolios'
 * returns stay honest), or omit it to open an empty portfolio the user funds
 * later via the purchase checkout. The bare `initialBalancePaise` seed path
 * (no transfer source) is retained only for tests and fixtures.
 */
export async function createAccount(
  input: {
    userId: string;
    name: string;
    initialBalancePaise?: bigint;
    transferFromAccountId?: string | null;
  },
  database: PrismaClient = prisma,
) {
  const amount = input.initialBalancePaise ?? 0n;
  const name = input.name.trim() || 'New portfolio';
  if (amount !== 0n && !isPositivePaise(amount)) {
    throw new AccountError('Enter a valid amount.');
  }
  if (input.transferFromAccountId && amount <= 0n) {
    throw new AccountError('Enter an amount to transfer.');
  }

  return database.$transaction(async (transaction) => {
    const source = input.transferFromAccountId
      ? await transaction.virtualAccount.findFirst({
          where: { id: input.transferFromAccountId, userId: input.userId, ...PORTFOLIO_FILTER },
          select: { id: true, name: true, availableCashPaise: true, startingBalancePaise: true },
        })
      : null;
    if (input.transferFromAccountId && !source) {
      throw new AccountError('Source portfolio not found.');
    }
    if (source && amount > source.availableCashPaise) {
      throw new AccountError('That is more than the source portfolio has available.');
    }

    const account = await transaction.virtualAccount.create({
      data: {
        userId: input.userId,
        name,
        startingBalancePaise: amount,
        availableCashPaise: amount,
        status: AccountStatus.ACTIVE,
        ledgerEntries:
          amount > 0n
            ? {
                create: {
                  type: LedgerEntryType.INITIAL_CREDIT,
                  amountPaise: amount,
                  balanceAfterPaise: amount,
                  referenceType: source ? 'TRANSFER' : 'SYSTEM',
                  referenceId: source ? source.id : 'ACCOUNT_OPENING',
                  description: source
                    ? `Opening transfer from ${source.name}`
                    : 'Initial virtual cash credit',
                },
              }
            : undefined,
      },
    });

    if (source) {
      const newSourceCash = source.availableCashPaise - amount;
      const newSourceBasis = source.startingBalancePaise - amount;
      await transaction.virtualAccount.update({
        where: { id: source.id },
        data: {
          availableCashPaise: newSourceCash,
          // ponytail: cost basis follows the cash so the source's return isn't
          // distorted; floor at 0 so withdrawing realized gains can't make it negative.
          startingBalancePaise: newSourceBasis < 0n ? 0n : newSourceBasis,
        },
      });
      await transaction.ledgerEntry.create({
        data: {
          virtualAccountId: source.id,
          type: LedgerEntryType.ADJUSTMENT,
          amountPaise: -amount,
          balanceAfterPaise: newSourceCash,
          referenceType: 'TRANSFER',
          referenceId: account.id,
          description: `Transferred to ${name}`,
        },
      });
    }

    // Switch to the newly-created portfolio.
    await transaction.user.update({
      where: { id: input.userId },
      data: { activeVirtualAccountId: account.id },
    });
    return account;
  });
}

/**
 * Credits virtual cash to a portfolio from the simulated checkout. The user
 * "pays" `amountPaidPaise` and receives `floor(amountPaidPaise * 0.5)` in
 * virtual funds — no real money changes hands. The credit bumps
 * `availableCashPaise` and writes a matching ADJUSTMENT ledger entry in one
 * transaction, preserving the reconciliation invariant
 * (cash == Σ ledger amounts, with a consistent balance chain).
 */
export async function addFunds(
  input: { userId: string; accountId: string; amountPaidPaise: bigint },
  database: PrismaClient = prisma,
) {
  if (!isPositivePaise(input.amountPaidPaise)) {
    throw new AccountError('Enter an amount greater than zero.');
  }
  const credited = BigInt(Math.floor(Number(input.amountPaidPaise) * PURCHASE_MULTIPLIER));
  if (credited <= 0n) {
    throw new AccountError('That amount is too small to credit any funds.');
  }

  await ownedPortfolio(input.accountId, input.userId, database);

  return database.$transaction(async (transaction) => {
    const account = await transaction.virtualAccount.findUniqueOrThrow({
      where: { id: input.accountId },
      select: { availableCashPaise: true },
    });

    const newCash = account.availableCashPaise + credited;
    if (newCash > MAX_PAISE) {
      throw new AccountError('This would exceed the maximum portfolio balance.');
    }

    await transaction.virtualAccount.update({
      where: { id: input.accountId },
      // Purchased funds are new principal: raise the cost basis too, or total
      // return (value − startingBalance) would count the deposit as a gain.
      data: { availableCashPaise: newCash, startingBalancePaise: { increment: credited } },
    });

    return transaction.ledgerEntry.create({
      data: {
        virtualAccountId: input.accountId,
        type: LedgerEntryType.ADJUSTMENT,
        amountPaise: credited,
        balanceAfterPaise: newCash,
        referenceType: 'PURCHASE',
        referenceId: randomUUID(),
        description: `Purchased virtual funds (paid ${formatPaidDescription(input.amountPaidPaise)})`,
      },
    });
  });
}

function formatPaidDescription(paise: bigint): string {
  return `₹${(Number(paise) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function setActiveAccount(
  params: { userId: string; accountId: string },
  database: PrismaClient = prisma,
) {
  await ownedPortfolio(params.accountId, params.userId, database);
  await database.user.update({
    where: { id: params.userId },
    data: { activeVirtualAccountId: params.accountId },
  });
}

/**
 * "Deletes" a portfolio by closing it. The ledger, orders and positions are
 * kept for audit — nothing is destroyed. Refuses to close the last open
 * portfolio, and re-points the active selection if needed.
 */
export async function closeAccount(
  params: { userId: string; accountId: string },
  database: PrismaClient = prisma,
) {
  await ownedPortfolio(params.accountId, params.userId, database);

  const openCount = await database.virtualAccount.count({
    where: { userId: params.userId, ...PORTFOLIO_FILTER },
  });
  if (openCount <= 1) {
    throw new AccountError('You must keep at least one open portfolio.');
  }

  await database.$transaction(async (transaction) => {
    await transaction.virtualAccount.update({
      where: { id: params.accountId },
      data: { status: AccountStatus.CLOSED },
    });

    const user = await transaction.user.findUnique({
      where: { id: params.userId },
      select: { activeVirtualAccountId: true },
    });
    if (user?.activeVirtualAccountId === params.accountId) {
      const next = await transaction.virtualAccount.findFirst({
        where: { userId: params.userId, ...PORTFOLIO_FILTER },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      await transaction.user.update({
        where: { id: params.userId },
        data: { activeVirtualAccountId: next?.id ?? null },
      });
    }
  });
}

async function ownedPortfolio(accountId: string, userId: string, database: PrismaClient) {
  const account = await database.virtualAccount.findFirst({
    where: { id: accountId, userId, ...PORTFOLIO_FILTER },
    select: { id: true },
  });
  if (!account) throw new AccountError('Portfolio not found.');
  return account;
}

function isPositivePaise(value: bigint): boolean {
  return value > 0n && value <= MAX_PAISE;
}

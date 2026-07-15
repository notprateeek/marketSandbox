import { AccountStatus, LedgerEntryType, type PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';
import { MAX_DATABASE_INT } from '@/server/services/submit-market-order';

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

export async function createAccount(
  input: { userId: string; name: string; initialBalancePaise: number },
  database: PrismaClient = prisma,
) {
  if (!isPositiveDatabaseInt(input.initialBalancePaise)) {
    throw new AccountError('Enter a starting balance greater than zero.');
  }
  const name = input.name.trim() || 'New portfolio';

  const account = await database.virtualAccount.create({
    data: {
      userId: input.userId,
      name,
      startingBalancePaise: input.initialBalancePaise,
      availableCashPaise: input.initialBalancePaise,
      status: AccountStatus.ACTIVE,
      ledgerEntries: {
        create: {
          type: LedgerEntryType.INITIAL_CREDIT,
          amountPaise: input.initialBalancePaise,
          balanceAfterPaise: input.initialBalancePaise,
          referenceType: 'SYSTEM',
          referenceId: 'ACCOUNT_OPENING',
          description: 'Initial virtual cash credit',
        },
      },
    },
  });

  // Switch to the newly-created portfolio.
  await database.user.update({
    where: { id: input.userId },
    data: { activeVirtualAccountId: account.id },
  });
  return account;
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

function isPositiveDatabaseInt(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_DATABASE_INT;
}

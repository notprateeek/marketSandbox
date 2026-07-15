import { OrderStatus, type PrismaClient } from '@/generated/prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Financial-integrity reconciliation for a virtual account. Reads the ledger,
 * positions and orders and returns a list of violations (empty ⇒ healthy).
 * Used by tests and can be run against production data as a safety net.
 *
 * Invariants checked:
 *  - available cash == sum of every ledger entry's signed amount
 *    (initial + sell + dividend + adjustments − buy − fees).
 *  - cash is never negative.
 *  - no position has a negative quantity or cost basis.
 *  - every FILLED order has a trade execution.
 *  - the ledger balance chain is consistent: each entry's balanceAfter equals
 *    some prior balance plus its amount, forming one chain from 0 to the cash.
 */
export interface ReconciliationViolation {
  virtualAccountId: string;
  code: string;
  detail: string;
}

export async function reconcileAccount(
  virtualAccountId: string,
  database: PrismaClient = prisma,
): Promise<ReconciliationViolation[]> {
  const violations: ReconciliationViolation[] = [];
  const flag = (code: string, detail: string) =>
    violations.push({ virtualAccountId, code, detail });

  const [account, ledger, positions, filledMissingExecution] = await Promise.all([
    database.virtualAccount.findUnique({ where: { id: virtualAccountId } }),
    database.ledgerEntry.findMany({ where: { virtualAccountId } }),
    database.position.findMany({ where: { virtualAccountId } }),
    database.order.count({
      where: { virtualAccountId, status: OrderStatus.FILLED, execution: { is: null } },
    }),
  ]);

  if (!account) {
    return [{ virtualAccountId, code: 'MISSING_ACCOUNT', detail: 'Account does not exist' }];
  }

  // available cash == Σ ledger amounts
  const ledgerSum = ledger.reduce((sum, entry) => sum + entry.amountPaise, 0);
  if (ledgerSum !== account.availableCashPaise) {
    flag('CASH_MISMATCH', `cash ${account.availableCashPaise} != ledger sum ${ledgerSum}`);
  }
  if (account.availableCashPaise < 0) {
    flag('NEGATIVE_CASH', `cash is ${account.availableCashPaise}`);
  }

  for (const position of positions) {
    if (position.quantity < 0) {
      flag('NEGATIVE_QUANTITY', `position ${position.instrumentId} quantity ${position.quantity}`);
    }
    if (position.totalCostPaise < 0) {
      flag('NEGATIVE_COST', `position ${position.instrumentId} cost ${position.totalCostPaise}`);
    }
  }

  if (filledMissingExecution > 0) {
    flag('FILLED_WITHOUT_EXECUTION', `${filledMissingExecution} filled order(s) lack an execution`);
  }

  if (ledger.length > 0) {
    checkLedgerChain(ledger, account.availableCashPaise, flag);
  }

  return violations;
}

export async function reconcileAllAccounts(
  database: PrismaClient = prisma,
): Promise<ReconciliationViolation[]> {
  const accounts = await database.virtualAccount.findMany({ select: { id: true } });
  const perAccount = await Promise.all(
    accounts.map((account) => reconcileAccount(account.id, database)),
  );
  return perAccount.flat();
}

/**
 * Order-independent ledger-chain check. Each entry has a balance-before
 * (balanceAfter − amount); collectively those befores must equal {0} plus every
 * balance-after except the final one (the account's current cash). This holds
 * regardless of row ordering, so it is robust to equal `createdAt` timestamps.
 */
function checkLedgerChain(
  ledger: { amountPaise: number; balanceAfterPaise: number }[],
  cashPaise: number,
  flag: (code: string, detail: string) => void,
) {
  const afters = ledger.map((entry) => entry.balanceAfterPaise);
  const befores = ledger.map((entry) => entry.balanceAfterPaise - entry.amountPaise);

  const finalIndex = afters.indexOf(cashPaise);
  if (finalIndex === -1) {
    flag('LEDGER_FINAL_MISMATCH', `no ledger entry ends at the current cash ${cashPaise}`);
    return;
  }

  const expectedBefores = afters.filter((_, index) => index !== finalIndex);
  expectedBefores.push(0);

  if (!sameMultiset(befores, expectedBefores)) {
    flag('LEDGER_CHAIN_BROKEN', 'ledger balances do not form a single consistent chain');
  }
}

function sameMultiset(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, index) => value === sortedB[index]);
}

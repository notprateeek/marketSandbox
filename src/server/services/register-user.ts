import { AccountStatus, LedgerEntryType, type PrismaClient } from '@/generated/prisma/client';
import { hashPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { normalizeEmail, type RegistrationInput } from '@/lib/validation/auth';

export const INITIAL_BALANCE_PAISE = 5_000_000n;

type RegistrationDatabase = Pick<PrismaClient, 'user'>;

export async function registerUser(
  input: RegistrationInput,
  database: RegistrationDatabase = prisma,
) {
  const passwordHash = await hashPassword(input.password);

  return database.user.create({
    data: {
      name: input.name.trim(),
      email: normalizeEmail(input.email),
      passwordHash,
      virtualAccounts: {
        create: {
          name: 'Primary Account',
          startingBalancePaise: INITIAL_BALANCE_PAISE,
          availableCashPaise: INITIAL_BALANCE_PAISE,
          status: AccountStatus.ACTIVE,
          ledgerEntries: {
            create: {
              type: LedgerEntryType.INITIAL_CREDIT,
              amountPaise: INITIAL_BALANCE_PAISE,
              balanceAfterPaise: INITIAL_BALANCE_PAISE,
              referenceType: 'SYSTEM',
              referenceId: 'ACCOUNT_OPENING',
              description: 'Initial virtual cash credit',
            },
          },
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
    },
  });
}

import { randomBytes } from 'node:crypto';

import type { PrismaClient } from '@/generated/prisma/client';
import { hashPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';

// Reuses the NextAuth `VerificationToken` table (identifier = email) — no new
// model or migration. Reset links are single-use and live for one hour.
type ResetDatabase = Pick<PrismaClient, 'user' | 'verificationToken'>;

const TOKEN_TTL_MS = 60 * 60 * 1000;

/**
 * Issues a single-use password-reset token for `email`, replacing any prior
 * one. Returns the token, or null when no account has that email (so callers
 * don't reveal which addresses are registered).
 */
export async function createPasswordResetToken(
  email: string,
  database: ResetDatabase = prisma,
): Promise<string | null> {
  const user = await database.user.findUnique({ where: { email }, select: { id: true } });
  if (!user) return null;

  const token = randomBytes(32).toString('base64url');
  await database.verificationToken.deleteMany({ where: { identifier: email } });
  await database.verificationToken.create({
    data: { identifier: email, token, expires: new Date(Date.now() + TOKEN_TTL_MS) },
  });
  return token;
}

/**
 * Consumes a reset token and sets the account's new password. Returns false if
 * the token is unknown, expired, or its account is gone. A successful reset (or
 * an expired hit) clears every token for that email, so links are single-use.
 */
export async function resetPasswordWithToken(
  token: string,
  newPassword: string,
  database: ResetDatabase = prisma,
): Promise<boolean> {
  const record = await database.verificationToken.findUnique({ where: { token } });
  if (!record) return false;

  const user =
    record.expires < new Date()
      ? null
      : await database.user.findUnique({
          where: { email: record.identifier },
          select: { id: true },
        });

  if (!user) {
    await database.verificationToken.deleteMany({ where: { identifier: record.identifier } });
    return false;
  }

  const passwordHash = await hashPassword(newPassword);
  await database.user.update({ where: { id: user.id }, data: { passwordHash } });
  await database.verificationToken.deleteMany({ where: { identifier: record.identifier } });
  return true;
}

// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEphemeralDatabase, type EphemeralDatabase } from '../helpers/pg';
import { PrismaClient } from '@/generated/prisma/client';
import { verifyPassword } from '@/lib/password';
import {
  createPasswordResetToken,
  resetPasswordWithToken,
} from '@/server/services/password-reset';
import { registerUser } from '@/server/services/register-user';

let ephemeral: EphemeralDatabase;
let database: PrismaClient;

beforeAll(async () => {
  ephemeral = await createEphemeralDatabase();
  database = ephemeral.client;
});

afterAll(async () => {
  await ephemeral.drop();
});

async function makeUser(email: string) {
  return registerUser({ name: 'Test', email, password: 'original-pass' }, database);
}

describe('password reset', () => {
  it('returns null for an unknown email and issues no token', async () => {
    expect(await createPasswordResetToken('nobody@example.com', database)).toBeNull();
    expect(await database.verificationToken.count()).toBe(0);
  });

  it('resets the password with a valid token and makes the token single-use', async () => {
    const email = 'reset@example.com';
    const user = await makeUser(email);

    const token = await createPasswordResetToken(email, database);
    expect(token).toBeTruthy();

    expect(await resetPasswordWithToken(token!, 'brand-new-pass', database)).toBe(true);

    const updated = await database.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    expect(await verifyPassword('brand-new-pass', updated.passwordHash!)).toBe(true);
    expect(await verifyPassword('original-pass', updated.passwordHash!)).toBe(false);

    // Single-use: the same token can't reset again.
    expect(await resetPasswordWithToken(token!, 'another-pass', database)).toBe(false);
  });

  it('issuing a new token invalidates the previous one', async () => {
    const email = 'reissue@example.com';
    await makeUser(email);

    const first = await createPasswordResetToken(email, database);
    const second = await createPasswordResetToken(email, database);
    expect(first).not.toBe(second);

    expect(await resetPasswordWithToken(first!, 'x-pass-1', database)).toBe(false);
    expect(await resetPasswordWithToken(second!, 'x-pass-2', database)).toBe(true);
  });

  it('rejects an expired token and clears it', async () => {
    const email = 'expired@example.com';
    await makeUser(email);

    await createPasswordResetToken(email, database);
    await database.verificationToken.updateMany({
      where: { identifier: email },
      data: { expires: new Date(Date.now() - 1000) },
    });
    const expired = await database.verificationToken.findFirstOrThrow({
      where: { identifier: email },
    });

    expect(await resetPasswordWithToken(expired.token, 'too-late-pass', database)).toBe(false);
    expect(await database.verificationToken.count({ where: { identifier: email } })).toBe(0);
  });
});

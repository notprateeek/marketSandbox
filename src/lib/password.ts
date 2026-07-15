import { promisify } from 'node:util';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const HASH_PREFIX = 'scrypt';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const key = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

  return `${HASH_PREFIX}:${salt}:${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return false;

  const [, salt, encodedKey] = parts;
  const expectedKey = Buffer.from(encodedKey, 'base64url');
  if (expectedKey.length !== KEY_LENGTH) return false;

  const actualKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return timingSafeEqual(expectedKey, actualKey);
}

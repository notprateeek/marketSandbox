import 'dotenv/config';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const databaseUrl = process.env.DATABASE_URL ?? 'file:./prisma/dev.db';

if (databaseUrl.startsWith('file:')) {
  const databasePath = resolve(databaseUrl.slice('file:'.length));
  mkdirSync(dirname(databasePath), { recursive: true });
  closeSync(openSync(databasePath, 'a'));
}

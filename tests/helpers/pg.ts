// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';

import { PrismaClient } from '@/generated/prisma/client';

// Each integration test file gets its own throwaway Postgres database, migrated
// fresh and dropped afterwards — the Postgres analogue of the old per-file
// SQLite files. Connection details come from DATABASE_URL (the dev/CI Postgres).
// ponytail: migrate-deploy per file is a few seconds each; switch to a migrated
// template database (CREATE DATABASE ... TEMPLATE) if the suite gets slow.
const BASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://tradeplay:tradeplay@localhost:5433/tradeplay';

export interface EphemeralDatabase {
  client: PrismaClient;
  url: string;
  drop: () => Promise<void>;
}

function urlForDatabase(name: string): string {
  const url = new URL(BASE_URL);
  url.pathname = `/${name}`;
  return url.toString();
}

const ADMIN_URL = urlForDatabase('postgres');

export async function createEphemeralDatabase(): Promise<EphemeralDatabase> {
  const name = `test_${randomUUID().replace(/-/g, '')}`;
  const url = urlForDatabase(name);

  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  execFileSync(
    process.execPath,
    [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    { cwd: process.cwd(), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' },
  );

  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });

  return {
    client,
    url,
    drop: async () => {
      await client.$disconnect();
      const cleaner = new Client({ connectionString: ADMIN_URL });
      await cleaner.connect();
      try {
        await cleaner.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await cleaner.end();
      }
    },
  };
}

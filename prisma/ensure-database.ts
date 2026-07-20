import 'dotenv/config';
import { Client } from 'pg';

// Ensures the target Postgres database exists before `prisma migrate` runs.
// Connects to the `postgres` maintenance DB and creates the target if missing.
const databaseUrl =
  process.env.DATABASE_URL ?? 'postgresql://tradeplay:tradeplay@localhost:5433/tradeplay';

async function main() {
  const url = new URL(databaseUrl);
  const targetDatabase = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!targetDatabase) throw new Error('DATABASE_URL has no database name');

  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      targetDatabase,
    ]);
    if (existing.rowCount === 0) {
      // Identifiers can't be parameterised; the name comes from our own env, not user input.
      await client.query(`CREATE DATABASE "${targetDatabase.replace(/"/g, '""')}"`);
      console.log(`Created database "${targetDatabase}".`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

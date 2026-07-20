import 'dotenv/config';
import { readFile } from 'node:fs/promises';

import { importNseBhavcopy } from '@/server/market-data';

/**
 * Post-market EOD job: append ONE_DAY candles from an NSE bhavcopy CSV.
 *
 *   npm run import:bhavcopy -- ./BhavCopy_NSE_CM_0_0_0_20260717_F_0000.csv
 *
 * Download the day's (unzipped) UDiFF sec-bhavcopy from NSE first, then run this
 * against it — wire it to cron/systemd at ~6:30pm IST. Only instruments already
 * tracked in the database are imported; the rest of the file is ignored.
 */
async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: tsx scripts/import-bhavcopy.ts <bhavcopy.csv>');
    process.exit(1);
  }

  const csv = await readFile(path, 'utf8');
  const summary = await importNseBhavcopy(csv);
  console.log(
    `Imported ${summary.importedRows} candle(s) — ${summary.duplicateRows} duplicate, ${summary.rejectedRows} rejected.`,
  );
  if (summary.errors.length > 0) {
    console.log(`First errors:`, summary.errors.slice(0, 5));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => process.exit(0));

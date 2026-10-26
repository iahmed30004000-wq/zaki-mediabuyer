/**
 * `npm run db:restore -- <backup folder>` — restores a backup into the database of DATABASE_URL, which must be EMPTY
 * and already migrated (`npx prisma migrate deploy`). Every table's count is checked against the backup's manifest.
 */
import { db } from "../src/server/db";
import { restoreAll } from "../src/ops/backup";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: npm run db:restore -- <backup folder>");
  process.exit(1);
}
restoreAll(db, dir).then((r) => {
  console.log(`restore ✓ ${Object.values(r).reduce((a, b) => a + b, 0)} rows into ${Object.keys(r).length} tables`);
  process.exit(0);
}).catch((e) => {
  console.error("restore failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

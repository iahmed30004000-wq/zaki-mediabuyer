/** `npm run db:backup` — a backup now, into STORAGE_DIR/backups/<today> (the same as the daily 02:30 job). */
import { db } from "../src/server/db";
import { dailyBackup } from "../src/ops/backup";

dailyBackup(db).then((r) => {
  console.log(`backup ✓ ${r.dir} — ${r.tables} tables, ${r.rows} rows (last ${r.kept} days kept)`);
  process.exit(0);
}).catch((e) => {
  console.error("backup failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

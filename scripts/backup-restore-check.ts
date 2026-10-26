/**
 * The backup drill (spec 17.4 «استرجاع تجريبي ناجح»): back up the local database, create a scratch database,
 * migrate it, restore into it, compare every table, drop the scratch database. Nothing touches the real one.
 * `npx tsx --env-file=.env scripts/backup-restore-check.ts`
 */
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { db } from "../src/server/db";
import { backupAll, restoreAll } from "../src/ops/backup";

const SCRATCH = "mb_restore_drill";
const psql = (sql: string) => execSync(`docker exec mediabuyer-db psql -U mediabuyer -d postgres -c "${sql}"`, { stdio: "pipe" });

(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "mb-backup-"));
  const manifest = await backupAll(db, dir);
  const rows = Object.values(manifest.counts).reduce((a, b) => a + b, 0);
  console.log(`✓ backup: ${Object.keys(manifest.counts).length} tables, ${rows} rows, migration ${manifest.migration}`);

  psql(`DROP DATABASE IF EXISTS ${SCRATCH}`);
  psql(`CREATE DATABASE ${SCRATCH}`);
  const url = process.env.DATABASE_URL!.replace(/\/[^/?]+(\?|$)/, `/${SCRATCH}$1`);
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const target = new PrismaClient({ datasources: { db: { url } } });
  try {
    const restored = await restoreAll(target, dir);
    const total = Object.values(restored).reduce((a, b) => a + b, 0);
    console.log(`✓ restore into an empty database: ${total} rows, every table matches the manifest`);
    const again = await restoreAll(target, dir).then(() => "accepted").catch((e: Error) => e.message);
    console.log(`${again.includes("not empty") ? "✓" : "✗"} a second restore into the same (now full) database is refused: «${again}»`);
    const sample = await target.changeSet.count();
    console.log(`✓ the restored database answers: ${sample} change sets, ${await target.attributedOrder.count()} orders`);
  } finally {
    await target.$disconnect();
    psql(`DROP DATABASE IF EXISTS ${SCRATCH}`);
    rmSync(dir, { recursive: true, force: true });
  }
  process.exit(0);
})().catch((e) => {
  console.error("✗ drill failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});

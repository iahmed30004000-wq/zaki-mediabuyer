/**
 * THE WEEKLY CLEAN-UP (docs/rebuild-v6/00-audit.md N-14): the tables that grow without a limit are trimmed once a week, by the cut-offs of
 * src/core/retention.ts. The worker's own slot rows older than 30 days (the newest good run of every job stays: «آخر مرة نجحت» reads it), the audit row
 * of every tool call older than 90 days (no other kind of audit row is touched), and the authorization codes that expired. Nothing a person decided or wrote
 * is here, and no run of a job is.
 */
import { AUDIT_ACTION_CLEANED, cleanupCutoffs } from "@/core/retention";
import { db } from "@/server/db";

export type CleanupResult = {
  jobRuns: number;
  mcpCalls: number;
  oauthCodes: number;
};

export async function weeklyCleanup(now = new Date()): Promise<CleanupResult> {
  const cut = cleanupCutoffs(now);

  // the newest good slot of each job stays, however old
  const good = await db.jobRun.groupBy({ by: ["job"], where: { status: "ok" }, _max: { finishedAt: true } });
  const keep = good.filter((g) => g._max.finishedAt).map((g) => ({ job: g.job, finishedAt: g._max.finishedAt as Date }));
  const jobRuns = await db.jobRun.deleteMany({ where: { startedAt: { lt: cut.jobRun }, ...(keep.length ? { NOT: { OR: keep } } : {}) } });

  const mcpCalls = await db.auditLog.deleteMany({ where: { action: AUDIT_ACTION_CLEANED, createdAt: { lt: cut.mcpCall } } });
  const oauthCodes = await db.oAuthCode.deleteMany({ where: { expiresAt: { lt: cut.oauthCode } } });
  return { jobRuns: jobRuns.count, mcpCalls: mcpCalls.count, oauthCodes: oauthCodes.count };
}

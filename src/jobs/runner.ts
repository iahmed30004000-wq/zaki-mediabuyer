/**
 * The job runner (DECISIONS D3: database rows instead of BullMQ). A run is a JobRun row unique on (job, slot): the
 * insert IS the lock, so the same job never runs twice for the same slot — two workers, a restart, a double click.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";

export type JobResult = Record<string, unknown> | void;

/** Runs `fn` once for `slot` (e.g. "2026-10-26T09"); returns null when that slot already ran or is running. */
export async function runOnce(job: string, slot: string, fn: () => Promise<JobResult>): Promise<{ ok: boolean; stats?: JobResult; error?: string } | null> {
  let runId: string;
  try {
    runId = (await db.jobRun.create({ data: { job, slot, status: "running" } })).id;
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return null;
    throw e;
  }
  try {
    const stats = await fn();
    await db.jobRun.update({ where: { id: runId }, data: { status: "ok", finishedAt: new Date(), stats: (stats ?? {}) as Prisma.InputJsonValue } });
    return { ok: true, stats };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await db.jobRun.update({ where: { id: runId }, data: { status: "failed", finishedAt: new Date(), error: error.slice(0, 2000) } });
    return { ok: false, error };
  }
}

/** When the last successful run of a job finished (the «stale data» rule reads this, spec 6.4 rule.stale_data). */
export async function lastSuccess(job: string): Promise<Date | null> {
  const r = await db.jobRun.findFirst({ where: { job, status: "ok" }, orderBy: { finishedAt: "desc" } });
  return r?.finishedAt ?? null;
}

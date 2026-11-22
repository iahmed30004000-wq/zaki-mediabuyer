/**
 * The job runner (DECISIONS D3: database rows instead of BullMQ). A run is a JobRun row unique on (job, slot): the
 * insert IS the lock, so the same job never runs twice for the same slot — two workers, a restart, a double click.
 *
 * A slot is not burned by a failure any more (v6 P0-1, N-07): a job given `retries` is tried again by the next round of the
 * worker until it has had `retries + 1` attempts; a row left «running» by a process that died is closed as «interrupted»
 * after 30 minutes. The claim of a retry is a compare-and-set on the row, so two workers never both retry.
 */
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { STALE_RUNNING_MS, slotAction } from "@/core/job-slot";

export type JobResult = Record<string, unknown> | void;

let draining = false;
/** After SIGTERM no new job starts; the one running finishes (or the process is cut, and its row is closed later as interrupted). */
export function stopStarting() {
  draining = true;
}
export function isStopping() {
  return draining;
}

/** Runs `fn` once for `slot` (e.g. "2026-10-26T09"); returns null when that slot already ran or is running (or the process is shutting down). */
export async function runOnce(job: string, slot: string, fn: () => Promise<JobResult>, opts: { retries?: number } = {}): Promise<{ ok: boolean; stats?: JobResult; error?: string } | null> {
  if (draining) return null;
  const retries = opts.retries ?? 0;
  let runId: string;
  try {
    runId = (await db.jobRun.create({ data: { job, slot, status: "running" } })).id;
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    const claimed = await claimRetry(job, slot, retries);
    if (!claimed) return null;
    runId = claimed;
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

/** The slot has a row: take it over for another attempt when the rules allow, else null. */
async function claimRetry(job: string, slot: string, retries: number): Promise<string | null> {
  const row = await db.jobRun.findUnique({ where: { job_slot: { job, slot } } });
  if (!row) return null;
  const now = new Date();
  const act = slotAction(row, now, retries);
  if (act.interrupt) await db.jobRun.updateMany({ where: { id: row.id, status: "running", attempt: row.attempt }, data: { status: "failed", finishedAt: now, error: "interrupted" } });
  if (!act.retry) return null;
  const won = await db.jobRun.updateMany({
    where: { id: row.id, status: "failed", attempt: row.attempt },
    data: { status: "running", attempt: row.attempt + 1, startedAt: now, finishedAt: null, error: null },
  });
  return won.count === 1 ? row.id : null;
}

/** Rows left «running» by a process that died (a deploy restarts the worker at any hour) are closed as failed «interrupted» after 30 minutes. */
export async function sweepInterrupted(now = new Date()): Promise<number> {
  const r = await db.jobRun.updateMany({ where: { status: "running", startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } }, data: { status: "failed", finishedAt: now, error: "interrupted" } });
  return r.count;
}

/** When the last successful run of a job finished (the «stale data» rule reads this, spec 6.4 rule.stale_data). */
export async function lastSuccess(job: string): Promise<Date | null> {
  const r = await db.jobRun.findFirst({ where: { job, status: "ok" }, orderBy: { finishedAt: "desc" } });
  return r?.finishedAt ?? null;
}

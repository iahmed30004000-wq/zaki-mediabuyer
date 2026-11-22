/**
 * ONE MAP OF JOBS, the server side (docs/rebuild-v6/01-model.md §12, W-23 · U-03). The site owns the numbers; a name is one job; a job that was merged
 * into another leads there. Nothing here deletes: a merged job is put away (`archivedAt`) with `mergedInto` pointing at the one that kept its history.
 * The screen that lets the owner tidy up is P3's — these are the pieces it calls.
 */
import type { Prisma, Workflow } from "@prisma/client";
import { MAX_JOB_NUMBER, mergedRef, nextNumber, renumberOrder, suggestDuplicates, type DuplicatePair } from "@/core/job-map";
import { audit, type Actor } from "./audit";
import { db } from "./db";

/** A client that can read and write jobs: the database itself, or a transaction on it. */
type Client = Pick<Prisma.TransactionClient, "workflow">;

export class MergeRefused extends Error {}

const MAX_HOPS = 5;

/**
 * The job a key leads to: itself, or — when it was merged into another — that one (a short chain, never a loop). Null: no such job. A log or a push
 * under the key of a job that was merged lands on the one that kept it.
 */
export async function loadJob(key: string, client: Client = db): Promise<Workflow | null> {
  let row = await client.workflow.findUnique({ where: { key } });
  const seen = new Set<string>([key]);
  for (let i = 0; i < MAX_HOPS && row?.mergedInto && !seen.has(row.mergedInto); i++) {
    seen.add(row.mergedInto);
    const next = await client.workflow.findUnique({ where: { key: row.mergedInto } });
    if (!next) break;
    row = next;
  }
  return row;
}

/** The next free number among the jobs that are not put away. Call it inside `withNumberLock` when the number is about to be written. */
export async function nextJobNumber(client: Client = db): Promise<number> {
  const rows = await client.workflow.findMany({ where: { archivedAt: null, number: { not: null } }, select: { number: true } });
  return nextNumber(rows.map((r) => r.number));
}

/** Is this number taken by another job that is not put away? */
export async function numberTaken(number: number, exceptKey: string | null, client: Client = db): Promise<boolean> {
  const hit = await client.workflow.findFirst({ where: { number, archivedAt: null, ...(exceptKey ? { key: { not: exceptKey } } : {}) }, select: { key: true } });
  return !!hit;
}

/** Runs `fn` with the numbering lock held (two jobs made at the same moment never get the same number). */
export async function withNumberLock<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"jobs:number"}))`;
      return fn(tx);
    },
    { timeout: 15_000 },
  );
}

/** The pairs that look like one job written twice (the same name once normalized, or the same cron for the same carrier). The owner decides each one. */
export async function listDuplicates(): Promise<DuplicatePair[]> {
  const rows = await db.workflow.findMany({ where: { archivedAt: null, mergedInto: null }, select: { id: true, key: true, name: true, number: true, domain: true, schedule: true, assigneeKey: true, enabled: true, createdAt: true } });
  const runs = await db.workflowRun.groupBy({ by: ["workflowId"], _count: { _all: true } });
  const count = new Map(runs.map((r) => [r.workflowId, (r._count as { _all: number })._all]));
  return suggestDuplicates(rows.map((r) => ({ key: r.key, name: r.name, number: r.number, domain: r.domain, schedule: r.schedule, assigneeKey: r.assigneeKey, enabled: r.enabled, createdAt: r.createdAt, runs: count.get(r.id) ?? 0 })));
}

export interface MergeResult {
  keep: string;
  drop: string;
  runs: number;
  /** runs that had to take a new ref because the kept job already had one like it */
  renamedRefs: number;
  handoffs: number;
  approvals: number;
}

/**
 * «ادمج الثانية فيها»: the runs of `drop` move to `keep` (a ref that is already there takes a suffix), its open requests and decisions follow, and `drop`
 * is put away with `mergedInto = keep`. From then on a `log_run` or a `push_jobs` under the key of `drop` goes to `keep`. One transaction, with both
 * jobs locked, so a run logged during the merge lands on one side or the other, whole.
 */
export async function mergeJobs(keepKey: string, dropKey: string, actor: Actor, now = new Date()): Promise<MergeResult> {
  if (keepKey === dropKey) throw new MergeRefused("ما بينفع تدمج مهمة بنفسها");
  const out = await db.$transaction(
    async (tx) => {
      for (const k of [keepKey, dropKey].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wf:${k}`}))`;
      const keep = await tx.workflow.findUnique({ where: { key: keepKey } });
      const drop = await tx.workflow.findUnique({ where: { key: dropKey } });
      if (!keep || !drop) throw new MergeRefused("المهمة مش موجودة");
      if (keep.archivedAt || keep.mergedInto) throw new MergeRefused("المهمة اللي بدك تدمج فيها مؤرشفة أو مدموجة بغيرها");
      if (drop.mergedInto) throw new MergeRefused("هاي المهمة اندمجت قبل");
      const taken = new Set((await tx.workflowRun.findMany({ where: { workflowId: keep.id }, select: { ref: true } })).map((r) => r.ref));
      const moving = await tx.workflowRun.findMany({ where: { workflowId: drop.id }, orderBy: { startedAt: "asc" }, select: { id: true, ref: true } });
      let renamed = 0;
      for (const r of moving) {
        const ref = mergedRef(r.ref, drop, taken);
        taken.add(ref);
        await tx.workflowRun.update({ where: { id: r.id }, data: { workflowId: keep.id, ...(ref !== r.ref ? { ref } : {}) } });
        if (ref !== r.ref) {
          renamed++;
          // the requests of a run that took a new name follow it
          await tx.handoff.updateMany({ where: { workflowKey: drop.key, runRef: r.ref }, data: { runRef: ref } });
        }
      }
      const moved = await tx.handoff.updateMany({ where: { workflowKey: drop.key }, data: { workflowKey: keep.key } });
      const approvals = await tx.approval.updateMany({ where: { workflowKey: drop.key }, data: { workflowKey: keep.key } });
      await tx.workflow.update({ where: { id: drop.id }, data: { archivedAt: now, mergedInto: keep.key, enabled: false, note: `اندمجت بـ «${keep.name}»` } });
      return { keep, drop, runs: moving.length, renamedRefs: renamed, handoffs: moved.count, approvals: approvals.count };
    },
    { timeout: 30_000 },
  );
  await audit(actor, "workflow.merge", { type: "workflow", id: out.keep.id }, { after: { keep: out.keep.key, drop: out.drop.key, runs: out.runs, renamedRefs: out.renamedRefs } });
  return { keep: out.keep.key, drop: out.drop.key, runs: out.runs, renamedRefs: out.renamedRefs, handoffs: out.handoffs, approvals: out.approvals };
}

/** The one-time renumbering after a tidy-up: 1…N in the order domain → old number → name, over the jobs that are not put away. Returns how many changed. */
export async function renumberJobs(actor: Actor): Promise<{ changed: number; total: number }> {
  const done = await withNumberLock(async (tx) => {
    const rows = await tx.workflow.findMany({ where: { archivedAt: null }, select: { id: true, key: true, name: true, number: true, domain: true } });
    if (rows.length > MAX_JOB_NUMBER) throw new MergeRefused("أكتر من 999 مهمة");
    const order = renumberOrder(rows);
    let changed = 0;
    for (const r of rows) {
      const n = order.get(r.key)!;
      if (r.number !== n) {
        await tx.workflow.update({ where: { id: r.id }, data: { number: n } });
        changed++;
      }
    }
    return { changed, total: rows.length };
  });
  await audit(actor, "workflow.renumber", { type: "workflow", id: "map" }, { after: done });
  return done;
}

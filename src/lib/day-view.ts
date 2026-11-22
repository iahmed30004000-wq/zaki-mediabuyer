/**
 * «الإنجاز» as the screen reads it (v3 · G): one Amman day, what was done and what is planned, from rows that already exist
 * — workflow runs, executed decisions, the owner's answers, closed tasks, videos that moved on, handovers answered — written
 * as lines by src/core/day.ts and grouped by who did them. Nothing is typed in by anyone. MOCK_MODE=1: no run ever
 * happened, so only what is scheduled shows (the seeded jobs), and the page says it is the demo.
 */
import { runsBetween } from "@/core/cron";
import { ammanKey } from "@/core/dates";
import {
  approvalItem, countItems, dayBounds, dayState, dayTitle, decisionItem, dueItem, expiryItem, groupItems, handoffItem, runItem, scheduledItems, taskDoneItem, videoItem,
  type DayGroup, type DayItem, type DayState,
} from "@/core/day";
import { WORKDAY_START_HOUR, workdayBounds, workdayOf } from "@/core/timeline";
import { SEED_WORKFLOWS } from "@/core/workflow";
import { db } from "@/server/db";
import { writeMode } from "@/meta/write";

export interface DayData {
  demo: boolean;
  day: string;
  /** today on the Amman clock — the switcher's «اليوم» */
  today: string;
  title: string;
  state: DayState;
  done: DayGroup[];
  planned: DayGroup[];
  counts: { done: number; planned: number };
}

const CAP = 300;

/**
 * `workday: true` reads the day as the owner lives it — 06:00 to 06:00 on the Amman clock (W-16), so the night round after midnight is part of the evening before — instead of
 * the calendar day (midnight to midnight) the old screens use.
 */
export async function loadDay(day: string, now = new Date(), opts: { workday?: boolean } = {}): Promise<DayData> {
  const { from, to } = opts.workday ? workdayOf(day) : dayBounds(day);
  // the working day that `now` belongs to starts on the key of (now − 6 hours): until 06:00 «today» is still yesterday's day
  const state = opts.workday ? dayState(day, new Date(now.getTime() - WORKDAY_START_HOUR * 3_600_000)) : dayState(day, now);
  const planFrom = state === "today" ? now : from;
  const planning = state !== "past";
  const demo = process.env.MOCK_MODE === "1";
  const iso = (d: Date | null) => (d ?? from).toISOString();
  const metaLive = writeMode() === "live";

  const done: DayItem[] = [];
  const planned: DayItem[] = [];

  if (!demo && state !== "future") {
    const [runs, changes, approvals, tasks, videos, handoffs] = await Promise.all([
      db.workflowRun.findMany({ where: { OR: [{ finishedAt: { gte: from, lt: to } }, { finishedAt: null, startedAt: { gte: from, lt: to } }] }, include: { workflow: { select: { name: true } } }, orderBy: { startedAt: "asc" }, take: CAP }),
      db.changeSet.findMany({ where: { state: "executed", executedAt: { gte: from, lt: to } }, orderBy: { executedAt: "asc" }, take: CAP }),
      db.approval.findMany({ where: { decidedAt: { gte: from, lt: to }, status: { in: ["approved", "rejected", "postponed", "cancelled"] } }, orderBy: { decidedAt: "asc" }, take: CAP }),
      db.task.findMany({ where: { status: "done", updatedAt: { gte: from, lt: to } }, orderBy: { updatedAt: "asc" }, take: CAP }),
      db.videoBankItem.findMany({ where: { updatedAt: { gte: from, lt: to }, status: { not: "bank" } }, orderBy: { updatedAt: "asc" }, take: CAP }),
      db.handoff.findMany({ where: { status: "done", doneAt: { gte: from, lt: to } }, orderBy: { doneAt: "asc" }, take: CAP }),
    ]);
    for (const r of runs) done.push(runItem({ name: r.workflow.name, status: r.status, at: iso(r.finishedAt ?? r.startedAt), summary: r.summary, metrics: (r.metrics as Record<string, unknown> | null) ?? null, source: r.source }));
    for (const c of changes) done.push(decisionItem({ source: c.source, sentence: c.sentence, at: iso(c.executedAt), spendDeltaDaily: Number(c.spendDeltaDaily), approvedBy: c.approvedBy, writeMode: c.writeMode }));
    for (const a of approvals) {
      const i = approvalItem({ status: a.status, title: a.title, at: iso(a.decidedAt), amount: a.amount === null ? null : Number(a.amount) });
      if (i) done.push(i);
    }
    for (const t of tasks) done.push(taskDoneItem({ title: t.title, at: t.updatedAt.toISOString(), assignee: t.assignee }));
    for (const v of videos) {
      const i = videoItem({ vName: v.vName, job: v.job, status: v.status, at: v.updatedAt.toISOString() }, metaLive);
      if (i) done.push(i);
    }
    for (const h of handoffs) done.push(handoffItem({ title: h.title, assignee: h.assignee, at: iso(h.doneAt), note: h.resultNote }));
  }

  if (planning) {
    const workflows = demo ? SEED_WORKFLOWS.map((w) => ({ name: w.name, schedule: w.schedule, executor: w.executor })) : await db.workflow.findMany({ where: { enabled: true, archivedAt: null, schedule: { not: null } }, select: { name: true, schedule: true, executor: true } });
    for (const w of workflows) {
      if (!w.schedule) continue;
      planned.push(...scheduledItems({ name: w.name, executor: w.executor }, runsBetween(w.schedule, planFrom, to).map((d) => d.toISOString())));
    }
    if (!demo) {
      const [due, expiring] = await Promise.all([
        db.task.findMany({ where: { dueAt: { gte: from, lt: to }, status: { not: "done" }, archivedAt: null }, orderBy: { dueAt: "asc" }, take: CAP }),
        db.approval.findMany({ where: { status: { in: ["pending", "postponed"] }, expiresAt: { gte: planFrom, lt: to } }, orderBy: { expiresAt: "asc" }, take: CAP }),
      ]);
      for (const t of due) planned.push(dueItem({ title: t.title, dueAt: t.dueAt!.toISOString(), assignee: t.assignee, priority: t.priority }));
      for (const a of expiring) planned.push(expiryItem({ title: a.title, at: a.expiresAt!.toISOString() }));
    }
  }

  const g = { done: groupItems(done), planned: groupItems(planned) };
  return { demo, day, today: opts.workday ? workdayBounds(now).key : ammanKey(now), title: dayTitle(day, opts.workday ? new Date(now.getTime() - WORKDAY_START_HOUR * 3_600_000) : now), state, done: g.done, planned: g.planned, counts: { done: countItems(g.done), planned: countItems(g.planned) } };
}

/** `?day=2026-11-14` → a valid day; anything else is today. */
export function readDay(raw: string | undefined, now = new Date()): string {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`)) && new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw ? raw : ammanKey(now);
}

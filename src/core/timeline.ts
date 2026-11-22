/**
 * «اليوم على الخط»: one line of dots for the working day — every scheduled run of every job, and what became of it (done · failed ·
 * running · missed · coming), plus the runs nobody scheduled (a manual one). Pure: the loaders hand in jobs and runs; the clock is a
 * parameter. Which run answers which slot is `slotFor`'s (src/core/slot-for.ts, W-16): a run that carries its own `scheduledFor` answers that slot; any
 * other answers the nearest slot from `graceMin` after it back to 5 minutes before — a run at 11:02 is the 11:00 slot's, not the 10:00 one's, and a manual
 * run answers none. The working day runs 06:00 → 06:00 on the Amman clock (a night round at 01:00 belongs to the day that started the evening
 * before). The same line is the mini one on the home page and the full one on «الشغل ← اليوم».
 */
import { ammanKey, keyMs } from "./dates";
import { jobSlots, slotOfRun, type SlotJob } from "./slot-for";

export const WORKDAY_START_HOUR = 6;
const HOUR = 3_600_000;
/** A slot that passed less than the job's `graceMin` (15 by default) ago is not «فات» yet (the run may be about to start). */
const GRACE_MIN = 15;

export interface WorkdayBounds {
  /** the calendar key of the day it started on */
  key: string;
  from: Date;
  to: Date;
}

/** The working day that `at` belongs to (Amman is UTC+3 all year). */
export function workdayBounds(at: Date): WorkdayBounds {
  const key = ammanKey(new Date(at.getTime() - WORKDAY_START_HOUR * HOUR));
  const from = new Date(keyMs(key) - 3 * HOUR + WORKDAY_START_HOUR * HOUR);
  return { key, from, to: new Date(from.getTime() + 24 * HOUR) };
}

/** The working day of a calendar key («2026-11-16» = 06:00 of the 16th → 06:00 of the 17th). */
export function workdayOf(key: string): WorkdayBounds {
  const from = new Date(keyMs(key) - 3 * HOUR + WORKDAY_START_HOUR * HOUR);
  return { key, from, to: new Date(from.getTime() + 24 * HOUR) };
}

export type DotState = "done" | "failed" | "running" | "missed" | "coming" | "manual";

export interface LineJob {
  key: string;
  name: string;
  /** a cron of five fields on the Amman clock, or null for a job nobody schedules */
  schedule: string | null;
  enabled: boolean;
  /** v6: how the slots are read (recurring · once · window · manual), and how long the site waits before a slot is «فات». Left out = recurring · 15. */
  kind?: string;
  runsAt?: string | null;
  endsAt?: string | null;
  graceMin?: number;
}
export interface LineRun {
  id: string;
  jobKey: string;
  startedAt: string;
  status: string;
  trigger: string;
  /** the slot the run answers, when it says so (ISO) */
  scheduledFor?: string | null;
}
export interface DayDot {
  jobKey: string;
  name: string;
  /** ISO — the slot's time, or the run's start for a manual one */
  at: string;
  state: DotState;
  runId: string | null;
}
export interface DayLine {
  from: string;
  to: string;
  dots: DayDot[];
  /** the first dot still coming */
  next: DayDot | null;
  counts: Record<DotState, number>;
}

const stateOfRun = (status: string): DotState => (status === "failed" || status === "lost" ? "failed" : status === "running" || status === "waiting" ? "running" : status === "missed" ? "missed" : status === "queued" ? "coming" : "done");
/** When two runs answer one slot (a «missed» row and the run that came late), the one that really ran is the dot. */
const RANK: Record<string, number> = { ok: 0, failed: 1, lost: 1, running: 2, waiting: 2, skipped: 3, queued: 4, missed: 5 };

/**
 * Lays the day out: for each enabled job its slots inside [from, to) (a cron, a one-off's moment, a window up to its end), each matched with the run that
 * answers it; a slot with no run is «فات» when it has passed (its `graceMin` of grace) and «جاي» when it has not; every run that answered no slot is a
 * manual dot. Sorted by time.
 */
export function dayLine(jobs: readonly LineJob[], runs: readonly LineRun[], bounds: { from: Date; to: Date }, now: Date): DayLine {
  const used = new Set<string>();
  const dots: DayDot[] = [];
  const inDay = runs.filter((r) => Date.parse(r.startedAt) >= bounds.from.getTime() && Date.parse(r.startedAt) < bounds.to.getTime());

  for (const job of jobs) {
    if (!job.enabled) continue;
    const kind = job.kind ?? "recurring";
    if (kind === "manual" || (!job.schedule && kind !== "once")) continue;
    const graceMin = job.graceMin ?? GRACE_MIN;
    const slotJob: SlotJob = { kind, schedule: job.schedule, runsAt: job.runsAt, endsAt: job.endsAt, graceMin };
    // [from, to) as the slots read it: (from − 1 ms, to − 1 ms]
    const slots = jobSlots(slotJob, new Date(bounds.from.getTime() - 1), new Date(bounds.to.getTime() - 1));
    const mine = inDay.filter((r) => r.jobKey === job.key && r.trigger !== "manual");
    const slotOf = (r: LineRun) => slotOfRun(slotJob, r)?.getTime() ?? null;
    for (const slot of slots) {
      const t = slot.getTime();
      const answering = mine.filter((r) => !used.has(r.id) && slotOf(r) === t).sort((a, b) => (RANK[a.status] ?? 3) - (RANK[b.status] ?? 3) || a.startedAt.localeCompare(b.startedAt));
      for (const r of answering) used.add(r.id);
      const hit = answering[0];
      if (hit) dots.push({ jobKey: job.key, name: job.name, at: slot.toISOString(), state: stateOfRun(hit.status), runId: hit.id });
      else dots.push({ jobKey: job.key, name: job.name, at: slot.toISOString(), state: t + graceMin * 60_000 < now.getTime() ? "missed" : "coming", runId: null });
    }
  }
  const names = new Map(jobs.map((j) => [j.key, j.name]));
  for (const r of inDay) {
    if (used.has(r.id)) continue;
    const state = r.status === "failed" || r.status === "lost" ? "failed" : r.status === "running" || r.status === "waiting" ? "running" : r.status === "missed" ? "missed" : "manual";
    dots.push({ jobKey: r.jobKey, name: names.get(r.jobKey) ?? r.jobKey, at: r.startedAt, state, runId: r.id });
  }
  dots.sort((a, b) => a.at.localeCompare(b.at));
  const counts: Record<DotState, number> = { done: 0, failed: 0, running: 0, missed: 0, coming: 0, manual: 0 };
  for (const d of dots) counts[d.state]++;
  return { from: bounds.from.toISOString(), to: bounds.to.toISOString(), dots, next: dots.find((d) => d.state === "coming") ?? null, counts };
}

export const DOT_AR: Record<DotState, string> = { done: "خلص", failed: "فشل", running: "شغّال", missed: "فات", coming: "جاي", manual: "يدوي" };

/** The half hour with the most dots on it — «أزحم وقت». Ties go to the earliest. Null when the day is empty. */
export function busiestSlot(dots: readonly Pick<DayDot, "at">[], bucketMin = 30): { from: string; count: number } | null {
  const size = bucketMin * 60_000;
  const by = new Map<number, number>();
  for (const d of dots) {
    const b = Math.floor(Date.parse(d.at) / size) * size;
    by.set(b, (by.get(b) ?? 0) + 1);
  }
  let best: { at: number; count: number } | null = null;
  for (const [at, count] of by) if (!best || count > best.count || (count === best.count && at < best.at)) best = { at, count };
  return best ? { from: new Date(best.at).toISOString(), count: best.count } : null;
}

/**
 * «اليوم على الخط»: one line of dots for the working day — every scheduled run of every job, and what became of it (done · failed ·
 * running · missed · coming), plus the runs nobody scheduled (a manual one). Pure: the loaders hand in jobs and runs; the clock is a
 * parameter. The working day runs 06:00 → 06:00 on the Amman clock (a night round at 01:00 belongs to the day that started the evening
 * before). The same line is the mini one on the home page and the full one on «الشغل ← اليوم».
 */
import { ammanKey, keyMs } from "./dates";
import { runsBetween } from "./cron";

export const WORKDAY_START_HOUR = 6;
const HOUR = 3_600_000;
/** A run that started within this long before a slot, or after it, is that slot's run. */
const EARLY_MS = 10 * 60_000;
const LATE_MS = 90 * 60_000;
/** A slot that passed less than this ago is not «فات» yet (the run may be about to start). */
const GRACE_MS = 15 * 60_000;

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
}
export interface LineRun {
  id: string;
  jobKey: string;
  startedAt: string;
  status: string;
  trigger: string;
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

const stateOfRun = (status: string): DotState => (status === "failed" ? "failed" : status === "running" || status === "waiting" ? "running" : "done");

/**
 * Lays the day out: for each enabled, scheduled job its slots inside [from, to), each matched with the first unused run that started
 * from 10 minutes before the slot to 90 minutes after it; a slot with no run is «فات» when it has passed (15 minutes of grace) and
 * «جاي» when it has not; every run that matched no slot is a manual dot. Sorted by time.
 */
export function dayLine(jobs: readonly LineJob[], runs: readonly LineRun[], bounds: { from: Date; to: Date }, now: Date): DayLine {
  const used = new Set<string>();
  const dots: DayDot[] = [];
  const inDay = runs.filter((r) => Date.parse(r.startedAt) >= bounds.from.getTime() && Date.parse(r.startedAt) < bounds.to.getTime());

  for (const job of jobs) {
    if (!job.enabled || !job.schedule) continue;
    let slots: Date[] = [];
    try {
      slots = runsBetween(job.schedule, bounds.from, bounds.to);
    } catch {
      slots = []; // a schedule the clock cannot read draws nothing rather than a guess
    }
    const mine = inDay.filter((r) => r.jobKey === job.key).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const slot of slots) {
      const t = slot.getTime();
      const hit = mine.find((r) => !used.has(r.id) && Date.parse(r.startedAt) >= t - EARLY_MS && Date.parse(r.startedAt) < t + LATE_MS);
      if (hit) {
        used.add(hit.id);
        dots.push({ jobKey: job.key, name: job.name, at: slot.toISOString(), state: stateOfRun(hit.status), runId: hit.id });
      } else {
        dots.push({ jobKey: job.key, name: job.name, at: slot.toISOString(), state: t + GRACE_MS < now.getTime() ? "missed" : "coming", runId: null });
      }
    }
  }
  const names = new Map(jobs.map((j) => [j.key, j.name]));
  for (const r of inDay) {
    if (used.has(r.id)) continue;
    dots.push({ jobKey: r.jobKey, name: names.get(r.jobKey) ?? r.jobKey, at: r.startedAt, state: r.status === "failed" ? "failed" : r.status === "running" || r.status === "waiting" ? "running" : "manual", runId: r.id });
  }
  dots.sort((a, b) => a.at.localeCompare(b.at));
  const counts: Record<DotState, number> = { done: 0, failed: 0, running: 0, missed: 0, coming: 0, manual: 0 };
  for (const d of dots) counts[d.state]++;
  return { from: bounds.from.toISOString(), to: bounds.to.toISOString(), dots, next: dots.find((d) => d.state === "coming") ?? null, counts };
}

export const DOT_AR: Record<DotState, string> = { done: "خلص", failed: "فشل", running: "شغّال", missed: "فات", coming: "جاي", manual: "يدوي" };

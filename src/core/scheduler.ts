/**
 * THE SITE'S OWN CLOCK (v3 · S), pure. A workflow with a schedule («43 10 * * *», Asia/Amman) used to need n8n to wake Claude at
 * that time. With `SITE_SCHEDULER=1` the worker does it: every minute it asks which workflows were due in the last few minutes.
 * A time that was missed (the worker was down) is never replayed in a crowd — only the latest due time of each workflow counts.
 */
import { isValidCron, runsBetween } from "./cron";

/** How far back a due time still counts: a restart or a late tick does not lose it, an hour of downtime is not replayed. */
export const LOOKBACK_MIN = 10;

export interface Schedulable {
  key: string;
  schedule: string | null;
  enabled: boolean;
  archivedAt: Date | null;
  permission: string;
}

export interface DueRun {
  key: string;
  at: Date;
  /** the minute it was due, UTC «2026-11-16T10:43» — what makes firing it twice impossible */
  slot: string;
}

export const schedulerOn = (env: Record<string, string | undefined> = process.env): boolean => env.SITE_SCHEDULER === "1";

/** A workflow the clock may fire: on, not put away, not black, with a schedule that reads. */
export const fires = (w: Schedulable): w is Schedulable & { schedule: string } => w.enabled && !w.archivedAt && w.permission !== "black" && !!w.schedule && isValidCron(w.schedule);

/** The latest time each firing workflow was due in [now − lookback, now]. */
export function dueRuns(list: Schedulable[], now: Date, lookbackMin: number = LOOKBACK_MIN): DueRun[] {
  const from = new Date(now.getTime() - lookbackMin * 60_000);
  const to = new Date(now.getTime() + 1);
  const out: DueRun[] = [];
  for (const w of list) {
    if (!fires(w)) continue;
    const at = runsBetween(w.schedule, from, to).at(-1);
    if (at) out.push({ key: w.key, at, slot: at.toISOString().slice(0, 16) });
  }
  return out;
}

/**
 * THE SLOTS OF A JOB, AND WHICH SLOT A RUN ANSWERS — pure (docs/rebuild-v6/01-model.md §5, W-14 · W-16).
 *
 * A job's slots are the moments it is due: the cron times of a recurring job, the moment of a one-off (`runsAt`), the cron times of a
 * window up to its end. A run is the answer to a slot when it started from `graceMin` minutes after the slot back to 5 minutes before it:
 * a run at 11:02 answers the 11:00 slot (not the 10:00 one), and 10:00 is not «فات» because of it.
 */
import { runsBetween } from "./cron";

/** A run that started up to this long before a slot is that slot's (the agent is a little early). */
export const EARLY_MIN = 5;

export interface SlotJob {
  kind: string;
  schedule: string | null;
  runsAt?: Date | string | null;
  endsAt?: Date | string | null;
  graceMin: number;
}

const ms = (v: Date | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isNaN(t) ? null : t;
};

/** The slots in (from, to], oldest first. A schedule the clock cannot read has none (it never throws). */
export function jobSlots(job: SlotJob, from: Date, to: Date): Date[] {
  if (to.getTime() <= from.getTime()) return [];
  if (job.kind === "once") {
    const at = ms(job.runsAt);
    return at !== null && at > from.getTime() && at <= to.getTime() ? [new Date(at)] : [];
  }
  if (job.kind === "manual" || !job.schedule) return [];
  const end = job.kind === "window" ? ms(job.endsAt) : null;
  try {
    // runsBetween is [a, b): shifting both ends by 1 ms makes it (from, to]
    const all = runsBetween(job.schedule, new Date(from.getTime() + 1), new Date(to.getTime() + 1));
    return end === null ? all : all.filter((d) => d.getTime() <= end);
  } catch {
    return [];
  }
}

/**
 * The slot a run that started at `startedAt` answers: the nearest one inside [startedAt − graceMin, startedAt + 5 min] (a tie goes to the
 * earlier one — the run is late for it). Null when there is none: the run is «يدوي بلا موعد».
 */
export function slotFor(job: SlotJob, startedAt: Date): Date | null {
  const t = startedAt.getTime();
  const from = new Date(t - job.graceMin * 60_000 - 1);
  const to = new Date(t + EARLY_MIN * 60_000);
  let best: Date | null = null;
  for (const s of jobSlots(job, from, to)) {
    if (!best || Math.abs(s.getTime() - t) < Math.abs(best.getTime() - t)) best = s;
  }
  return best;
}

/** The reference a slot's own row (a «missed» row, or the run the site queued for it) is written under: `slot-<ISO>`. */
export const slotRef = (slot: Date | string): string => `slot-${typeof slot === "string" ? slot : slot.toISOString()}`;

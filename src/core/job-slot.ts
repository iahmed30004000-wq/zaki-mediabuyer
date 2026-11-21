/**
 * What to do with a slot that already has a row (N-07). Pure: the runner reads the row and asks.
 *
 *   ok                          → nothing, the slot is done
 *   running, started < 30 min   → nothing, somebody is on it
 *   running, started ≥ 30 min   → the process died mid-run: mark it failed («interrupted»), then it is like any failed slot
 *   failed, attempt ≤ retries   → try again (the next round of the worker); a job with `retries: 0` never does
 */
export const STALE_RUNNING_MS = 30 * 60_000;

export interface SlotRow {
  status: string;
  attempt: number;
  startedAt: Date;
}

export function slotAction(row: SlotRow, now: Date, retries: number): { interrupt: boolean; retry: boolean } {
  const stale = row.status === "running" && now.getTime() - row.startedAt.getTime() >= STALE_RUNNING_MS;
  const failed = row.status === "failed" || stale;
  return { interrupt: stale, retry: failed && row.attempt <= retries };
}

/** The jobs whose failure costs a day (a missing backup, a missing report): two more tries inside the same slot. */
export const JOB_RETRIES: Record<string, number> = { "db.backup": 2, "report.morning": 2, "plan.week": 2, "report.weekly": 2 };

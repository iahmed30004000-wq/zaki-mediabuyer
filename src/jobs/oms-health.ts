/**
 * IS THE OMS ANSWERING, AND SHOULD WE ASK IT AGAIN YET?
 *
 * The owner's rule (26/10): the media buyer must never be the thing that hurts the OMS. So:
 *   · one sync an hour at most — the worker's slot (`runOnce("oms.sync", "<date>T<hour>")`), never per page view;
 *   · after failures it backs off: 1 h, 2 h, 4 h, then every 8 h until one succeeds — no tight retry loop;
 *   · when the last real sync is older than 3 hours, every OMS-based figure is shown as «تقدير», not «حقيقي».
 * Pure functions over the `JobRun` rows, so the rule is tested without a database or a clock.
 */

export interface RunRow {
  status: string;
  startedAt: Date;
  finishedAt?: Date | null;
  stats?: unknown;
}

export const STALE_AFTER_H = 3;
export const MAX_BACKOFF_H = 8;
const HOUR = 3_600_000;
const GRACE_MS = 5 * 60_000;

const statsOf = (r: RunRow) => (r.stats && typeof r.stats === "object" ? (r.stats as Record<string, unknown>) : {});
/** A run that actually read the OMS (not a skip and not a back-off). */
const isRealSync = (r: RunRow) => r.status === "ok" && typeof statsOf(r).orders === "number";
const isPause = (r: RunRow) => r.status === "ok" && !isRealSync(r);

/** When the last REAL sync finished — a skipped or backed-off slot is not a sync. */
export function lastOmsSync(runs: RunRow[]): Date | null {
  const hit = [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).find(isRealSync);
  return hit ? (hit.finishedAt ?? hit.startedAt) : null;
}

export function omsStale(last: Date | null, now: Date = new Date()): boolean {
  return !last || now.getTime() - last.getTime() > STALE_AFTER_H * HOUR;
}

/**
 * Whether this hour's slot should leave the OMS alone. Counts the failures since the last real sync (skipped and
 * backed-off slots neither break nor extend the run), and waits 2^(n−1) hours after the latest, capped at 8.
 */
export function omsBackoff(runs: RunRow[], now: Date = new Date()): { wait: boolean; failures: number; until: Date | null } {
  const recent = [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  let failures = 0;
  let lastFailure: Date | null = null;
  for (const r of recent) {
    if (isRealSync(r)) break;
    if (isPause(r)) continue;
    if (r.status === "failed") {
      failures++;
      lastFailure ??= r.startedAt;
    }
  }
  if (failures === 0 || !lastFailure) return { wait: false, failures, until: null };
  const until = new Date(lastFailure.getTime() + Math.min(2 ** (failures - 1), MAX_BACKOFF_H) * HOUR);
  // Five minutes of grace: the hourly slot starts a few hundred ms later or earlier each time, and a one-hour wait
  // must not quietly become two because the clock read 11:05:00.1 against a failure at 10:05:00.3.
  return { wait: now.getTime() < until.getTime() - GRACE_MS, failures, until };
}

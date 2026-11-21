/**
 * What /api/health says (v6 P0-1, N-06). Pure. «ok» means the database answers AND the worker ticked in the last 3 minutes
 * (the worker writes `Setting worker.tick` at the start of every round). A visitor with no session gets only `{ ok, version, worker: { ok } }`;
 * the rest (which links are configured, the demo flag, the heartbeat time) is for the signed-in owner.
 */
export const WORKER_STALE_SEC = 180;

export const WORKER_TICK_KEY = "worker.tick";

/** The heartbeat the worker stores: `{ at: ISO }`. Anything else counts as «never ticked». */
export function tickTime(value: unknown): Date | null {
  const at = (value as { at?: unknown } | null)?.at;
  if (typeof at !== "string") return null;
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function workerState(tick: Date | null, now: Date): { ok: boolean; at: string | null; ageSec: number | null } {
  if (!tick) return { ok: false, at: null, ageSec: null };
  const ageSec = Math.max(0, Math.round((now.getTime() - tick.getTime()) / 1000));
  return { ok: ageSec <= WORKER_STALE_SEC, at: tick.toISOString(), ageSec };
}

export interface HealthFacts {
  database: boolean;
  version: string;
  worker: { ok: boolean; at: string | null; ageSec: number | null };
}

/** The answer for a visitor with no session: nothing about which integrations exist. */
export function publicHealth(f: HealthFacts) {
  return { ok: f.database && f.worker.ok, version: f.version, worker: { ok: f.worker.ok } };
}

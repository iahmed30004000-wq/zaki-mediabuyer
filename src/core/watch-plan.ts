/**
 * THE WATCHDOG'S BRAIN — pure (docs/rebuild-v6/01-model.md §5 · §6). The site is the clock: once a minute the worker hands this a snapshot
 * (the jobs, the runs that matter, the open requests, the approvals) and gets back the actions to take. Nothing here reads a database or a
 * clock but the `now` it is given, so every rule can be tested by hand.
 *
 *   fire             wake = site / site_run and the slot came: ask for the run (a run `queued` + a request for the one who carries it out)
 *   miss             the slot is older than graceMin and nothing answered it: a run `missed`
 *   lose             a run `running` whose last word is older than maxRunMin: `lost`
 *   stuck            waiting more than 30 minutes, or queued past graceMin: a notification, once per run
 *   reopen_handoff   somebody took a request and went silent past its lease: it is open again
 *   expire_handoff   nobody took it by its end: it ends, and the run it held up is missed
 *   close_handoff    the run it was for already ended: nothing left to ask
 *   finish_job       a one-off that ran, or a window that ended: finished
 *   expire_approval  a request for the owner that ran out
 *
 * No storm out of the past: the slots counted for a job start at the newest of «the first time the watchdog ever ran» (`since`), the day the job
 * was made, the day its schedule last changed — and never more than the last 6 hours.
 */
import { jobSlots, slotFor, type SlotJob } from "./slot-for";

export const WATCH_LOOKBACK_H = 6;
/** A run waiting on somebody for longer than this is «stuck» (a notification, once). */
export const STUCK_WAITING_MIN = 30;

export type WatchAction =
  | { type: "fire"; jobKey: string; slot: string }
  | { type: "miss"; jobKey: string; slot: string }
  | { type: "lose"; runId: string }
  | { type: "reopen_handoff"; id: string }
  | { type: "expire_handoff"; id: string }
  | { type: "close_handoff"; id: string }
  | { type: "finish_job"; jobKey: string }
  | { type: "expire_approval"; id: string }
  | { type: "stuck"; runId: string; minutes: number };

export interface WatchJob extends SlotJob {
  key: string;
  enabled: boolean;
  archivedAt: Date | null;
  finishedAt: Date | null;
  mergedInto: string | null;
  /** green · yellow · red · black — a black job is forbidden to agents and to the site: nothing is expected of it */
  permission: string;
  wake: string;
  maxRunMin: number;
  createdAt: Date;
  scheduleChangedAt: Date | null;
}

export interface WatchRun {
  id: string;
  jobKey: string;
  ref: string;
  status: string;
  trigger: string;
  scheduledFor: Date | null;
  startedAt: Date;
  heartbeatAt: Date | null;
  updatedAt: Date;
}

export interface WatchHandoff {
  id: string;
  workflowKey: string;
  runRef: string | null;
  status: string;
  expiresAt: Date | null;
  leaseUntil: Date | null;
}

export interface WatchApproval {
  id: string;
  status: string;
  expiresAt: Date | null;
  postponedUntil: Date | null;
}

export interface WatchSnapshot {
  jobs: WatchJob[];
  runs: WatchRun[];
  handoffs: WatchHandoff[];
  approvals: WatchApproval[];
  /** the first time the watchdog ever ran (Setting `watchdog.since`): nothing earlier is counted */
  since: Date;
}

const MIN = 60_000;
const ENDED = ["ok", "failed", "skipped", "missed", "lost"];
const isEnded = (status: string) => ENDED.includes(status);

/** Is anything expected of this job? On, not put away, not merged into another, not finished, not black. */
export const isWatched = (j: WatchJob): boolean => j.enabled && !j.archivedAt && !j.finishedAt && !j.mergedInto && j.permission !== "black";

/** Does this run answer this slot of the job? A manual run answers none; a run that carries its own `scheduledFor` answers that one only. */
function answers(job: WatchJob, run: WatchRun, slot: Date): boolean {
  if (run.trigger === "manual") return false;
  if (run.scheduledFor) return run.scheduledFor.getTime() === slot.getTime();
  return slotFor(job, run.startedAt)?.getTime() === slot.getTime();
}

export function watchPlan(s: WatchSnapshot, now: Date): WatchAction[] {
  const out: WatchAction[] = [];
  const t = now.getTime();
  const jobs = [...s.jobs].sort((a, b) => a.key.localeCompare(b.key));
  const byKey = new Map(jobs.map((j) => [j.key, j]));
  const runsOf = new Map<string, WatchRun[]>();
  for (const r of s.runs) runsOf.set(r.jobKey, [...(runsOf.get(r.jobKey) ?? []), r]);
  const runAt = new Map(s.runs.map((r) => [`${r.jobKey}\u0000${r.ref}`, r]));

  // ── the slots ──
  for (const job of jobs) {
    if (!isWatched(job)) continue;
    const mine = runsOf.get(job.key) ?? [];
    const floor = Math.max(s.since.getTime(), job.createdAt.getTime(), job.scheduleChangedAt?.getTime() ?? 0, t - WATCH_LOOKBACK_H * 3_600_000);
    const slots = jobSlots(job, new Date(floor), now);
    const grace = job.graceMin * MIN;
    for (const slot of slots) {
      if (mine.some((r) => answers(job, r, slot))) continue;
      const late = t - slot.getTime();
      if (job.wake !== "self" && late <= grace) out.push({ type: "fire", jobKey: job.key, slot: slot.toISOString() });
      else if (late > grace) out.push({ type: "miss", jobKey: job.key, slot: slot.toISOString() });
    }
    // a one-off that ran is finished; a window past its end is finished
    if (job.kind === "once" && job.runsAt) {
      const at = new Date(job.runsAt);
      if (mine.some((r) => r.status === "ok" && answers(job, r, at))) out.push({ type: "finish_job", jobKey: job.key });
    } else if (job.kind === "window" && job.endsAt && new Date(job.endsAt).getTime() <= t) out.push({ type: "finish_job", jobKey: job.key });
  }

  // ── the runs ──
  const expiring = new Set(s.handoffs.filter((h) => h.status === "open" && h.expiresAt && h.expiresAt.getTime() <= t && h.runRef).map((h) => `${h.workflowKey}\u0000${h.runRef}`));
  for (const run of [...s.runs].sort((a, b) => a.id.localeCompare(b.id))) {
    const job = byKey.get(run.jobKey);
    if (!job) continue;
    if (run.status === "running") {
      const last = (run.heartbeatAt ?? run.startedAt).getTime();
      if (t - last > job.maxRunMin * MIN) out.push({ type: "lose", runId: run.id });
    } else if (run.status === "waiting") {
      const minutes = Math.floor((t - run.updatedAt.getTime()) / MIN);
      if (minutes > STUCK_WAITING_MIN) out.push({ type: "stuck", runId: run.id, minutes });
    } else if (run.status === "queued") {
      const since = (run.scheduledFor ?? run.startedAt).getTime();
      const minutes = Math.floor((t - since) / MIN);
      // a scheduled request that is about to end is «missed» in this very pass, not «stuck»
      if (t - since > job.graceMin * MIN && !expiring.has(`${run.jobKey}\u0000${run.ref}`)) out.push({ type: "stuck", runId: run.id, minutes });
    }
  }

  // ── the requests ──
  for (const h of [...s.handoffs].sort((a, b) => a.id.localeCompare(b.id))) {
    if (h.status !== "open" && h.status !== "claimed") continue;
    const run = h.runRef ? runAt.get(`${h.workflowKey}\u0000${h.runRef}`) : undefined;
    if (run && isEnded(run.status)) out.push({ type: "close_handoff", id: h.id });
    else if (h.status === "open" && h.expiresAt && h.expiresAt.getTime() <= t) out.push({ type: "expire_handoff", id: h.id });
    else if (h.status === "claimed" && h.leaseUntil && h.leaseUntil.getTime() <= t) out.push({ type: "reopen_handoff", id: h.id });
  }

  // ── the owner's decisions that ran out (a postponed one that is still asleep is not expired: it ends after it came back) ──
  for (const a of [...s.approvals].sort((x, y) => x.id.localeCompare(y.id))) {
    if (a.status === "pending" && a.expiresAt && a.expiresAt.getTime() < t) out.push({ type: "expire_approval", id: a.id });
    else if (a.status === "postponed" && !a.postponedUntil && a.expiresAt && a.expiresAt.getTime() < t) out.push({ type: "expire_approval", id: a.id });
  }
  return out;
}

/** What the plan holds, counted by kind — for the heartbeat row and the log. */
export function countActions(actions: readonly WatchAction[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of actions) out[a.type] = (out[a.type] ?? 0) + 1;
  return out;
}

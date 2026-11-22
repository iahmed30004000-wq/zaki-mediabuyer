/**
 * The watchdog's brain (docs/rebuild-v6/01-model.md §5 · §6) — pure: a snapshot in, the actions out. «فاتت» · «انقطعت» · no storm out of the past · once ·
 * for a window · the lease · it does not repeat. Amman is UTC+3: 10:00 there is 07:00Z.
 */
import { describe, expect, it } from "vitest";
import { STUCK_WAITING_MIN, WATCH_LOOKBACK_H, countActions, isWatched, watchPlan, type WatchApproval, type WatchHandoff, type WatchJob, type WatchRun, type WatchSnapshot } from "@/core/watch-plan";

const Z = (hh: number, mm = 0) => new Date(Date.UTC(2026, 10, 22, hh, mm));
const iso = (d: Date) => d.toISOString();
const DAY0 = new Date(Date.UTC(2026, 10, 1));

const job = (key: string, over: Partial<WatchJob> = {}): WatchJob => ({
  key,
  kind: "recurring",
  schedule: "0 10 * * *", // 10:00 Amman = 07:00Z
  runsAt: null,
  endsAt: null,
  graceMin: 15,
  enabled: true,
  archivedAt: null,
  finishedAt: null,
  mergedInto: null,
  permission: "green",
  wake: "self",
  maxRunMin: 90,
  createdAt: DAY0,
  scheduleChangedAt: null,
  ...over,
});
let n = 0;
const run = (jobKey: string, over: Partial<WatchRun> = {}): WatchRun => ({ id: `r${++n}`, jobKey, ref: `ref${n}`, status: "ok", trigger: "schedule", scheduledFor: null, startedAt: Z(7, 1), heartbeatAt: null, updatedAt: Z(7, 1), ...over });
const snap = (over: Partial<WatchSnapshot> = {}): WatchSnapshot => ({ jobs: [], runs: [], handoffs: [], approvals: [], since: DAY0, ...over });

describe("a slot nothing answered (فاتت)", () => {
  it("is missed once it is older than graceMin, and not before", () => {
    const j = [job("daily")];
    expect(watchPlan(snap({ jobs: j }), Z(7, 15))).toEqual([]); // exactly graceMin: not yet
    expect(watchPlan(snap({ jobs: j }), Z(7, 16))).toEqual([{ type: "miss", jobKey: "daily", slot: iso(Z(7, 0)) }]);
  });

  it("a job's own graceMin is the one that counts", () => {
    expect(watchPlan(snap({ jobs: [job("daily", { graceMin: 30 })] }), Z(7, 20))).toEqual([]);
    expect(watchPlan(snap({ jobs: [job("daily", { graceMin: 30 })] }), Z(7, 31))).toHaveLength(1);
  });

  it("a run that started in time answers it — a run at 10:02 is the 10:00 slot's", () => {
    expect(watchPlan(snap({ jobs: [job("daily")], runs: [run("daily", { startedAt: Z(7, 2) })] }), Z(9, 0))).toEqual([]);
  });

  it("a run that says its own scheduledFor answers that slot, whenever it started", () => {
    const r = run("daily", { startedAt: Z(8, 40), scheduledFor: Z(7, 0) });
    expect(watchPlan(snap({ jobs: [job("daily")], runs: [r] }), Z(9, 0))).toEqual([]);
  });

  it("a manual run answers no slot: the slot is still missed", () => {
    const r = run("daily", { startedAt: Z(7, 2), trigger: "manual" });
    expect(watchPlan(snap({ jobs: [job("daily")], runs: [r] }), Z(7, 40))).toEqual([{ type: "miss", jobKey: "daily", slot: iso(Z(7, 0)) }]);
  });

  it("a run for another slot, or another job, does not answer this one", () => {
    const r = run("daily", { startedAt: Z(7, 0), scheduledFor: Z(6, 0) });
    expect(watchPlan(snap({ jobs: [job("daily")], runs: [r] }), Z(7, 40))).toHaveLength(1);
    expect(watchPlan(snap({ jobs: [job("daily"), job("other")], runs: [run("other", { startedAt: Z(7, 1) })] }), Z(7, 40))).toEqual([{ type: "miss", jobKey: "daily", slot: iso(Z(7, 0)) }]);
  });

  it("a slot that was already written down as missed is not written again (the pass that follows finds its run)", () => {
    const first = watchPlan(snap({ jobs: [job("daily")] }), Z(7, 20));
    expect(first).toHaveLength(1);
    const written = run("daily", { ref: `slot-${iso(Z(7, 0))}`, status: "missed", scheduledFor: Z(7, 0), startedAt: Z(7, 0) });
    expect(watchPlan(snap({ jobs: [job("daily")], runs: [written] }), Z(7, 21))).toEqual([]);
    expect(watchPlan(snap({ jobs: [job("daily")], runs: [written] }), Z(9, 0))).toEqual([]);
  });

  it("several slots in a row each get their own", () => {
    const hourly = job("hourly", { schedule: "0 * * * *" });
    const plan = watchPlan(snap({ jobs: [hourly], since: Z(3, 0) }), Z(8, 30));
    expect(plan.map((a) => a.type === "miss" && a.slot)).toEqual([iso(Z(4, 0)), iso(Z(5, 0)), iso(Z(6, 0)), iso(Z(7, 0)), iso(Z(8, 0))]);
  });
});

describe("no storm out of the past", () => {
  it("nothing before the first time the watchdog ever ran is counted", () => {
    expect(watchPlan(snap({ jobs: [job("daily")], since: Z(7, 30) }), Z(9, 0))).toEqual([]);
    // the first pass is the moment itself: no slot is behind it
    expect(watchPlan(snap({ jobs: [job("daily")], since: Z(9, 0) }), Z(9, 0))).toEqual([]);
  });

  it("nothing before the day the job was made, or the moment its schedule last changed", () => {
    expect(watchPlan(snap({ jobs: [job("daily", { createdAt: Z(7, 30) })] }), Z(9, 0))).toEqual([]);
    expect(watchPlan(snap({ jobs: [job("daily", { scheduleChangedAt: Z(7, 30) })] }), Z(9, 0))).toEqual([]);
    // moved to a time that is still ahead: nothing is missed, and it is counted from there
    expect(watchPlan(snap({ jobs: [job("daily", { schedule: "0 13 * * *", scheduleChangedAt: Z(8, 0) })] }), Z(9, 0))).toEqual([]);
  });

  it("never more than the last 6 hours, however long the worker was down", () => {
    expect(WATCH_LOOKBACK_H).toBe(6);
    const hourly = job("hourly", { schedule: "0 * * * *" });
    const plan = watchPlan(snap({ jobs: [hourly] }), Z(20, 30));
    expect(plan).toHaveLength(6); // 15:00 … 20:00: the slots of 14:00 and before are older than 6 hours and never counted
    expect(plan.every((a) => a.type === "miss" && Date.parse(a.slot) > Z(20, 30).getTime() - 6 * 3_600_000)).toBe(true);
  });
});

describe("which jobs are watched", () => {
  const plan = (j: WatchJob) => watchPlan(snap({ jobs: [j] }), Z(8, 0));

  it("a switched-off, put-away, finished, merged or black job is not expected to run", () => {
    expect(plan(job("a"))).toHaveLength(1);
    expect(plan(job("a", { enabled: false }))).toEqual([]);
    expect(plan(job("a", { archivedAt: Z(1) }))).toEqual([]);
    expect(plan(job("a", { finishedAt: Z(1) }))).toEqual([]);
    expect(plan(job("a", { mergedInto: "b" }))).toEqual([]);
    expect(plan(job("a", { permission: "black" }))).toEqual([]);
    expect(isWatched(job("a"))).toBe(true);
    expect(isWatched(job("a", { permission: "black" }))).toBe(false);
  });

  it("a manual job, and a job with no schedule, have no slots", () => {
    expect(plan(job("a", { kind: "manual" }))).toEqual([]);
    expect(plan(job("a", { schedule: null }))).toEqual([]);
    expect(plan(job("a", { schedule: "not a cron" }))).toEqual([]);
  });
});

describe("a job the site wakes (wake = site)", () => {
  it("is asked for when its slot comes, then missed when graceMin has passed with nothing", () => {
    const j = job("asked", { wake: "site" });
    expect(watchPlan(snap({ jobs: [j] }), Z(7, 0))).toEqual([{ type: "fire", jobKey: "asked", slot: iso(Z(7, 0)) }]);
    expect(watchPlan(snap({ jobs: [j] }), Z(7, 10))).toEqual([{ type: "fire", jobKey: "asked", slot: iso(Z(7, 0)) }]);
    // the worker was down: past the grace, a request would be born dead — it is written as missed
    expect(watchPlan(snap({ jobs: [j] }), Z(7, 20))).toEqual([{ type: "miss", jobKey: "asked", slot: iso(Z(7, 0)) }]);
  });

  it("a slot that has its queued run is asked for once only", () => {
    const j = job("asked", { wake: "site" });
    const queued = run("asked", { status: "queued", scheduledFor: Z(7, 0), startedAt: Z(7, 0), ref: `slot-${iso(Z(7, 0))}` });
    expect(watchPlan(snap({ jobs: [j], runs: [queued] }), Z(7, 5))).toEqual([]);
    expect(watchPlan(snap({ jobs: [job("run", { wake: "site_run" })] }), Z(7, 1))).toEqual([{ type: "fire", jobKey: "run", slot: iso(Z(7, 0)) }]);
  });

  it("an agent that wakes itself (self) is never asked: only watched", () => {
    expect(watchPlan(snap({ jobs: [job("mine")] }), Z(7, 5))).toEqual([]);
  });
});

describe("a run that went silent (انقطعت)", () => {
  const j = job("long", { maxRunMin: 90, schedule: null });

  it("is lost when the last word — the heartbeat, or the start — is older than maxRunMin", () => {
    const r = run("long", { status: "running", startedAt: Z(5, 0), heartbeatAt: null });
    expect(watchPlan(snap({ jobs: [j], runs: [r] }), Z(6, 30))).toEqual([]); // exactly 90: not yet
    expect(watchPlan(snap({ jobs: [j], runs: [r] }), Z(6, 31))).toEqual([{ type: "lose", runId: r.id }]);
  });

  it("a heartbeat keeps it alive", () => {
    const r = run("long", { status: "running", startedAt: Z(5, 0), heartbeatAt: Z(6, 0) });
    expect(watchPlan(snap({ jobs: [j], runs: [r] }), Z(7, 20))).toEqual([]);
    expect(watchPlan(snap({ jobs: [j], runs: [r] }), Z(7, 31))).toEqual([{ type: "lose", runId: r.id }]);
  });

  it("a job's own maxRunMin is the one that counts, and a switched-off job's run is still closed", () => {
    const r = run("long", { status: "running", startedAt: Z(5, 0) });
    expect(watchPlan(snap({ jobs: [job("long", { maxRunMin: 20, schedule: null })], runs: [r] }), Z(5, 21))).toHaveLength(1);
    expect(watchPlan(snap({ jobs: [job("long", { enabled: false, schedule: null })], runs: [r] }), Z(7, 0))).toHaveLength(1);
  });

  it("a run that has ended is never lost", () => {
    for (const status of ["ok", "failed", "skipped", "missed", "lost"]) expect(watchPlan(snap({ jobs: [j], runs: [run("long", { status, startedAt: Z(1, 0) })] }), Z(9, 0))).toEqual([]);
  });
});

describe("stuck", () => {
  const j = job("w", { schedule: null });

  it("a run waiting more than 30 minutes is stuck, with how long", () => {
    expect(STUCK_WAITING_MIN).toBe(30);
    const r = run("w", { status: "waiting", updatedAt: Z(8, 0) });
    expect(watchPlan(snap({ jobs: [j], runs: [r] }), Z(8, 30))).toEqual([]);
    expect(watchPlan(snap({ jobs: [j], runs: [r] }), Z(8, 41))).toEqual([{ type: "stuck", runId: r.id, minutes: 41 }]);
  });

  it("a run queued longer than graceMin is stuck; one whose request is about to end is missed this pass instead", () => {
    const q = run("w", { status: "queued", scheduledFor: Z(8, 0), startedAt: Z(8, 0), ref: "q1" });
    expect(watchPlan(snap({ jobs: [j], runs: [q] }), Z(8, 15))).toEqual([]);
    expect(watchPlan(snap({ jobs: [j], runs: [q] }), Z(8, 16))).toEqual([{ type: "stuck", runId: q.id, minutes: 16 }]);
    const h: WatchHandoff = { id: "h1", workflowKey: "w", runRef: "q1", status: "open", expiresAt: Z(8, 15), leaseUntil: null };
    expect(watchPlan(snap({ jobs: [j], runs: [q], handoffs: [h] }), Z(8, 16))).toEqual([{ type: "expire_handoff", id: "h1" }]);
  });

  it("a manual run that nobody took is stuck after graceMin from the moment it was asked", () => {
    const q = run("w", { status: "queued", scheduledFor: null, startedAt: Z(8, 0), trigger: "manual" });
    expect(watchPlan(snap({ jobs: [j], runs: [q] }), Z(8, 20))).toEqual([{ type: "stuck", runId: q.id, minutes: 20 }]);
  });
});

describe("the requests (the lease)", () => {
  const j = job("h", { schedule: null });
  const h = (over: Partial<WatchHandoff> = {}): WatchHandoff => ({ id: "h1", workflowKey: "h", runRef: "ref-h", status: "open", expiresAt: null, leaseUntil: null, ...over });
  const live = (status: string) => run("h", { ref: "ref-h", status, startedAt: Z(7, 59), updatedAt: Z(7, 59) });

  it("a request nobody took by its end expires", () => {
    expect(watchPlan(snap({ jobs: [j], handoffs: [h({ expiresAt: Z(8, 0) })], runs: [live("queued")] }), Z(8, 0))).toEqual([{ type: "expire_handoff", id: "h1" }]);
    expect(watchPlan(snap({ jobs: [j], handoffs: [h({ expiresAt: Z(8, 1) })], runs: [live("queued")] }), Z(8, 0))).toEqual([]);
    expect(watchPlan(snap({ jobs: [j], handoffs: [h({ expiresAt: null })], runs: [live("queued")] }), Z(20, 0)).some((a) => a.type === "expire_handoff")).toBe(false);
  });

  it("one that was taken and went quiet past its lease is opened again", () => {
    const taken = h({ status: "claimed", leaseUntil: Z(9, 0) });
    expect(watchPlan(snap({ jobs: [j], handoffs: [taken], runs: [{ ...live("running"), heartbeatAt: Z(8, 59) }] }), Z(8, 59))).toEqual([]);
    expect(watchPlan(snap({ jobs: [j], handoffs: [taken], runs: [{ ...live("running"), heartbeatAt: Z(8, 59) }] }), Z(9, 0))).toEqual([{ type: "reopen_handoff", id: "h1" }]);
  });

  it("a request whose run already ended has nothing left to ask: it is closed, whatever else it was waiting for", () => {
    for (const status of ["ok", "failed", "skipped", "missed", "lost"]) {
      expect(watchPlan(snap({ jobs: [j], handoffs: [h({ status: "claimed", leaseUntil: Z(1, 0) })], runs: [live(status)] }), Z(9, 0))).toEqual([{ type: "close_handoff", id: "h1" }]);
      expect(watchPlan(snap({ jobs: [j], handoffs: [h({ expiresAt: Z(1, 0) })], runs: [live(status)] }), Z(9, 0))).toEqual([{ type: "close_handoff", id: "h1" }]);
    }
  });

  it("a taken request that is still within its lease is left alone", () => {
    expect(watchPlan(snap({ jobs: [j], handoffs: [h({ status: "claimed", leaseUntil: Z(10, 0) })], runs: [{ ...live("running"), heartbeatAt: Z(8, 50) }] }), Z(9, 0))).toEqual([]);
  });
});

describe("a one-off (مرة وحدة) and a window (لفترة) — W-14", () => {
  const once = job("once", { kind: "once", schedule: null, runsAt: Z(10, 0), createdAt: Z(6, 0) });

  it("a one-off wakes at its moment, by the same rules: missed when nothing answered", () => {
    expect(watchPlan(snap({ jobs: [once] }), Z(10, 10))).toEqual([]);
    expect(watchPlan(snap({ jobs: [once] }), Z(10, 16))).toEqual([{ type: "miss", jobKey: "once", slot: iso(Z(10, 0)) }]);
    expect(watchPlan(snap({ jobs: [job("once", { kind: "once", schedule: null, runsAt: Z(10, 0), createdAt: Z(6, 0), wake: "site" })] }), Z(10, 1))).toEqual([{ type: "fire", jobKey: "once", slot: iso(Z(10, 0)) }]);
  });

  it("the first good run finishes it", () => {
    const ok = run("once", { status: "ok", startedAt: Z(10, 2) });
    expect(watchPlan(snap({ jobs: [once], runs: [ok] }), Z(10, 30))).toEqual([{ type: "finish_job", jobKey: "once" }]);
    // a run that failed or was missed does not finish it
    expect(watchPlan(snap({ jobs: [once], runs: [run("once", { status: "failed", startedAt: Z(10, 2) })] }), Z(10, 30))).toEqual([]);
    // finished: nothing more is expected of it, and nothing is said again
    expect(watchPlan(snap({ jobs: [{ ...once, finishedAt: Z(10, 30) }], runs: [ok] }), Z(11, 30))).toEqual([]);
  });

  it("a one-off in the past, from before the watchdog existed, is not a storm", () => {
    expect(watchPlan(snap({ jobs: [{ ...once, createdAt: DAY0 }], since: Z(10, 30) }), Z(12, 0))).toEqual([]);
  });

  it("a window has its slots until it ends and is finished after it", () => {
    const win = job("win", { kind: "window", schedule: "0 * * * *", endsAt: Z(9, 0), createdAt: Z(5, 0) });
    const during = watchPlan(snap({ jobs: [win] }), Z(8, 5));
    // 05:00 is not after the day it was made; 06:00 and 07:00 are missed; 08:00 is 5 minutes old, still inside its grace
    expect(during.map((a) => a.type === "miss" && a.slot)).toEqual([iso(Z(6, 0)), iso(Z(7, 0))]);
    const after = watchPlan(snap({ jobs: [win] }), Z(12, 0));
    expect(after.filter((a) => a.type === "miss").map((a) => a.type === "miss" && a.slot)).not.toContain(iso(Z(10, 0)));
    expect(after).toContainEqual({ type: "finish_job", jobKey: "win" });
    expect(watchPlan(snap({ jobs: [{ ...win, finishedAt: Z(9, 5) }] }), Z(12, 0))).toEqual([]);
  });
});

describe("the owner's decisions that ran out", () => {
  const a = (over: Partial<WatchApproval>): WatchApproval => ({ id: "a1", status: "pending", expiresAt: Z(8, 0), postponedUntil: null, ...over });

  it("a pending one past its end expires; one that has not reached it does not", () => {
    expect(watchPlan(snap({ approvals: [a({})] }), Z(8, 1))).toEqual([{ type: "expire_approval", id: "a1" }]);
    expect(watchPlan(snap({ approvals: [a({})] }), Z(7, 59))).toEqual([]);
    expect(watchPlan(snap({ approvals: [a({ expiresAt: null })] }), Z(20, 0))).toEqual([]);
  });

  it("a postponed one that is still asleep is not expired — it ends after it came back (W-10)", () => {
    expect(watchPlan(snap({ approvals: [a({ status: "postponed", postponedUntil: Z(12, 0) })] }), Z(9, 0))).toEqual([]);
    expect(watchPlan(snap({ approvals: [a({ status: "postponed", postponedUntil: null })] }), Z(9, 0))).toEqual([{ type: "expire_approval", id: "a1" }]);
  });
});

describe("it does not repeat, and it is the same plan for the same snapshot", () => {
  it("counts the plan by kind", () => {
    expect(countActions([{ type: "miss", jobKey: "a", slot: "x" }, { type: "miss", jobKey: "b", slot: "x" }, { type: "lose", runId: "r" }])).toEqual({ miss: 2, lose: 1 });
  });

  it("the plan does not depend on the order of the snapshot", () => {
    const jobs = [job("b"), job("a"), job("c")];
    const one = watchPlan(snap({ jobs }), Z(8, 0));
    const two = watchPlan(snap({ jobs: [...jobs].reverse() }), Z(8, 0));
    expect(two).toEqual(one);
    expect(one.map((x) => x.type === "miss" && x.jobKey)).toEqual(["a", "b", "c"]);
  });

  it("a pass that was carried out finds nothing left to do at the next minute", () => {
    const j = job("daily");
    const t0 = Z(7, 20);
    const first = watchPlan(snap({ jobs: [j] }), t0);
    const written = first.map((a) => (a.type === "miss" ? run(a.jobKey, { ref: `slot-${a.slot}`, status: "missed", scheduledFor: new Date(a.slot), startedAt: new Date(a.slot) }) : null)).filter((x): x is WatchRun => !!x);
    for (const min of [1, 2, 30, 120]) expect(watchPlan(snap({ jobs: [j], runs: written }), new Date(t0.getTime() + min * 60_000))).toEqual([]);
  });
});

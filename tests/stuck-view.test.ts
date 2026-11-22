/**
 * «بدّها منك» — the runs part (v6 · P5, docs/rebuild-v6/02-screens.md §2 section 1). `loadStuck()` is the first two lanes of «هلق»: what waits for a decision or a step, a request nobody took
 * past its grace, a run that stopped or was lost in the last 24 hours and that nothing later answered, and the slots missed today. Read from stored rows on the in-memory stand-in;
 * the lanes' own rule (`laneOfRun`) is what both the home and the tasks screen use, so this also holds that they never disagree.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/directory", () => ({ directoryNames: async () => ({ claude: "Claude الرئيسي" }) }));
vi.mock("@/server/reports", () => ({ loadReports: async () => [] }));
vi.mock("@/lib/day-view", () => ({ loadDay: async () => ({ done: [] }) }));
vi.mock("@/lib/jobs-view", () => ({ loadJobs: async () => ({ jobs: [], demo: false }) }));

import { buildNow, stuckOf } from "@/core/tasks-view";
import { loadHomeTasks, loadStuck } from "@/lib/tasks-view";

type Rows = Record<string, any>[];
const rows = (name: string): Rows => (h.db as unknown as Record<string, { rows: Rows }>)[name]!.rows;
const NOW = new Date("2026-11-22T17:00:00.000Z"); // 20:00 Amman, the working day is Nov 22 06:00 → Nov 23 06:00
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

async function job(key: string, over: Record<string, unknown> = {}) {
  return h.db.workflow.create({ data: jobRow(key, ["a", "b"], { number: rows("workflow").length + 1, ...over }) });
}
async function run(workflowId: string, ref: string, status: string, over: Record<string, unknown> = {}) {
  return h.db.workflowRun.create({ data: { workflowId, ref, status, startedAt: ago(60), ...over } });
}
const keys = (cards: { jobKey: string }[]) => cards.map((c) => c.jobKey);

describe("loadStuck", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  });

  it("nothing waits: no cards", async () => {
    const r = await loadStuck({ now: NOW });
    expect(r).toMatchObject({ cards: [], total: 0, demo: false });
  });

  it("what needs somebody — a decision's wait, a stopped run, a request nobody took, a missed slot — and only that", async () => {
    const waiting = await job("waits");
    await run(waiting.id, "w1", "waiting", { startedAt: ago(120), nodeStates: { a: { status: "approval", at: ago(119).toISOString() } } });
    const failed = await job("failed");
    await run(failed.id, "f1", "failed", { startedAt: ago(100), finishedAt: ago(90) });
    const late = await job("late", { graceMin: 15 });
    await run(late.id, "q1", "queued", { startedAt: ago(40), scheduledFor: ago(40) });
    const fresh = await job("fresh", { graceMin: 15 });
    await run(fresh.id, "q2", "queued", { startedAt: ago(5), scheduledFor: ago(5) });
    const going = await job("going");
    await run(going.id, "g1", "running", { startedAt: ago(10) });
    const old = await job("old");
    await run(old.id, "o1", "failed", { startedAt: ago(30 * 60), finishedAt: ago(30 * 60 - 5) });
    const missed = await job("missed");
    await run(missed.id, "m1", "missed", { startedAt: ago(200), scheduledFor: ago(200) });
    await run(missed.id, "m2", "missed", { startedAt: ago(100), scheduledFor: ago(100) });

    const r = await loadStuck({ now: NOW });
    // the stopped and waiting ones first, oldest first; then the missed one — one card for the job, with how many came before it
    expect(keys(r.cards)).toEqual(["waits", "failed", "late", "missed"]);
    expect(r.total).toBe(4);
    expect(r.cards.find((c) => c.jobKey === "missed")).toMatchObject({ state: "missed", more: 1 });
    expect(r.cards.find((c) => c.jobKey === "waits")!.state).toBe("approval");
    expect(r.cards.find((c) => c.jobKey === "failed")!.state).toBe("fail");
    expect(r.cards.find((c) => c.jobKey === "late")!.state).toBe("queued");
    // inside its grace, going, or older than a day: not stuck
    expect(keys(r.cards)).not.toContain("fresh");
    expect(keys(r.cards)).not.toContain("going");
    expect(keys(r.cards)).not.toContain("old");
  });

  it("a run that stopped is old news once a later run of the same job finished well", async () => {
    const j = await job("night");
    await run(j.id, "r1", "failed", { startedAt: ago(300), finishedAt: ago(290) });
    expect((await loadStuck({ now: NOW })).total).toBe(1);
    await run(j.id, "r2", "ok", { startedAt: ago(100), finishedAt: ago(95) });
    expect((await loadStuck({ now: NOW })).total).toBe(0);
  });

  it("a slot missed on a past working day is not today's", async () => {
    const j = await job("night");
    await run(j.id, "m0", "missed", { startedAt: ago(40 * 60), scheduledFor: ago(40 * 60) });
    expect((await loadStuck({ now: NOW })).total).toBe(0);
  });

  it("the home and «هلق» are ONE rule: the stuck lanes of the tasks screen are exactly the home's cards", async () => {
    const a = await job("a");
    await run(a.id, "a1", "waiting", { startedAt: ago(50), nodeStates: { a: { status: "failed", at: ago(49).toISOString() } } });
    const b = await job("b");
    await run(b.id, "b1", "lost", { startedAt: ago(80), finishedAt: ago(70) });
    const c = await job("c");
    await run(c.id, "c1", "missed", { startedAt: ago(30), scheduledFor: ago(30) });
    const home = await loadStuck({ now: NOW });
    const jobs = rows("workflow").map((w) => ({ key: w.key, number: w.number, name: w.name, domain: "ads" as const, kind: "recurring", schedule: null, scheduleText: null, runsAt: null, endsAt: null, enabled: true, graceMin: 15, assigneeKey: "claude", graph: w.graph }));
    const ids = new Map(rows("workflow").map((w) => [w.id, w.key]));
    const viewRuns = rows("workflowRun").map((r) => ({ id: r.id, jobKey: ids.get(r.workflowId)!, status: r.status, trigger: "schedule", scheduledFor: r.scheduledFor?.toISOString() ?? null, startedAt: r.startedAt.toISOString(), heartbeatAt: null, finishedAt: r.finishedAt?.toISOString() ?? null, endReason: null, summary: null, doneBy: null, nodeStates: r.nodeStates }));
    const lanes = buildNow({ jobs, runs: viewRuns, tasks: [], names: {}, now: NOW });
    expect(stuckOf(lanes).cards.map((x) => x.id)).toEqual(home.cards.map((x) => x.id));
    expect(lanes.needs).toBe(home.total);
    expect(home.total).toBe(3);
  });
});

describe("loadHomeTasks — what the home needs from the tasks place", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  });

  it("the stopped runs and the moments still to come today, the first ones and how many in all", async () => {
    const j = await job("round", { schedule: "0 23 * * *", enabled: true });
    await run(j.id, "r1", "failed", { startedAt: ago(100), finishedAt: ago(90) });
    // `loadHomeTasks` reads the clock itself: stand the clock at the moment of the fixture
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    try {
      const t = await loadHomeTasks(null);
      expect(t.demo).toBe(false);
      expect(keys(t.stuck.cards)).toEqual(["round"]);
      expect(t.upcoming.total).toBe(1);
      expect(t.upcoming.lines.map((l) => [l.time, l.jobKey])).toEqual([["23:00", "round"]]);
    } finally {
      vi.useRealTimers();
    }
  });
});

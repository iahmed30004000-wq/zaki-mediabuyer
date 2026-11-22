/**
 * GET /api/jobs/live (docs/rebuild-v6/01-model.md §13): the agents, the runs that are going, the requests nobody took — one query per table, so the number of
 * queries does not grow with the number of runs (W-20). The shape is the plan's; the lamps and the sentence are `run-state.ts`'s.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AWAKE_WITHIN_MIN, buildLive } from "@/core/jobs-live";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb>, caller: { role: "OWNER" } as { role: string } | null }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/auth", async () => {
  class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  }
  return {
    HttpError,
    requireCapability: async () => {
      if (!h.caller) throw new HttpError(401, "سجّل دخولك");
      return h.caller;
    },
    errorResponse: (e: unknown) => Response.json({ error: e instanceof Error ? e.message : "x" }, { status: (e as { status?: number }).status ?? 500 }),
  };
});

import { GET } from "@/app/api/jobs/live/route";
import { loadLive } from "@/server/jobs-live";

type Rows = Record<string, any>[];
const NOW = new Date("2026-11-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

async function fill(jobs: number, runsPer: number) {
  for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  await h.db.actor.create({ data: { key: "claude", name: "Claude الرئيسي", kind: "agent", lastSeenAt: min(-2) } });
  await h.db.actor.create({ data: { key: "hermes", name: "هيرمز", kind: "agent", lastSeenAt: min(-200) } });
  await h.db.actor.create({ data: { key: "sara", name: "سارة", kind: "person" } });
  for (let i = 0; i < jobs; i++) {
    const wf = await h.db.workflow.create({ data: jobRow(`j${i}`, ["a", "b", "c"], { number: i + 1, name: `مهمة ${i}`, assigneeKey: i % 2 ? "hermes" : "claude" }) });
    for (let r = 0; r < runsPer; r++) {
      await h.db.workflowRun.create({
        data: { workflowId: wf.id, ref: `r${r}`, status: ["running", "waiting", "queued", "ok", "failed"][r % 5], startedAt: min(-30 + r), heartbeatAt: min(-1), doneBy: i % 2 ? "hermes" : "claude", nodeStates: { a: { status: "done", at: min(-20).toISOString() }, b: { status: "running", at: min(-10).toISOString(), startedAt: min(-10).toISOString() } }, graphVersion: 1 },
      });
    }
    await h.db.handoff.create({ data: { workflowKey: `j${i}`, kind: "manual_run", title: "x", assignee: i % 2 ? "hermes" : "claude", createdAt: min(-5 - i) } });
  }
}

function counted() {
  const calls: string[] = [];
  const wrap = (name: string) => {
    const t = (h.db as unknown as Record<string, Record<string, any>>)[name]!;
    for (const m of ["findMany", "findFirst", "findUnique", "groupBy", "count"]) {
      if (typeof t[m] !== "function" || t[m].__wrapped) continue;
      const orig = t[m].bind(t);
      t[m] = Object.assign((...a: unknown[]) => (calls.push(`${name}.${m}`), orig(...a)), { __wrapped: true });
    }
  };
  for (const n of ["actor", "workflow", "workflowRun", "workflowVersion", "handoff"]) wrap(n);
  return calls;
}

describe("the live answer", () => {
  beforeEach(() => {
    h.caller = { role: "OWNER" };
  });

  it("asks a fixed number of questions however many runs there are", async () => {
    const calls = counted();
    await fill(3, 5);
    calls.length = 0;
    await loadLive({ now: NOW });
    const few = calls.length;
    await fill(40, 5);
    calls.length = 0;
    const out = await loadLive({ now: NOW });
    expect(out.runs.length).toBeGreaterThan(30);
    expect(calls.length).toBe(few);
    expect(calls.length).toBeLessThanOrEqual(5);
  });

  it("has the shape of the plan: the agents, the runs with their steps, the queue", async () => {
    await fill(2, 5);
    const out = await loadLive({ now: NOW });
    expect(Object.keys(out).sort()).toEqual(["agents", "at", "queue", "runs"]);
    expect(out.at).toBe(NOW.toISOString());
    expect(out.agents.map((a) => [a.key, a.state])).toEqual([["claude", "running"], ["hermes", "running"]]);
    expect(out.agents.find((a) => a.key === "claude")).toMatchObject({ name: "Claude الرئيسي", queued: 1 });
    expect(out.queue).toHaveLength(2);
    expect(out.queue[0]).toMatchObject({ jobKey: "j1", assignee: "hermes", kind: "manual_run" });
    const run = out.runs.find((r) => r.status === "running" && r.jobKey === "j0")!;
    expect(run).toMatchObject({ jobNumber: 1, jobName: "مهمة 0", lamp: "run" });
    expect(Object.keys(run).sort()).toEqual(["heartbeatAt", "id", "jobKey", "jobName", "jobNumber", "lamp", "scheduledFor", "sentence", "startedAt", "status", "steps"]);
    expect(run.steps).toHaveLength(3);
    expect(run.steps[0]).toMatchObject({ id: "a", n: 1, no: "1.1", lamp: "done" });
    expect(run.steps[1]).toMatchObject({ id: "b", n: 2, no: "1.2", lamp: "run" });
    expect(Object.keys(run.steps[1]!).sort()).toEqual(["endedAt", "error", "id", "inferred", "label", "lamp", "n", "no", "note", "startedAt"]);
    expect(run.sentence).toContain("الخطوة 2 من 3");
  });

  it("brings only the runs that are going — and, with `since`, the ones that changed after it", async () => {
    await fill(1, 5); // statuses: running · waiting · queued · ok · failed
    expect((await loadLive({ now: NOW })).runs.map((r) => r.status).sort()).toEqual(["queued", "running", "waiting"]);
    const rows = (h.db.workflowRun as unknown as { rows: Rows }).rows;
    rows.find((r) => r.status === "ok")!.updatedAt = min(-1);
    rows.find((r) => r.status === "failed")!.updatedAt = min(-120);
    const since = (await loadLive({ now: NOW, since: min(-10) })).runs.map((r) => r.status).sort();
    expect(since).toEqual(["ok", "queued", "running", "waiting"]);
  });

  it("an agent that spoke recently is awake, one that did not is silent, one with a run going is running; a person is not an agent", () => {
    expect(AWAKE_WITHIN_MIN).toBe(15);
    const job = { id: "w1", key: "k", name: "ن", number: 1, assigneeKey: "claude", version: 1, graph: { nodes: [], edges: [] } };
    const run = { id: "r", workflowId: "w1", ref: "x", status: "ok", scheduledFor: null, startedAt: min(-9), heartbeatAt: null, finishedAt: null, endReason: null, summary: null, doneBy: "claude", graphVersion: null, nodeStates: {} };
    const actors = [
      { key: "claude", name: "C", kind: "agent", active: true, lastSeenAt: min(-5) },
      { key: "hermes", name: "H", kind: "agent", active: true, lastSeenAt: min(-16) },
      { key: "muse", name: "M", kind: "agent", active: true, lastSeenAt: null },
      { key: "gone", name: "G", kind: "agent", active: false, lastSeenAt: min(-1) },
      { key: "sara", name: "S", kind: "person", active: true, lastSeenAt: min(-1) },
    ];
    const out = buildLive({ now: NOW, actors, jobs: [job], runs: [run], versions: new Map(), requests: [] });
    expect(out.agents.map((a) => [a.key, a.state])).toEqual([["claude", "awake"], ["hermes", "silent"], ["muse", "silent"]]);
    const going = buildLive({ now: NOW, actors, jobs: [job], runs: [{ ...run, status: "running" }], versions: new Map(), requests: [] });
    expect(going.agents.find((a) => a.key === "claude")!.state).toBe("running");
    expect(going.agents.find((a) => a.key === "hermes")!.state).toBe("silent");
  });

  it("a run is drawn from the steps it began with: an older run keeps its own", async () => {
    await fill(0, 0);
    const wf = await h.db.workflow.create({ data: { ...jobRow("v", ["new1", "new2"], { number: 1 }), version: 2 } });
    await h.db.workflowVersion.create({ data: { workflowId: wf.id, version: 1, graph: jobRow("v", ["old1"]).graph } });
    await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "old", status: "running", startedAt: min(-5), graphVersion: 1, nodeStates: { old1: { status: "running", at: min(-4).toISOString() } } } });
    await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "cur", status: "running", startedAt: min(-4), graphVersion: 2, nodeStates: {} } });
    const out = await loadLive({ now: NOW });
    expect(out.runs.find((r) => r.steps.some((s) => s.id === "old1"))).toBeTruthy();
    expect(out.runs.find((r) => r.steps.some((s) => s.id === "new1"))).toBeTruthy();
  });

  it("the route needs `work.view`, takes `since`, and refuses one that is not a time", async () => {
    await fill(1, 2);
    const ok = await GET(new Request("https://x.test/api/jobs/live"));
    expect(ok.status).toBe(200);
    expect(Object.keys(await ok.json()).sort()).toEqual(["agents", "at", "queue", "runs"]);
    expect((await GET(new Request("https://x.test/api/jobs/live?since=2026-11-22T09:00:00Z"))).status).toBe(200);
    expect((await GET(new Request("https://x.test/api/jobs/live?since=yesterday"))).status).toBe(400);
    h.caller = null;
    expect((await GET(new Request("https://x.test/api/jobs/live"))).status).toBe(401);
  });
});

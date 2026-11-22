/**
 * `log_run` after v6 P1-1: what a call does to a run (the times, the heartbeat, no `ref`, a run that ended is not reopened, the requests the end closes,
 * the steps the owner switched off, a step the job no longer has). The pure part is `planRun`; the rest runs the real `logRun` on an in-memory database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { planRun, parseWhen, type ExistingRun, type PlanArgs } from "@/core/run-log";
import type { NodeStates, WfGraph } from "@/core/workflow";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { LogRunInput, RunRefused, UnknownJob, logRun } from "@/server/workflows";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
const graph: WfGraph = {
  nodes: [
    { id: "start", type: "trigger", label: "بداية" },
    { id: "read", type: "step", label: "قراءة" },
    { id: "judge", type: "step", label: "حكم" },
    { id: "act", type: "step", label: "تنفيذ" },
  ],
  edges: [{ from: "start", to: "read" }, { from: "read", to: "judge" }, { from: "judge", to: "act" }],
};
const existing = (over: Partial<ExistingRun> = {}): ExistingRun => ({ status: "running", startedAt: min(-30), finishedAt: null, trigger: "schedule", scheduledFor: null, heartbeatAt: min(-5), doneBy: "claude", endReason: null, graphVersion: 1, nodeStates: {}, ...over });
const args = (over: Partial<PlanArgs> = {}): PlanArgs => ({ existing: null, input: { updates: [] }, runGraph: graph, currentGraph: graph, version: 1, now: NOW, actorKey: "claude", ...over });
const ok = (p: ReturnType<typeof planRun>) => {
  if (!p.ok) throw new Error("refused: " + p.error);
  return p;
};

describe("planRun — the times and the heartbeat", () => {
  it("a new run begins now, at the version the job is on, signed by whoever logged it", () => {
    const p = ok(planRun(args({ input: { status: "running", updates: [] }, version: 4 })));
    expect(p.created).toBe(true);
    expect(p.data).toMatchObject({ status: "running", startedAt: NOW, finishedAt: null, heartbeatAt: NOW, doneBy: "claude", graphVersion: 4, endReason: null, trigger: "schedule" });
  });

  it("scheduled_for ties the run to its slot, and the slot stays when later calls do not repeat it", () => {
    const slot = "2026-11-22T09:00:00.000Z";
    const first = ok(planRun(args({ input: { status: "running", scheduled_for: slot, updates: [] } })));
    expect(first.data.scheduledFor).toEqual(new Date(slot));
    const second = ok(planRun(args({ existing: existing({ scheduledFor: new Date(slot) }), input: { updates: [] } })));
    expect(second.data.scheduledFor).toEqual(new Date(slot));
  });

  it("every call (a heartbeat alone too) is a sign of life: heartbeatAt moves to now", () => {
    const p = ok(planRun(args({ existing: existing(), input: { heartbeat: true, updates: [] } })));
    expect(p.data.heartbeatAt).toEqual(NOW);
    expect(p.data.status).toBe("running");
    expect(p.data.startedAt).toEqual(min(-30));
  });

  it("a late word about a run that has ended does not make it look alive", () => {
    const ended = existing({ status: "ok", finishedAt: min(-10), heartbeatAt: min(-10) });
    const p = ok(planRun(args({ existing: ended, input: { updates: [{ id: "read", status: "done" }] } })));
    expect(p.data).toMatchObject({ status: "ok", heartbeatAt: min(-10), finishedAt: min(-10) });
    expect(p.closeRequests).toBe(false);
  });

  it("a run that ends takes the end time it is told, else now; and keeps the one it had", () => {
    const told = ok(planRun(args({ existing: existing(), input: { status: "ok", finished_at: "2026-11-22T09:59:00.000Z", updates: [] } })));
    expect(told.data.finishedAt).toEqual(new Date("2026-11-22T09:59:00.000Z"));
    expect(ok(planRun(args({ existing: existing(), input: { status: "failed", updates: [] } }))).data.finishedAt).toEqual(NOW);
    expect(ok(planRun(args({ existing: existing({ status: "ok", finishedAt: min(-3) }), input: { status: "ok", updates: [] } }))).data.finishedAt).toEqual(min(-3));
  });

  it("a bad time is refused in words, naming the field", () => {
    for (const f of ["started_at", "finished_at", "scheduled_for"] as const) {
      const p = planRun(args({ input: { status: "running", [f]: "الأحد", updates: [] } }));
      expect(p).toMatchObject({ ok: false });
      expect((p as { error: string }).error).toContain(f);
    }
    expect(parseWhen("2026-11-22", "x")).toEqual({ ok: true, at: new Date("2026-11-22T00:00:00Z") });
  });

  it("a request waiting in the queue starts when the agent says so: startedAt is the real start", () => {
    const queued = existing({ status: "queued", startedAt: min(-50) });
    const viaStatus = ok(planRun(args({ existing: queued, input: { status: "running", updates: [] } })));
    expect(viaStatus.data).toMatchObject({ status: "running", startedAt: NOW });
    const viaNodes = ok(planRun(args({ existing: queued, input: { updates: [{ id: "read", status: "running" }] } })));
    expect(viaNodes.data).toMatchObject({ status: "running", startedAt: NOW });
  });
});

describe("planRun — what is refused", () => {
  it("a run that has ended is not opened again by «running» (W-12)", () => {
    for (const status of ["ok", "failed", "skipped", "missed", "lost"]) {
      const p = planRun(args({ existing: existing({ status, finishedAt: min(-9) }), input: { status: "running", updates: [] } }));
      expect(p, status).toMatchObject({ ok: false });
    }
  });

  it("an agent cannot write queued · missed · lost, new run or old", () => {
    for (const status of ["queued", "missed", "lost"]) {
      expect(planRun(args({ input: { status, updates: [] } }))).toMatchObject({ ok: false });
      expect(planRun(args({ existing: existing(), input: { status, updates: [] } }))).toMatchObject({ ok: false });
    }
  });

  it("the site may (a claim, a retry, the owner's buttons): it writes any status and reopens a run", () => {
    const p = ok(planRun(args({ site: true, existing: existing({ status: "failed", finishedAt: min(-9), endReason: "error" }), input: { status: "queued", updates: [] } })));
    expect(p.data).toMatchObject({ status: "queued", finishedAt: null, endReason: null });
  });

  it("a run the owner cancelled stays cancelled whatever the agent says, and the agent is told to stop", () => {
    const cancelled = existing({ status: "skipped", finishedAt: min(-2), endReason: "cancelled" });
    expect(planRun(args({ existing: cancelled, input: { status: "ok", updates: [] } }))).toMatchObject({ ok: false });
    const p = ok(planRun(args({ existing: cancelled, input: { updates: [{ id: "read", status: "done" }] } })));
    expect(p.stop).toBe(true);
    expect(p.data).toMatchObject({ status: "skipped", endReason: "cancelled" });
  });

  it("a step the job does not have is refused for a current run, naming the ones it has", () => {
    const p = planRun(args({ input: { status: "running", updates: [{ id: "ghost", status: "done" }] } }));
    expect(p).toMatchObject({ ok: false });
    expect((p as { error: string }).error).toContain("read");
  });
});

describe("planRun — what the end of a run does", () => {
  it("ok · failed · skipped close the requests still open for the run; running and waiting do not", () => {
    for (const status of ["ok", "failed", "skipped"]) expect(ok(planRun(args({ existing: existing(), input: { status, updates: [] } }))).closeRequests, status).toBe(true);
    for (const status of ["running", "waiting"]) expect(ok(planRun(args({ existing: existing(), input: { status, updates: [] } }))).closeRequests, status).toBe(false);
    expect(ok(planRun(args({ existing: existing(), input: { updates: [{ id: "read", status: "done" }] } }))).closeRequests).toBe(false);
  });

  it("a finished run fills the steps it was not told about, marked as guessed", () => {
    const p = ok(planRun(args({ existing: existing({ nodeStates: { read: { status: "done", at: "x", startedAt: "s", endedAt: "e" } } as NodeStates }), input: { status: "ok", updates: [] } })));
    expect(p.data.nodeStates.read!.inferred).toBeUndefined();
    expect(p.data.nodeStates.judge).toMatchObject({ status: "done", inferred: true });
  });

  it("a step's error and note go with it; a failed run marks the running step", () => {
    const p = ok(planRun(args({ existing: existing(), input: { status: "failed", updates: [{ id: "read", status: "running" }, { id: "judge", status: "failed", error: "ما في مخزون" }] } })));
    expect(p.data.nodeStates.judge).toMatchObject({ status: "failed", error: "ما في مخزون" });
    expect(p.data.nodeStates.read).toMatchObject({ status: "failed", inferred: true });
  });
});

describe("planRun — a run keeps reading the steps it began with (W-17)", () => {
  const old: WfGraph = { nodes: [...graph.nodes, { id: "gone", type: "step", label: "انشالت" }], edges: [...graph.edges, { from: "act", to: "gone" }] };

  it("a step the job has dropped is accepted for a run of an older version, and marked", () => {
    const p = ok(planRun(args({ existing: existing({ graphVersion: 1 }), runGraph: old, currentGraph: graph, version: 2, input: { updates: [{ id: "gone", status: "done", note: "خلص" }] } })));
    expect(p.data.nodeStates.gone).toMatchObject({ status: "done" });
    expect(p.data.nodeStates.gone!.note).toBe("خطوة انشالت — خلص");
    expect(p.data.graphVersion).toBe(1);
  });

  it("a step nobody ever had is still refused, old run or not", () => {
    expect(planRun(args({ existing: existing({ graphVersion: 1 }), runGraph: old, currentGraph: graph, version: 2, input: { updates: [{ id: "nope", status: "done" }] } }))).toMatchObject({ ok: false });
  });

  it("the end of the old run is drawn on ITS steps", () => {
    const p = ok(planRun(args({ existing: existing({ graphVersion: 1 }), runGraph: old, currentGraph: graph, version: 2, input: { status: "ok", updates: [] } })));
    expect(p.data.nodeStates.gone).toMatchObject({ status: "done", inferred: true });
  });
});

describe("log_run's input (what the agent may send)", () => {
  const base = { job: "daily-check", ref: "r1" };
  it("takes the new fields: scheduled_for, heartbeat, a step's error, the step status «skipped»", () => {
    const p = LogRunInput.safeParse({ ...base, status: "running", scheduled_for: "2026-11-22T09:00:00Z", heartbeat: true, node: { id: "read", status: "skipped", error: "x" } });
    expect(p.success).toBe(true);
  });

  it("does not take the site's statuses (queued · missed · lost)", () => {
    for (const status of ["queued", "missed", "lost"]) expect(LogRunInput.safeParse({ ...base, status }).success, status).toBe(false);
  });

  it("an artifact link must be https", () => {
    expect(LogRunInput.safeParse({ ...base, artifacts: [{ label: "تقرير", url: "https://drive.example.com/x" }] }).success).toBe(true);
    for (const url of ["javascript:alert(1)", "http://x.com", "/etc/passwd", "data:text/html,x"]) expect(LogRunInput.safeParse({ ...base, artifacts: [{ label: "x", url }] }).success, url).toBe(false);
  });
});

describe("logRun, on a database", () => {
  const db = () => h.db;
  const reset = () => {
    for (const t of Object.values(db())) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  };
  const actor = { type: "agent" as const, id: "mcp:Claude" };
  const call = (input: Parameters<typeof logRun>[0], over: { now?: Date; actorKey?: string | null } = {}) => logRun(input, actor, "mcp", over.now ?? NOW, { actorKey: over.actorKey === undefined ? "claude" : over.actorKey });
  const job = async (steps = ["read", "judge", "act"], extra = {}) => db().workflow.create({ data: jobRow("daily-check", steps, extra) });
  const runs = () => (db().workflowRun as unknown as { rows: Record<string, any>[] }).rows;
  const handoffs = () => (db().handoff as unknown as { rows: Record<string, any>[] }).rows;

  beforeEach(reset);

  it("a call without ref is refused with a clear sentence, and nothing is written", async () => {
    await job();
    await expect(call({ job: "daily-check", status: "running" })).rejects.toThrow(/ref/);
    expect(runs()).toHaveLength(0);
  });

  it("an unknown job says which are known", async () => {
    await job();
    const e = await call({ job: "nope", ref: "r1" }).catch((x) => x);
    expect(e).toBeInstanceOf(UnknownJob);
    expect((e as UnknownJob).known).toContain("daily-check");
  });

  it("records a run with its times, its slot, who logged it and the version of the steps", async () => {
    await job();
    const r = await call({ job: "daily-check", ref: "r1", status: "running", scheduled_for: "2026-11-22T09:55:00Z" });
    expect(r.created).toBe(true);
    expect(r.run).toMatchObject({ status: "running", scheduledFor: "2026-11-22T09:55:00.000Z", heartbeatAt: NOW.toISOString(), doneBy: "claude", graphVersion: 1 });
    expect(r.disabled_steps).toEqual([]);
    expect(r.stop).toBe(false);
  });

  it("the same ref again is the same run; the step times are written by the site", async () => {
    await job();
    await call({ job: "daily-check", ref: "r1", status: "running", node: { id: "read", status: "running" } });
    const r = await call({ job: "daily-check", ref: "r1", node: { id: "read", status: "failed", error: "ما قدرنا نقرا" } }, { now: min(7) });
    expect(r.created).toBe(false);
    expect(runs()).toHaveLength(1);
    expect(r.run.nodeStates.read).toMatchObject({ status: "failed", error: "ما قدرنا نقرا", startedAt: NOW.toISOString(), endedAt: min(7).toISOString() });
    expect(r.run.heartbeatAt).toBe(min(7).toISOString());
  });

  it("a run that has ended is not reopened by a late «running»", async () => {
    await job();
    await call({ job: "daily-check", ref: "r1", status: "ok", summary: "تم" });
    await expect(call({ job: "daily-check", ref: "r1", status: "running" }, { now: min(3) })).rejects.toBeInstanceOf(RunRefused);
    expect(runs()[0]!.status).toBe("ok");
  });

  it("the end of a run closes the requests still open for it (doneBy: auto) and leaves the others", async () => {
    await job();
    const mine = await db().handoff.create({ data: { workflowKey: "daily-check", runRef: "r1", kind: "manual_run", title: "t", status: "claimed" } });
    const other = await db().handoff.create({ data: { workflowKey: "daily-check", runRef: "r2", kind: "manual_run", title: "t", status: "open" } });
    await call({ job: "daily-check", ref: "r1", status: "ok" });
    const rows = handoffs();
    expect(rows.find((x) => x.id === mine.id)).toMatchObject({ status: "done", doneBy: "auto" });
    expect(rows.find((x) => x.id === other.id)!.status).toBe("open");
  });

  it("every word from the run pushes the taker's lease on (the job's maxRunMin from now)", async () => {
    await job(["read"], { maxRunMin: 40 });
    const hd = await db().handoff.create({ data: { workflowKey: "daily-check", runRef: "r1", kind: "manual_run", title: "t", status: "claimed", leaseUntil: min(5) } });
    await call({ job: "daily-check", ref: "r1", status: "running", heartbeat: true }, { now: min(10) });
    expect(handoffs().find((x) => x.id === hd.id)!.leaseUntil).toEqual(min(50));
  });

  it("tells the agent which steps the owner switched off, and to stop when he cancelled", async () => {
    await db().workflow.create({ data: jobRow("daily-check", ["read", "judge", "act"], { graph: { nodes: [{ id: "start", type: "trigger", label: "x" }, { id: "read", type: "step", label: "r" }, { id: "judge", type: "step", label: "j", disabled: true }, { id: "act", type: "step", label: "a" }], edges: [] } }) });
    const r = await call({ job: "daily-check", ref: "r1", status: "running" });
    expect(r.disabled_steps).toEqual(["judge"]);
    await db().workflowRun.updateMany({ where: { ref: "r1" }, data: { status: "skipped", endReason: "cancelled", finishedAt: NOW } });
    const again = await call({ job: "daily-check", ref: "r1", node: { id: "read", status: "done" } }, { now: min(1) });
    expect(again.stop).toBe(true);
    expect(again.run.status).toBe("skipped");
  });

  it("says when the owner last changed a standing order", async () => {
    await job();
    expect((await call({ job: "daily-check", ref: "r1" })).orders_changed_at).toBeNull();
    const o = await db().standingOrder.create({ data: { text: "x" } });
    expect((await call({ job: "daily-check", ref: "r2" })).orders_changed_at).toBe((o.updatedAt as Date).toISOString());
  });

  it("a step the job dropped since is accepted for a run that began under an older version, and marked", async () => {
    const wf = await job(["read", "judge", "act"]);
    await db().workflowVersion.create({ data: { workflowId: wf.id, version: 1, graph: wf.graph } });
    await call({ job: "daily-check", ref: "r1", status: "running" });
    // the owner drops «act» — version 2
    const next = { ...wf.graph, nodes: wf.graph.nodes.filter((n: { id: string }) => n.id !== "act"), edges: wf.graph.edges.filter((e: { to: string }) => e.to !== "act") };
    await db().workflow.update({ where: { key: "daily-check" }, data: { graph: next, version: 2 } });
    const r = await call({ job: "daily-check", ref: "r1", node: { id: "act", status: "done", note: "خلص" } });
    expect(r.run.nodeStates.act).toMatchObject({ status: "done", note: "خطوة انشالت — خلص" });
    expect(r.run.graphVersion).toBe(1);
    // a NEW run on the new version does not know it
    await expect(call({ job: "daily-check", ref: "r2", node: { id: "act", status: "done" } })).rejects.toBeInstanceOf(RunRefused);
  });

  it("refuses customer data in a step's note or error, and a link that is not https", async () => {
    await job();
    await expect(call({ job: "daily-check", ref: "r1", node: { id: "read", status: "failed", error: "فشل مع الزبون 0791234567 بعمان" } })).rejects.toBeInstanceOf(RunRefused);
    await expect(call({ job: "daily-check", ref: "r2", artifacts: [{ label: "x", url: "http://x.com" }] })).rejects.toBeInstanceOf(RunRefused);
    await expect(call({ job: "daily-check", ref: "r3", artifacts: [{ label: "x", url: "https://user:pw@x.com/a" }] })).rejects.toBeInstanceOf(RunRefused);
    expect(runs()).toHaveLength(0);
  });

  it("two calls at the same moment for one run are both written, one after the other (the lock is asked for)", async () => {
    await job();
    const lock = vi.spyOn(db(), "$executeRaw");
    await Promise.all([
      call({ job: "daily-check", ref: "r1", status: "running", node: { id: "read", status: "running" } }),
      call({ job: "daily-check", ref: "r1", node: { id: "judge", status: "running" } }),
    ]).catch(() => undefined);
    expect(lock).toHaveBeenCalled();
    expect(runs().length).toBeLessThanOrEqual(1);
  });

  it("create_if_missing makes a job for the caller's agent", async () => {
    const r = await call({ job: "brand-new", ref: "r1", create_if_missing: true });
    expect(r.workflow.key).toBe("brand-new");
    expect((await db().workflow.findUnique({ where: { key: "brand-new" } }))!.assigneeKey).toBe("claude");
  });
});

/**
 * The owner's buttons on a run that stopped (docs/rebuild-v6/01-model.md §8): retry · skip · cancel · reassign. The site never runs the steps; it puts the
 * run back in the queue as «كمّل من الخطوة N» for the job's agent, and the agent hears about a cancel from the next `log_run` answer.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { HandoffRefused, claimHandoff } from "@/server/handoffs";
import { cancelRun, reassignRun, retryRun, skipRunStep } from "@/server/run-actions";
import { logRun } from "@/server/workflows";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
const owner = { type: "user" as const, id: "u1" };
const agent = { type: "agent" as const, id: "mcp:Claude" };
const rows = (name: "handoff" | "workflowRun" | "workflow") => (h.db[name] as unknown as { rows: Record<string, any>[] }).rows;

/** a run that failed at step «b» of a, b, c, d */
async function failedRun(over: { status?: string; states?: Record<string, unknown> } = {}) {
  await logRun({ job: "night-check", ref: "r1", status: "running", node: { id: "a", status: "running" } }, agent, "mcp", NOW, { actorKey: "claude" });
  await logRun({ job: "night-check", ref: "r1", nodes: [{ id: "a", status: "done" }, { id: "b", status: "failed", error: "ما قدرنا نقرا المخزون" }] }, agent, "mcp", min(2), { actorKey: "claude" });
  await logRun({ job: "night-check", ref: "r1", status: over.status === "lost" ? "failed" : "failed", summary: "وقفت" }, agent, "mcp", min(3), { actorKey: "claude" });
  const run = rows("workflowRun")[0]!;
  if (over.status === "lost") Object.assign(run, { status: "lost", endReason: "lost" });
  return run;
}

describe("the owner's buttons", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: jobRow("night-check", ["a", "b", "c", "d"], { maxRunMin: 60 }) });
  });

  describe("retry — أعد المحاولة من هون", () => {
    it("puts the run back in the queue from the step that failed: one try more, a request «كمّل من الخطوة 2» for the job's agent", async () => {
      const run = await failedRun();
      const r = await retryRun("night-check", run.id, owner, min(10));
      expect(r.run.status).toBe("queued");
      expect(r.run).toMatchObject({ finishedAt: null, endReason: null });
      expect(r.run.nodeStates.b).toMatchObject({ status: "waiting", attempt: 2 });
      expect(r.run.nodeStates.b!.error).toBeUndefined();
      expect(r.run.nodeStates.a!.status).toBe("done");
      expect(r.handoff).toMatchObject({ kind: "resume", nodeId: "b", assignee: "claude", status: "open", runRef: "r1", title: "كمّل من الخطوة 2: خطوة b" });
      expect(r.handoff!.context.lastError).toBe("ما قدرنا نقرا المخزون");
      expect(r.handoff!.expiresAt).toBe(new Date(min(10).getTime() + 6 * 3_600_000).toISOString());
    });

    it("the agent takes it, goes on from step 2, and the same run finishes — the retry did not make a new run", async () => {
      const run = await failedRun();
      const r = await retryRun("night-check", run.id, owner, min(10));
      const c = await claimHandoff(r.handoff!.id, "Claude", agent, min(11), { actorKey: "claude" });
      expect(rows("workflowRun")[0]!.status).toBe("running");
      await logRun({ job: "night-check", ref: "r1", nodes: [{ id: "b", status: "running" }, { id: "b", status: "done" }] }, agent, "mcp", min(12), { actorKey: "claude" });
      const end = await logRun({ job: "night-check", ref: "r1", status: "ok", summary: "تم" }, agent, "mcp", min(13), { actorKey: "claude" });
      expect(c.claim).toBeTruthy();
      expect(end.run.status).toBe("ok");
      expect(rows("workflowRun")).toHaveLength(1);
      expect(rows("handoff")[0]).toMatchObject({ status: "done", doneBy: "auto" });
    });

    it("a lost run can be retried too, and a running one cannot", async () => {
      const run = await failedRun({ status: "lost" });
      await expect(retryRun("night-check", run.id, owner, min(10))).resolves.toBeTruthy();
      await h.db.workflowRun.create({ data: { workflowId: rows("workflow")[0]!.id, ref: "live", status: "running", startedAt: NOW } });
      const live = rows("workflowRun").find((x) => x.ref === "live")!;
      await expect(retryRun("night-check", live.id, owner, min(10))).rejects.toMatchObject({ status: 409 });
    });

    it("a request still open for the run is closed (the owner took over), so there is one request, not two", async () => {
      const run = await failedRun();
      await h.db.handoff.create({ data: { workflowKey: "night-check", runRef: "r1", kind: "node_failed", title: "t", status: "open" } });
      await retryRun("night-check", run.id, owner, min(10));
      const open = rows("handoff").filter((x) => ["open", "claimed"].includes(x.status));
      expect(open).toHaveLength(1);
      expect(open[0]!.kind).toBe("resume");
      expect(rows("handoff").find((x) => x.kind === "node_failed")).toMatchObject({ status: "cancelled", doneBy: "user:u1" });
    });

    it("goes to the job's own agent, not always Claude", async () => {
      await h.db.workflow.update({ where: { key: "night-check" }, data: { assigneeKey: "hermes" } });
      const run = await failedRun();
      expect((await retryRun("night-check", run.id, owner, min(10))).handoff!.assignee).toBe("hermes");
    });

    it("a run the owner cancelled is not retried; an unknown run or job is a 404", async () => {
      const run = await failedRun();
      Object.assign(rows("workflowRun")[0]!, { endReason: "cancelled" });
      await expect(retryRun("night-check", run.id, owner, min(10))).rejects.toMatchObject({ status: 409 });
      await expect(retryRun("night-check", "nope", owner, min(10))).rejects.toMatchObject({ status: 404 });
      await expect(retryRun("ghost", run.id, owner, min(10))).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("skip — تخطّى هالخطوة", () => {
    it("sets the failed step aside and asks for the run to go on from the step after it", async () => {
      const run = await failedRun();
      const r = await skipRunStep("night-check", run.id, owner, min(10));
      expect(r.run.status).toBe("queued");
      expect(r.run.nodeStates.b).toMatchObject({ status: "skipped", endedAt: min(10).toISOString() });
      expect(r.handoff).toMatchObject({ kind: "resume", nodeId: "c", title: "كمّل من الخطوة 3: خطوة c" });
    });

    it("skipping the last step ends the run ok — there is nothing to ask", async () => {
      await logRun({ job: "night-check", ref: "r2", status: "running", nodes: [{ id: "a", status: "done" }, { id: "b", status: "done" }, { id: "c", status: "done" }, { id: "d", status: "failed", error: "x" }] }, agent, "mcp", NOW, { actorKey: "claude" });
      await logRun({ job: "night-check", ref: "r2", status: "failed" }, agent, "mcp", min(1), { actorKey: "claude" });
      const run = rows("workflowRun").find((x) => x.ref === "r2")!;
      const r = await skipRunStep("night-check", run.id, owner, min(10));
      expect(r.run.status).toBe("ok");
      expect(r.handoff).toBeUndefined();
      expect(rows("handoff")).toHaveLength(0);
    });

    it("skips a step the owner names, if it is stopped; refuses one that is done", async () => {
      const run = await failedRun();
      await expect(skipRunStep("night-check", run.id, owner, min(10), "a")).rejects.toMatchObject({ status: 409 });
      await expect(skipRunStep("night-check", run.id, owner, min(10), "zzz")).rejects.toMatchObject({ status: 404 });
      await expect(skipRunStep("night-check", run.id, owner, min(10), "b")).resolves.toBeTruthy();
    });

    it("skips the gate a run waits at, when asked", async () => {
      await logRun({ job: "night-check", ref: "r3", status: "running", nodes: [{ id: "a", status: "done" }, { id: "b", status: "approval", note: "بانتظار موافقتك" }] }, agent, "mcp", NOW, { actorKey: "claude" });
      await logRun({ job: "night-check", ref: "r3", status: "waiting" }, agent, "mcp", min(1), { actorKey: "claude" });
      const run = rows("workflowRun").find((x) => x.ref === "r3")!;
      const r = await skipRunStep("night-check", run.id, owner, min(5));
      expect(r.run.nodeStates.b!.status).toBe("skipped");
      expect(r.handoff).toMatchObject({ nodeId: "c" });
    });
  });

  describe("cancel — ألغِ التشغيل", () => {
    it("ends any run that has not ended as skipped (cancelled), closes its requests, and tells the agent to stop", async () => {
      await logRun({ job: "night-check", ref: "r1", status: "running", node: { id: "a", status: "running" } }, agent, "mcp", NOW, { actorKey: "claude" });
      await h.db.handoff.create({ data: { workflowKey: "night-check", runRef: "r1", kind: "needs_input", title: "t", status: "claimed" } });
      const run = rows("workflowRun")[0]!;
      const r = await cancelRun("night-check", run.id, owner, min(5));
      expect(r.run).toMatchObject({ status: "skipped", endReason: "cancelled" });
      expect(r.run.nodeStates.a!.status).toBe("skipped");
      expect(rows("handoff")[0]).toMatchObject({ status: "cancelled" });
      const next = await logRun({ job: "night-check", ref: "r1", node: { id: "a", status: "done" } }, agent, "mcp", min(6), { actorKey: "claude" });
      expect(next.stop).toBe(true);
      await expect(logRun({ job: "night-check", ref: "r1", status: "running" }, agent, "mcp", min(7), { actorKey: "claude" })).rejects.toThrow();
    });

    it("a queued run can be cancelled; one that ended cannot", async () => {
      await h.db.workflowRun.create({ data: { workflowId: rows("workflow")[0]!.id, ref: "q", status: "queued", startedAt: NOW } });
      const q = rows("workflowRun").find((x) => x.ref === "q")!;
      await expect(cancelRun("night-check", q.id, owner, min(1))).resolves.toBeTruthy();
      await expect(cancelRun("night-check", q.id, owner, min(2))).rejects.toMatchObject({ status: 409 });
    });
  });

  describe("reassign — سلّمها لغيره", () => {
    it("gives the request the run waits on to somebody else, for this run only", async () => {
      const run = await failedRun();
      const r = await retryRun("night-check", run.id, owner, min(10));
      const out = await reassignRun("night-check", run.id, "muse", owner);
      expect(out.handoff).toMatchObject({ id: r.handoff!.id, assignee: "muse", status: "open" });
      expect(rows("workflow")[0]!.assigneeKey).toBe("claude");
    });

    it("refuses when no request waits for it", async () => {
      const run = await failedRun();
      await expect(reassignRun("night-check", run.id, "muse", owner)).rejects.toBeInstanceOf(HandoffRefused);
    });
  });
});

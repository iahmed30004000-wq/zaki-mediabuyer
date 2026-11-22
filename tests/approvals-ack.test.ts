/**
 * Decisions after v6 P1-1: a decision shows on the step that asked (`run_ref` / `node_id`), the agent says «نفّذت» (`ack_approval`) and it is not offered
 * again (W-06), a postponed request does not end while it sleeps (W-10), who may answer is decided on the server from what the request carries,
 * and a decision from a step puts its run back on its way (§8).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { approvalCapabilityOf, expiryAfterPostpone, isTeamMessage } from "@/core/approval-rules";
import { fromApproval, kindOfApproval, type ApprovalIn } from "@/core/inbox";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/auth", () => ({
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));
vi.mock("@/server/notify", () => ({ URGENCY_ICON: { red: "r", orange: "o", yellow: "y" } }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test" }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async () => undefined, telegramFromEnv: () => null }));
vi.mock("@/server/settings", () => ({
  getSetting: async (key: string) => (key === "owner.wake_kinds" ? [] : { mode: "awake", schedule: { enabled: false, awake: "10:00", asleep: "23:00" }, switch: "manual" }),
}));

import { ApprovalInput, ackApproval, decideApproval, listApprovals, refreshApprovals, requestApproval, Refused } from "@/server/approvals";
import { claimHandoff } from "@/server/handoffs";
import { logRun } from "@/server/workflows";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);
const hr = (x: number) => min(x * 60);
const agent = { type: "agent" as const, id: "mcp:Claude" };
const rows = (name: "approval" | "handoff" | "workflowRun") => (h.db[name] as unknown as { rows: Record<string, any>[] }).rows;
const ownerCaller = { id: "u1", role: "OWNER" as never };
const opsCaller = { id: "u2", role: "OPS_MANAGER" as never };

describe("who may answer — decided on the server", () => {
  const msg = { kind: "send_message", amount: null, analysis: { text: "أهلاً، طلبك بالطريق" } };

  it("a message to the team is the operations manager's — only when it IS one: the kind, no money, and the text to send", () => {
    expect(isTeamMessage(msg)).toBe(true);
    expect(approvalCapabilityOf(msg)).toBe("ops.send");
    expect(isTeamMessage({ ...msg, amount: 0 })).toBe(true);
  });

  it("anything with an amount is the owner's, whatever kind the agent wrote", () => {
    expect(approvalCapabilityOf({ ...msg, amount: 50 })).toBe("owner_only");
    expect(approvalCapabilityOf({ kind: "cap_raise", amount: 200, analysis: null })).toBe("owner_only");
  });

  it("a «message» without the text it would send, or any other kind, is the owner's", () => {
    expect(approvalCapabilityOf({ kind: "send_message", amount: null, analysis: null })).toBe("owner_only");
    expect(approvalCapabilityOf({ kind: "send_message", amount: null, analysis: { text: "  " } })).toBe("owner_only");
    expect(approvalCapabilityOf({ kind: "send_message", amount: null, analysis: { text: 12 } })).toBe("owner_only");
    expect(approvalCapabilityOf({ kind: "stock", amount: null, analysis: { text: "x" } })).toBe("owner_only");
    expect(approvalCapabilityOf({ kind: null, amount: null, analysis: { text: "x" } })).toBe("owner_only");
  });

  it("the inbox shows the same rule: a message that names money is money, and a message with no text is not offered to the operations manager", () => {
    const base: ApprovalIn = { id: "a1", title: "t", why: "w", numbers: [], options: [{ key: "approve", label: "ابعت" }, { key: "reject", label: "لا" }], amount: null, urgency: "orange", kind: "send_message", source: "mcp", workflowKey: null, expiresAt: null, postponedUntil: null, createdAt: NOW.toISOString(), analysis: { text: "نص" } };
    expect(kindOfApproval({ kind: "send_message", amount: 30 })).toBe("spend");
    expect(fromApproval(base).kind).toBe("message");
    expect(fromApproval(base).actions[0]!.capability).toBe("ops.send");
    const spoof = fromApproval({ ...base, analysis: null });
    expect(spoof.kind).toBe("other");
    expect(spoof.domain).not.toBe("ops");
    expect(spoof.actions.every((a) => a.capability !== "ops.send")).toBe(true);
    expect(fromApproval({ ...base, amount: 80 }).kind).toBe("spend");
  });
});

describe("a postponed request does not end while it sleeps (W-10)", () => {
  const created = new Date("2026-11-22T08:00:00Z");
  it("an expiry that falls before the request comes back moves past it, keeping at least an hour (or the time first given)", () => {
    const until = new Date("2026-11-22T12:00:00Z");
    expect(expiryAfterPostpone({ expiresAt: new Date("2026-11-22T09:00:00Z"), createdAt: created, until })).toEqual(new Date("2026-11-22T13:00:00Z"));
    expect(expiryAfterPostpone({ expiresAt: new Date("2026-11-22T11:00:00Z"), createdAt: created, until })).toEqual(new Date("2026-11-22T15:00:00Z"));
  });
  it("an expiry later than the return stays; no expiry stays none", () => {
    const until = new Date("2026-11-22T12:00:00Z");
    expect(expiryAfterPostpone({ expiresAt: new Date("2026-11-22T20:00:00Z"), createdAt: created, until })).toEqual(new Date("2026-11-22T20:00:00Z"));
    expect(expiryAfterPostpone({ expiresAt: null, createdAt: created, until })).toBeNull();
  });
});

describe("decisions, on a database", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: jobRow("night-round", ["read", "gate", "act", "report"], { graph: { nodes: [{ id: "start", type: "trigger", label: "بداية" }, { id: "read", type: "step", label: "قراءة" }, { id: "gate", type: "approval", label: "موافقة" }, { id: "act", type: "step", label: "تنفيذ" }, { id: "report", type: "step", label: "تقرير" }], edges: [{ from: "start", to: "read" }, { from: "read", to: "gate" }, { from: "gate", to: "act" }, { from: "act", to: "report" }] } }) });
  });

  const ask = (over: Partial<Parameters<typeof requestApproval>[0]> = {}, now = NOW) => requestApproval({ title: "ارفع السقف", why: "ربح", urgency: "orange", ...over } as never, agent, now);

  it("a request names the run and the step that asked, and the schema takes them", async () => {
    expect(ApprovalInput.safeParse({ title: "t", why: "w", urgency: "red", run_ref: "r1", node_id: "gate" }).success).toBe(true);
    const r = await ask({ workflow: "night-round", run_ref: "r1", node_id: "gate" });
    expect(r.approval).toMatchObject({ runRef: "r1", nodeId: "gate", workflowKey: "night-round", actedAt: null });
  });

  describe("ack_approval — «نفّذت»", () => {
    it("a decided request is offered by default until the agent acks it; then it is not", async () => {
      const a = (await ask()).approval;
      await decideApproval(a.id, { action: "approve" }, ownerCaller, min(1));
      expect((await listApprovals({}, min(2))).map((x) => x.id)).toEqual([a.id]);
      const acked = await ackApproval(a.id, agent, min(3));
      expect(acked.actedAt).toBe(min(3).toISOString());
      expect(await listApprovals({}, min(4))).toEqual([]);
    });

    it("an acked one is still there when asked for by id or by status", async () => {
      const a = (await ask()).approval;
      await decideApproval(a.id, { action: "reject" }, ownerCaller, min(1));
      await ackApproval(a.id, agent, min(2));
      expect((await listApprovals({ ids: [a.id] }, min(3)))[0]).toMatchObject({ status: "rejected", actedAt: expect.any(String) });
      expect((await listApprovals({ status: ["rejected"] }, min(3))).map((x) => x.id)).toEqual([a.id]);
    });

    it("what is still pending is always offered", async () => {
      const a = (await ask()).approval;
      expect((await listApprovals({}, hr(30))).map((x) => x.id)).toEqual([a.id]);
    });

    it("a decision older than 48 hours that was never acked is no longer offered by default (as before)", async () => {
      const a = (await ask()).approval;
      await decideApproval(a.id, { action: "approve" }, ownerCaller, min(1));
      expect(await listApprovals({}, hr(50))).toEqual([]);
    });

    it("acking twice is fine and keeps the first time; a request nobody answered cannot be acked", async () => {
      const a = (await ask()).approval;
      await expect(ackApproval(a.id, agent, min(1))).rejects.toBeInstanceOf(Refused);
      await decideApproval(a.id, { action: "approve" }, ownerCaller, min(2));
      await ackApproval(a.id, agent, min(3));
      expect((await ackApproval(a.id, agent, min(9))).actedAt).toBe(min(3).toISOString());
      await expect(ackApproval("nope", agent, min(9))).rejects.toBeInstanceOf(Refused);
    });
  });

  describe("postponing", () => {
    it("moves the expiry past the return, and the request comes back to pending instead of expiring", async () => {
      const a = (await ask({ expires_in_min: 30 })).approval;
      await decideApproval(a.id, { action: "postpone", until: "1h" }, ownerCaller, min(5));
      const row = rows("approval")[0]!;
      expect(row.status).toBe("postponed");
      expect(row.expiresAt.getTime()).toBeGreaterThan(row.postponedUntil.getTime());
      // 45 minutes later: still asleep — not expired
      expect((await refreshApprovals(min(45))).expired).toBe(0);
      expect(rows("approval")[0]!.status).toBe("postponed");
      // it comes back, and is pending with an expiry in the future
      const back = await refreshApprovals(min(70));
      expect(back).toMatchObject({ woken: 1, expired: 0 });
      expect(rows("approval")[0]).toMatchObject({ status: "pending", postponedUntil: null });
      expect(rows("approval")[0]!.expiresAt.getTime()).toBeGreaterThan(min(70).getTime());
    });

    it("an old postponed request whose expiry already passed (made before this fix) still comes back before it can expire", async () => {
      const a = await h.db.approval.create({ data: { title: "t", why: "w", status: "postponed", postponedUntil: min(20), expiresAt: min(10), createdAt: NOW } });
      expect((await refreshApprovals(min(15))).expired).toBe(0);
      expect(rows("approval")[0]!.status).toBe("postponed");
      expect(await refreshApprovals(min(25))).toMatchObject({ woken: 1, expired: 0 });
      expect(rows("approval").find((x) => x.id === a.id)!.status).toBe("pending");
    });

    it("a pending request still expires at its time", async () => {
      await ask({ expires_in_min: 10 });
      expect((await refreshApprovals(min(11))).expired).toBe(1);
      expect(rows("approval")[0]!.status).toBe("expired");
    });
  });

  describe("who may answer, decided on the server", () => {
    it("the operations manager may approve a real message to the team", async () => {
      const a = (await ask({ kind: "send_message", analysis: { analysis: "x" } })).approval;
      // no text to send → owner only
      await expect(decideApproval(a.id, { action: "approve" }, opsCaller, min(1))).rejects.toMatchObject({ status: 403 });
      // the real door (request_approval's schema) carries the text, so the manager can approve what it asks for
      expect(ApprovalInput.safeParse({ title: "t", why: "w", urgency: "yellow", kind: "send_message", analysis: { text: "أهلاً" } }).success).toBe(true);
      const m = (await ask({ kind: "send_message", analysis: { text: "أهلاً بالفريق" } })).approval;
      await expect(decideApproval(m.id, { action: "approve" }, opsCaller, min(1))).resolves.toMatchObject({ status: "approved" });
    });

    it("a request that wears the message kind but names an amount is the owner's", async () => {
      const m = await h.db.approval.create({ data: { title: "رسالة", why: "w", kind: "send_message", amount: 500, analysis: { text: "أهلاً" } } });
      await expect(decideApproval(m.id, { action: "approve" }, opsCaller, min(1))).rejects.toMatchObject({ status: 403 });
      await expect(decideApproval(m.id, { action: "approve" }, ownerCaller, min(1))).resolves.toMatchObject({ status: "approved" });
    });
  });

  describe("a decision from a step puts the run back on its way (§8)", () => {
    const waitingRun = async (ref = "r1") => {
      await logRun({ job: "night-round", ref, status: "running", nodes: [{ id: "read", status: "done" }, { id: "gate", status: "approval", note: "بانتظار موافقتك" }] }, agent, "mcp", NOW, { actorKey: "claude" });
      await logRun({ job: "night-round", ref, status: "waiting" }, agent, "mcp", min(1), { actorKey: "claude" });
    };

    it("approved: the step goes on and the job's agent is asked to carry on from it", async () => {
      await waitingRun();
      const a = (await ask({ workflow: "night-round", run_ref: "r1", node_id: "gate" }, min(2))).approval;
      await decideApproval(a.id, { action: "approve" }, ownerCaller, min(3));
      const run = rows("workflowRun")[0]!;
      expect(run.status).toBe("queued");
      expect(run.nodeStates.gate).toMatchObject({ status: "running", note: "المالك وافق" });
      const ho = rows("handoff");
      expect(ho).toHaveLength(1);
      expect(ho[0]).toMatchObject({ kind: "resume", nodeId: "gate", assignee: "claude", runRef: "r1", status: "open" });
      // the agent takes it and carries on
      await expect(claimHandoff(ho[0]!.id, "Claude", agent, min(4), { actorKey: "claude" })).resolves.toBeTruthy();
      expect(rows("workflowRun")[0]!.status).toBe("running");
    });

    it("rejected: the step is set aside and the request is for the step after it", async () => {
      await waitingRun();
      const a = (await ask({ workflow: "night-round", run_ref: "r1", node_id: "gate" }, min(2))).approval;
      await decideApproval(a.id, { action: "reject" }, ownerCaller, min(3));
      expect(rows("workflowRun")[0]!.nodeStates.gate).toMatchObject({ status: "skipped", note: "المالك رفض" });
      expect(rows("handoff")[0]).toMatchObject({ kind: "resume", nodeId: "act" });
    });

    it("rejecting the last step ends the run", async () => {
      await logRun({ job: "night-round", ref: "r2", status: "running", nodes: [{ id: "read", status: "done" }, { id: "gate", status: "done" }, { id: "act", status: "done" }, { id: "report", status: "approval" }] }, agent, "mcp", NOW, { actorKey: "claude" });
      await logRun({ job: "night-round", ref: "r2", status: "waiting" }, agent, "mcp", min(1), { actorKey: "claude" });
      const a = (await ask({ workflow: "night-round", run_ref: "r2", node_id: "report" }, min(2))).approval;
      await decideApproval(a.id, { action: "reject" }, ownerCaller, min(3));
      expect(rows("workflowRun")[0]!.status).toBe("ok");
      expect(rows("handoff")).toHaveLength(0);
    });

    it("postponing, cancelling, a run that already ended, or a step the job no longer has changes nothing", async () => {
      await waitingRun();
      const a = (await ask({ workflow: "night-round", run_ref: "r1", node_id: "gate" }, min(2))).approval;
      await decideApproval(a.id, { action: "postpone", until: "1h" }, ownerCaller, min(3));
      expect(rows("handoff")).toHaveLength(0);
      expect(rows("workflowRun")[0]!.status).toBe("waiting");
      await logRun({ job: "night-round", ref: "r1", status: "failed" }, agent, "mcp", min(4), { actorKey: "claude" });
      const b = (await ask({ workflow: "night-round", run_ref: "r1", node_id: "gate", ref: "b" }, min(5))).approval;
      await decideApproval(b.id, { action: "approve" }, ownerCaller, min(6));
      expect(rows("handoff")).toHaveLength(0);
      const c = (await ask({ workflow: "night-round", run_ref: "r1", node_id: "ghost", ref: "c" }, min(7))).approval;
      await expect(decideApproval(c.id, { action: "approve" }, ownerCaller, min(8))).resolves.toBeTruthy();
    });

    it("a request with no step (the old kind) works as it did", async () => {
      const a = (await ask()).approval;
      await expect(decideApproval(a.id, { action: "approve" }, ownerCaller, min(1))).resolves.toMatchObject({ status: "approved", runRef: null });
      expect(rows("handoff")).toHaveLength(0);
    });
  });
});

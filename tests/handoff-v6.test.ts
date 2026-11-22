/**
 * The queue after v6 P1-1 (docs/rebuild-v6/01-model.md §7): a request has an end, a taker has a lease and a code, the request goes to the job's own
 * agent, only that agent takes or answers it, and an answer does not turn a failure into a success.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_HANDOFF_KINDS,
  HANDOFF_KINDS,
  KIND_AR,
  MANUAL_EXPIRY_HOURS,
  actorOwnsAssignee,
  claimGate,
  completeGate,
  expiryFor,
  isExpired,
  leaseUntil,
  queueAssignee,
} from "@/core/handoff";
import { jobRow } from "./helpers/fake-db";
import { vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { HandoffComplete, HandoffRefused, cancelHandoff, claimHandoff, completeHandoff, createHandoff, endExpired, listHandoffs, reassignHandoff, requestRun } from "@/server/handoffs";
import { logRun } from "@/server/workflows";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

describe("the rules of the queue — pure", () => {
  it("a manual request ends 6 hours after it was asked; a scheduled one at its slot + graceMin", () => {
    expect(MANUAL_EXPIRY_HOURS).toBe(6);
    expect(expiryFor({ graceMin: 15, now: NOW })).toEqual(new Date("2026-11-22T16:00:00.000Z"));
    expect(expiryFor({ scheduledFor: new Date("2026-11-22T09:00:00Z"), graceMin: 20, now: NOW })).toEqual(new Date("2026-11-22T09:20:00.000Z"));
  });

  it("the lease is the moment plus maxRunMin", () => {
    expect(leaseUntil(NOW, 90)).toEqual(min(90));
  });

  it("only an open request whose time is up is expired", () => {
    expect(isExpired({ status: "open", expiresAt: min(-1) }, NOW)).toBe(true);
    expect(isExpired({ status: "open", expiresAt: NOW }, NOW)).toBe(true);
    expect(isExpired({ status: "open", expiresAt: min(1) }, NOW)).toBe(false);
    expect(isExpired({ status: "open", expiresAt: null }, NOW)).toBe(false);
    expect(isExpired({ status: "claimed", expiresAt: min(-100) }, NOW)).toBe(false);
  });

  it("a request goes to the job's agent; a job nobody is tied to, or one the site carries out, goes to Claude as it always did", () => {
    expect(queueAssignee("hermes")).toBe("hermes");
    expect(queueAssignee("muse")).toBe("muse");
    expect(queueAssignee("sara")).toBe("sara");
    expect(queueAssignee(null)).toBe("claude");
    expect(queueAssignee(undefined)).toBe("claude");
    expect(queueAssignee("site")).toBe("claude");
  });

  it("who is the assignee: the same key, or any Claude for any Claude; an untied token is Claude and nobody else", () => {
    expect(actorOwnsAssignee("claude", "claude")).toBe(true);
    expect(actorOwnsAssignee("claude", "claude_desktop")).toBe(true);
    expect(actorOwnsAssignee("hermes", "hermes")).toBe(true);
    expect(actorOwnsAssignee("hermes", "claude")).toBe(false);
    expect(actorOwnsAssignee("muse", "hermes")).toBe(false);
    expect(actorOwnsAssignee(null, "claude")).toBe(true);
    expect(actorOwnsAssignee(null, "hermes")).toBe(false);
    expect(actorOwnsAssignee("claude", "sara")).toBe(false);
  });

  it("taking: only the assignee (or the owner, signed in)", () => {
    expect(claimGate({ assignee: "hermes" }, { actorKey: "hermes" })).toEqual({ ok: true });
    expect(claimGate({ assignee: "hermes" }, { actorKey: "claude" })).toMatchObject({ ok: false, status: 403 });
    expect(claimGate({ assignee: "hermes" }, { actorKey: "claude", owner: true })).toEqual({ ok: true });
  });

  it("answering: with the right code, or as the assignee; a wrong code never, even from the assignee", () => {
    const hd = { assignee: "claude", claimNonce: "abc" };
    expect(completeGate(hd, { actorKey: "hermes", claim: "abc" })).toEqual({ ok: true });
    expect(completeGate(hd, { actorKey: "claude", claim: "zzz" })).toMatchObject({ ok: false, status: 403 });
    expect(completeGate(hd, { actorKey: "claude" })).toEqual({ ok: true });
    expect(completeGate(hd, { actorKey: "hermes" })).toMatchObject({ ok: false, status: 403 });
    expect(completeGate({ assignee: "claude", claimNonce: null }, { actorKey: "claude", claim: "x" })).toMatchObject({ ok: false });
    expect(completeGate(hd, { actorKey: null, owner: true })).toEqual({ ok: true });
  });

  it("«resume» is a kind of request with words — and an agent cannot open one itself", () => {
    expect(HANDOFF_KINDS).toContain("resume");
    expect(KIND_AR.resume).toBeTruthy();
    expect(AGENT_HANDOFF_KINDS).not.toContain("resume");
    expect(AGENT_HANDOFF_KINDS).toHaveLength(HANDOFF_KINDS.length - 1);
  });
});

describe("the queue, on a database", () => {
  const db = () => h.db;
  const table = (name: "handoff" | "workflowRun" | "workflow") => (db()[name] as unknown as { rows: Record<string, any>[] }).rows;
  const reset = () => {
    for (const t of Object.values(db())) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  };
  const owner = { type: "user" as const, id: "u1" };
  const agent = { type: "agent" as const, id: "mcp:Claude" };

  beforeEach(async () => {
    reset();
    await db().workflow.create({ data: jobRow("daily-check", ["read", "judge"], { graceMin: 10, maxRunMin: 60 }) });
    await db().workflow.create({ data: jobRow("hermes-requests", ["task", "hermes"], { assigneeKey: "hermes", executor: "hermes" }) });
  });

  describe("asking", () => {
    it("«شغّلها هلأ» is a run waiting in the queue, for the job's own agent, ending in 6 hours", async () => {
      const r = await requestRun("hermes-requests", owner, NOW);
      expect(r.created).toBe(true);
      expect(r.handoff).toMatchObject({ assignee: "hermes", status: "open", expiresAt: new Date("2026-11-22T16:00:00Z").toISOString() });
      const run = table("workflowRun")[0]!;
      expect(run).toMatchObject({ status: "queued", trigger: "manual", summary: "بانتظار هيرمز", doneBy: "owner" });
    });

    it("a job nobody is tied to goes to Claude, as before", async () => {
      await db().workflow.create({ data: jobRow("orphan", ["a"], { assigneeKey: null }) });
      expect((await requestRun("orphan", owner, NOW)).handoff.assignee).toBe("claude");
    });

    it("asking again says it was already asked, and since when", async () => {
      const first = await requestRun("daily-check", owner, NOW);
      const again = await requestRun("daily-check", owner, min(49));
      expect(again.created).toBe(false);
      expect(again.handoff.id).toBe(first.handoff.id);
      expect(again.since).toBe(NOW.toISOString());
      expect(again.handoff.waitingMin).toBeGreaterThanOrEqual(0);
    });

    it("after the time is up it is not «still open»: the old one ends, the run is «missed», and a new one is made", async () => {
      const first = await requestRun("daily-check", owner, NOW);
      const later = new Date(NOW.getTime() + 7 * 3_600_000);
      const again = await requestRun("daily-check", owner, later);
      expect(again.created).toBe(true);
      expect(again.handoff.id).not.toBe(first.handoff.id);
      const old = table("handoff").find((x) => x.id === first.handoff.id)!;
      expect(old).toMatchObject({ status: "cancelled", doneBy: "auto" });
      expect(table("workflowRun").find((x) => x.ref === old.runRef)).toMatchObject({ status: "missed", endReason: "missed" });
    });

    it("a request about a stuck step shows the run as waiting with the step handed over, and has no end of its own", async () => {
      const r = await createHandoff({ workflow: "daily-check", kind: "node_failed", node: "read", title: "فشلت", run_ref: "r9" }, agent, NOW);
      expect(r.handoff.expiresAt).toBeNull();
      expect(table("workflowRun")[0]).toMatchObject({ status: "waiting", ref: "r9" });
      expect(table("workflowRun")[0]!.nodeStates.read.status).toBe("handoff");
    });

    it("an agent's request never reopens a run that ended or that the owner cancelled", async () => {
      const wf = table("workflow")[0]!;
      const mk = async (ref: string, over: Record<string, unknown>) => { await db().workflowRun.create({ data: { workflowId: wf.id, ref, startedAt: NOW, ...over } }); };
      await mk("c1", { status: "skipped", endReason: "cancelled", finishedAt: min(1) });
      await mk("c2", { status: "ok", finishedAt: min(1) });
      await mk("c3", { status: "failed", finishedAt: min(1) });
      for (const ref of ["c1", "c2", "c3"]) {
        await expect(createHandoff({ workflow: "daily-check", kind: "node_failed", node: "read", title: "فشلت", run_ref: ref }, agent, min(2))).rejects.toMatchObject({ status: 409 });
      }
      expect(table("handoff")).toHaveLength(0);
      expect(table("workflowRun").find((x) => x.ref === "c1")).toMatchObject({ status: "skipped", endReason: "cancelled" });
      expect(table("workflowRun").find((x) => x.ref === "c2")).toMatchObject({ status: "ok", finishedAt: min(1) });
      // a run that is still going is fine, and so is a ref the site has not seen yet
      await mk("live", { status: "running" });
      await expect(createHandoff({ workflow: "daily-check", kind: "node_failed", node: "read", title: "فشلت", run_ref: "live" }, agent, min(2))).resolves.toMatchObject({ created: true });
    });

    it("a scheduled request ends at its slot + graceMin", async () => {
      const slot = new Date("2026-11-22T09:30:00Z");
      const r = await createHandoff({ workflow: "daily-check", kind: "manual_run", title: "t" }, owner, NOW, { scheduledFor: slot });
      expect(r.handoff).toMatchObject({ scheduledFor: slot.toISOString(), expiresAt: new Date("2026-11-22T09:40:00Z").toISOString() });
      expect(table("workflowRun")[0]!.scheduledFor).toEqual(slot);
    });

    it("endExpired ends only what is open and late", async () => {
      await requestRun("daily-check", owner, NOW);
      expect(await endExpired(min(10))).toBe(0);
      expect(await endExpired(new Date(NOW.getTime() + 7 * 3_600_000))).toBe(1);
      expect(await endExpired(new Date(NOW.getTime() + 8 * 3_600_000))).toBe(0);
    });

    it("what is offered to an agent: not a request whose time is up", async () => {
      await requestRun("daily-check", owner, NOW);
      expect(await listHandoffs({ assignee: "claude" }, min(10))).toHaveLength(1);
      expect(await listHandoffs({ assignee: "claude" }, new Date(NOW.getTime() + 7 * 3_600_000))).toHaveLength(0);
    });

    it("the default list is the requests of one agent: Claude sees Claude's, Hermes sees Hermes's", async () => {
      await requestRun("daily-check", owner, NOW);
      await requestRun("hermes-requests", owner, NOW);
      expect((await listHandoffs({ assignee: "claude" })).map((x) => x.workflowKey)).toEqual(["daily-check"]);
      expect((await listHandoffs({ assignee: "hermes" })).map((x) => x.workflowKey)).toEqual(["hermes-requests"]);
    });
  });

  describe("taking", () => {
    it("gives the taker a code and a lease, moves the run to running, and the step shows who has it", async () => {
      const { handoff } = await createHandoff({ workflow: "daily-check", kind: "node_failed", node: "read", title: "فشلت", run_ref: "r9" }, agent, NOW);
      const r = await claimHandoff(handoff.id, "Claude", agent, min(2), { actorKey: "claude" });
      expect(r.claim).toMatch(/^[A-Za-z0-9_-]{10,}$/);
      expect(r.handoff).toMatchObject({ status: "claimed", claimedBy: "Claude", leaseUntil: min(62).toISOString() });
      expect(JSON.stringify(r.handoff)).not.toContain(r.claim);
      const run = table("workflowRun")[0]!;
      expect(run.status).toBe("running");
      expect(run.nodeStates.read).toMatchObject({ status: "running", note: "عند Claude" });
    });

    it("a queued run starts when it is taken: startedAt is the taking", async () => {
      const { handoff } = await requestRun("daily-check", owner, NOW);
      await claimHandoff(handoff.id, "Claude", agent, min(12), { actorKey: "claude" });
      expect(table("workflowRun")[0]).toMatchObject({ status: "running", startedAt: min(12) });
    });

    it("a second session with the same token name is told somebody took it (it used to be let in)", async () => {
      const { handoff } = await requestRun("daily-check", owner, NOW);
      await claimHandoff(handoff.id, "Claude", agent, min(1), { actorKey: "claude" });
      await expect(claimHandoff(handoff.id, "Claude", agent, min(2), { actorKey: "claude" })).rejects.toMatchObject({ status: 409 });
    });

    it("only the one it was given to may take it", async () => {
      const { handoff } = await requestRun("hermes-requests", owner, NOW);
      await expect(claimHandoff(handoff.id, "Claude", agent, min(1), { actorKey: "claude" })).rejects.toMatchObject({ status: 403 });
      await expect(claimHandoff(handoff.id, "Muse", agent, min(1), { actorKey: "muse" })).rejects.toMatchObject({ status: 403 });
      expect(table("handoff")[0]!.status).toBe("open");
      await expect(claimHandoff(handoff.id, "Hermes", agent, min(1), { actorKey: "hermes" })).resolves.toMatchObject({ handoff: { status: "claimed" } });
    });

    it("the owner may take it for anyone", async () => {
      const { handoff } = await requestRun("hermes-requests", owner, NOW);
      await expect(claimHandoff(handoff.id, "owner", owner, min(1), { owner: true })).resolves.toBeTruthy();
    });

    it("a request whose time is up cannot be taken", async () => {
      const { handoff } = await requestRun("daily-check", owner, NOW);
      const e = await claimHandoff(handoff.id, "Claude", agent, new Date(NOW.getTime() + 7 * 3_600_000), { actorKey: "claude" }).catch((x) => x);
      expect(e).toBeInstanceOf(HandoffRefused);
      expect(e.status).toBe(409);
      expect(table("handoff")[0]!.status).toBe("cancelled");
    });

    it("a token tied to nobody (an old one) is Claude", async () => {
      const { handoff } = await requestRun("daily-check", owner, NOW);
      await expect(claimHandoff(handoff.id, "old", agent, min(1), { actorKey: null })).resolves.toBeTruthy();
    });

    it("giving it to someone else voids the old taker's code and lease", async () => {
      const { handoff } = await requestRun("daily-check", owner, NOW);
      await claimHandoff(handoff.id, "Claude", agent, min(1), { actorKey: "claude" });
      const back = await reassignHandoff(handoff.id, "hermes", owner);
      expect(back).toMatchObject({ status: "open", assignee: "hermes", claimedBy: null, leaseUntil: null });
      expect(table("handoff")[0]!.claimNonce).toBeNull();
    });
  });

  describe("answering", () => {
    const taken = async (key = "daily-check", actorKey = "claude") => {
      const { handoff } = await requestRun(key, owner, NOW);
      const c = await claimHandoff(handoff.id, "Claude", agent, min(1), { actorKey });
      return { id: handoff.id, claim: c.claim };
    };

    it("needs the code, or to be the one it was given to — never a wrong code", async () => {
      const { id, claim } = await taken();
      await expect(completeHandoff(id, { claim: "wrong" }, "Claude", agent, min(5), { actorKey: "claude" })).rejects.toMatchObject({ status: 403 });
      await expect(completeHandoff(id, {}, "Hermes", agent, min(5), { actorKey: "hermes" })).rejects.toMatchObject({ status: 403 });
      expect(table("handoff")[0]!.status).toBe("claimed");
      await expect(completeHandoff(id, { claim }, "Hermes", agent, min(5), { actorKey: "hermes" })).resolves.toBeTruthy();
    });

    it("a run the owner asked for ends ok with the answer (no failed step), with the step done", async () => {
      const { id, claim } = await taken();
      const r = await completeHandoff(id, { claim, note: "تم", result: { checked: 12 } }, "Claude", agent, min(5), { actorKey: "claude" });
      expect(r.run).toMatchObject({ status: "ok", summary: "تم", metrics: { checked: 12 } });
      expect(table("handoff")[0]).toMatchObject({ status: "done", doneBy: "Claude" });
    });

    it("answering does not turn a failure into a success: a run that failed stays failed, and its summary and numbers stay", async () => {
      const { id, claim } = await taken();
      await logRun({ job: "daily-check", ref: table("handoff")[0]!.runRef, status: "failed", summary: "الرصيد خلص", metrics: { spend: 5 }, node: { id: "read", status: "failed", error: "x" } }, agent, "mcp", min(3), { actorKey: "claude" });
      // the end of the run closed the request («doneBy: auto»): the answer may still leave its note
      const r = await completeHandoff(id, { claim, note: "شكراً" }, "Claude", agent, min(5), { actorKey: "claude" });
      expect(r.run).toBeNull();
      const run = table("workflowRun")[0]!;
      expect(run).toMatchObject({ status: "failed", summary: "الرصيد خلص", metrics: { spend: 5 } });
      expect(run.nodeStates.read.status).toBe("failed");
      expect(table("handoff")[0]).toMatchObject({ status: "done", doneBy: "Claude", resultNote: "شكراً" });
    });

    it("without a word a still-running run with a failed step is not declared a success", async () => {
      const { id, claim } = await taken();
      const ref = table("handoff")[0]!.runRef;
      await logRun({ job: "daily-check", ref, node: { id: "read", status: "failed", error: "x" } }, agent, "mcp", min(3), { actorKey: "claude" });
      expect(table("workflowRun")[0]!.status).toBe("running");
      const r = await completeHandoff(id, { claim }, "Claude", agent, min(5), { actorKey: "claude" });
      expect(r.run!.status).toBe("running");
      expect(r.run!.nodeStates.read!.status).toBe("failed");
    });

    it("its own word is honoured: failed", async () => {
      const { id, claim } = await taken();
      const r = await completeHandoff(id, { claim, run_status: "failed", note: "ما زبطت" }, "Claude", agent, min(5), { actorKey: "claude" });
      expect(r.run).toMatchObject({ status: "failed" });
      expect(r.run!.nodeStates.read!.status).toBe("failed");
    });

    it("a stuck step only unblocks the run: it goes on as running", async () => {
      const { handoff } = await createHandoff({ workflow: "daily-check", kind: "needs_input", node: "read", title: "بدها جواب", run_ref: "r9" }, agent, NOW);
      const c = await claimHandoff(handoff.id, "Claude", agent, min(1), { actorKey: "claude" });
      const r = await completeHandoff(handoff.id, { claim: c.claim, note: "جاوبت" }, "Claude", agent, min(4), { actorKey: "claude" });
      expect(r.run).toMatchObject({ status: "running", summary: "جاوبت" });
      expect(r.run!.nodeStates.read!.status).toBe("done");
    });

    it("the owner may mark one done by hand", async () => {
      const { handoff } = await requestRun("hermes-requests", owner, NOW);
      const r = await completeHandoff(handoff.id, { note: "خلصتها بإيدي" }, "owner:u1", owner, min(3), { owner: true });
      expect(r.handoff.status).toBe("done");
      expect(r.run!.status).toBe("ok");
    });

    it("customer data in the answer is refused and nothing moves", async () => {
      const { id, claim } = await taken();
      await expect(completeHandoff(id, { claim, note: "اتصلت بـ 0791234567" }, "Claude", agent, min(5), { actorKey: "claude" })).rejects.toBeInstanceOf(HandoffRefused);
      expect(table("handoff")[0]!.status).toBe("claimed");
    });

    it("the answer's schema takes the claim code, and says what the missing run_status means", () => {
      expect(HandoffComplete.safeParse({ claim: "abc", run_status: "ok" }).success).toBe(true);
      expect(HandoffComplete.safeParse({ claim: "" }).success).toBe(false);
    });
  });

  describe("dropping", () => {
    it("the owner drops it: the run is skipped, cancelled, so the agent is told to stop", async () => {
      const { handoff } = await requestRun("daily-check", owner, NOW);
      await cancelHandoff(handoff.id, owner, min(3));
      expect(table("workflowRun")[0]).toMatchObject({ status: "skipped", endReason: "cancelled", summary: "الغاها المالك" });
      const r = await logRun({ job: "daily-check", ref: table("handoff")[0]!.runRef, node: { id: "read", status: "done" } }, agent, "mcp", min(4), { actorKey: "claude" });
      expect(r.stop).toBe(true);
    });
  });
});

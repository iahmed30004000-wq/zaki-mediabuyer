/**
 * The watchdog carrying out its plan (docs/rebuild-v6/01-model.md §6): a slot nothing answered becomes a run «missed» and ONE notification, a run that went
 * silent becomes «lost», a request that was taken and dropped is open again, a request nobody took ends — and a second pass, or a second worker, finds
 * nothing left to do. The database is the in-memory stand-in of tests/helpers/fake-db.ts (the real one was used for the same flows by hand: see
 * docs/rebuild-v6/NOTES.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb>, exec: vi.fn() }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test", omsLinked: () => false }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async () => undefined, telegramFromEnv: () => null }));
vi.mock("@/server/step-exec", async (orig) => ({ ...(await orig<typeof import("@/server/step-exec")>()), executeWorkflow: (...a: unknown[]) => h.exec(...a) }));

import { WATCHDOG_SINCE_KEY, WATCHDOG_TICK_KEY } from "@/core/health";
import { applyWatch, loadSnapshot, runWatchdog, watchPlan } from "@/jobs/watchdog";
import { ExecRefused } from "@/server/step-exec";

type Rows = Record<string, any>[];
const rows = (name: "workflow" | "workflowRun" | "handoff" | "notification" | "approval" | "setting" | "actor"): Rows => (h.db[name] as unknown as { rows: Rows }).rows;
const Z = (hh: number, mm = 0) => new Date(Date.UTC(2026, 10, 22, hh, mm));
const OLD = new Date(Date.UTC(2026, 10, 1));
const SLOT = "2026-11-22T07:00:00.000Z";

async function setSince(at: Date) {
  await h.db.setting.create({ data: { key: WATCHDOG_SINCE_KEY, value: { at: at.toISOString() } } });
}
async function addJob(key: string, extra: Record<string, unknown> = {}) {
  // 10:00 Amman = 07:00Z
  return h.db.workflow.create({ data: { ...jobRow(key, ["read", "judge"]), schedule: "0 10 * * *", createdAt: OLD, ...extra } });
}

describe("the watchdog", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    h.db.lock.held = false;
    h.exec.mockReset();
    await setSince(OLD);
    await h.db.actor.create({ data: { key: "claude", name: "Claude الرئيسي" } });
  });

  describe("«فاتت»", () => {
    it("writes the missed run and ONE notification, and a second pass writes nothing", async () => {
      await addJob("daily");
      const first = await runWatchdog(Z(7, 20));
      expect(first.planned).toEqual({ miss: 1 });
      expect(first.applied).toEqual({ miss: 1 });
      expect(rows("workflowRun")).toHaveLength(1);
      expect(rows("workflowRun")[0]).toMatchObject({ ref: `slot-${SLOT}`, status: "missed", endReason: "missed", trigger: "schedule", doneBy: "site" });
      expect(rows("workflowRun")[0]!.scheduledFor.toISOString()).toBe(SLOT);
      expect(rows("workflowRun")[0]!.startedAt.toISOString()).toBe(SLOT);
      const n = rows("notification");
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ source: "workflow", audience: "owner", urgency: "orange", key: `run.missed:${rows("workflowRun")[0]!.id}`, href: "/work/job/daily" });
      expect(n[0]!.title).toContain("مهمة daily");
      expect(n[0]!.title).toContain("فاتت");
      expect(n[0]!.title.length).toBeLessThanOrEqual(45);
      expect(n[0]!.body).toContain("Claude الرئيسي");

      for (const min of [21, 22, 60, 300]) {
        const again = await runWatchdog(Z(7, min > 100 ? 59 : min));
        expect(again.applied).toEqual({});
      }
      expect(rows("workflowRun")).toHaveLength(1);
      expect(rows("notification")).toHaveLength(1);
    });

    it("two passes at the same moment (two workers that both planned it) still write one run", async () => {
      await addJob("daily");
      const snap = await loadSnapshot(Z(7, 20));
      const plan = watchPlan(snap, Z(7, 20));
      const [a, b] = await Promise.all([applyWatch(plan, Z(7, 20)), applyWatch(plan, Z(7, 20))]);
      expect(rows("workflowRun")).toHaveLength(1);
      expect(rows("notification")).toHaveLength(1);
      expect((a.applied.miss ?? 0) + (b.applied.miss ?? 0)).toBeGreaterThanOrEqual(1);
    });

    it("a job that does not want «missed» in notifyOn gets the run, and the owner gets no row", async () => {
      await addJob("quiet", { notifyOn: ["failed"] });
      await runWatchdog(Z(7, 20));
      expect(rows("workflowRun")).toHaveLength(1);
      expect(rows("notification")).toHaveLength(0);
    });

    it("nothing is missed before the first time the watchdog ran: the first pass writes its own start and no storm", async () => {
      rows("setting").length = 0;
      await addJob("daily");
      const first = await runWatchdog(Z(7, 20));
      expect(first.planned).toEqual({});
      expect(rows("workflowRun")).toHaveLength(0);
      expect(rows("setting").find((s) => s.key === WATCHDOG_SINCE_KEY)!.value.at).toBe(Z(7, 20).toISOString());
      // the start never moves
      await runWatchdog(Z(9, 0));
      expect(rows("setting").find((s) => s.key === WATCHDOG_SINCE_KEY)!.value.at).toBe(Z(7, 20).toISOString());
    });

    it("a run that came on time answers the slot: no miss, and the job in a day line is not «فات»", async () => {
      const wf = await addJob("daily");
      await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "r1", status: "ok", startedAt: Z(7, 2), scheduledFor: Z(7, 0), finishedAt: Z(7, 5) } });
      expect((await runWatchdog(Z(7, 40))).planned).toEqual({});
    });
  });

  describe("the heartbeat", () => {
    it("every pass writes one row, in place, and nothing else when nothing is due", async () => {
      await addJob("daily", { schedule: null });
      await runWatchdog(Z(8, 0));
      await runWatchdog(Z(8, 1));
      await runWatchdog(Z(8, 2));
      const ticks = rows("setting").filter((s) => s.key === WATCHDOG_TICK_KEY);
      expect(ticks).toHaveLength(1);
      expect(ticks[0]!.value.at).toBe(Z(8, 2).toISOString());
      expect(rows("workflowRun")).toHaveLength(0);
      expect(rows("notification")).toHaveLength(0);
    });

    it("while another worker holds the lock this pass does nothing at all, and says so", async () => {
      await addJob("daily");
      h.db.lock.held = true;
      const r = await runWatchdog(Z(7, 20));
      expect(r.locked).toBe(true);
      expect(rows("workflowRun")).toHaveLength(0);
      expect(rows("setting").find((s) => s.key === WATCHDOG_TICK_KEY)!.value.locked).toBe(true);
      h.db.lock.held = false;
      expect((await runWatchdog(Z(7, 21))).applied).toEqual({ miss: 1 });
    });
  });

  describe("«انقطعت»", () => {
    async function runningRun(extra: Record<string, unknown> = {}, wfExtra: Record<string, unknown> = {}) {
      const wf = await addJob("long", { schedule: null, ...wfExtra });
      return h.db.workflowRun.create({
        data: {
          workflowId: wf.id,
          ref: "r1",
          status: "running",
          startedAt: Z(5, 0),
          heartbeatAt: Z(5, 10),
          doneBy: "claude",
          nodeStates: { read: { status: "done", at: Z(5, 5).toISOString() }, judge: { status: "running", at: Z(5, 10).toISOString(), startedAt: Z(5, 10).toISOString() } },
          ...extra,
        },
      });
    }

    it("closes a run whose last word is older than maxRunMin: lost, the step that was running failed with who went quiet, one notification", async () => {
      const r = await runningRun();
      const out = await runWatchdog(Z(6, 41)); // 91 minutes after 05:10
      expect(out.applied).toEqual({ lose: 1 });
      const run = rows("workflowRun")[0]!;
      expect(run).toMatchObject({ id: r.id, status: "lost", endReason: "lost" });
      expect(run.finishedAt).toEqual(Z(6, 41));
      expect(run.nodeStates.judge).toMatchObject({ status: "failed", error: "انقطع الخبر من Claude الرئيسي", inferred: true });
      expect(run.nodeStates.read.status).toBe("done");
      const n = rows("notification");
      expect(n).toHaveLength(1);
      expect(n[0]).toMatchObject({ key: `run.lost:${r.id}`, urgency: "orange" });
      expect(n[0]!.body).toContain("Claude الرئيسي");
      expect((await runWatchdog(Z(6, 42))).applied).toEqual({});
      expect(rows("notification")).toHaveLength(1);
    });

    it("a heartbeat that came in between is not overwritten (the conditional write finds the run alive)", async () => {
      const r = await runningRun();
      const snap = await loadSnapshot(Z(6, 41));
      const plan = watchPlan(snap, Z(6, 41));
      expect(plan).toEqual([{ type: "lose", runId: r.id }]);
      await h.db.workflowRun.updateMany({ where: { id: r.id }, data: { heartbeatAt: Z(6, 40) } });
      const done = await applyWatch(plan, Z(6, 41));
      expect(done.applied).toEqual({});
      expect(done.skipped).toBe(1);
      expect(rows("workflowRun")[0]!.status).toBe("running");
    });

    it("a request the silent one had taken is open again for a new taker, who has the grace to come", async () => {
      await runningRun();
      await h.db.handoff.create({ data: { workflowKey: "long", runRef: "r1", kind: "manual_run", title: "x", status: "claimed", claimedBy: "Claude", claimedAt: Z(5, 0), claimNonce: "n1", leaseUntil: Z(6, 40), assignee: "claude", expiresAt: Z(5, 15) } });
      const out = await runWatchdog(Z(6, 41));
      expect(out.applied).toMatchObject({ lose: 1, reopen_handoff: 1 });
      const hd = rows("handoff")[0]!;
      expect(hd).toMatchObject({ status: "open", claimedBy: null, claimNonce: null, leaseUntil: null });
      expect(hd.expiresAt).toEqual(Z(6, 56));
    });

    it("a job the site runs itself has nobody to wait for: the run failed, and the notification says failed", async () => {
      await runningRun({ doneBy: "site" }, { wake: "site_run" });
      const out = await runWatchdog(Z(6, 41));
      expect(out.applied).toEqual({ lose: 1 });
      expect(rows("workflowRun")[0]).toMatchObject({ status: "failed", endReason: "error" });
      expect(rows("notification")[0]!.key).toMatch(/^run\.failed:/);
    });

    it("a run with a fresh heartbeat is left alone", async () => {
      await runningRun({ heartbeatAt: Z(6, 30) });
      expect((await runWatchdog(Z(6, 41))).planned).toEqual({});
    });
  });

  describe("a job the site wakes (wake = site)", () => {
    it("asks for the run when the slot comes: a queued run for that slot and a request that ends at slot + graceMin — once", async () => {
      await addJob("asked", { wake: "site", assigneeKey: "hermes" });
      const out = await runWatchdog(Z(7, 1));
      expect(out.applied).toEqual({ fire: 1 });
      const run = rows("workflowRun")[0]!;
      expect(run).toMatchObject({ ref: `slot-${SLOT}`, status: "queued", trigger: "schedule" });
      expect(run.scheduledFor.toISOString()).toBe(SLOT);
      const hd = rows("handoff")[0]!;
      expect(hd).toMatchObject({ workflowKey: "asked", runRef: `slot-${SLOT}`, kind: "manual_run", assignee: "hermes", status: "open" });
      expect(hd.expiresAt.toISOString()).toBe("2026-11-22T07:15:00.000Z");
      expect(hd.scheduledFor.toISOString()).toBe(SLOT);
      expect(hd.title).toContain("10:00");
      for (const min of [2, 3, 10]) expect((await runWatchdog(Z(7, min))).applied).toEqual({});
      expect(rows("workflowRun")).toHaveLength(1);
      expect(rows("handoff")).toHaveLength(1);
    });

    it("nobody took it by the end: the request ends, the run is missed, and the owner is told once", async () => {
      await addJob("asked", { wake: "site" });
      await runWatchdog(Z(7, 1));
      expect((await runWatchdog(Z(7, 14))).applied).toEqual({});
      const out = await runWatchdog(Z(7, 16));
      expect(out.applied).toMatchObject({ expire_handoff: 1 });
      expect(rows("handoff")[0]).toMatchObject({ status: "cancelled", doneBy: "auto" });
      expect(rows("workflowRun")[0]).toMatchObject({ status: "missed", endReason: "missed" });
      expect(rows("notification").filter((x) => x.key.startsWith("run.missed:"))).toHaveLength(1);
      expect((await runWatchdog(Z(7, 17))).applied).toEqual({});
    });

    it("a request whose run ended is closed (the agent logged the end without answering)", async () => {
      await addJob("asked", { wake: "site" });
      await runWatchdog(Z(7, 1));
      await h.db.workflowRun.updateMany({ where: { ref: `slot-${SLOT}` }, data: { status: "ok", finishedAt: Z(7, 5) } });
      const out = await runWatchdog(Z(7, 6));
      expect(out.applied).toEqual({ close_handoff: 1 });
      expect(rows("handoff")[0]).toMatchObject({ status: "done", doneBy: "auto" });
    });

    it("a job the site runs: its own steps run from the clock with the slot's ref; with none to run, it asks the agent as a press of «شغّلها هلأ» would", async () => {
      await addJob("recipe", { wake: "site_run", assigneeKey: "site" });
      h.exec.mockResolvedValueOnce({ ref: `slot-${SLOT}`, status: "ok", ran: [] });
      const ran = await runWatchdog(Z(7, 1));
      expect(ran.applied).toEqual({ fire: 1 });
      expect(h.exec).toHaveBeenCalledTimes(1);
      expect(h.exec.mock.calls[0]![0]).toBe("recipe");
      expect(h.exec.mock.calls[0]![3]).toMatchObject({ ref: `slot-${SLOT}`, trigger: "schedule" });
      expect(h.exec.mock.calls[0]![3].scheduledFor.toISOString()).toBe(SLOT);
      expect(rows("handoff")).toHaveLength(0);

      h.exec.mockReset();
      h.exec.mockRejectedValueOnce(new ExecRefused("ما في خطوة بينفّذها الموقع هون", 400));
      const asked = await runWatchdog(Z(7, 2));
      expect(asked.applied).toEqual({ fire: 1 });
      expect(rows("handoff")).toHaveLength(1);
      expect(rows("handoff")[0]).toMatchObject({ assignee: "claude", runRef: `slot-${SLOT}` });
      expect(rows("workflowRun").find((r) => r.ref === `slot-${SLOT}`)!.status).toBe("queued");
    });
  });

  describe("stuck", () => {
    it("a run that waits more than 30 minutes is told once, whatever number of passes come after", async () => {
      const wf = await addJob("w", { schedule: null });
      await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "r1", status: "waiting", startedAt: Z(8, 0), nodeStates: {} } });
      rows("workflowRun")[0]!.updatedAt = Z(8, 0);
      expect((await runWatchdog(Z(8, 30))).planned).toEqual({});
      const first = await runWatchdog(Z(8, 41));
      expect(first.applied).toEqual({ stuck: 1 });
      for (const min of [42, 43, 90]) expect((await runWatchdog(Z(8, min > 59 ? 59 : min))).applied).toEqual({});
      const n = rows("notification");
      expect(n).toHaveLength(1);
      expect(n[0]!.key).toBe(`run.stuck:${rows("workflowRun")[0]!.id}`);
      expect(n[0]!.title).toContain("واقفة");
    });

    it("a manual request nobody took says «ما حدا استلمها»", async () => {
      const wf = await addJob("m", { schedule: null });
      await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "manual-1", status: "queued", trigger: "manual", startedAt: Z(8, 0), nodeStates: {} } });
      await h.db.handoff.create({ data: { workflowKey: "m", runRef: "manual-1", kind: "manual_run", title: "x", assignee: "claude", expiresAt: Z(14, 0) } });
      await runWatchdog(Z(8, 20));
      const n = rows("notification");
      expect(n).toHaveLength(1);
      expect(n[0]!.title).toContain("ما حدا استلمها");
    });
  });

  describe("a one-off and a window", () => {
    it("a one-off that ran is finished, once", async () => {
      const wf = await addJob("once", { kind: "once", schedule: null, runsAt: Z(7, 0), createdAt: Z(5, 0) });
      await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "r1", status: "ok", startedAt: Z(7, 2), finishedAt: Z(7, 9) } });
      const out = await runWatchdog(Z(7, 30));
      expect(out.applied).toEqual({ finish_job: 1 });
      expect(rows("workflow").find((w) => w.key === "once")!.finishedAt).toEqual(Z(7, 30));
      expect((await runWatchdog(Z(7, 31))).applied).toEqual({});
    });

    it("a one-off that never ran is missed at its moment (the old watcher never looked at it)", async () => {
      await addJob("once", { kind: "once", schedule: null, runsAt: Z(7, 0), createdAt: Z(5, 0) });
      expect((await runWatchdog(Z(7, 20))).applied).toEqual({ miss: 1 });
      expect(rows("workflow").find((w) => w.key === "once")!.finishedAt).toBeNull();
    });

    it("a window past its end is finished and no longer expected", async () => {
      await addJob("win", { kind: "window", schedule: "0 * * * *", endsAt: Z(7, 0), createdAt: Z(5, 30) });
      const out = await runWatchdog(Z(8, 30));
      expect(out.applied.finish_job).toBe(1);
      expect(rows("workflow").find((w) => w.key === "win")!.finishedAt).toEqual(Z(8, 30));
      const slots = rows("workflowRun").map((r) => r.scheduledFor.toISOString());
      expect(slots.every((s) => Date.parse(s) <= Z(7, 0).getTime())).toBe(true);
    });
  });

  describe("the owner's decisions", () => {
    it("one that ran out expires; a postponed one that is still asleep does not", async () => {
      await h.db.approval.create({ data: { title: "a", why: "w", status: "pending", expiresAt: Z(8, 0) } });
      await h.db.approval.create({ data: { title: "b", why: "w", status: "postponed", postponedUntil: Z(12, 0), expiresAt: Z(8, 0) } });
      const out = await runWatchdog(Z(9, 0));
      expect(out.applied).toEqual({ expire_approval: 1 });
      expect(rows("approval").map((a) => a.status)).toEqual(["expired", "postponed"]);
    });
  });

  it("one action that fails does not stop the rest of the plan", async () => {
    await addJob("a");
    await addJob("b");
    const snap = await loadSnapshot(Z(7, 20));
    const plan = watchPlan(snap, Z(7, 20));
    expect(plan).toHaveLength(2);
    const spy = vi.spyOn(h.db.workflowRun, "findUnique").mockRejectedValueOnce(new Error("boom"));
    const out = await applyWatch(plan, Z(7, 20));
    spy.mockRestore();
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toContain("boom");
    expect(out.applied.miss).toBe(1);
  });
});

/**
 * The events of the engine (docs/rebuild-v6/01-model.md §10): one `Notification` row per event with a key that makes it unique, the title in 45 characters,
 * only for what the job wants to hear (`notifyOn`) — and `log_run` ties a new run to the slot it answers (W-16). Sending is the dispatcher's (P7): nothing
 * here sends.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT_KINDS, NOTIFY_FLAG, RUN_EVENTS, TITLE_MAX, runEventRow, titleOf, wantsEvent } from "@/core/events";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb>, sent: [] as string[] }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test", omsLinked: () => false }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async (_: unknown, text: string) => void h.sent.push(text), telegramFromEnv: () => ({ token: "t", chatId: "1" }) }));

import { emit } from "@/server/events";
import { logRun } from "@/server/workflows";

type Rows = Record<string, any>[];
const rows = (name: "workflowRun" | "notification"): Rows => (h.db[name] as unknown as { rows: Rows }).rows;
const agent = { type: "agent" as const, id: "mcp:Claude" };
const NOW = new Date("2026-11-22T10:00:00.000Z");

describe("the rows — pure", () => {
  it("the events the engine knows, and what switches each one on", () => {
    expect(RUN_EVENTS).toEqual(["run.missed", "run.lost", "run.stuck", "run.failed", "run.done"]);
    expect(EVENT_KINDS).toEqual(expect.arrayContaining([...RUN_EVENTS, "approval.new", "stock.red", "stock.orange", "report.morning", "agent.silent", "backup.failed", "worker.down", "sync.failed"]));
    expect(NOTIFY_FLAG).toEqual({ "run.missed": "missed", "run.lost": "failed", "run.stuck": "stuck", "run.failed": "failed", "run.done": "done" });
  });

  it("the defaults: missed, stuck and failed are on; done only for a job that asks; the owner may take one off", () => {
    const def = ["missed", "stuck", "failed"];
    expect(wantsEvent("run.missed", def)).toBe(true);
    expect(wantsEvent("run.lost", def)).toBe(true);
    expect(wantsEvent("run.done", def)).toBe(false);
    expect(wantsEvent("run.done", [...def, "done"])).toBe(true);
    expect(wantsEvent("run.stuck", ["missed", "failed"])).toBe(false);
    expect(wantsEvent("run.missed", null)).toBe(true);
    expect(wantsEvent("run.done", undefined)).toBe(false);
  });

  it("a title starts with the thing itself and is 45 characters at most: the name gives way, the verb never does", () => {
    expect(TITLE_MAX).toBe(45);
    const long = "اسم مهمة طويل كتير كتير كتير كتير كتير كتير كتير كتير كتير";
    for (const kind of RUN_EVENTS) {
      const r = runEventRow({ kind, runId: "r1", jobKey: "k", jobName: long, scheduledFor: new Date("2026-11-22T07:00:00Z"), minutes: 95, who: "Claude الرئيسي", queued: kind === "run.stuck" });
      expect(r.title.length, kind).toBeLessThanOrEqual(45);
      expect(r.key).toBe(`${kind}:r1`);
      expect(r.href).toBe("/tasks/k");
    }
    expect(titleOf("جولة الليل", "فاتت 10:00")).toBe("جولة الليل فاتت 10:00");
    expect(titleOf("جولة الليل", "فاتت").endsWith("فاتت")).toBe(true);
  });

  it("each event says what it is, in the owner's words, with the clock of Amman, and never more than the job's name and a count", () => {
    const base = { runId: "r1", jobKey: "night", jobName: "جولة الليل", who: "Claude الرئيسي" };
    const missed = runEventRow({ ...base, kind: "run.missed", scheduledFor: new Date("2026-11-22T11:00:00Z") });
    expect(missed.title).toBe("جولة الليل فاتت 14:00");
    expect(missed.urgency).toBe("orange");
    expect(missed.body).toContain("Claude الرئيسي ما بدأ");
    expect(runEventRow({ ...base, kind: "run.lost", minutes: 95 }).title).toBe("جولة الليل انقطعت");
    expect(runEventRow({ ...base, kind: "run.lost", minutes: 95 }).body).toContain("من ساعتين");
    expect(runEventRow({ ...base, kind: "run.stuck", minutes: 40 }).title).toBe("جولة الليل واقفة");
    expect(runEventRow({ ...base, kind: "run.stuck", minutes: 40, queued: true }).title).toBe("جولة الليل ما حدا استلمها");
    const failed = runEventRow({ ...base, kind: "run.failed", detail: "ما قدرنا نقرا المخزون" });
    expect(failed.body).toContain("ما قدرنا نقرا المخزون");
    const done = runEventRow({ ...base, kind: "run.done" });
    expect(done.urgency).toBe("yellow");
  });
});

describe("emit", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    h.sent.length = 0;
  });

  it("writes one row, the same event twice is one row, and nothing is sent", async () => {
    const f = { kind: "run.missed" as const, runId: "r9", jobKey: "k", jobName: "ن" };
    expect(await emit(f, ["missed"])).toEqual({ written: true });
    expect(await emit(f, ["missed"])).toEqual({ written: false, skipped: "exists" });
    expect(rows("notification")).toHaveLength(1);
    expect(rows("notification")[0]).toMatchObject({ source: "workflow", audience: "owner", key: "run.missed:r9", sentAt: null });
    expect(h.sent).toEqual([]);
  });

  it("writes nothing for an event the job does not want", async () => {
    expect(await emit({ kind: "run.done", runId: "r", jobKey: "k", jobName: "ن" }, ["missed"])).toEqual({ written: false, skipped: "not_wanted" });
    expect(rows("notification")).toHaveLength(0);
  });

  it("never throws: a notice that could not be written does not fail the work that raised it", async () => {
    const spy = vi.spyOn(h.db.notification, "create").mockRejectedValueOnce(new Error("db down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await emit({ kind: "run.missed", runId: "r", jobKey: "k", jobName: "ن" }, ["missed"])).toEqual({ written: false, skipped: "failed" });
    spy.mockRestore();
    quiet.mockRestore();
  });
});

describe("log_run and the events", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: jobRow("daily-check", ["read", "judge"], { schedule: "0 10 * * *", name: "الفحص اليومي" }) });
  });

  it("a run that ends failed tells the owner once, with the step that failed", async () => {
    await logRun({ job: "daily-check", ref: "r1", status: "running" }, agent, "mcp", NOW);
    await logRun({ job: "daily-check", ref: "r1", node: { id: "read", status: "failed", error: "ما قدرنا نقرا المخزون" } }, agent, "mcp", NOW);
    expect(rows("notification")).toHaveLength(0);
    const run = await logRun({ job: "daily-check", ref: "r1", status: "failed", summary: "وقفت" }, agent, "mcp", NOW);
    const n = rows("notification");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ key: `run.failed:${run.run.id}`, urgency: "orange" });
    expect(n[0]!.title).toBe("الفحص اليومي فشلت");
    expect(n[0]!.body).toContain("ما قدرنا نقرا المخزون");
    // the same word again is not a new event
    await logRun({ job: "daily-check", ref: "r1", status: "failed" }, agent, "mcp", NOW);
    expect(rows("notification")).toHaveLength(1);
  });

  it("a run that ends well is told only to a job that asks for it", async () => {
    await logRun({ job: "daily-check", ref: "r1", status: "ok" }, agent, "mcp", NOW);
    expect(rows("notification")).toHaveLength(0);
    await h.db.workflow.updateMany({ where: { key: "daily-check" }, data: { notifyOn: ["missed", "stuck", "failed", "done"] } });
    await logRun({ job: "daily-check", ref: "r2", status: "ok", summary: "خلصت 3 خطوات" }, agent, "mcp", NOW);
    expect(rows("notification")).toHaveLength(1);
    expect(rows("notification")[0]).toMatchObject({ urgency: "yellow" });
    expect(rows("notification")[0]!.body).toContain("خلصت 3 خطوات");
  });

  it("a failed notice that cannot be written does not fail the log", async () => {
    const spy = vi.spyOn(h.db.notification, "findUnique").mockRejectedValueOnce(new Error("db down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await logRun({ job: "daily-check", ref: "r1", status: "failed" }, agent, "mcp", NOW);
    spy.mockRestore();
    quiet.mockRestore();
    expect(r.run.status).toBe("failed");
  });

  it("a new run that says no `scheduled_for` is tied to the slot it answers (W-16): 10:02 is the 10:00 slot's", async () => {
    // 10:00 Amman = 07:00Z
    await logRun({ job: "daily-check", ref: "r1", status: "running", started_at: "2026-11-22T07:02:00Z" }, agent, "mcp", NOW);
    expect(rows("workflowRun")[0]!.scheduledFor.toISOString()).toBe("2026-11-22T07:00:00.000Z");
  });

  it("…to none when it is far from every slot, or when it says it was asked for by hand; and the agent's own `scheduled_for` always wins", async () => {
    await logRun({ job: "daily-check", ref: "far", status: "running", started_at: "2026-11-22T09:30:00Z" }, agent, "mcp", NOW);
    await logRun({ job: "daily-check", ref: "hand", status: "running", trigger: "manual", started_at: "2026-11-22T07:01:00Z" }, agent, "mcp", NOW);
    await logRun({ job: "daily-check", ref: "own", status: "running", started_at: "2026-11-22T09:30:00Z", scheduled_for: "2026-11-22T07:00:00Z" }, agent, "mcp", NOW);
    const by = (ref: string) => rows("workflowRun").find((r) => r.ref === ref)!;
    expect(by("far").scheduledFor).toBeNull();
    expect(by("hand").scheduledFor).toBeNull();
    expect(by("own").scheduledFor.toISOString()).toBe("2026-11-22T07:00:00.000Z");
  });

  it("a run that is updated later keeps the slot it was tied to", async () => {
    await logRun({ job: "daily-check", ref: "r1", status: "running", started_at: "2026-11-22T07:02:00Z" }, agent, "mcp", NOW);
    await logRun({ job: "daily-check", ref: "r1", status: "ok" }, agent, "mcp", new Date("2026-11-22T08:30:00Z"));
    expect(rows("workflowRun")[0]!.scheduledFor.toISOString()).toBe("2026-11-22T07:00:00.000Z");
  });
});

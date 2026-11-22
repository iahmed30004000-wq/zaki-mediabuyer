/**
 * The steps the site runs for a job (docs/rebuild-v6/00-audit.md W-18): one run at a time per job, under a lock, and the clock's run carries the slot's own ref.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { siteConfigFrom } from "@/core/step-exec";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test", omsLinked: () => false }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async () => undefined, telegramFromEnv: () => null }));

import { ExecRefused, executeWorkflow, type ExecDeps } from "@/server/step-exec";
import { mergeJobs } from "@/server/job-map";

type Rows = Record<string, any>[];
const rows = (name: "workflow" | "workflowRun" | "handoff"): Rows => (h.db[name] as unknown as { rows: Rows }).rows;
const owner = { type: "user" as const, id: "u1" };
const NOW = new Date("2026-11-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

const deps = (): ExecDeps => ({
  cfg: siteConfigFrom({ N8N_BASE_URL: "https://n8n.example.com", N8N_WEBHOOK_SECRET: "test-secret-value", N8N_ALLOWED_PATHS: "daily-ops" }),
  fetch: (async () => new Response('{"ok":true}', { status: 200 })) as typeof fetch,
  resolve: async () => ["93.184.216.34"],
  sleep: async () => undefined,
  now: () => NOW,
  telegram: null,
});
const graph = {
  nodes: [
    { id: "start", type: "trigger", label: "بداية" },
    { id: "call", type: "step", label: "نداء", executor: "n8n", target: "daily-ops", permission: "green" },
  ],
  edges: [{ from: "start", to: "call" }],
};

describe("a job's steps from the site, one run at a time (W-18)", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: { ...jobRow("site-job", ["call"]), graph, executor: "n8n", assigneeKey: "site", number: 1 } });
  });

  it("runs, and writes its run with the steps it ran", async () => {
    const r = await executeWorkflow("site-job", owner, deps());
    expect(r.status).toBe("ok");
    expect(rows("workflowRun")).toHaveLength(1);
    expect(rows("workflowRun")[0]).toMatchObject({ status: "ok", trigger: "manual" });
  });

  it("takes the job's lock before it looks for a run that is going (the check and the first write are one step)", async () => {
    const locks: string[] = [];
    const spy = vi.spyOn(h.db, "$executeRaw").mockImplementation((async (parts: TemplateStringsArray, ...vals: unknown[]) => (locks.push(parts.join("?") + JSON.stringify(vals)), 0)) as never);
    await executeWorkflow("site-job", owner, deps());
    spy.mockRestore();
    expect(locks.some((l) => l.includes("pg_advisory_xact_lock") && l.includes("exec:site-job"))).toBe(true);
  });

  it("a run that is going (it spoke within maxRunMin) stops a second one: 409, and nothing is written", async () => {
    const wf = rows("workflow")[0]!;
    await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "going", status: "running", startedAt: min(-10), heartbeatAt: min(-2), doneBy: "claude" } });
    rows("workflowRun")[0]!.updatedAt = min(-2);
    await expect(executeWorkflow("site-job", owner, deps())).rejects.toMatchObject({ status: 409 });
    await expect(executeWorkflow("site-job", owner, deps())).rejects.toBeInstanceOf(ExecRefused);
    expect(rows("workflowRun")).toHaveLength(1);
  });

  it("a run that went quiet past maxRunMin does not hold the job: the watchdog closes it, and a new one may start", async () => {
    const wf = rows("workflow")[0]!;
    await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "dead", status: "running", startedAt: min(-300), heartbeatAt: min(-200) } });
    rows("workflowRun")[0]!.updatedAt = min(-200);
    const r = await executeWorkflow("site-job", owner, deps());
    expect(r.status).toBe("ok");
    expect(rows("workflowRun")).toHaveLength(2);
  });

  it("the clock's run carries the slot's ref, the slot it answers and that it was not asked for by hand", async () => {
    const slot = new Date("2026-11-22T07:00:00.000Z");
    const r = await executeWorkflow("site-job", { type: "system", id: "watchdog" }, deps(), { ref: `slot-${slot.toISOString()}`, scheduledFor: slot, trigger: "schedule" });
    expect(r.ref).toBe(`slot-${slot.toISOString()}`);
    expect(rows("workflowRun")[0]).toMatchObject({ ref: `slot-${slot.toISOString()}`, trigger: "schedule", status: "ok" });
    expect(rows("workflowRun")[0]!.scheduledFor).toEqual(slot);
  });

  it("a key that was merged into another job runs that one", async () => {
    await h.db.workflow.create({ data: { ...jobRow("old-name", ["call"]), graph, executor: "n8n", number: 2 } });
    await mergeJobs("site-job", "old-name", owner, NOW);
    const r = await executeWorkflow("old-name", owner, deps());
    expect(r.status).toBe("ok");
    expect(rows("workflowRun").every((x) => x.workflowId === rows("workflow").find((w) => w.key === "site-job")!.id)).toBe(true);
  });
});

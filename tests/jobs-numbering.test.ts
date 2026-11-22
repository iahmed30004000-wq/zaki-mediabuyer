/**
 * The numbers belong to the site (docs/rebuild-v6/01-model.md §12, U-03): the next free one is given at the moment a job is made, whoever makes it,
 * two jobs made together never share one — and no read of the map writes a row any more (W-23: `ensureSeeded` is not called by a read).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SEED_WORKFLOWS } from "@/core/workflow";
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

import { nextJobNumber, numberTaken, withNumberLock } from "@/server/job-map";
import { UnknownJob, createWorkflow, ensureSeeded, listWorkflows, logRun, runsOf } from "@/server/workflows";
import { createHandoff, requestRun } from "@/server/handoffs";
import { upsertJobs } from "@/server/jobs";

type Rows = Record<string, any>[];
const wfs = (): Rows => (h.db.workflow as unknown as { rows: Rows }).rows;
const me = { type: "user" as const, id: "u1" };
const agent = { type: "agent" as const, id: "mcp:Claude" };

describe("the next free number", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  });

  it("is one more than the biggest number of a job that is not put away", async () => {
    expect(await nextJobNumber()).toBe(1);
    await h.db.workflow.create({ data: jobRow("a", ["x"], { number: 4 }) });
    await h.db.workflow.create({ data: jobRow("b", ["x"], { number: 9, archivedAt: new Date() }) });
    await h.db.workflow.create({ data: jobRow("c", ["x"]) });
    expect(await nextJobNumber()).toBe(5);
    expect(await numberTaken(4, null)).toBe(true);
    expect(await numberTaken(4, "a")).toBe(false);
    expect(await numberTaken(9, null)).toBe(false);
  });

  it("a job made from the site (createWorkflow) takes the next one, then the next", async () => {
    await h.db.workflow.create({ data: jobRow("a", ["x"], { number: 3 }) });
    const one = await createWorkflow({ name: "مهمة جديدة 1", template: "blank" }, me);
    const two = await createWorkflow({ name: "مهمة جديدة 2", template: "blank" }, me);
    expect([one.number, two.number]).toEqual([4, 5]);
  });

  it("a job made by a log_run (create_if_missing) takes the next one", async () => {
    await h.db.workflow.create({ data: jobRow("a", ["x"], { number: 7 }) });
    const r = await logRun({ job: "fresh-job", ref: "r1", status: "running", create_if_missing: true }, agent, "mcp");
    expect(wfs().find((w) => w.key === r.workflow.key)!.number).toBe(8);
  });

  it("the number is read and written under the numbering lock, so jobs made one after the other never share one (the race itself was tried on a real Postgres: docs/rebuild-v6/NOTES.md)", async () => {
    const locks: string[] = [];
    const spy = vi.spyOn(h.db, "$executeRaw").mockImplementation((async (parts: TemplateStringsArray, ...vals: unknown[]) => (locks.push(parts.join("?") + JSON.stringify(vals)), 0)) as never);
    const made = [];
    for (const i of [1, 2, 3, 4]) made.push(await withNumberLock(async (tx) => tx.workflow.create({ data: { ...jobRow(`p${i}`, ["x"]), number: await nextJobNumber(tx) } as never })));
    spy.mockRestore();
    expect(made.map((m) => m.number)).toEqual([1, 2, 3, 4]);
    expect(locks).toHaveLength(4);
    expect(locks.every((l) => l.includes("pg_advisory_xact_lock") && l.includes("jobs:number"))).toBe(true);
  });

  it("a push of the agent asking for a number that is taken is given another", async () => {
    await h.db.workflow.create({ data: jobRow("a", ["x"], { number: 3, name: "أ" }) });
    const r = await upsertJobs({ jobs: [{ key: "new-job", number: 3, name: "ب", domain: "ads", kind: "recurring" }, { key: "free-job", number: 20, name: "ج", domain: "ads", kind: "recurring" }] }, agent);
    expect(r.jobs.map((j) => j.number)).toEqual([4, 20]);
  });
});

describe("no read writes a row (W-23, W-20)", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  });

  it("listing the jobs of an empty database lists none and creates none — the seed is for a new database, once", async () => {
    expect(await listWorkflows()).toEqual([]);
    expect(wfs()).toHaveLength(0);
    expect(await runsOf("daily-check")).toEqual([]);
    expect(wfs()).toHaveLength(0);
    expect(await ensureSeeded()).toBe(SEED_WORKFLOWS.length);
    expect(wfs()).toHaveLength(SEED_WORKFLOWS.length);
    expect(await ensureSeeded()).toBe(0);
  });

  it("a log, a request or a push on an empty database does not seed it: a job that is not there is not there", async () => {
    await expect(logRun({ job: "daily-check", ref: "r1", status: "running" }, agent, "mcp")).rejects.toBeInstanceOf(UnknownJob);
    await expect(requestRun("daily-check", me)).rejects.toThrow();
    await expect(createHandoff({ workflow: "daily-check", kind: "needs_input", title: "x" }, me)).rejects.toBeInstanceOf(UnknownJob);
    expect(wfs()).toHaveLength(0);
    await upsertJobs({ jobs: [{ key: "mine", name: "مهمتي", domain: "ads", kind: "manual" }] }, agent);
    expect(wfs().map((w) => w.key)).toEqual(["mine"]);
  });

  it("the jobs of a list come from one number of queries however many jobs there are", async () => {
    const calls: string[] = [];
    const wrap = (name: string, t: Record<string, any>) => {
      for (const m of ["findMany", "findFirst", "findUnique", "groupBy"]) {
        const orig = t[m].bind(t);
        t[m] = (...a: unknown[]) => (calls.push(`${name}.${m}`), orig(...a));
      }
    };
    wrap("workflow", h.db.workflow);
    wrap("workflowRun", h.db.workflowRun);
    const count = async (n: number) => {
      wfs().length = 0;
      (h.db.workflowRun as unknown as { rows: unknown[] }).rows.length = 0;
      for (let i = 0; i < n; i++) {
        const wf = await h.db.workflow.create({ data: jobRow(`j${i}`, ["a"], { number: i + 1 }) });
        for (let r = 0; r < 3; r++) await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: `r${r}`, status: r === 2 ? "running" : "ok", startedAt: new Date(Date.now() - (3 - r) * 60_000) } });
      }
      calls.length = 0;
      const cards = await listWorkflows();
      expect(cards).toHaveLength(n);
      return calls.length;
    };
    const few = await count(3);
    const many = await count(60);
    expect(many).toBe(few);
    expect(many).toBeLessThanOrEqual(4);
  });

  it("the list says for each job its last run, the run going now, who carries it out and what the owner edited", async () => {
    const wf = await h.db.workflow.create({ data: jobRow("a", ["x"], { number: 1, wake: "site", assigneeKey: "hermes", graceMin: 20, ownerEdited: ["name"] }) });
    await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "old", status: "ok", startedAt: new Date(Date.now() - 3_600_000) } });
    await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "new", status: "running", startedAt: new Date(Date.now() - 60_000) } });
    const [card] = await listWorkflows();
    expect(card).toMatchObject({ key: "a", wake: "site", assigneeKey: "hermes", graceMin: 20, maxRunMin: 90, ownerEdited: ["name"] });
    expect(card!.lastRun?.ref).toBe("new");
    expect(card!.live?.ref).toBe("new");
    expect((await listWorkflows(new Date(), { key: "a" }))).toHaveLength(1);
    expect((await listWorkflows(new Date(), { key: "zzz" }))).toEqual([]);
  });
});

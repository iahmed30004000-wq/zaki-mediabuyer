/**
 * Writing to a job is guarded (docs/rebuild-v6/01-model.md §14 · W-11 · W-17): a save carries the version of the drawing it was made from and is refused
 * (409) when somebody saved since; a switch on ONE step is made on the server, on the drawing as it is now.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WfGraph } from "@/core/workflow";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { RunRefused, WorkflowConflict, WorkflowPatch, setStepEnabled, updateWorkflow } from "@/server/workflows";

const owner = { type: "user" as const, id: "u1" };
const wf = () => (h.db.workflow as unknown as { rows: Record<string, any>[] }).rows.find((r) => r.key === "daily-check")!;
const versions = () => (h.db.workflowVersion as unknown as { rows: Record<string, any>[] }).rows;
const graphOf = (): WfGraph => wf().graph;
const withNode = (g: WfGraph, id: string, patch: object): WfGraph => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

describe("saving a drawing from a page that may be stale", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: jobRow("daily-check", ["read", "judge", "act"]) });
  });

  it("the patch takes baseVersion and baseUpdatedAt", () => {
    expect(WorkflowPatch.safeParse({ enabled: false, baseVersion: 1, baseUpdatedAt: "2026-11-22T10:00:00Z" }).success).toBe(true);
    expect(WorkflowPatch.safeParse({ baseVersion: 0 }).success).toBe(false);
  });

  it("a save on the version the page loaded is written, and is the next version", async () => {
    const card = await updateWorkflow("daily-check", { graph: withNode(graphOf(), "read", { label: "قراءة جديدة" }), baseVersion: 1 }, owner);
    expect(card!.version).toBe(2);
    expect(wf().version).toBe(2);
    expect(versions().map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("a save from a page that loaded an older version is refused with 409's error, and nothing is written", async () => {
    await updateWorkflow("daily-check", { graph: withNode(graphOf(), "read", { label: "من التبويب الأول" }), baseVersion: 1 }, owner);
    const before = JSON.stringify(wf().graph);
    const e = await updateWorkflow("daily-check", { graph: withNode(graphOf(), "act", { label: "من التبويب القديم" }), baseVersion: 1 }, owner).catch((x) => x);
    expect(e).toBeInstanceOf(WorkflowConflict);
    expect(e.message).toBe("حدا عدّلها قبلك — حدّث الصفحة");
    expect(wf().version).toBe(2);
    expect(JSON.stringify(wf().graph)).toBe(before);
  });

  it("a stale version number guards a change that is not the drawing too (the name, the switch)", async () => {
    await updateWorkflow("daily-check", { graph: withNode(graphOf(), "read", { label: "x" }), baseVersion: 1 }, owner);
    await expect(updateWorkflow("daily-check", { enabled: false, baseVersion: 1 }, owner)).rejects.toBeInstanceOf(WorkflowConflict);
    expect(wf().enabled).toBe(true);
  });

  it("a page that sends when it last saw the job (baseUpdatedAt) is refused if it was saved since — the stale description cannot turn back on a job the owner stopped", async () => {
    const seen = wf().updatedAt.toISOString();
    await updateWorkflow("daily-check", { enabled: false }, owner); // from the phone
    expect(wf().enabled).toBe(false);
    await expect(updateWorkflow("daily-check", { description: "وصف جديد", enabled: true, baseUpdatedAt: seen }, owner)).rejects.toBeInstanceOf(WorkflowConflict);
    expect(wf().enabled).toBe(false);
    expect(wf().description).toBeNull();
    // with what it last saw, it is written
    await expect(updateWorkflow("daily-check", { description: "وصف جديد", baseUpdatedAt: wf().updatedAt.toISOString() }, owner)).resolves.toBeTruthy();
    expect(wf().description).toBe("وصف جديد");
  });

  it("without any base (the older clients, the agent's own edits) a change that is not the drawing is written as before", async () => {
    await expect(updateWorkflow("daily-check", { enabled: false }, owner)).resolves.toBeTruthy();
    expect(wf().enabled).toBe(false);
  });

  it("a drawing is written only over the version it was made from, even with no base: two saves of the same one cannot both win", async () => {
    const g = withNode(graphOf(), "read", { label: "واحد" });
    await updateWorkflow("daily-check", { graph: g }, owner);
    // the same drawing again changes nothing (saving twice is saving once)
    await updateWorkflow("daily-check", { graph: g }, owner);
    expect(wf().version).toBe(2);
  });

  it("changing the schedule notes when (the watchdog counts slots from then)", async () => {
    await updateWorkflow("daily-check", { schedule: "0 10 * * *" }, owner, new Date("2026-11-22T10:00:00Z"));
    expect(wf().scheduleChangedAt).toEqual(new Date("2026-11-22T10:00:00Z"));
    await updateWorkflow("daily-check", { schedule: "0 10 * * *" }, owner, new Date("2026-11-22T11:00:00Z"));
    expect(wf().scheduleChangedAt).toEqual(new Date("2026-11-22T10:00:00Z"));
  });
});

describe("switching one step", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: jobRow("daily-check", ["read", "judge", "act"]) });
  });
  const disabled = () => graphOf().nodes.filter((n) => n.disabled).map((n) => n.id);

  it("switches off one step; the rest of the drawing is the one on the server", async () => {
    const r = await setStepEnabled("daily-check", "judge", false, owner);
    expect(r).toMatchObject({ changed: true });
    expect(disabled()).toEqual(["judge"]);
    expect(wf().version).toBe(2);
  });

  it("two quick switches do not undo each other (the second does not start from the drawing the first page loaded)", async () => {
    await setStepEnabled("daily-check", "read", false, owner);
    await setStepEnabled("daily-check", "act", false, owner);
    expect(disabled().sort()).toEqual(["act", "read"]);
    await setStepEnabled("daily-check", "read", true, owner);
    expect(disabled()).toEqual(["act"]);
  });

  it("a switch that changes nothing is not a new version", async () => {
    await setStepEnabled("daily-check", "judge", false, owner);
    const again = await setStepEnabled("daily-check", "judge", false, owner);
    expect(again).toMatchObject({ changed: false });
    expect(wf().version).toBe(2);
  });

  it("is retried when somebody saved between reading and writing", async () => {
    // right after the first read, somebody else saves (the version moves on): the write finds out, and the switch is made again on the new drawing
    const real = h.db.workflow.findUnique.bind(h.db.workflow);
    let reads = 0;
    const spy = vi.spyOn(h.db.workflow, "findUnique").mockImplementation(async (a) => {
      const r = await real(a);
      if (++reads === 1) await h.db.workflow.update({ where: { key: "daily-check" }, data: { version: { increment: 1 } } });
      return r;
    });
    const r = await setStepEnabled("daily-check", "judge", false, owner);
    spy.mockRestore();
    expect(r).toMatchObject({ changed: true });
    expect(disabled()).toEqual(["judge"]);
    expect(wf().version).toBe(3);
  });

  it("a step the job does not have, or the trigger, is refused; a job that does not exist is null", async () => {
    await expect(setStepEnabled("daily-check", "ghost", false, owner)).rejects.toBeInstanceOf(RunRefused);
    await expect(setStepEnabled("daily-check", "start", false, owner)).rejects.toBeInstanceOf(RunRefused);
    expect(await setStepEnabled("nope", "read", false, owner)).toBeNull();
  });
});

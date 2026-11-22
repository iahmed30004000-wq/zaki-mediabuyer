/**
 * One map of jobs (docs/rebuild-v6/01-model.md §12, W-23 · U-03): the pairs that look like one job twice, the merge itself (runs move, refs that clash take a
 * suffix, the dropped job is put away and leads to the one that kept it), and the one-time renumbering.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { followMerged, findNameClash, mergedRef, nextNumber, normalizeName, renumberOrder, suggestDuplicates, type MapJob } from "@/core/job-map";
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

import { MergeRefused, listDuplicates, loadJob, mergeJobs, renumberJobs } from "@/server/job-map";
import { logRun } from "@/server/workflows";
import { requestRun } from "@/server/handoffs";

type Rows = Record<string, any>[];
const rows = (name: "workflow" | "workflowRun" | "handoff" | "approval"): Rows => (h.db[name] as unknown as { rows: Rows }).rows;
const owner = { type: "user" as const, id: "u1" };
const NOW = new Date("2026-11-22T10:00:00.000Z");

describe("names, numbers and keys — pure", () => {
  it("a name is the same name once marks, kinds of alef, ya, ha and punctuation are gone", () => {
    expect(normalizeName("جولة  الليل!")).toBe(normalizeName("جولة الليل"));
    expect(normalizeName("إدارة الأعلانات")).toBe(normalizeName("ادارة الاعلانات"));
    expect(normalizeName("مَهمّة")).toBe(normalizeName("مهمه"));
    expect(normalizeName("Night Round")).toBe(normalizeName("night-round"));
    expect(normalizeName("جولة الليل")).not.toBe(normalizeName("جولة النهار"));
    expect(normalizeName("   ")).toBe("");
  });

  it("finds the job that already has a name, and not the job itself", () => {
    const jobs = [{ key: "a", name: "الفحص اليومي" }, { key: "b", name: "جولة الليل" }];
    expect(findNameClash(jobs, "الفحص  اليومي", undefined)?.key).toBe("a");
    expect(findNameClash(jobs, "الفحص اليومي", "a")).toBeNull();
    expect(findNameClash(jobs, "شي جديد")).toBeNull();
    expect(findNameClash(jobs, "")).toBeNull();
  });

  it("the next free number is one more than the biggest; the first gap when the map is full", () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([1, 2, 5, null, undefined])).toBe(6);
    const full = Array.from({ length: 999 }, (_, i) => i + 1).filter((n) => n !== 40);
    expect(nextNumber(full)).toBe(40);
    expect(() => nextNumber(Array.from({ length: 999 }, (_, i) => i + 1))).toThrow();
  });

  it("a ref that is taken gets a suffix that says where it came from, and it is never taken twice", () => {
    expect(mergedRef("r1", { number: 7, key: "x" }, new Set())).toBe("r1");
    expect(mergedRef("r1", { number: 7, key: "x" }, new Set(["r1"]))).toBe("r1-m7");
    expect(mergedRef("r1", { number: 7, key: "x" }, new Set(["r1", "r1-m7"]))).toBe("r1-m7-2");
    expect(mergedRef("r1", { number: null, key: "old-job" }, new Set(["r1"]))).toBe("r1-mold-job");
    expect(mergedRef("x".repeat(80), { number: 7, key: "x" }, new Set(["x".repeat(80)])).length).toBeLessThanOrEqual(80);
  });

  it("a merged key leads to the job that kept it: a short chain, never a loop", () => {
    const map = new Map<string, string | null>([["a", "b"], ["b", "c"], ["c", null]]);
    expect(followMerged("a", map)).toBe("c");
    expect(followMerged("c", map)).toBe("c");
    expect(followMerged("zzz", map)).toBe("zzz");
    expect(followMerged("x", new Map([["x", "y"], ["y", "x"]]))).toBe("y");
  });
});

describe("suggestDuplicates — the pairs the owner decides on", () => {
  const j = (key: string, name: string, over: Partial<MapJob> = {}): MapJob => ({ key, name, number: null, ...over });

  it("the same name once normalized is a pair; the one with more history is kept", () => {
    const out = suggestDuplicates([j("a", "جولة الليل", { number: 1, runs: 2 }), j("b", "جولة  الليل!", { number: 9, runs: 40 }), j("c", "شي تاني", { runs: 99 })]);
    expect(out).toEqual([{ keep: "b", drop: "a", reasons: ["name"] }]);
  });

  it("the same cron for the same carrier is a pair; the same cron for another carrier is not", () => {
    const out = suggestDuplicates([j("a", "x1", { schedule: "0 9 * * *", assigneeKey: "claude", number: 2 }), j("b", "x2", { schedule: "0 9 * * *", assigneeKey: "claude", number: 1 }), j("c", "x3", { schedule: "0 9 * * *", assigneeKey: "hermes" })]);
    expect(out).toEqual([{ keep: "b", drop: "a", reasons: ["schedule"] }]);
    expect(suggestDuplicates([j("a", "x1", { schedule: null }), j("b", "x2", { schedule: null })])).toEqual([]);
  });

  it("a group of three is two pairs against the one to keep, and its reason says why each belongs", () => {
    const out = suggestDuplicates([j("a", "ن", { runs: 1, number: 3 }), j("b", "ن", { runs: 5, number: 4 }), j("c", "ن", { runs: 5, number: 2 })]);
    expect(out).toEqual([{ keep: "c", drop: "a", reasons: ["name"] }, { keep: "c", drop: "b", reasons: ["name"] }]);
  });

  it("two jobs linked only through a third are still one group (the reason is «linked»)", () => {
    const out = suggestDuplicates([j("a", "اسم", { runs: 9, schedule: "0 1 * * *", assigneeKey: "claude" }), j("b", "اسم", { schedule: "0 2 * * *", assigneeKey: "claude" }), j("c", "تاني", { schedule: "0 2 * * *", assigneeKey: "claude" })]);
    expect(out.map((p) => p.drop).sort()).toEqual(["b", "c"]);
    expect(out.find((p) => p.drop === "c")!.reasons).toEqual(["linked"]);
  });

  it("nothing similar, nothing suggested", () => {
    expect(suggestDuplicates([j("a", "واحد"), j("b", "اثنين")])).toEqual([]);
    expect(suggestDuplicates([])).toEqual([]);
  });
});

describe("renumberOrder — 1…N by domain, then the old number, then the name", () => {
  it("orders by domain (ads before ops), then the old number (none goes last), then the name", () => {
    const out = renumberOrder([
      { key: "o2", name: "ب", number: 3, domain: "ops" },
      { key: "a1", name: "ج", number: 7, domain: "ads" },
      { key: "a0", name: "أ", number: 7, domain: "ads" },
      { key: "an", name: "ز", number: null, domain: "ads" },
      { key: "o1", name: "أ", number: 1, domain: "ops" },
    ]);
    expect([...out.entries()].sort((x, y) => x[1] - y[1]).map(([k]) => k)).toEqual(["a0", "a1", "an", "o1", "o2"]);
    expect([...out.values()].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("the server side", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: jobRow("keep", ["a", "b"], { number: 1, name: "الفحص اليومي" }) });
    await h.db.workflow.create({ data: jobRow("drop", ["a", "b"], { number: 2, name: "الفحص اليومي", source: "mcp" }) });
  });

  it("merging moves the runs, renames a ref that clashes, follows the open requests, and puts the dropped job away", async () => {
    await logRun({ job: "keep", ref: "r1", status: "ok" }, owner, "mcp", NOW);
    await logRun({ job: "drop", ref: "r1", status: "ok" }, owner, "mcp", NOW);
    await logRun({ job: "drop", ref: "r2", status: "ok" }, owner, "mcp", NOW);
    const wf = rows("workflow");
    const h1 = await h.db.handoff.create({ data: { workflowKey: "drop", runRef: "r1", kind: "needs_input", title: "x", assignee: "claude" } });
    await h.db.approval.create({ data: { title: "a", why: "w", workflowKey: "drop" } });

    const r = await mergeJobs("keep", "drop", owner, NOW);
    expect(r).toMatchObject({ keep: "keep", drop: "drop", runs: 2, renamedRefs: 1, handoffs: 1, approvals: 1 });
    const keepId = wf.find((w) => w.key === "keep")!.id;
    expect(rows("workflowRun").map((x) => [x.workflowId, x.ref]).sort()).toEqual([[keepId, "r1"], [keepId, "r1-m2"], [keepId, "r2"]].sort());
    expect(rows("handoff").find((x) => x.id === h1.id)).toMatchObject({ workflowKey: "keep", runRef: "r1-m2" });
    expect(rows("approval")[0]!.workflowKey).toBe("keep");
    expect(wf.find((w) => w.key === "drop")).toMatchObject({ mergedInto: "keep", enabled: false });
    expect(wf.find((w) => w.key === "drop")!.archivedAt).toEqual(expect.any(Date));
    expect(wf.find((w) => w.key === "keep")).toMatchObject({ mergedInto: null, archivedAt: null });
  });

  it("after it, a log under the dropped key lands on the job that kept it — and so does a request", async () => {
    await mergeJobs("keep", "drop", owner, NOW);
    expect((await loadJob("drop"))?.key).toBe("keep");
    const r = await logRun({ job: "drop", ref: "late", status: "running" }, owner, "mcp", NOW);
    expect(r.workflow.key).toBe("keep");
    expect(rows("workflowRun").find((x) => x.ref === "late")!.workflowId).toBe(rows("workflow").find((w) => w.key === "keep")!.id);
    const q = await requestRun("drop", owner, NOW);
    expect(q.handoff.workflowKey).toBe("keep");
  });

  it("refuses to merge a job into itself, a job that is not there, a put-away job, or one that was merged already", async () => {
    await expect(mergeJobs("keep", "keep", owner)).rejects.toBeInstanceOf(MergeRefused);
    await expect(mergeJobs("keep", "nope", owner)).rejects.toBeInstanceOf(MergeRefused);
    await mergeJobs("keep", "drop", owner, NOW);
    await expect(mergeJobs("keep", "drop", owner)).rejects.toThrow(/اندمجت/);
    await expect(mergeJobs("drop", "keep", owner)).rejects.toThrow(/مؤرشفة|مدموجة/);
  });

  it("lists the duplicates with the runs each has", async () => {
    await logRun({ job: "drop", ref: "r1", status: "ok" }, owner, "mcp", NOW);
    await logRun({ job: "drop", ref: "r2", status: "ok" }, owner, "mcp", NOW);
    const out = await listDuplicates();
    expect(out).toEqual([{ keep: "drop", drop: "keep", reasons: ["name"] }]);
  });

  it("renumbers 1…N over the jobs that are not put away, and says how many changed", async () => {
    await h.db.workflow.create({ data: jobRow("ops1", ["a"], { number: 40, domain: "ops", name: "ز" }) });
    await h.db.workflow.create({ data: jobRow("gone", ["a"], { number: 41, archivedAt: NOW, name: "م" }) });
    const r = await renumberJobs(owner);
    expect(r).toEqual({ changed: 1, total: 3 });
    expect(rows("workflow").filter((w) => !w.archivedAt).map((w) => [w.key, w.number]).sort()).toEqual([["drop", 2], ["keep", 1], ["ops1", 3]]);
    expect(rows("workflow").find((w) => w.key === "gone")!.number).toBe(41);
    expect(await renumberJobs(owner)).toEqual({ changed: 0, total: 3 });
  });
});

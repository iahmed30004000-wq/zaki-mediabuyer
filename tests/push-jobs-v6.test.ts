/**
 * `push_jobs` after v6 (docs/rebuild-v6/01-model.md §11, W-13): the agent's map is a hint. What the owner edited by hand is not written over, a finished
 * job can be opened, a name is one job, the number is the site's, a key that was merged lands on the job that kept it, and a step that is no longer in
 * the list is marked instead of left behind.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GONE_DESC, mergeBranches, mergeOwnerEdited, ownerEditedFields, withoutOwnerEdited } from "@/core/push-jobs";
import type { WfGraph } from "@/core/workflow";
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

import { mergeJobs } from "@/server/job-map";
import { upsertJobs } from "@/server/jobs";
import { updateWorkflow } from "@/server/workflows";

type Rows = Record<string, any>[];
const wf = (key: string): Record<string, any> => (h.db.workflow as unknown as { rows: Rows }).rows.find((w) => w.key === key)!;
const owner = { type: "user" as const, id: "u1" };
const agent = { type: "agent" as const, id: "mcp:Claude" };
const NOW = new Date("2026-11-22T10:00:00.000Z");
const J = (key: string, over: Record<string, unknown> = {}) => ({ key, name: `مهمة ${key}`, domain: "ads" as const, kind: "recurring" as const, ...over });

const graph = (steps: Record<string, any>[]): WfGraph => ({
  nodes: [{ id: "start", type: "trigger", label: "بداية" }, ...steps.map((s) => ({ type: "step" as const, executor: "claude_mcp" as const, ...s }))] as WfGraph["nodes"],
  edges: steps.map((s, i) => ({ from: i === 0 ? "start" : steps[i - 1]!.id, to: s.id })),
});

describe("what a push may change — pure", () => {
  it("what the owner changed is his: only the fields that really changed", () => {
    const before = { name: "أ", description: "د", schedule: "0 9 * * *" };
    expect(ownerEditedFields({ name: "أ" }, before)).toEqual([]);
    expect(ownerEditedFields({ name: "ب" }, before)).toEqual(["name"]);
    expect(ownerEditedFields({ description: null, schedule: "0 10 * * *" }, before)).toEqual(["description", "schedule", "scheduleText"]);
    expect(mergeOwnerEdited(["name"], ["description", "name"])).toEqual(["description", "name"]);
  });

  it("the columns he edited are left out of the write, and said", () => {
    const out = withoutOwnerEdited({ name: "x", schedule: "y", kind: "recurring" }, ["name", "scheduleText"]);
    expect(out.data).toEqual({ schedule: "y", kind: "recurring" });
    expect(out.kept).toEqual(["name"]);
  });

  it("a step that is no longer in the list is switched off and marked; one that comes back is on again; the owner's own «off» is never turned on", () => {
    const g = graph([{ id: "a", label: "أ" }, { id: "b", label: "ب" }, { id: "c", label: "ج", disabled: true }, { id: "p", label: "شخص", executor: "person" }]);
    const first = mergeBranches(g, [{ id: "a", label: "أ" }]);
    expect(first.gone).toEqual(["b"]); // c is already off (the owner's), p is a person's step
    const nodes = first.graph!.nodes;
    expect(nodes.find((n) => n.id === "b")).toMatchObject({ disabled: true, desc: GONE_DESC });
    expect(nodes.find((n) => n.id === "c")).toMatchObject({ disabled: true });
    expect(nodes.find((n) => n.id === "c")!.desc).toBeUndefined();
    expect(nodes.find((n) => n.id === "p")!.disabled).toBeUndefined();
    const back = mergeBranches(first.graph!, [{ id: "a", label: "أ" }, { id: "b", label: "ب جديد", desc: "وصف" }, { id: "c", label: "ج" }]);
    expect(back.revived).toEqual(["b"]);
    expect(back.graph!.nodes.find((n) => n.id === "b")).toMatchObject({ label: "ب جديد", desc: "وصف" });
    expect(back.graph!.nodes.find((n) => n.id === "b")!.disabled).toBeUndefined();
    expect(back.graph!.nodes.find((n) => n.id === "c")!.disabled).toBe(true);
  });

  it("a list that names nothing says nothing about the steps; a list that changes nothing changes nothing", () => {
    const g = graph([{ id: "a", label: "أ" }]);
    expect(mergeBranches(g, []).graph).toBeNull();
    expect(mergeBranches(g, [{ id: "a", label: "أ" }]).graph).toBeNull();
    const added = mergeBranches(g, [{ id: "a", label: "أ" }, { id: "n", label: "جديدة", enabled: false }]);
    expect(added.added).toEqual(["n"]);
    expect(added.graph!.nodes.find((n) => n.id === "n")!.disabled).toBe(true);
    expect(added.graph!.edges).toContainEqual({ from: "a", to: "n" });
  });
});

describe("push_jobs", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  });

  it("what the owner edited by hand is not written over: the name and the time stay his, and the answer says so", async () => {
    await upsertJobs({ jobs: [J("night", { name: "جولة الليل", schedule: "35 0 * * *", schedule_text: "00:35", description: "وصف الوكيل" })] }, agent, NOW);
    expect(wf("night")).toMatchObject({ name: "جولة الليل", schedule: "35 0 * * *", ownerEdited: [] });
    // the owner renames it and moves its time, from the site
    await updateWorkflow("night", { name: "جولة الإعلانات", schedule: "0 1 * * *" }, owner, NOW);
    expect(wf("night").ownerEdited).toEqual(["name", "schedule", "scheduleText"]);
    // the agent pushes its own words again
    const r = await upsertJobs({ jobs: [J("night", { name: "جولة الليل", schedule: "35 0 * * *", schedule_text: "00:35", description: "وصف جديد من الوكيل" })] }, agent, NOW);
    expect(r.jobs[0]).toMatchObject({ ok: true, kept_yours: ["name", "schedule", "scheduleText"] });
    expect(wf("night")).toMatchObject({ name: "جولة الإعلانات", schedule: "0 1 * * *", description: "وصف جديد من الوكيل" });
  });

  it("an edit by the agent itself is not «the owner's»", async () => {
    await upsertJobs({ jobs: [J("a")] }, agent, NOW);
    await updateWorkflow("a", { name: "اسم من الوكيل" }, agent, NOW);
    expect(wf("a").ownerEdited).toEqual([]);
  });

  it("when the time of a job moves, what was expected before is not counted against it", async () => {
    await upsertJobs({ jobs: [J("a", { schedule: "0 9 * * *" })] }, agent, NOW);
    expect(wf("a").scheduleChangedAt).toBeNull();
    const later = new Date(NOW.getTime() + 3_600_000);
    await upsertJobs({ jobs: [J("a", { schedule: "0 9 * * *" })] }, agent, later);
    expect(wf("a").scheduleChangedAt).toBeNull();
    await upsertJobs({ jobs: [J("a", { schedule: "0 11 * * *" })] }, agent, later);
    expect(wf("a").scheduleChangedAt).toEqual(later);
  });

  it("finished: false opens a job that was finished (by replace, or by hand); finished: true closes it; saying nothing leaves it", async () => {
    await upsertJobs({ jobs: [J("a"), J("b")] }, agent, NOW);
    const r1 = await upsertJobs({ jobs: [J("a")], replace: true }, agent, NOW);
    expect(r1.finished).toEqual(["b"]);
    expect(wf("b").finishedAt).toEqual(NOW);
    await upsertJobs({ jobs: [J("b")] }, agent, NOW);
    expect(wf("b").finishedAt).toEqual(NOW);
    await upsertJobs({ jobs: [J("b", { finished: false })] }, agent, NOW);
    expect(wf("b").finishedAt).toBeNull();
    await upsertJobs({ jobs: [J("b", { finished: true })] }, agent, NOW);
    expect(wf("b").finishedAt).toEqual(NOW);
  });

  it("replace only closes jobs the agent made, and never one that is merged or put away", async () => {
    await h.db.workflow.create({ data: jobRow("seeded", ["x"]) });
    await upsertJobs({ jobs: [J("a"), J("m"), J("p")] }, agent, NOW);
    await mergeJobs("a", "m", owner, NOW);
    await h.db.workflow.updateMany({ where: { key: "p" }, data: { archivedAt: NOW } });
    const r = await upsertJobs({ jobs: [J("a")], replace: true }, agent, NOW);
    expect(r.finished).toEqual([]);
    expect(wf("seeded").finishedAt).toBeNull();
  });

  it("replace never finishes a job the list mentions, even when that entry is refused (a phone number, a bad cron, a reserved branch id)", async () => {
    await upsertJobs({ jobs: [J("a"), J("b"), J("c"), J("d"), J("gone")] }, agent, NOW);
    const r = await upsertJobs(
      { jobs: [J("a", { note: "اتصل 0791234567" }), J("b", { schedule: "not a cron" }), J("c", { branches: [{ id: "start", label: "x" }] }), J("d", { branches: [{ id: "x", label: "1" }, { id: "x", label: "2" }] })], replace: true },
      agent,
      NOW,
    );
    expect(r.jobs.map((j) => j.ok)).toEqual([false, false, false, false]);
    expect(r.finished).toEqual(["gone"]);
    for (const k of ["a", "b", "c", "d"]) expect(wf(k).finishedAt, k).toBeNull();
  });

  it("a name that is another job's is refused, with that job's key — and a key of its own is allowed to keep its name", async () => {
    await upsertJobs({ jobs: [J("a", { name: "الفحص اليومي" })] }, agent, NOW);
    const r = await upsertJobs({ jobs: [J("b", { name: "الفحص  اليومي" }), J("a", { name: "الفحص اليومي", note: "ملاحظة" })] }, agent, NOW);
    expect(r.jobs[0]).toMatchObject({ key: "b", ok: false });
    expect(r.jobs[0]!.error).toContain("a");
    expect(r.jobs[1]).toMatchObject({ key: "a", ok: true });
    expect((h.db.workflow as unknown as { rows: Rows }).rows.map((w) => w.key)).toEqual(["a"]);
  });

  it("a rename into another job's name is refused too, unless the owner already owns that name", async () => {
    await upsertJobs({ jobs: [J("a", { name: "أول" }), J("b", { name: "ثاني" })] }, agent, NOW);
    const r = await upsertJobs({ jobs: [J("b", { name: "أول" })] }, agent, NOW);
    expect(r.jobs[0]).toMatchObject({ ok: false });
    expect(wf("b").name).toBe("ثاني");
  });

  it("a key that was merged into another job lands on that one, and the answer says where", async () => {
    await upsertJobs({ jobs: [J("keep", { name: "الباقية" }), J("drop", { name: "المدموجة" })] }, agent, NOW);
    await mergeJobs("keep", "drop", owner, NOW);
    const r = await upsertJobs({ jobs: [J("drop", { name: "الباقية", note: "تحديث" })] }, agent, NOW);
    expect(r.jobs[0]).toMatchObject({ key: "keep", ok: true, redirected_to: "keep" });
    expect(wf("keep").note).toBe("تحديث");
    expect(wf("drop").note).not.toBe("تحديث");
    expect((h.db.workflow as unknown as { rows: Rows }).rows).toHaveLength(2);
  });

  it("steps the agent's list no longer has are marked — in the answer, on the job, and in a new version of its drawing", async () => {
    await upsertJobs({ jobs: [J("a", { branches: [{ id: "x", label: "ص" }, { id: "y", label: "ع" }] })] }, agent, NOW);
    const r = await upsertJobs({ jobs: [J("a", { branches: [{ id: "x", label: "ص" }] })] }, agent, NOW);
    expect(r.jobs[0]).toMatchObject({ gone_steps: ["y"] });
    expect(r.jobs[0]!.branches).toEqual([{ id: "x", enabled: true }]);
    const g = wf("a").graph as WfGraph;
    expect(g.nodes.find((n) => n.id === "y")).toMatchObject({ disabled: true, desc: GONE_DESC });
    expect(wf("a").version).toBe(2);
    // back in the list: on again
    const back = await upsertJobs({ jobs: [J("a", { branches: [{ id: "x", label: "ص" }, { id: "y", label: "ع" }] })] }, agent, NOW);
    expect(back.jobs[0]!.gone_steps).toBeUndefined();
    expect((wf("a").graph as WfGraph).nodes.find((n) => n.id === "y")!.disabled).toBeUndefined();
    // a push that repeats the list changes nothing
    const version = wf("a").version;
    await upsertJobs({ jobs: [J("a", { branches: [{ id: "x", label: "ص" }, { id: "y", label: "ع" }] })] }, agent, NOW);
    expect(wf("a").version).toBe(version);
  });

  it("a job the agent makes is carried out by that agent (an old token tied to nobody is Claude)", async () => {
    await upsertJobs({ jobs: [J("h1"), J("c1")] }, agent, NOW, { actorKey: "hermes" });
    await upsertJobs({ jobs: [J("c2")] }, agent, NOW);
    await upsertJobs({ jobs: [J("c3")] }, agent, NOW, { actorKey: "claude" });
    expect(wf("h1")).toMatchObject({ assigneeKey: "hermes", executor: "hermes", source: "mcp" });
    expect(wf("c2")).toMatchObject({ assigneeKey: "claude", executor: "claude_mcp" });
    expect(wf("c3")).toMatchObject({ assigneeKey: "claude", executor: "claude_mcp" });
  });

  it("the owner's switch and decision are still his (a push never switches a job back on)", async () => {
    await upsertJobs({ jobs: [J("a")] }, agent, NOW);
    await h.db.workflow.updateMany({ where: { key: "a" }, data: { enabled: false, decision: "cancel" } });
    const r = await upsertJobs({ jobs: [J("a", { name: "مهمة a" })] }, agent, NOW);
    expect(r.jobs[0]).toMatchObject({ enabled: false, decision: "cancel" });
  });
});

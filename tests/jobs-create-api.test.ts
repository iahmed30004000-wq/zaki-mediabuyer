/**
 * POST /api/jobs (v6 · P4-1, docs/rebuild-v6/02-screens.md §3.7 «الحفظ»), through the real handler and the real server code over the stand-in database: only the owner and the manager
 * (`work.create`) may make a job; the job gets the next number and `source: "ui"` and its first version; «هلق» asks for the run the way the clock would; a one-time job for a
 * person is a task; a time in the past, a name that is already a job, a person who is not in the directory and a text with a phone number are refused and nothing is written.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRow } from "./helpers/fake-db";

const state = vi.hoisted(() => ({ role: "OWNER" as string | null, audits: [] as { action: string; after?: unknown }[], db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> & { user: unknown } }));

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (state.role ? { value: "session" } : undefined) }) }));
vi.mock("@/lib/session-token", async (orig) => ({ ...(await orig<typeof import("@/lib/session-token")>()), authRequired: () => true, readSession: async (v?: string) => (v ? { sub: "u1", ver: 1 } : null) }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  const db = makeFakeDb() as ReturnType<typeof makeFakeDb> & { user: unknown };
  db.user = { findUnique: async () => (state.role ? { id: "u1", role: state.role, active: true, sessionVer: 1 } : null) };
  state.db = db;
  return { db };
});
vi.mock("@/server/audit", () => ({ audit: async (_a: unknown, action: string, _t: unknown, d?: { after?: unknown }) => void state.audits.push({ action, after: d?.after }) }));

import { POST } from "@/app/api/jobs/route";
import { createJobFromDraft, DraftRefused } from "@/server/jobs-create";
import { PERSON_REPEAT_REFUSAL, type JobDraft } from "@/core/job-draft";
import { GraphSchema } from "@/core/workflow";

type Rows = Record<string, any>[];
const rows = (name: "workflow" | "workflowVersion" | "workflowRun" | "handoff" | "task"): Rows => (state.db[name] as unknown as { rows: Rows }).rows;
const owner = { type: "user" as const, id: "u1" };
const NOW = new Date("2026-11-22T10:00:00.000Z"); // Sunday 13:00 on the Amman clock

const draft = (over: Partial<JobDraft> = {}): JobDraft => ({
  name: "فحص المخزون",
  domain: "ops",
  assigneeKey: "claude",
  when: { kind: "daily", time: "09:30" },
  steps: [
    { verb: "read", text: "اقرا المخزون" },
    { verb: "decide", text: "إذا المخزون قليل" },
    { verb: "tell", text: "ابعتلي تنبيه" },
  ],
  notifyOn: ["stuck", "missed", "failed"],
  ...over,
});
const post = (body: unknown) => POST(new Request("http://localhost/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const FUTURE = { kind: "once", date: "2099-01-05", time: "09:00" } as const;

beforeEach(async () => {
  state.role = "OWNER";
  state.audits.length = 0;
  for (const t of Object.values(state.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  // the team directory: Claude, an agent, and two people
  for (const [key, name, kind, team] of [["claude", "Claude", "agent", null], ["hermes", "هيرمز", "agent", null], ["member1", "عضو الفريق", "person", "confirm"], ["site", "الموقع", "agent", null]] as const) await state.db.actor.create({ data: { key, name, kind, team } });
  await state.db.actor.create({ data: { key: "gone", name: "راح", kind: "person", active: false } });
  for (const [k, n] of [["night-round", 1], ["daily-check", 2], ["old", 9]] as const) await state.db.workflow.create({ data: jobRow(k, ["a"], { number: n, name: `مهمة ${k}` }) });
});

describe("who may make a job", () => {
  it("the owner and the manager: 201", async () => {
    for (const role of ["OWNER", "MANAGER"]) {
      state.role = role;
      const r = await post({ draft: draft({ name: `مهمة ${role}`, when: FUTURE }) });
      expect(r.status, role).toBe(201);
    }
    expect(rows("workflow").filter((w) => w.source === "ui")).toHaveLength(2);
  });

  it("everybody else: 403, and nothing is written; nobody signed in: 401", async () => {
    for (const role of ["ADS_MANAGER", "OPS_MANAGER", "TEAM_LEAD", "MEMBER", "ANALYST", "VIEWER"]) {
      state.role = role;
      expect((await post({ draft: draft({ when: FUTURE }) })).status, role).toBe(403);
    }
    state.role = null;
    expect((await post({ draft: draft({ when: FUTURE }) })).status).toBe(401);
    expect(rows("workflow")).toHaveLength(3);
    expect(rows("workflowVersion")).toHaveLength(0);
    expect(state.audits).toEqual([]);
  });
});

describe("what a saved job is", () => {
  it("the next number after the biggest on the map, `source: ui`, switched on, the site as its clock, its first version, and the audit line", async () => {
    const r = await post({ draft: draft({ when: FUTURE }) });
    const out = await r.json();
    expect(r.status).toBe(201);
    expect(out).toMatchObject({ ok: true, kind: "job", number: 10, name: "فحص المخزون", asked: null });
    expect(out.href).toBe(`/tasks/${out.key}`);
    expect(out.key).toMatch(/^wf-[0-9a-f]{6}$/);
    const w = rows("workflow").find((x) => x.key === out.key)!;
    expect(w).toMatchObject({ source: "ui", number: 10, enabled: true, wake: "site", assigneeKey: "claude", executor: "claude_mcp", kind: "once", domain: "ops", version: 1, permission: "green", notifyOn: ["stuck", "missed", "failed"] });
    expect(w.runsAt.toISOString()).toBe("2099-01-05T06:00:00.000Z");
    expect(GraphSchema.safeParse(w.graph).success).toBe(true);
    // every node has a place (the drawing board opens it laid out)
    expect(w.graph.nodes.every((n: { x?: number; y?: number }) => typeof n.x === "number" && typeof n.y === "number")).toBe(true);
    expect(rows("workflowVersion")).toEqual([expect.objectContaining({ workflowId: w.id, version: 1, note: "من «مهمة جديدة»", createdBy: "u1" })]);
    expect(state.audits).toEqual([{ action: "workflow.create", after: expect.objectContaining({ key: out.key, from: "builder", assignee: "claude" }) }]);
  });

  it("the second one is the one after: numbers are never shared", async () => {
    const a = await (await post({ draft: draft({ name: "أولى", when: FUTURE }) })).json();
    const b = await (await post({ draft: draft({ name: "تانية", when: FUTURE }) })).json();
    expect([a.number, b.number]).toEqual([10, 11]);
  });

  it("every day at 09:30: the cron, the words, recurring; what the owner wrote is his (`ownerEdited`)", async () => {
    const out = await (await post({ draft: draft() })).json();
    const w = rows("workflow").find((x) => x.key === out.key)!;
    expect(w).toMatchObject({ kind: "recurring", schedule: "30 9 * * *", scheduleText: "كل يوم 09:30", runsAt: null, endsAt: null });
    expect(w.ownerEdited).toEqual(expect.arrayContaining(["name", "schedule", "scheduleText", "kind"]));
    expect(w.scheduleChangedAt).toBeInstanceOf(Date);
  });

  it("a job for another agent carries that agent's executor", async () => {
    const out = await (await post({ draft: draft({ name: "للهيرمز", assigneeKey: "hermes", when: FUTURE }) })).json();
    expect(rows("workflow").find((x) => x.key === out.key)).toMatchObject({ assigneeKey: "hermes", executor: "hermes" });
  });

  it("a repeating or window job for a person is refused (a person cannot log a run, so every slot would be marked missed) and nothing is written", async () => {
    const whens: JobDraft["when"][] = [
      { kind: "daily", time: "09:30" },
      { kind: "weekly", days: [0, 2], time: "09:30" },
      { kind: "hourly", from: "09:00", to: "17:00", everyHours: 2 },
      { kind: "window", everyHours: 2, until: "2099-01-05T10:00:00.000Z" },
    ];
    for (const when of whens) {
      const r = await post({ draft: draft({ name: "تذكير متكرر", assigneeKey: "member1", when }) });
      const out = await r.json();
      expect(r.status).toBe(400);
      expect(out).toMatchObject({ ok: false, field: "assigneeKey", error: PERSON_REPEAT_REFUSAL });
    }
    expect(rows("workflow")).toHaveLength(3);
    expect(rows("workflowVersion")).toHaveLength(0);
    expect(rows("task")).toHaveLength(0);
    expect(rows("handoff")).toHaveLength(0);
  });
});

describe("«هلق»", () => {
  it("saves the job and asks for the run at once, the way the clock does for that moment: one queued run on the slot, one open request for the doer", async () => {
    const out = await createJobFromDraft(draft({ name: "هلق", when: { kind: "now" } }), owner, NOW);
    expect(out).toMatchObject({ kind: "job", asked: true });
    if (out.kind !== "job") throw new Error();
    const w = rows("workflow").find((x) => x.key === out.key)!;
    expect(w).toMatchObject({ kind: "once", schedule: null });
    expect(w.runsAt.toISOString()).toBe(NOW.toISOString());
    const run = rows("workflowRun").find((x) => x.workflowId === w.id)!;
    expect(run).toMatchObject({ status: "queued", ref: `slot-${NOW.toISOString()}`, trigger: "schedule" });
    expect(run.scheduledFor.toISOString()).toBe(NOW.toISOString());
    expect(rows("handoff")).toEqual([expect.objectContaining({ workflowKey: out.key, kind: "manual_run", assignee: "claude", status: "open", runRef: `slot-${NOW.toISOString()}` })]);
  });

  it("the request goes to the person or the agent who was chosen", async () => {
    await createJobFromDraft(draft({ name: "للهيرمز هلق", assigneeKey: "hermes", when: { kind: "now" } }), owner, NOW);
    expect(rows("handoff")[0]).toMatchObject({ assignee: "hermes" });
  });
});

describe("a one-time job for a person is a task", () => {
  it("a task on the team's board with its time and the steps in the note — and no job", async () => {
    const out = await post({ draft: draft({ name: "ردّ على الرسالة", assigneeKey: "member1", when: { kind: "once", date: "2099-01-05", time: "09:00" }, steps: [{ verb: "do", text: "ردّ على الرسالة" }] }) });
    const body = await out.json();
    expect(out.status).toBe(201);
    expect(body).toMatchObject({ ok: true, kind: "task", title: "ردّ على الرسالة", href: "/tasks/team" });
    expect(rows("task")).toEqual([expect.objectContaining({ title: "ردّ على الرسالة", assignee: "member1", executor: "person", source: "ui", note: "1. نفّذ: ردّ على الرسالة" })]);
    expect(rows("task")[0]!.dueAt.toISOString()).toBe("2099-01-05T06:00:00.000Z");
    expect(rows("workflow")).toHaveLength(3);
  });

  it("«هلق» for a person is a task due now", async () => {
    const out = await createJobFromDraft(draft({ name: "هلق لعضو الفريق", assigneeKey: "member1", when: { kind: "now" } }), owner, NOW);
    expect(out).toMatchObject({ kind: "task" });
    expect(rows("task")[0]!.dueAt.toISOString()).toBe(NOW.toISOString());
  });
});

describe("what is refused — and nothing is written", () => {
  const refused = async (d: JobDraft, status: number, field?: string, message?: RegExp) => {
    const r = await post({ draft: d });
    const out = await r.json();
    expect(r.status).toBe(status);
    expect(out.ok).toBe(false);
    if (field) expect(out.field).toBe(field);
    if (message) expect(out.error).toMatch(message);
    expect(rows("workflow")).toHaveLength(3);
    expect(rows("workflowVersion")).toHaveLength(0);
    expect(rows("task")).toHaveLength(0);
    expect(rows("handoff")).toHaveLength(0);
  };

  it("a one-time moment in the past", async () => {
    await refused(draft({ when: { kind: "once", date: "2020-01-01", time: "09:00" } }), 400, "when.date", /فات/);
  });

  it("a name that is already a job (once the marks are gone): 409, and it says which", async () => {
    await refused(draft({ name: "مهمة  night-round!", when: FUTURE }), 409, "name", /night-round/);
  });

  it("a doer who is not in the directory, or who is put away", async () => {
    await refused(draft({ assigneeKey: "nobody", when: FUTURE }), 400, "assigneeKey");
    await refused(draft({ assigneeKey: "gone", when: FUTURE }), 400, "assigneeKey");
  });

  it("the site by itself: its recipes are not built yet, so a draft that wants one is told so; the site with free steps is refused by the draft's own rule", async () => {
    await refused(draft({ assigneeKey: "site", steps: [], recipe: { name: "stock_alert", params: {} }, when: FUTURE }), 400, "recipe", /وصفات/);
    await refused(draft({ assigneeKey: "site", when: FUTURE }), 400, "assigneeKey");
  });

  it("a text with a customer's phone number (the filter every text goes through)", async () => {
    await refused(draft({ steps: [{ verb: "tell", text: "اتصل على 0791234567" }], when: FUTURE }), 400, "steps", /رقم هاتف/);
    await refused(draft({ name: "للرقم 0791234567", when: FUTURE }), 400, "steps");
  });

  it("no steps, an empty name, a bad shape: 400 with the sentence", async () => {
    await refused(draft({ steps: [], when: FUTURE }), 400, "steps");
    await refused(draft({ name: "  ", when: FUTURE }), 400, "name");
    const r = await post({ draft: { ...draft(), surprise: 1 } });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toMatch(/المسودة/);
    expect((await post("nope")).status).toBe(400);
  });

  it("DraftRefused carries its status and field to the caller", async () => {
    await expect(createJobFromDraft(draft({ when: { kind: "once", date: "2020-01-01", time: "09:00" } }), owner, NOW)).rejects.toMatchObject({ status: 400, field: "when.date" });
    await expect(createJobFromDraft(draft({ name: "مهمة old" }), owner, NOW)).rejects.toBeInstanceOf(DraftRefused);
  });
});

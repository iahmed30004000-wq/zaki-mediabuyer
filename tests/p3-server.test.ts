/**
 * The server pieces of P3 on the in-memory stand-in: the bell (a person reads and marks only their own notices), «تجاهل» on a missed slot, «نظّف المكرّر» (the merges the owner chose, the
 * jobs that never ran put away, the numbers 1…N), and the scope check of the routes that change many tasks by id (S-19). The real database was used for the same flows by hand (docs/rebuild-v6/NOTES.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb>, keys: null as string[] | null, actorOfUser: null as { key: string } | null }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test", omsLinked: () => false }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async () => undefined, telegramFromEnv: () => null }));
vi.mock("@/server/directory", () => ({ taskKeysFor: async () => h.keys, actorOfUser: async () => h.actorOfUser }));

import { HttpError } from "@/server/auth";
import { loadBell, markBellRead } from "@/server/notifications";
import { dismissMissed } from "@/server/run-actions";
import { HandoffRefused } from "@/server/handoffs";
import { listNeverRun, tidyJobs } from "@/server/job-map";
import { assertTasksInScope } from "@/server/task-scope";

type Rows = Record<string, any>[];
const rows = (name: string): Rows => (h.db as unknown as Record<string, { rows: Rows }>)[name]!.rows;
const owner = { type: "user" as const, id: "u1" };
const NOW = new Date("2026-11-22T12:00:00.000Z");
const clear = () => {
  for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
};

describe("the bell", () => {
  beforeEach(() => {
    clear();
    h.actorOfUser = null;
  });
  const note = (over: Record<string, unknown>) => h.db.notification.create({ data: { urgency: "orange", title: "x", ...over } });

  it("the owner and the manager read the owner's notices: the unread count, the newest first, a link inside the site only", async () => {
    await note({ title: "قديم", key: "k1", createdAt: new Date("2026-11-22T10:00:00.000Z"), readAt: new Date("2026-11-22T10:30:00.000Z") });
    await note({ title: "جولة فاتت", key: "k2", createdAt: new Date("2026-11-22T11:50:00.000Z"), href: "/tasks/night" });
    await note({ title: "بره", key: "k3", createdAt: new Date("2026-11-22T11:55:00.000Z"), href: "https://evil.example", urgency: "red" });
    await note({ title: "لحدا تاني", key: "k4", audience: "member-a" });
    const bell = await loadBell({ id: "u1", role: "OWNER", demo: false }, NOW);
    expect(bell.unread).toBe(2);
    expect(bell.items.map((i) => i.title)).toEqual(["بره", "جولة فاتت", "قديم"]);
    expect(bell.items.map((i) => i.href)).toEqual([null, "/tasks/night", null]);
    expect(bell.items[0]).toMatchObject({ lamp: "fail", unread: true });
    expect((await loadBell({ id: "u2", role: "MANAGER", demo: false }, NOW)).unread).toBe(2);
  });

  it("«علّم الكل مقروء» really writes readAt — on the person's own notices only", async () => {
    await note({ title: "ا", key: "a" });
    await note({ title: "ب", key: "b" });
    await note({ title: "لحدا تاني", key: "c", audience: "member-a" });
    expect(await markBellRead({ id: "u1", role: "OWNER", demo: false }, undefined, NOW)).toBe(2);
    expect(rows("notification").filter((n) => n.audience === "owner").every((n) => n.readAt instanceof Date)).toBe(true);
    expect(rows("notification").find((n) => n.audience === "member-a")!.readAt).toBeNull();
    expect((await loadBell({ id: "u1", role: "OWNER", demo: false }, NOW)).unread).toBe(0);
    // a second press changes nothing
    expect(await markBellRead({ id: "u1", role: "OWNER", demo: false }, undefined, NOW)).toBe(0);
  });

  it("only these ids, when ids are given — and never one that belongs to another audience", async () => {
    const a = await note({ title: "ا", key: "a" });
    await note({ title: "ب", key: "b" });
    const other = await note({ title: "لحدا", key: "c", audience: "member-a" });
    expect(await markBellRead({ id: "u1", role: "OWNER", demo: false }, [a.id, other.id], NOW)).toBe(1);
    expect(rows("notification").find((n) => n.id === other.id)!.readAt).toBeNull();
    expect((await loadBell({ id: "u1", role: "OWNER", demo: false }, NOW)).unread).toBe(1);
  });

  it("a person with a directory entry reads their own notices; a role with neither the owner's audience nor an entry has an empty bell", async () => {
    await note({ title: "للمالك", key: "o" });
    await note({ title: "لحدا", key: "s", audience: "member-a" });
    h.actorOfUser = { key: "member-a" };
    expect((await loadBell({ id: "u3", role: "MEMBER", demo: false }, NOW)).items.map((i) => i.title)).toEqual(["لحدا"]);
    h.actorOfUser = null;
    expect(await loadBell({ id: "u3", role: "MEMBER", demo: false }, NOW)).toEqual({ unread: 0, items: [] });
    expect(await markBellRead({ id: "u3", role: "MEMBER", demo: false }, undefined, NOW)).toBe(0);
  });
});

describe("«تجاهل» — a missed slot becomes «انتخطت»", () => {
  beforeEach(async () => {
    clear();
    await h.db.workflow.create({ data: jobRow("night", ["a", "b"]) });
  });

  it("a missed run is set aside with the reason «owner_skipped»; it is no longer missed", async () => {
    const wf = rows("workflow")[0]!;
    const run = await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "slot-1", status: "missed", endReason: "missed", startedAt: NOW, finishedAt: NOW, nodeStates: {} } });
    const r = await dismissMissed("night", run.id, owner, new Date("2026-11-22T13:00:00.000Z"));
    expect(r.run.status).toBe("skipped");
    expect(rows("workflowRun")[0]).toMatchObject({ status: "skipped", endReason: "owner_skipped" });
  });

  it("only a missed slot can be dismissed: a running one, a finished one and a second press are refused", async () => {
    const wf = rows("workflow")[0]!;
    const running = await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "r1", status: "running", startedAt: NOW, nodeStates: {} } });
    await expect(dismissMissed("night", running.id, owner, NOW)).rejects.toBeInstanceOf(HandoffRefused);
    const missed = await h.db.workflowRun.create({ data: { workflowId: wf.id, ref: "slot-2", status: "missed", startedAt: NOW, nodeStates: {} } });
    await dismissMissed("night", missed.id, owner, NOW);
    await expect(dismissMissed("night", missed.id, owner, NOW)).rejects.toThrow(/مش «فاتت»/);
    await expect(dismissMissed("night", "nope", owner, NOW)).rejects.toThrow(/التشغيل مش موجود/);
    await expect(dismissMissed("ghost", missed.id, owner, NOW)).rejects.toThrow(/المهمة مش موجودة/);
  });
});

describe("«نظّف المكرّر»", () => {
  beforeEach(async () => {
    clear();
    await h.db.workflow.create({ data: jobRow("night-a", ["a"], { name: "جولة الليل", number: 1, domain: "ads", source: "ui" }) });
    await h.db.workflow.create({ data: jobRow("night-b", ["a"], { name: "جولة الليل", number: 5, domain: "ads", source: "ui" }) });
    await h.db.workflow.create({ data: jobRow("planted", ["a"], { name: "مزروعة", number: 9, domain: "ops", source: "seed" }) });
    await h.db.workflow.create({ data: jobRow("planted-ran", ["a"], { name: "مزروعة اشتغلت", number: 10, domain: "ops", source: "seed" }) });
    const ran = rows("workflow").find((w) => w.key === "planted-ran")!;
    await h.db.workflowRun.create({ data: { workflowId: ran.id, ref: "r1", status: "ok", startedAt: NOW, nodeStates: {} } });
  });

  it("the jobs the site planted that never ran are offered to be put away; one that ran is not", async () => {
    expect((await listNeverRun()).map((j) => j.key)).toEqual(["planted"]);
  });

  it("merges the pairs he chose, puts away what never ran, and numbers the map 1…N — nothing is deleted", async () => {
    const r = await tidyJobs({ merges: [{ keep: "night-a", drop: "night-b" }], archive: ["planted"], renumber: true }, owner, NOW);
    expect(r).toMatchObject({ merged: 1, archived: 1, refused: [] });
    expect(r.renumbered).toMatchObject({ total: 2 });
    const byKey = Object.fromEntries(rows("workflow").map((w) => [w.key, w]));
    expect(byKey["night-b"]).toMatchObject({ mergedInto: "night-a", enabled: false });
    expect(byKey["night-b"].archivedAt).toBeInstanceOf(Date);
    expect(byKey["planted"].archivedAt).toBeInstanceOf(Date);
    expect(byKey["planted"].enabled).toBe(false);
    expect(rows("workflow")).toHaveLength(4); // nothing deleted
    // the two that are left are numbered 1 and 2 (ads first, then ops)
    expect([byKey["night-a"].number, byKey["planted-ran"].number]).toEqual([1, 2]);
  });

  it("a merge that is refused is reported and the rest goes on; with nothing done there is no renumbering", async () => {
    const r = await tidyJobs({ merges: [{ keep: "night-a", drop: "ghost" }, { keep: "night-a", drop: "night-a" }], archive: [], renumber: true }, owner, NOW);
    expect(r.merged).toBe(0);
    expect(r.refused).toHaveLength(2);
    expect(r.renumbered).toBeNull();
  });

  it("archiving the same key twice, or a key that is already away, changes nothing the second time", async () => {
    const first = await tidyJobs({ merges: [], archive: ["planted", "planted"], renumber: false }, owner, NOW);
    expect(first.archived).toBe(1);
    expect((await tidyJobs({ merges: [], archive: ["planted"], renumber: false }, owner, NOW)).archived).toBe(0);
  });
});

describe("S-19 — the routes that change many tasks check the scope first", () => {
  beforeEach(async () => {
    clear();
    await h.db.task.create({ data: { id: "t1", title: "لفريقي", assignee: "member-a" } });
    await h.db.task.create({ data: { id: "t2", title: "لفريق تاني", assignee: "member-b" } });
    await h.db.task.create({ data: { id: "t3", title: "بلا مسؤول", assignee: null } });
  });
  const lead = { id: "u1", role: "TEAM_LEAD" as const, demo: false };

  it("a role that sees all is never refused (keys = null)", async () => {
    h.keys = null;
    await expect(assertTasksInScope({ ...lead, role: "OWNER" }, ["t1", "t2", "t3"])).resolves.toBeUndefined();
  });

  it("a team lead may change their own team's tasks", async () => {
    h.keys = ["member-a", "lead"];
    await expect(assertTasksInScope(lead, ["t1"])).resolves.toBeUndefined();
  });

  it("another team's task, an unassigned one or one that does not exist is a 403 «هاي مهمة مش مهمتك» — before anything is written", async () => {
    h.keys = ["member-a", "lead"];
    for (const ids of [["t1", "t2"], ["t3"], ["ghost"]]) {
      const e = await assertTasksInScope(lead, ids).catch((x) => x);
      expect(e).toBeInstanceOf(HttpError);
      expect(e).toMatchObject({ status: 403, message: "هاي مهمة مش مهمتك" });
    }
  });

  it("a person with no link to the directory has no scope at all", async () => {
    h.keys = [];
    await expect(assertTasksInScope(lead, ["t1"])).rejects.toMatchObject({ status: 403 });
  });
});

import { describe, expect, it } from "vitest";
import { doorError, externalRefOf, idempotencyKeyOf, pickBoard, pullQueue, remoteDone, shouldPush, toDoorTask, workspaceConfigFrom, type TaskLike } from "@/core/workspace-door";

const task = (o: Partial<TaskLike> = {}): TaskLike => ({ id: "ckabc123", title: "جهّز تقرير الأسبوع", note: null, status: "new", assignee: "laith", executor: null, dueAt: null, priority: "normal", archivedAt: null, wsId: null, wsError: null, wsSyncedAt: null, updatedAt: new Date("2026-11-16T09:00:00Z"), ...o });

describe("the link", () => {
  it("needs https (or the machine's own localhost) and a token, and no password in the address", () => {
    expect(workspaceConfigFrom({ WORKSPACE_BASE_URL: "https://ws.example.com/", WORKSPACE_API_TOKEN: "t" })).toEqual({ base: "https://ws.example.com", token: "t", boardId: null });
    expect(workspaceConfigFrom({ WORKSPACE_BASE_URL: "http://localhost:3000", WORKSPACE_API_TOKEN: "t", WORKSPACE_BOARD_ID: " ckb1 " })).toMatchObject({ base: "http://localhost:3000", boardId: "ckb1" });
    expect(workspaceConfigFrom({ WORKSPACE_BASE_URL: "http://ws.example.com", WORKSPACE_API_TOKEN: "t" })).toBeNull();
    expect(workspaceConfigFrom({ WORKSPACE_BASE_URL: "https://u:p@ws.example.com", WORKSPACE_API_TOKEN: "t" })).toBeNull();
    expect(workspaceConfigFrom({ WORKSPACE_BASE_URL: "https://ws.example.com" })).toBeNull();
    expect(workspaceConfigFrom({ WORKSPACE_BASE_URL: "not a url", WORKSPACE_API_TOKEN: "t" })).toBeNull();
    expect(workspaceConfigFrom({})).toBeNull();
  });
});

describe("what goes out", () => {
  it("a person's open task goes; an agent's, a finished, an archived or an already-sent one does not", () => {
    expect(shouldPush(task())).toBe(true);
    expect(shouldPush(task({ assignee: null, executor: "person" }))).toBe(true);
    expect(shouldPush(task({ assignee: "claude" }))).toBe(false);
    expect(shouldPush(task({ assignee: "hermes", executor: "hermes" }))).toBe(false);
    expect(shouldPush(task({ assignee: null, executor: null }))).toBe(false);
    expect(shouldPush(task({ status: "done" }))).toBe(false);
    expect(shouldPush(task({ archivedAt: new Date() }))).toBe(false);
    expect(shouldPush(task({ wsId: "ckt1" }))).toBe(false);
    // refused by the door: not again until somebody edits it
    const refused = { wsError: "x", wsSyncedAt: new Date("2026-11-16T10:00:00Z") };
    expect(shouldPush(task({ ...refused }))).toBe(false);
    expect(shouldPush(task({ ...refused, updatedAt: new Date("2026-11-16T11:00:00Z") }))).toBe(true);
  });

  it("the body has only the fields the contract declares, with an opaque reference", () => {
    const b = toDoorTask(task({ priority: "urgent", note: "ملاحظة", dueAt: new Date("2026-11-20T00:00:00Z") }), "ckb1");
    expect(b).toEqual({ title: "جهّز تقرير الأسبوع", boardId: "ckb1", priority: "URGENT", externalRef: "mb:task/ckabc123", description: "ملاحظة", dueDate: "2026-11-20" });
    expect(Object.keys(toDoorTask(task(), "b")).sort()).toEqual(["boardId", "externalRef", "priority", "title"]);
    // no assignee and nothing that names a person or a price can ride in the body
    const keys = Object.keys(b).join(" ");
    expect(keys).not.toMatch(/assignee|name|phone|price|customer|amount/i);
    // the reference obeys the contract: letters, digits and . _ : - /, at most 128, no spaces, no @
    expect(externalRefOf("ckabc123")).toMatch(/^[A-Za-z0-9._:\/-]{1,128}$/);
    expect(idempotencyKeyOf("ckabc123")).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });

  it("maps the priorities, cuts the long, strips NUL and drops a date outside 2000–2100", () => {
    expect(toDoorTask(task({ priority: "low" }), "b").priority).toBe("LOW");
    expect(toDoorTask(task({ priority: "high" }), "b").priority).toBe("HIGH");
    expect(toDoorTask(task({ priority: "weird" }), "b").priority).toBe("NORMAL");
    expect(toDoorTask(task({ title: "x".repeat(400) }), "b").title).toHaveLength(280);
    expect(toDoorTask(task({ note: "y".repeat(12_000) }), "b").description).toHaveLength(10_000);
    expect(toDoorTask(task({ title: "a\u0000b", note: "c\u0000d" }), "b")).toMatchObject({ title: "ab", description: "cd" });
    expect(toDoorTask(task({ dueAt: new Date("1999-01-01T00:00:00Z") }), "b").dueDate).toBeUndefined();
    expect(toDoorTask(task({ dueAt: new Date("2101-01-01T00:00:00Z") }), "b").dueDate).toBeUndefined();
  });
});

describe("the board", () => {
  const boards = [{ id: "b1", name: "A" }, { id: "b2", name: "B" }];
  it("the owner's choice if listed; else the only one; else a reason, never a guess", () => {
    expect(pickBoard(boards, "b2")).toEqual({ ok: true, id: "b2" });
    expect(pickBoard(boards, "zzz")).toMatchObject({ ok: false });
    expect(pickBoard([boards[0]!], null)).toEqual({ ok: true, id: "b1" });
    expect(pickBoard(boards, null)).toMatchObject({ ok: false, why: expect.stringContaining("WORKSPACE_BOARD_ID") });
    expect(pickBoard([], null)).toMatchObject({ ok: false });
  });
});

describe("what comes back", () => {
  it("a task is closed here only when Workspace says done", () => {
    expect(remoteDone({ status: "done" })).toBe(true);
    expect(remoteDone({ status: "open", finishedAt: "2026-11-16T10:00:00.000Z" })).toBe(true);
    expect(remoteDone({ status: "open", finishedAt: null })).toBe(false);
    expect(remoteDone(null)).toBe(false);
    expect(remoteDone({})).toBe(false);
  });

  it("asks about pushed open tasks only, the longest-unchecked first, up to the limit", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 16, 10, m));
    const rows = [
      { id: "a", wsId: "1", status: "new", archivedAt: null, wsSyncedAt: at(30) },
      { id: "b", wsId: "2", status: "doing", archivedAt: null, wsSyncedAt: null },
      { id: "c", wsId: "3", status: "done", archivedAt: null, wsSyncedAt: null },
      { id: "d", wsId: null, status: "new", archivedAt: null, wsSyncedAt: null },
      { id: "e", wsId: "5", status: "new", archivedAt: new Date(), wsSyncedAt: null },
      { id: "f", wsId: "6", status: "new", archivedAt: null, wsSyncedAt: at(10) },
    ];
    expect(pullQueue(rows).map((r) => r.id)).toEqual(["b", "f", "a"]);
    expect(pullQueue(rows, 2).map((r) => r.id)).toEqual(["b", "f"]);
  });
});

describe("the door's refusals, in the owner's words", () => {
  it("a shut door stops the run; a bad task does not", () => {
    for (const s of [401, 403]) expect(doorError(s)).toMatchObject({ stop: true, retry: false });
    expect(doorError(404, "door.board_not_found")).toMatchObject({ stop: true });
    expect(doorError(404, "door.not_found")).toMatchObject({ stop: false, retry: false });
    expect(doorError(422, "door.customer_data_rejected")).toMatchObject({ stop: false, retry: false });
    expect(doorError(429)).toMatchObject({ stop: true, retry: true });
    expect(doorError(503)).toMatchObject({ stop: true, retry: true });
    expect(doorError(418).why).toContain("418");
  });
});

/**
 * `get_jobs` (docs/rebuild-v6/01-model.md §11): the agent reads its schedule from the site — the jobs it carries out (or all of them), with the steps and which
 * are on, when each is next due, and its last run. And the instructions the agent is given say so.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRpc } from "@/core/mcp-rpc";
import { TOOL_SCOPE, toolAllowed } from "@/core/token-scopes";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", async (orig) => ({ ...(await orig<typeof import("@/server/audit")>()), audit: async () => undefined }));
vi.mock("@/server/auth", () => ({ HttpError: class extends Error {} }));
vi.mock("@/server/notify", () => ({ URGENCY_ICON: { red: "r", orange: "o", yellow: "y" }, createNotification: async () => ({ created: true, id: "n" }), dispatchNotification: async () => ({}) }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test" }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async () => undefined, telegramFromEnv: () => null }));
vi.mock("@/server/settings", () => ({ getSetting: async () => ({ mode: "awake", schedule: { enabled: false, awake: "10:00", asleep: "23:00" }, switch: "manual" }) }));

import { SERVER_INSTRUCTIONS, TOOLS, type McpCtx } from "@/server/mcp/tools";

const INFO = { name: "t", version: "1" };
const ctxOf = (actorKey: string | null): McpCtx => ({ tokenId: "t1", tokenName: "T", actor: { type: "agent", id: "mcp:T" }, actorKey });
let n = 0;
const call = async (name: string, args: unknown, ctx: McpCtx) => {
  const r = (await handleRpc({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, TOOLS, ctx, INFO)).body as { result: { content: { text: string }[]; structuredContent?: any; isError?: boolean } };
  return { text: r.result.content[0]!.text, data: r.result.structuredContent, isError: !!r.result.isError };
};
type Rows = Record<string, any>[];

describe("get_jobs", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    const c = await h.db.workflow.create({ data: { ...jobRow("daily-check", ["read", "judge"], { number: 2, name: "الفحص اليومي", schedule: "43 10 * * *", scheduleText: "10:43", wake: "site" }), assigneeKey: "claude" } });
    await h.db.workflow.create({ data: { ...jobRow("hermes-requests", ["task"], { number: 5, name: "طلبات هيرمز" }), assigneeKey: "hermes" } });
    await h.db.workflow.create({ data: { ...jobRow("old", ["x"], { number: 6, archivedAt: new Date() }), assigneeKey: "claude" } });
    const g = (h.db.workflow as unknown as { rows: Rows }).rows[0]!;
    g.graph.nodes[2].disabled = true;
    await h.db.workflowRun.create({ data: { workflowId: c.id, ref: "r1", status: "ok", startedAt: new Date("2026-11-22T07:43:00Z"), scheduledFor: new Date("2026-11-22T07:43:00Z") } });
  });

  it("is a read tool of the «read» scope", () => {
    const t = TOOLS.find((x) => x.name === "get_jobs")!;
    expect(t.readOnly).toBe(true);
    expect(TOOL_SCOPE.get_jobs).toBe("mcp:read");
    expect(toolAllowed(["mcp:read"], "get_jobs")).toBe(true);
    expect(toolAllowed(["mcp:push"], "get_jobs")).toBe(false);
  });

  it("gives an agent the jobs it carries out, with the steps, which are on, when it is next due, and its last run", async () => {
    const r = await call("get_jobs", {}, ctxOf("claude"));
    expect(r.isError).toBe(false);
    expect(r.data.jobs.map((j: any) => j.key)).toEqual(["daily-check"]);
    const j = r.data.jobs[0];
    expect(j).toMatchObject({ key: "daily-check", number: 2, name: "الفحص اليومي", kind: "recurring", enabled: true, finished: false, wake: "site", assignee: "claude", schedule: "43 10 * * *", schedule_text: "10:43", grace_min: 15, max_run_min: 90 });
    expect(j.steps).toEqual([{ id: "read", title: "خطوة read", enabled: true }, { id: "judge", title: "خطوة judge", enabled: false }]);
    expect(j.next_run).toEqual(expect.stringMatching(/^2026|^20\d\d-/));
    expect(j.last_run).toEqual({ ref: "r1", status: "ok", started_at: "2026-11-22T07:43:00.000Z", scheduled_for: "2026-11-22T07:43:00.000Z" });
    expect(r.text).toContain("1 مهمة");
  });

  it("each agent sees its own: Hermes the Hermes ones, an old token tied to nobody is Claude, all=true is everything, key asks for one", async () => {
    expect((await call("get_jobs", {}, ctxOf("hermes"))).data.jobs.map((j: any) => j.key)).toEqual(["hermes-requests"]);
    expect((await call("get_jobs", {}, ctxOf(null))).data.jobs.map((j: any) => j.key)).toEqual(["daily-check"]);
    expect((await call("get_jobs", { all: true }, ctxOf("hermes"))).data.jobs.map((j: any) => j.key).sort()).toEqual(["daily-check", "hermes-requests"]);
    expect((await call("get_jobs", { key: "hermes-requests" }, ctxOf("claude"))).data.jobs.map((j: any) => j.key)).toEqual(["hermes-requests"]);
    const none = await call("get_jobs", {}, ctxOf("muse"));
    expect(none.data.jobs).toEqual([]);
    expect(none.text).toContain("all=true");
  });

  it("a job the owner switched off says so, a put-away job is not listed", async () => {
    await h.db.workflow.updateMany({ where: { key: "daily-check" }, data: { enabled: false } });
    const r = await call("get_jobs", {}, ctxOf("claude"));
    expect(r.data.jobs[0]).toMatchObject({ enabled: false, next_run: null });
    expect(r.data.jobs.some((j: any) => j.key === "old")).toBe(false);
  });

  it("refuses an input it does not know", async () => {
    expect((await call("get_jobs", { nope: 1 }, ctxOf("claude"))).isError).toBe(true);
  });

  it("the instructions tell the agent the site is the clock, wake, get_jobs, and to send scheduled_for", () => {
    for (const w of ["get_jobs", "wake", "scheduled_for", "get_handoffs"]) expect(SERVER_INSTRUCTIONS).toContain(w);
  });

  it("push_jobs says what the site now does with a map: its numbers, its names, what the owner edited, the steps that went", () => {
    const d = TOOLS.find((x) => x.name === "push_jobs")!.description;
    for (const w of ["finished=false", "kept_yours", "gone_steps"]) expect(d).toContain(w);
  });
});

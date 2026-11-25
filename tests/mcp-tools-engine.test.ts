/**
 * The tools of the engine as the agent calls them (v6 P1-1): log_run's answer, get_handoffs for its own agent, claim → code → complete, and ack_approval.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleRpc } from "@/core/mcp-rpc";
import { TOOL_SCOPE, toolAllowed } from "@/core/token-scopes";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  // the rows are stamped from the real clock: «what was decided in the last 48 hours» is measured against it
  h.db = makeFakeDb(new Date());
  return { db: h.db };
});
vi.mock("@/server/audit", async (orig) => ({ ...(await orig<typeof import("@/server/audit")>()), audit: async () => undefined }));
vi.mock("@/server/auth", () => ({ HttpError: class extends Error {} }));
vi.mock("@/server/notify", () => ({ URGENCY_ICON: { red: "r", orange: "o", yellow: "y" }, createNotification: async () => ({}), dispatchNotification: async () => ({}) }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test" }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async () => undefined, telegramFromEnv: () => null }));
vi.mock("@/server/settings", () => ({ getSetting: async (key: string) => (key === "owner.wake_kinds" ? [] : { mode: "awake", schedule: { enabled: false, awake: "10:00", asleep: "23:00" }, switch: "manual" }) }));

import { SERVER_INSTRUCTIONS, TOOLS, type McpCtx } from "@/server/mcp/tools";
import { requestRun } from "@/server/handoffs";
import { decideApproval } from "@/server/approvals";

const INFO = { name: "t", version: "1" };
const ctxOf = (actorKey: string | null, name = "Claude"): McpCtx => ({ tokenId: "t1", tokenName: name, actor: { type: "agent", id: `mcp:${name}` }, actorKey });
let n = 0;
const call = async (name: string, args: unknown, ctx: McpCtx) => {
  const r = (await handleRpc({ jsonrpc: "2.0", id: ++n, method: "tools/call", params: { name, arguments: args } }, TOOLS, ctx, INFO)).body as { result: { content: { text: string }[]; structuredContent?: any; isError?: boolean } };
  return { text: r.result.content[0]!.text, data: r.result.structuredContent, isError: !!r.result.isError };
};
const owner = { type: "user" as const, id: "u1" };
const table = (name: "handoff" | "workflowRun" | "approval") => (h.db[name] as unknown as { rows: Record<string, any>[] }).rows;

describe("the engine's tools", () => {
  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    await h.db.workflow.create({ data: jobRow("daily-check", ["read", "judge"]) });
    await h.db.workflow.create({ data: jobRow("hermes-requests", ["task"], { assigneeKey: "hermes" }) });
  });

  it("there is a tool to say a decision was carried out, and it needs the «ask» scope like request_approval", () => {
    expect(TOOLS.map((t) => t.name)).toContain("ack_approval");
    expect(TOOL_SCOPE.ack_approval).toBe("mcp:ask");
    expect(toolAllowed(["mcp:ask"], "ack_approval")).toBe(true);
    expect(toolAllowed(["mcp:read"], "ack_approval")).toBe(false);
    expect(TOOLS.find((t) => t.name === "ack_approval")!.readOnly).toBe(false);
  });

  it("the instructions tell the agent about the claim code, ack_approval and the answer's new fields", () => {
    expect(SERVER_INSTRUCTIONS).toContain("claim");
    expect(SERVER_INSTRUCTIONS).toContain("ack_approval");
    expect(SERVER_INSTRUCTIONS).toContain("disabled_steps");
    expect(SERVER_INSTRUCTIONS).toContain("ref");
  });

  describe("log_run", () => {
    it("is refused without a ref, in words the agent can act on", async () => {
      const r = await call("log_run", { job: "daily-check", status: "running" }, ctxOf("claude"));
      expect(r.isError).toBe(true);
      expect(r.text).toContain("ref");
    });

    it("answers with the steps the owner switched off and says nothing about stopping while he has not", async () => {
      await h.db.workflow.update({ where: { key: "daily-check" }, data: { graph: { nodes: [{ id: "start", type: "trigger", label: "x" }, { id: "read", type: "step", label: "r" }, { id: "judge", type: "step", label: "j", disabled: true }], edges: [] } } });
      const r = await call("log_run", { job: "daily-check", ref: "r1", status: "running" }, ctxOf("claude"));
      expect(r.isError).toBe(false);
      expect(r.data).toMatchObject({ disabled_steps: ["judge"], stop: false });
      expect(r.text).toContain("judge");
      expect(r.text).not.toContain("⛔");
    });

    it("says stop when the owner cancelled the run, and signs the run with the token's agent", async () => {
      await call("log_run", { job: "daily-check", ref: "r1", status: "running" }, ctxOf("claude"));
      expect(table("workflowRun")[0]!.doneBy).toBe("claude");
      await h.db.workflowRun.updateMany({ where: { ref: "r1" }, data: { status: "skipped", endReason: "cancelled" } });
      const r = await call("log_run", { job: "daily-check", ref: "r1", node: { id: "read", status: "done" } }, ctxOf("claude"));
      expect(r.data.stop).toBe(true);
      expect(r.text).toContain("⛔");
    });

    it("refuses to reopen a run that ended", async () => {
      await call("log_run", { job: "daily-check", ref: "r1", status: "ok" }, ctxOf("claude"));
      const r = await call("log_run", { job: "daily-check", ref: "r1", status: "running" }, ctxOf("claude"));
      expect(r.isError).toBe(true);
    });

    it("an agent that sends the site's own status is told so by the schema, before anything is written", async () => {
      const r = await call("log_run", { job: "daily-check", ref: "r1", status: "missed" }, ctxOf("claude"));
      expect(r.isError).toBe(true);
      expect(table("workflowRun")).toHaveLength(0);
    });
  });

  describe("the queue, as one agent sees it", () => {
    it("get_handoffs gives each agent its own requests", async () => {
      await requestRun("daily-check", owner);
      await requestRun("hermes-requests", owner);
      const claude = await call("get_handoffs", {}, ctxOf("claude"));
      expect(claude.data.handoffs.map((x: { workflowKey: string }) => x.workflowKey)).toEqual(["daily-check"]);
      const hermes = await call("get_handoffs", {}, ctxOf("hermes", "Hermes"));
      expect(hermes.data.handoffs.map((x: { workflowKey: string }) => x.workflowKey)).toEqual(["hermes-requests"]);
      // a token tied to nobody is Claude, as before
      const legacy = await call("get_handoffs", {}, ctxOf(null, "old"));
      expect(legacy.data.handoffs.map((x: { workflowKey: string }) => x.workflowKey)).toEqual(["daily-check"]);
    });

    it("claim → code → complete: the code is in the answer of the claim and in no list", async () => {
      const { handoff } = await requestRun("daily-check", owner);
      const claimed = await call("claim_handoff", { id: handoff.id }, ctxOf("claude"));
      expect(claimed.isError).toBe(false);
      const code: string = claimed.data.claim;
      expect(code).toBeTruthy();
      expect(claimed.text).toContain(code);
      expect(JSON.stringify((await call("get_handoffs", { status: ["claimed"] }, ctxOf("claude"))).data)).not.toContain(code);
      const wrong = await call("complete_handoff", { id: handoff.id, claim: "nope" }, ctxOf("claude"));
      expect(wrong.isError).toBe(true);
      const done = await call("complete_handoff", { id: handoff.id, claim: code, note: "تم" }, ctxOf("claude"));
      expect(done.isError).toBe(false);
      expect(done.data.run).toMatchObject({ status: "ok" });
    });

    it("another agent cannot take it, whatever its token is called", async () => {
      const { handoff } = await requestRun("hermes-requests", owner);
      const r = await call("claim_handoff", { id: handoff.id }, ctxOf("claude", "Hermes"));
      expect(r.isError).toBe(true);
      expect(table("handoff")[0]!.status).toBe("open");
    });

    it("create_handoff does not offer «resume» (the site's own kind)", () => {
      const schema = JSON.stringify(TOOLS.find((t) => t.name === "create_handoff")!.input.safeParse({ workflow: "daily-check", kind: "resume", title: "x" }));
      expect(schema).toContain("false");
    });
  });

  describe("ack_approval", () => {
    it("marks a decided request as carried out, and get_approvals stops offering it", async () => {
      const asked = await call("request_approval", { title: "ارفع", why: "ربح", urgency: "orange", ref: "a1" }, ctxOf("claude"));
      const id: string = asked.data.approval.id;
      expect((await call("ack_approval", { id }, ctxOf("claude"))).isError).toBe(true); // not answered yet
      await decideApproval(id, { action: "approve" }, { id: "u1", role: "OWNER" as never });
      expect((await call("get_approvals", {}, ctxOf("claude"))).data.approvals.map((x: { id: string }) => x.id)).toEqual([id]);
      const acked = await call("ack_approval", { id }, ctxOf("claude"));
      expect(acked.isError).toBe(false);
      expect(acked.data.approval.actedAt).toBeTruthy();
      expect((await call("get_approvals", {}, ctxOf("claude"))).data.approvals).toEqual([]);
    });

    it("request_approval takes the run and the step it came from", async () => {
      const r = await call("request_approval", { title: "t", why: "w", urgency: "yellow", run_ref: "r1", node_id: "judge", workflow: "daily-check" }, ctxOf("claude"));
      expect(r.data.approval).toMatchObject({ runRef: "r1", nodeId: "judge" });
    });

    it("an unknown id is said in words", async () => {
      expect((await call("ack_approval", { id: "nope" }, ctxOf("claude"))).isError).toBe(true);
    });
  });
});

/**
 * The doors of the engine after v6 P1-1: a batch of tool calls is at most 10, runs one after the other and is charged and audited per call;
 * the audit keeps the token's id (it used to lose it); every tool call says which agent was heard from; each REST door takes its own scope;
 * a link an agent sends is https only.
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { MAX_BATCH, countToolCalls, handleRpc, type ToolDef } from "@/core/mcp-rpc";
import { makeLimiter } from "@/core/rate-limit";
import { SEEN_EVERY_MS, shouldTouch } from "@/core/agent-seen";
import { isHttpsUrl } from "@/core/safe-url";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb>, audits: [] as { actor: unknown; action: string; target: unknown; change: unknown }[] }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", async (orig) => {
  const real = await orig<typeof import("@/server/audit")>();
  return { ...real, audit: async (actor: unknown, action: string, target: unknown, change: unknown) => void h.audits.push({ actor, action, target, change }) };
});
vi.mock("@/server/env", () => ({ appOrigin: () => "https://mb.test" }));

import { redact } from "@/server/audit";
import { ContractError, hashToken, requireToken } from "@/server/api-token";
import { touchAgent } from "@/server/agent-seen";
import { TOOLS } from "@/server/mcp/tools";
import { POST } from "@/app/mcp/route";

const INFO = { name: "t", version: "1", instructions: "x" };
type Ctx = { log: string[] };
const tools: ToolDef<Ctx>[] = [
  { name: "echo", title: "e", description: "d", input: z.object({ n: z.number().optional() }).strict(), readOnly: true, run: async (a, c) => { c.log.push(`start${(a as { n?: number }).n}`); await new Promise((r) => setTimeout(r, 2)); c.log.push(`end${(a as { n?: number }).n}`); return { text: "ok" }; } },
  { name: "bad", title: "b", description: "d", input: z.object({}), readOnly: false, run: async () => ({ text: "لا", isError: true }) },
];
const rpc = (name: string, args: unknown, id: number) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("a batch is not a way round the limits", () => {
  it("more than 10 messages is refused whole, with a sentence that says how many", async () => {
    expect(MAX_BATCH).toBe(10);
    const log: string[] = [];
    const reply = await handleRpc(Array.from({ length: 11 }, (_, i) => rpc("echo", { n: i }, i + 1)), tools, { log }, INFO);
    expect(JSON.stringify(reply.body)).toContain("-32600");
    expect(JSON.stringify(reply.body)).toContain("11");
    expect(log).toEqual([]);
    const ten = await handleRpc(Array.from({ length: 10 }, (_, i) => rpc("echo", { n: i }, i + 1)), tools, { log }, INFO);
    expect((ten.body as unknown[]).length).toBe(10);
  });

  it("the calls of a batch run one after the other, never all at once", async () => {
    const log: string[] = [];
    await handleRpc([rpc("echo", { n: 1 }, 1), rpc("echo", { n: 2 }, 2), rpc("echo", { n: 3 }, 3)], tools, { log }, INFO);
    expect(log).toEqual(["start1", "end1", "start2", "end2", "start3", "end3"]);
  });

  it("every tool call is reported, in a batch or alone, failures and unknown tools too — and notifications are not calls", async () => {
    const seen: { name: string; isError: boolean }[] = [];
    const onToolCall = (c: { name: string; isError: boolean }) => void seen.push(c);
    await handleRpc([rpc("echo", {}, 1), rpc("bad", {}, 2), rpc("nope", {}, 3), { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 9, method: "ping" }], tools, { log: [] }, INFO, { onToolCall });
    expect(seen).toEqual([{ name: "echo", isError: false }, { name: "bad", isError: true }, { name: "nope", isError: true }]);
    seen.length = 0;
    await handleRpc(rpc("echo", {}, 1), tools, { log: [] }, INFO, { onToolCall });
    expect(seen).toEqual([{ name: "echo", isError: false }]);
  });

  it("counts the calls a body carries", () => {
    expect(countToolCalls(rpc("echo", {}, 1))).toBe(1);
    expect(countToolCalls([rpc("echo", {}, 1), rpc("echo", {}, 2), { jsonrpc: "2.0", id: 3, method: "tools/list" }])).toBe(2);
    expect(countToolCalls({ jsonrpc: "2.0", id: 1, method: "ping" })).toBe(0);
    expect(countToolCalls(null)).toBe(0);
    expect(countToolCalls("x")).toBe(0);
  });

  it("the limiter charges a batch for each call in it", () => {
    const lim = makeLimiter(10, 60_000);
    expect(lim("t", 0, 4).ok).toBe(true);
    expect(lim("t", 0, 4).ok).toBe(true);
    expect(lim("t", 0, 4)).toMatchObject({ ok: false });
    expect(lim("t", 0, 2).ok).toBe(true);
    expect(lim("t", 1, 1).ok).toBe(false);
    expect(lim("t", 61_000, 10).ok).toBe(true);
    // the old call shape still works (one call)
    const one = makeLimiter(2, 1000);
    expect([one("k", 0).ok, one("k", 1).ok, one("k", 2).ok]).toEqual([true, true, false]);
  });
});

describe("the audit keeps WHICH token made a call", () => {
  it("the token's id is kept, and a real secret is still hidden", () => {
    expect(redact({ tokenId: "tok_123", error: false })).toEqual({ tokenId: "tok_123", error: false });
    expect(redact({ token: "mbm_secret", tokenHash: "abc", nested: { accessToken: "x", tokenId: "t1" } })).toEqual({ token: "[redacted]", tokenHash: "[redacted]", nested: { accessToken: "[redacted]", tokenId: "t1" } });
  });
});

describe("the MCP door, end to end", () => {
  const plain = "mbm_test-token-123456";
  const post = (body: unknown, token = plain) => POST(new Request("https://mb.test/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));
  const names = ["get_mode"];

  beforeEach(async () => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    h.audits.length = 0;
    await h.db.actor.create({ data: { key: "claude", name: "Claude", kind: "agent" } });
    await h.db.apiToken.create({ data: { name: "Claude", scopes: ["mcp"], tokenHash: hashToken(plain), prefix: "mbm_test", actorKey: "claude" } });
    expect(TOOLS.some((t) => t.name === names[0])).toBe(true);
  });

  it("a batch of 11 is refused (400), with nothing run and nothing audited as a call", async () => {
    const res = await post(Array.from({ length: 11 }, (_, i) => rpc("get_mode", {}, i + 1)));
    expect(res.status).toBe(400);
    expect(h.audits.filter((a) => a.action === "mcp.call")).toHaveLength(0);
  });

  it("each call of a batch is audited, with the token's id (never the token)", async () => {
    // get_mode needs the db settings: use the ones that need nothing — list_tasks / unknown tool errors are enough to see the audit
    const res = await post([rpc("nope_a", {}, 1), rpc("nope_b", {}, 2), rpc("nope_c", {}, 3)]);
    expect(res.status).toBe(200);
    const calls = h.audits.filter((a) => a.action === "mcp.call");
    expect(calls.map((c) => (c.target as { id: string }).id)).toEqual(["nope_a", "nope_b", "nope_c"]);
    const tokenId = (h.db.apiToken as unknown as { rows: { id: string }[] }).rows[0]!.id;
    for (const c of calls) expect(c.change).toEqual({ after: { tokenId, error: true } });
    expect(JSON.stringify(h.audits)).not.toContain(plain);
  });

  it("a single call is audited the same way", async () => {
    await post(rpc("nope", {}, 1));
    expect(h.audits.filter((a) => a.action === "mcp.call")).toHaveLength(1);
  });

  it("a call tells the site which agent was heard from", async () => {
    const other = "mbm_other-token-98765";
    await h.db.actor.create({ data: { key: "seen-agent", name: "s", kind: "agent" } });
    await h.db.apiToken.create({ data: { name: "S", scopes: ["mcp"], tokenHash: hashToken(other), prefix: "mbm_othe", actorKey: "seen-agent" } });
    const row = () => (h.db.actor as unknown as { rows: { key: string; lastSeenAt: Date | null }[] }).rows.find((r) => r.key === "seen-agent")!;
    expect(row().lastSeenAt).toBeNull();
    await post(rpc("nope", {}, 1), other);
    expect(row().lastSeenAt).toBeInstanceOf(Date);
  });

  it("a call that is not a tool call (a ping) does not count as being heard from", async () => {
    const other = "mbm_ping-token-55555";
    await h.db.actor.create({ data: { key: "ping-agent", name: "p", kind: "agent" } });
    await h.db.apiToken.create({ data: { name: "P", scopes: ["mcp"], tokenHash: hashToken(other), prefix: "mbm_ping", actorKey: "ping-agent" } });
    await post({ jsonrpc: "2.0", id: 1, method: "ping" }, other);
    expect((h.db.actor as unknown as { rows: { key: string; lastSeenAt: Date | null }[] }).rows.find((r) => r.key === "ping-agent")!.lastSeenAt).toBeNull();
  });

  it("a batch is charged per call: 120 a minute, so a batch of 10 repeated 13 times is stopped", async () => {
    const batch = Array.from({ length: 10 }, (_, i) => rpc("nope", {}, i + 1));
    let last = 200;
    for (let i = 0; i < 13; i++) last = (await post(batch, plain)).status;
    expect(last).toBe(429);
  });
});

describe("when an agent was last heard from", () => {
  it("is written once a minute at most", async () => {
    expect(shouldTouch(null, 1000)).toBe(true);
    expect(shouldTouch(1000, 1000 + SEEN_EVERY_MS - 1)).toBe(false);
    expect(shouldTouch(1000, 1000 + SEEN_EVERY_MS)).toBe(true);
  });

  it("a token tied to nobody touches nobody, and a missing actor is not an error", async () => {
    await touchAgent(null);
    await touchAgent(undefined);
    await touchAgent("ghost-agent-9");
  });

  it("the statement itself refuses a second write inside the minute", async () => {
    await h.db.actor.create({ data: { key: "muse-x", name: "m", kind: "agent" } });
    const row = () => (h.db.actor as unknown as { rows: { key: string; lastSeenAt: Date | null }[] }).rows.find((r) => r.key === "muse-x")!;
    const t0 = new Date("2026-11-22T10:00:00Z");
    await touchAgent("muse-x", t0);
    expect(row().lastSeenAt).toEqual(t0);
    await touchAgent("muse-x", new Date(t0.getTime() + 30_000));
    expect(row().lastSeenAt).toEqual(t0);
    await touchAgent("muse-x", new Date(t0.getTime() + 61_000));
    expect(row().lastSeenAt).toEqual(new Date(t0.getTime() + 61_000));
  });
});

describe("each REST door takes its own scope", () => {
  const mk = async (scopes: string[], plain: string, actorKey: string | null = null) => {
    await h.db.apiToken.create({ data: { name: "t", scopes, tokenHash: createHash("sha256").update(plain).digest("hex"), prefix: plain.slice(0, 6), actorKey } });
    return new Request("https://mb.test/x", { headers: { authorization: `Bearer ${plain}` } });
  };
  const ok = async (req: Request, scope: Parameters<typeof requireToken>[1]) => {
    try {
      await requireToken(req, scope);
      return true;
    } catch (e) {
      if (e instanceof ContractError) return false;
      throw e;
    }
  };

  it("the handoff queue: «handoff», the full «mcp», and «mcp:handoff» — not «mcp:videos» or «mcp:read»", async () => {
    expect(await ok(await mk(["handoff"], "q1-aaaaaaaa"), "handoff")).toBe(true);
    expect(await ok(await mk(["mcp"], "q2-aaaaaaaa"), "handoff")).toBe(true);
    expect(await ok(await mk(["mcp:handoff"], "q3-aaaaaaaa"), "handoff")).toBe(true);
    expect(await ok(await mk(["mcp:videos"], "q4-aaaaaaaa"), "handoff")).toBe(false);
    expect(await ok(await mk(["mcp:read", "mcp:push"], "q5-aaaaaaaa"), "handoff")).toBe(false);
    expect(await ok(await mk(["vp:read"], "q6-aaaaaaaa"), "handoff")).toBe(false);
  });

  it("the video requests: «handoff» (the queue token Hermes has always used), the full «mcp», and «mcp:videos» — not «mcp:handoff»", async () => {
    expect(await ok(await mk(["handoff"], "v1-aaaaaaaa"), "videos")).toBe(true);
    expect(await ok(await mk(["mcp"], "v2-aaaaaaaa"), "videos")).toBe(true);
    expect(await ok(await mk(["mcp:videos"], "v3-aaaaaaaa"), "videos")).toBe(true);
    expect(await ok(await mk(["mcp:handoff"], "v4-aaaaaaaa"), "videos")).toBe(false);
    expect(await ok(await mk(["mcp:ask"], "v5-aaaaaaaa"), "videos")).toBe(false);
  });

  it("the MCP door still takes the old «mcp» and every finer scope", async () => {
    expect(await ok(await mk(["mcp"], "m1-aaaaaaaa"), "mcp")).toBe(true);
    expect(await ok(await mk(["mcp:ask"], "m2-aaaaaaaa"), "mcp")).toBe(true);
    expect(await ok(await mk(["handoff"], "m3-aaaaaaaa"), "mcp")).toBe(false);
  });

  it("a revoked or unknown token is refused whatever its scope", async () => {
    const req = await mk(["mcp"], "r1-aaaaaaaa");
    await h.db.apiToken.updateMany({ where: {}, data: { revokedAt: new Date() } });
    expect(await ok(req, "handoff")).toBe(false);
    expect(await ok(new Request("https://mb.test/x", { headers: { authorization: "Bearer nothing-here" } }), "handoff")).toBe(false);
  });
});

describe("a link an agent sends", () => {
  it("is shown as a link only when it is a plain https address", () => {
    expect(isHttpsUrl("https://drive.example.com/file/d/1")).toBe(true);
    for (const u of ["javascript:alert(1)", "data:text/html;base64,xx", "http://example.com", "//example.com", "/relative", "https://user:pw@example.com/", "https://", "", "ftp://x.com", "HTTPS://EXAMPLE.COM/A"]) {
      expect(isHttpsUrl(u), u).toBe(u === "HTTPS://EXAMPLE.COM/A");
    }
    expect(isHttpsUrl(undefined)).toBe(false);
    expect(isHttpsUrl("https://x.com/" + "a".repeat(400))).toBe(false);
  });
});

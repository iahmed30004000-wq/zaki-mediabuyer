import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MetricRow } from "@/core/push-rows";
import { SUPPORTED_VERSIONS, handleRpc, negotiate, toolList, type ToolDef } from "@/core/mcp-rpc";
import { toJsonSchema } from "@/core/zod-schema";

const INFO = { name: "zaki-mediabuyer", version: "1.0.0", instructions: "اقرأ get_mode قبل أي شي" };
type Ctx = { calls: string[] };

const tools: ToolDef<Ctx>[] = [
  {
    name: "echo",
    title: "صدى",
    description: "بيرجّع اللي بعتّه",
    input: z.object({ text: z.string().min(1).describe("النص"), times: z.number().int().min(1).max(3).optional() }).strict(),
    readOnly: true,
    run: async (a, ctx) => {
      const { text, times } = a as { text: string; times?: number };
      ctx.calls.push("echo");
      return { text: text.repeat(times ?? 1), data: { echoed: text } };
    },
  },
  { name: "boom", title: "فشل", description: "بيفشل", input: z.object({}), readOnly: false, run: async () => { throw new Error("secret detail: postgres://user:pass@host"); } },
  { name: "sorry", title: "آسف", description: "بيرد بخطأ مفهوم", input: z.object({}), readOnly: false, run: async () => ({ text: "التوكن ما إله صلاحية", isError: true }) },
];

const rpc = (method: string, params?: unknown, id: number | string | null = 1) => ({ jsonrpc: "2.0", id, method, params });
const call = (body: unknown, ctx: Ctx = { calls: [] }) => handleRpc(body, tools, ctx, INFO);

describe("MCP over HTTP, stateless (v4 · A)", () => {
  it("initializes: the client's version when we know it, our latest when we do not", async () => {
    for (const v of SUPPORTED_VERSIONS) {
      const r = await call(rpc("initialize", { protocolVersion: v, capabilities: {}, clientInfo: { name: "claude", version: "1" } }));
      expect(r.status).toBe(200);
      expect((r.body as { result: { protocolVersion: string } }).result.protocolVersion).toBe(v);
    }
    expect(negotiate("2099-01-01")).toBe(SUPPORTED_VERSIONS[0]);
    expect(negotiate(undefined)).toBe(SUPPORTED_VERSIONS[0]);
  });

  it("says it only has tools, who it is, and what Claude should do first", async () => {
    const r = (await call(rpc("initialize", { protocolVersion: "2025-06-18" }))).body as { result: { capabilities: Record<string, unknown>; serverInfo: { name: string }; instructions: string } };
    expect(r.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(r.result.serverInfo.name).toBe("zaki-mediabuyer");
    expect(r.result.instructions).toContain("get_mode");
  });

  it("answers a notification with 202 and no body", async () => {
    const r = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(r).toEqual({ status: 202 });
  });

  it("answers ping, and empty lists for what it does not have", async () => {
    expect(((await call(rpc("ping"))).body as { result: unknown }).result).toEqual({});
    expect(((await call(rpc("resources/list"))).body as { result: unknown }).result).toEqual({ resources: [] });
    expect(((await call(rpc("prompts/list"))).body as { result: unknown }).result).toEqual({ prompts: [] });
  });

  it("lists the tools with a JSON schema made from the very validators they use", async () => {
    const list = ((await call(rpc("tools/list"))).body as { result: { tools: ReturnType<typeof toolList> } }).result.tools;
    expect(list.map((t) => t.name)).toEqual(["echo", "boom", "sorry"]);
    const echo = list[0]!;
    expect(echo.inputSchema).toMatchObject({ type: "object", required: ["text"], additionalProperties: false });
    expect((echo.inputSchema as { properties: Record<string, unknown> }).properties.times).toEqual({ type: "integer", minimum: 1, maximum: 3 });
    expect(echo.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
  });

  it("runs a tool and answers with text and data", async () => {
    const ctx = { calls: [] as string[] };
    const r = (await call(rpc("tools/call", { name: "echo", arguments: { text: "هلا", times: 2 } }), ctx)).body as { result: { content: { type: string; text: string }[]; structuredContent: unknown; isError?: boolean } };
    expect(r.result.content).toEqual([{ type: "text", text: "هلاهلا" }]);
    expect(r.result.structuredContent).toEqual({ echoed: "هلا" });
    expect(r.result.isError).toBeUndefined();
    expect(ctx.calls).toEqual(["echo"]);
  });

  it("tells the model what is wrong with its arguments instead of failing — and does not run the tool", async () => {
    const ctx = { calls: [] as string[] };
    const r = (await call(rpc("tools/call", { name: "echo", arguments: { times: 9 } }), ctx)).body as { result: { content: { text: string }[]; isError: boolean } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]!.text).toContain("text");
    expect(r.result.content[0]!.text).toContain("times");
    expect(ctx.calls).toEqual([]);
  });

  it("keeps a failing tool's details to itself", async () => {
    const r = (await call(rpc("tools/call", { name: "boom", arguments: {} }))).body as { result: { content: { text: string }[]; isError: boolean } };
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0]!.text).not.toContain("postgres");
    expect(r.result.content[0]!.text).not.toContain("secret");
  });

  it("passes a tool's own refusal through as an error result", async () => {
    const r = (await call(rpc("tools/call", { name: "sorry", arguments: {} }))).body as { result: { content: { text: string }[]; isError: boolean } };
    expect(r.result).toMatchObject({ isError: true, content: [{ type: "text", text: "التوكن ما إله صلاحية" }] });
  });

  it("makes an unknown tool, an unknown method and a malformed message JSON-RPC errors", async () => {
    expect(((await call(rpc("tools/call", { name: "nope" }))).body as { error: { code: number } }).error.code).toBe(-32602);
    expect(((await call(rpc("tools/delete"))).body as { error: { code: number } }).error.code).toBe(-32601);
    expect(((await call({ id: 5, hello: 1 })).body as { error: { code: number; }; id: number }).error.code).toBe(-32600);
    expect(((await call("text")).body as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("answers a batch with the replies to its requests only", async () => {
    const r = await call([rpc("ping", undefined, 1), { jsonrpc: "2.0", method: "notifications/initialized" }, rpc("ping", undefined, 2)]);
    expect(r.status).toBe(200);
    expect((r.body as { id: number }[]).map((x) => x.id)).toEqual([1, 2]);
    expect(await call([{ jsonrpc: "2.0", method: "notifications/initialized" }])).toEqual({ status: 202 });
    expect(((await call([])).body as { error: { code: number } }).error.code).toBe(-32600);
  });

  it("ignores a response from the client", async () => {
    expect(await call({ jsonrpc: "2.0", id: 9, result: {} })).toEqual({ status: 202 });
  });
});

describe("zod → JSON Schema", () => {
  it("describes the metric row: three required keys, closed, with integers and an enum", () => {
    const s = toJsonSchema(MetricRow) as { required: string[]; additionalProperties: boolean; properties: Record<string, { type?: string; enum?: string[]; description?: string; minimum?: number; pattern?: string }> };
    expect(s.required).toEqual(["date", "level", "id"]);
    expect(s.additionalProperties).toBe(false);
    expect(s.properties.level!.enum).toEqual(["account", "campaign", "adset", "ad", "product", "person"]);
    expect(s.properties.impressions).toMatchObject({ type: "integer", minimum: 0 });
    expect(s.properties.spend!.type).toBe("number");
    expect(s.properties.date!.pattern).toBe("^\\d{4}-\\d{2}-\\d{2}$");
    expect(s.properties.date!.description).toContain("يوم");
  });

  it("handles arrays, records, unions, defaults and literals", () => {
    const s = toJsonSchema(z.object({ a: z.array(z.string()).min(1).max(5), b: z.record(z.string(), z.number()), c: z.union([z.string(), z.number()]), d: z.boolean().default(false), e: z.literal("x") })) as { properties: Record<string, unknown>; required: string[] };
    expect(s.properties.a).toEqual({ type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 });
    expect(s.properties.b).toEqual({ type: "object", additionalProperties: { type: "number" } });
    expect(s.properties.c).toEqual({ anyOf: [{ type: "string" }, { type: "number" }] });
    expect(s.properties.e).toEqual({ const: "x" });
    expect(s.required).toEqual(["a", "b", "c", "e"]);
  });
});

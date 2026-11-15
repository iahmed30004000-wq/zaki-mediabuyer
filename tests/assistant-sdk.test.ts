import http from "node:http";
import type { AddressInfo } from "node:net";
import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toolSpecs } from "@/core/assistant";
import { makeLlm } from "@/server/assistant";
import { AssistantError, runLoop, toAssistantError, type LlmRequest } from "@/server/assistant/loop";
import { makeTools } from "@/server/assistant/tools";
import { z } from "zod";

/**
 * The model client is the official SDK, and there is no key to try it with — so it is tried against a stand-in server that speaks
 * the Messages API: the request the SDK really sends (path, headers, body) and how a reply, and each kind of error, comes back
 * through it. What this cannot say is how the real model behaves: that needs a key (see docs/DECISIONS.md D32).
 */
interface Seen {
  method?: string;
  url?: string;
  headers: http.IncomingHttpHeaders;
  body: any;
}

let server: http.Server;
let base = "";
let seen: Seen[] = [];
let respond: (n: number, body: any) => { status: number; json: unknown; headers?: Record<string, string> } = () => ({ status: 200, json: {} });

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) : null;
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      const r = respond(seen.length, body);
      res.writeHead(r.status, { "content-type": "application/json", ...(r.headers ?? {}) });
      res.end(JSON.stringify(r.json));
    });
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

const message = (content: unknown[], stop_reason: string) => ({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: { input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 6, cache_creation_input_tokens: 7 } });

const REQ: LlmRequest = {
  model: "claude-opus-5-5",
  max_tokens: 100,
  system: [{ type: "text", text: "قواعد", cache_control: { type: "ephemeral" } }],
  tools: toolSpecs([{ name: "t", description: "d", access: "read", status: "s", input: z.object({ a: z.string() }).strict(), run: async () => ({ data: {}, sources: [], facts: [] }) }]),
  messages: [{ role: "user", content: "سؤال" }],
};

describe("the request, as the SDK sends it", () => {
  it("has the shape the Messages API wants — checked by the compiler against the SDK's own types, and on the wire", async () => {
    // compile-time: what the loop sends (model, system with cache_control, tools, a tool round) is a valid request
    const typed: Anthropic.MessageCreateParamsNonStreaming = {
      model: "claude-opus-5-5",
      max_tokens: 100,
      system: [{ type: "text", text: "x", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "t", description: "d", input_schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } }],
      messages: [
        { role: "user", content: "q" },
        { role: "assistant", content: [{ type: "tool_use", id: "tu_1", name: "t", input: { a: "x" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: "{}", is_error: true }] },
      ],
    };
    expect(typed.model).toBe("claude-opus-5-5");

    seen = [];
    respond = () => ({ status: 200, json: message([{ type: "text", text: "أهلين" }], "end_turn") });
    const out = await makeLlm("test-key-123", base).create(REQ);
    expect(seen).toHaveLength(1);
    const s = seen[0]!;
    expect(s.method).toBe("POST");
    expect(s.url).toBe("/v1/messages");
    // the key travels as the SDK decides (Bearer in 1.x, x-api-key in older ones) — and never anywhere but the header
    expect(s.headers.authorization === "Bearer test-key-123" || s.headers["x-api-key"] === "test-key-123").toBe(true);
    expect(JSON.stringify(s.body)).not.toContain("test-key-123");
    expect(s.headers["anthropic-version"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(s.headers["content-type"]).toContain("application/json");
    expect(s.body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 100,
      system: [{ type: "text", text: "قواعد", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "سؤال" }],
    });
    expect(s.body.tools[0]).toEqual({ name: "t", description: "d", input_schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"], additionalProperties: false } });
    // non-streaming, no thinking switch, no forced tool choice: the defaults the model expects
    expect(s.body.stream).toBeUndefined();
    expect(s.body.thinking).toBeUndefined();
    expect(s.body.tool_choice).toBeUndefined();
    // and the reply comes back as the loop reads it
    expect(out.content).toEqual([{ type: "text", text: "أهلين" }]);
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage).toMatchObject({ input_tokens: 123, output_tokens: 45, cache_read_input_tokens: 6, cache_creation_input_tokens: 7 });
  });

  it("a whole question over the wire: tool round, the turn sent back verbatim, the answer the dashboard's number", async () => {
    seen = [];
    const think = { type: "thinking", thinking: "أفكّر…", signature: "sig-abc" };
    respond = (n) =>
      n === 1
        ? { status: 200, json: message([think, { type: "tool_use", id: "toolu_1", name: "calculate", input: { expression: "4.15 - 3.8" } }], "tool_use") }
        : { status: 200, json: message([{ type: "text", text: "الفرق 0.35$" }], "end_turn") };
    const r = await runLoop(
      { llm: makeLlm("k", base), model: "claude-opus-5-5", system: "sys", tools: makeTools(), ctx: { caller: { id: "u", role: "OWNER", demo: false }, now: new Date("2026-11-15T09:00:00Z"), place: null }, canWrite: true, now: new Date("2026-11-15T09:00:00Z") },
      { question: "كم الفرق بين 4.15 و 3.8؟", history: [] },
    );
    expect(r.answer).toBe("الفرق 0.35$");
    expect(r.verified).toBe(true);
    expect(seen).toHaveLength(2);
    const second = seen[1]!.body.messages;
    expect(second.map((m: { role: string }) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[1].content).toEqual([think, { type: "tool_use", id: "toolu_1", name: "calculate", input: { expression: "4.15 - 3.8" } }]);
    expect(second[2].content[0]).toMatchObject({ type: "tool_result", tool_use_id: "toolu_1" });
    expect(JSON.parse(second[2].content[0].content)).toMatchObject({ result: 0.35, display: "0.35" });
    expect(r.usage.input).toBe(246);
    expect(r.usage.cacheRead).toBe(12);
  });
});

describe("what the SDK throws, as the owner reads it", () => {
  const err = (type: string, message: string) => ({ type: "error", error: { type, message } });
  const run = (status: number, json: unknown, headers?: Record<string, string>) => {
    seen = [];
    respond = () => ({ status, json, headers });
    return makeLlm("k", base).create(REQ).then(
      () => null,
      (e) => toAssistantError(e),
    );
  };

  it("a key Anthropic does not accept, a model it does not know, a balance that ran out", async () => {
    expect(await run(401, err("authentication_error", "invalid x-api-key"))).toMatchObject({ code: "auth", status: 502 });
    expect(await run(404, err("not_found_error", "model: claude-nope"))).toMatchObject({ code: "model" });
    expect(await run(400, err("invalid_request_error", "Your credit balance is too low to access the Anthropic API."))).toMatchObject({ code: "billing" });
    expect(await run(400, err("invalid_request_error", "messages: something else"))).toMatchObject({ code: "server" });
  });

  it("a busy service is retried by the SDK itself, then said in words", async () => {
    const rate = await run(429, err("rate_limit_error", "slow down"), { "retry-after-ms": "1" });
    expect(rate).toMatchObject({ code: "rate", status: 503 });
    expect(seen.length).toBeGreaterThan(1); // the SDK retried before giving up
    const over = await run(529, err("overloaded_error", "Overloaded"), { "retry-after-ms": "1" });
    expect(over).toMatchObject({ code: "server", status: 503 });
  });

  it("a server that is not there is a connection error, not a crash", async () => {
    const e = await makeLlm("k", "http://127.0.0.1:1").create(REQ).then(
      () => null,
      (x) => toAssistantError(x),
    );
    expect(e).toBeInstanceOf(AssistantError);
    expect(e).toMatchObject({ code: "connection" });
  });
});

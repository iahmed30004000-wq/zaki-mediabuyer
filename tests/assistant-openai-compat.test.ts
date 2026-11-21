import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { AssistantTool, ToolOutput } from "@/core/assistant";
import { assistantConfigured, assistantProvider, compatConfig, compatUsdPer1k } from "@/server/assistant/config";
import { AssistantError, runLoop, type LlmRequest } from "@/server/assistant/loop";
import { compatError, fromChatAnswer, makeCompatLlm, toChatMessages, toChatRequest } from "@/server/assistant/openai-compat";

const KEY = "sk-test-only-not-a-real-key";
const NOW = new Date("2026-11-21T10:00:00Z");

const out = (data: unknown): ToolOutput => ({ data, sources: [], facts: [] });
const tool = (name: string, run: (a: unknown) => ToolOutput): AssistantTool<unknown> => ({ name, description: `the ${name} tool`, input: z.object({ code: z.string() }).strict(), access: "read", status: `${name}…`, run: async (a) => run(a) });

/** A fake /chat/completions: answers in order, and keeps what it was sent. */
function fakeServer(answers: (object | { status: number })[]) {
  const sent: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    sent.push({ url, auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) });
    const a = answers[sent.length - 1] ?? answers[answers.length - 1]!;
    if ("status" in a && typeof a.status === "number") return new Response(JSON.stringify({ error: { message: `nope ${KEY}` } }), { status: a.status });
    return new Response(JSON.stringify(a), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { sent, fetchImpl };
}

const REQ: LlmRequest = {
  model: "glm-test",
  max_tokens: 800,
  system: [{ type: "text", text: "أنت المساعد", cache_control: { type: "ephemeral" } }],
  tools: [{ name: "product_day", description: "يوم منتج", input_schema: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } }],
  messages: [
    { role: "user", content: "كم طلب للطنين؟" },
    { role: "assistant", content: [{ type: "text", text: "بشوف" }, { type: "tool_use", id: "c1", name: "product_day", input: { code: "TIN01" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: '{"orders":12}' }] },
  ],
};

describe("the request, as chat completions", () => {
  it("system first, the assistant's tool_use as tool_calls, each tool_result as a «tool» message", () => {
    const m = toChatMessages("أنت المساعد", REQ.messages);
    expect(m).toEqual([
      { role: "system", content: "أنت المساعد" },
      { role: "user", content: "كم طلب للطنين؟" },
      { role: "assistant", content: "بشوف", tool_calls: [{ id: "c1", type: "function", function: { name: "product_day", arguments: '{"code":"TIN01"}' } }] },
      { role: "tool", tool_call_id: "c1", content: '{"orders":12}' },
    ]);
  });

  it("tools become functions, the model and the token limit go through", () => {
    const body = toChatRequest(REQ);
    expect(body).toMatchObject({ model: "glm-test", max_tokens: 800, tool_choice: "auto" });
    expect(body.tools).toEqual([{ type: "function", function: { name: "product_day", description: "يوم منتج", parameters: REQ.tools[0]!.input_schema } }]);
  });

  it("a failed tool says so to the model", () => {
    const m = toChatMessages("s", [{ role: "user", content: [{ type: "tool_result", tool_use_id: "c9", content: "ما في", is_error: true }] }]);
    expect(m[1]).toEqual({ role: "tool", tool_call_id: "c9", content: "خطأ: ما في" });
  });
});

describe("the answer, as the loop reads it", () => {
  it("tool_calls → tool_use blocks with parsed arguments, stop = tool_use", () => {
    const r = fromChatAnswer({ choices: [{ message: { content: null, tool_calls: [{ id: "x1", type: "function", function: { name: "product_day", arguments: '{"code":"TIN01"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
    expect(r).toEqual({ content: [{ type: "tool_use", id: "x1", name: "product_day", input: { code: "TIN01" } }], stop_reason: "tool_use", usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 } });
  });

  it("text → a text block; length → max_tokens; arguments that are not JSON pass on as-is", () => {
    expect(fromChatAnswer({ choices: [{ message: { content: "١٢ طلب" }, finish_reason: "stop" }] }).stop_reason).toBe("end_turn");
    expect(fromChatAnswer({ choices: [{ message: { content: "نص" }, finish_reason: "length" }] }).stop_reason).toBe("max_tokens");
    const bad = fromChatAnswer({ choices: [{ message: { tool_calls: [{ id: "x", function: { name: "t", arguments: "{oops" } }] }, finish_reason: "tool_calls" }] });
    expect(bad.content[0]).toMatchObject({ type: "tool_use", input: "{oops" });
  });
});

describe("the client", () => {
  it("POSTs {base}/chat/completions with the key in the Authorization header only", async () => {
    const s = fakeServer([{ choices: [{ message: { content: "تمام" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } }]);
    const llm = makeCompatLlm({ baseUrl: "https://glm.example/v1/", apiKey: KEY }, s.fetchImpl);
    const r = await llm.create(REQ);
    expect(s.sent[0]!.url).toBe("https://glm.example/v1/chat/completions");
    expect(s.sent[0]!.auth).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(s.sent[0]!.body)).not.toContain(KEY);
    expect(r.content).toEqual([{ type: "text", text: "تمام" }]);
  });

  it("a refusal names the variable to check — never the key or the body", async () => {
    const s = fakeServer([{ status: 401 }]);
    const err = await makeCompatLlm({ baseUrl: "https://glm.example/v1", apiKey: KEY }, s.fetchImpl).create(REQ).catch((e) => e);
    expect(err).toBeInstanceOf(AssistantError);
    expect(err.code).toBe("auth");
    expect(err.message).toContain("ASSISTANT_API_KEY");
    expect(err.message).not.toContain(KEY);
    expect(compatError(404).message).toContain("ASSISTANT_MODEL");
    expect(compatError(429).code).toBe("rate");
  });

  it("the whole loop runs on it: a tool call, then an answer from the tool's number", async () => {
    const s = fakeServer([
      { choices: [{ message: { content: null, tool_calls: [{ id: "a1", type: "function", function: { name: "product_day", arguments: '{"code":"TIN01"}' } }] }, finish_reason: "tool_calls" }], usage: { prompt_tokens: 50, completion_tokens: 10 } },
      { choices: [{ message: { content: "الطنين جاب 12 طلب." }, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 8 } },
    ]);
    let ran: unknown = null;
    const r = await runLoop(
      { llm: makeCompatLlm({ baseUrl: "https://glm.example/v1", apiKey: KEY }, s.fetchImpl), model: "glm-test", system: "s", tools: [tool("product_day", (a) => ((ran = a), out({ orders: 12 })))], ctx: {}, canWrite: false, now: NOW, price: (u) => ((u.input + u.output) / 1000) * 0.5 },
      { question: "كم طلب للطنين؟", history: [] },
    );
    expect(ran).toEqual({ code: "TIN01" });
    expect(r).toMatchObject({ answer: "الطنين جاب 12 طلب.", stop: "answered", verified: true, steps: 2 });
    expect(r.costUsd).toBeCloseTo(((50 + 10 + 80 + 8) / 1000) * 0.5, 10);
    // the second call carried the tool's answer back as a «tool» message
    expect((s.sent[1]!.body.messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  });
});

describe("the switch", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("all three of ASSISTANT_BASE_URL · ASSISTANT_API_KEY · ASSISTANT_MODEL, or it stays on Claude", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.CLAUDE_API_KEY;
    process.env.ASSISTANT_BASE_URL = "https://glm.example/v1/";
    process.env.ASSISTANT_API_KEY = KEY;
    delete process.env.ASSISTANT_MODEL;
    expect(compatConfig()).toBeNull();
    expect(assistantProvider()).toBe("anthropic");
    process.env.ASSISTANT_MODEL = "glm-test";
    expect(compatConfig()).toEqual({ baseUrl: "https://glm.example/v1", apiKey: KEY, model: "glm-test" });
    expect(assistantProvider()).toBe("openai-compatible");
    expect(await assistantConfigured()).toBe(true);
  });

  it("ASSISTANT_USD_PER_1K is a price or nothing", () => {
    delete process.env.ASSISTANT_USD_PER_1K;
    expect(compatUsdPer1k()).toBeNull();
    process.env.ASSISTANT_USD_PER_1K = "0.002";
    expect(compatUsdPer1k()).toBe(0.002);
    process.env.ASSISTANT_USD_PER_1K = "غلط";
    expect(compatUsdPer1k()).toBeNull();
  });
});

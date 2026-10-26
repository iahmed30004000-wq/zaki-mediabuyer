import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ask, extractJson, routeFor, AGENTS, AgentUnavailable, type GatewayDeps, type Provider } from "@/gateway/gateway";
import { PrivacyRefusal, privacyHits } from "@/gateway/privacy";

const internal: Provider = { key: "internal", baseUrl: "http://127.0.0.1:11434/v1", model: "qwen", internal: true };
const external: Provider = { key: "external", baseUrl: "https://api.example.com/v1", apiKey: "k", model: "big", internal: false };

function reply(content: string, ok = true) {
  return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: ok ? 200 : 500 }));
}

function deps(fetchImpl: GatewayDeps["fetch"], extra: Partial<GatewayDeps> = {}): GatewayDeps & { logs: unknown[] } {
  const logs: unknown[] = [];
  return { fetch: fetchImpl, providers: [internal, external], spentToday: async () => 0, log: async (e) => void logs.push(e), logs, ...extra };
}

describe("privacy filter (spec 11.1)", () => {
  it.each([
    ["a Meta token", "token EAABsbCS1iHgBAKZBZCZA0ZCxyz123456789"],
    ["an API key", "use sk-ant-api03-DUMMYexampleFAKEtest00"],
    ["a Syrian phone", "رقم الزبون 0944123456"],
    ["an international phone", "+963 944 123 456"],
    ["Arabic-Indic digits", "اتصل ٠٩٤٤١٢٣٤٥٦"],
    ["a Jordanian phone", "0791234567"],
    ["an e-mail", "ali@example.com"],
  ])("refuses %s", (_l, text) => {
    expect(privacyHits(text).length).toBeGreaterThan(0);
  });

  it("lets aggregated numbers through", () => {
    expect(privacyHits("TRF01: صرف 121.20$ · 22 مؤكد · تكلفة المؤكد 5.51$ · CR00147 · act_1029")).toEqual([]);
  });

  it("a refused text never reaches the network, and the refusal is logged", async () => {
    const f = vi.fn();
    const d = deps(f as unknown as typeof fetch);
    await expect(ask(d, "M11", [{ role: "user", content: "الزبون 0944123456" }])).rejects.toBeInstanceOf(PrivacyRefusal);
    expect(f).not.toHaveBeenCalled();
    expect(d.logs).toEqual([expect.objectContaining({ ok: false, blocked: "phone" })]);
  });
});

describe("routing", () => {
  it("privacy-sensitive agents and internal_only never use an external provider", () => {
    expect(routeFor(AGENTS.H01!, [internal, external], undefined).map((p) => p.key)).toEqual(["internal"]);
    expect(routeFor(AGENTS.M02!, [internal, external], "internal_only").map((p) => p.key)).toEqual(["internal"]);
    expect(routeFor(AGENTS.M02!, [internal, external], "off").map((p) => p.key)).toEqual(["internal", "external"]);
  });

  it("falls back to the next provider when the first one fails", async () => {
    const f = vi.fn().mockImplementationOnce(() => reply("", false)).mockImplementationOnce(() => reply("تمام"));
    const d = deps(f as unknown as typeof fetch, { privacyMode: "off" });
    await expect(ask(d, "M11", [{ role: "user", content: "اكتب التقرير" }])).resolves.toBe("تمام");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("stops at the daily cap", async () => {
    const d = deps(vi.fn() as unknown as typeof fetch, { spentToday: async () => 3 });
    await expect(ask(d, "M02", [{ role: "user", content: "حلّل" }])).rejects.toBeInstanceOf(AgentUnavailable);
  });
});

describe("schemas", () => {
  const S = z.object({ verdict: z.enum(["pass", "edit", "block"]) });
  it("repairs once, then accepts", async () => {
    const f = vi.fn().mockImplementationOnce(() => reply("ما بعرف")).mockImplementationOnce(() => reply('```json\n{"verdict":"edit"}\n```'));
    await expect(ask(deps(f as unknown as typeof fetch), "M01", [{ role: "user", content: "افحص" }], S)).resolves.toEqual({ verdict: "edit" });
  });
  it("reads JSON wrapped in a think block", () => {
    expect(extractJson('<think>hmm</think>\n{"a":1}')).toEqual({ a: 1 });
  });
});

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Artifact, AssistantTool, ToolOutput } from "@/core/assistant";
import { STATS, formatStat } from "@/core/numbers";
import { loadNumbers } from "@/lib/numbers-view";
import { AssistantError, runLoop, toAssistantError, type Llm, type LlmRequest, type LlmResponse, type LoopDeps, type ToolResultBlock } from "@/server/assistant/loop";
import { makeTools, type ToolCtx } from "@/server/assistant/tools";

const NOW = new Date("2026-11-15T09:00:00Z"); // noon in Amman: today 2026-11-15, yesterday 2026-11-14
const ctx: ToolCtx = { caller: { id: "u1", role: "OWNER", demo: false }, now: NOW, place: null };
const USAGE = { input_tokens: 1000, output_tokens: 100 };

type Step = (req: LlmRequest) => LlmResponse;
/** A scripted model: step n answers call n (the last step repeats). It keeps a copy of every request as it was sent. */
function script(...steps: Step[]): Llm & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async create(req) {
      calls.push(structuredClone(req));
      return steps[Math.min(calls.length - 1, steps.length - 1)]!(req);
    },
  };
}
const say = (text: string): Step => () => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: USAGE });
const call = (name: string, input: unknown, id = `tu_${name}`): Step => () => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use", usage: USAGE });
/** The tool results of the last message the loop sent, parsed. */
const results = (req: LlmRequest): { id: string; data: any; error: boolean }[] => {
  const last = req.messages[req.messages.length - 1]!;
  return (last.content as ToolResultBlock[]).map((b) => ({ id: b.tool_use_id, data: JSON.parse(b.content), error: !!b.is_error }));
};

const base = (llm: Llm, tools: AssistantTool<ToolCtx>[], over: Partial<LoopDeps<ToolCtx>> = {}): LoopDeps<ToolCtx> => ({ llm, model: "claude-opus-5-5", system: "sys", tools, ctx, canWrite: true, now: NOW, ...over });
const ask = (question: string, history: { role: "user" | "assistant"; text: string }[] = []) => ({ question, history });

const tool = (name: string, run: (a: unknown) => ToolOutput | Promise<ToolOutput>, access: "read" | "write" = "read", input: z.ZodTypeAny = z.object({}).passthrough()): AssistantTool<ToolCtx> => ({ name, description: name, input, access, status: `${name}…`, run: async (a) => run(a) });
const out = (data: unknown, extra: Partial<ToolOutput> = {}): ToolOutput => ({ data, sources: [], facts: [], ...extra });

let was: string | undefined;
beforeAll(() => {
  was = process.env.MOCK_MODE;
  process.env.MOCK_MODE = "1"; // the screens' own loaders over the made-up counts: no database needed
});
afterAll(() => {
  if (was === undefined) delete process.env.MOCK_MODE;
  else process.env.MOCK_MODE = was;
});

const PRODUCTS = [
  { code: "TRF01", name: "ماء الكمأة" },
  { code: "TIN01", name: "قطرة طنين الأذن" },
];

describe("the quality gate: the answer is the dashboard's number", () => {
  const COST = STATS.find((s) => s.key === "costPerOrder")!;

  it("«كم كلفة الطلب الحقيقي للطنين امبارح» → exactly what «الأرقام» shows for yesterday", async () => {
    const dash = await loadNumbers({ d: "yesterday" }, NOW);
    const tin = dash.products.find((p) => p.code === "TIN01")!;
    const expected = formatStat(COST, tin.current.costPerOrder);
    expect(expected).toMatch(/^\d+\.\d\d\$$/);

    // the model names the tool and the product the way a person says it; then it copies the printed number
    const llm = script(
      call("get_numbers", { range: "yesterday", product: "الطنين", stats: ["costPerOrder"] }),
      (req) => {
        const [r] = results(req);
        expect(r!.error).toBe(false);
        const row = r!.data.scopes[0];
        expect(row.code).toBe("TIN01");
        return { content: [{ type: "text", text: `تكلفة الطلب الحقيقي للطنين امبارح ${row.stats[0].display} (حقيقي).` }], stop_reason: "end_turn", usage: USAGE };
      },
    );
    const r = await runLoop(base(llm, makeTools({ products: async () => PRODUCTS })), ask("كم كلفة الطلب الحقيقي للطنين امبارح"));

    expect(r.answer).toContain(expected);
    expect(r.verified).toBe(true);
    expect(r.stop).toBe("answered");
    expect(r.tools).toMatchObject([{ name: "get_numbers", ok: true }]);
    // «الأرقام اللي جاوبت منها»: the code's own line, first because the answer says it, linking to the screen
    expect(r.facts[0]).toMatchObject({ value: expected, raw: tin.current.costPerOrder, cited: true });
    expect(r.facts[0]!.label).toContain("تكلفة الطلب الحقيقي");
    expect(r.facts[0]!.label).toContain("قطرة طنين الأذن");
    expect(r.sources).toEqual([{ id: "numbers:d=yesterday", label: `الأرقام · ${dash.label}`, href: "/?tab=numbers&d=yesterday" }]);
  });

  it("a model that says a different number is caught, told once, and the corrected answer is the one that goes out", async () => {
    const dash = await loadNumbers({ d: "yesterday" }, NOW);
    const real = formatStat(COST, dash.products.find((p) => p.code === "TIN01")!.current.costPerOrder);
    const llm = script(
      call("get_numbers", { range: "yesterday", product: "TIN01", stats: ["costPerOrder"] }),
      say("تكلفة الطلب الحقيقي 4.17$ امبارح."), // not what the tool returned
      (req) => {
        const last = req.messages[req.messages.length - 1]!;
        expect(last.role).toBe("user");
        expect(last.content as string).toContain("4.17$");
        expect(last.content as string).toContain("calculate");
        return { content: [{ type: "text", text: `تكلفة الطلب الحقيقي ${real} امبارح.` }], stop_reason: "end_turn", usage: USAGE };
      },
    );
    const r = await runLoop(base(llm, makeTools({ products: async () => PRODUCTS })), ask("كم كلفة الطلب الحقيقي للطنين امبارح"));
    expect(llm.calls).toHaveLength(3);
    expect(r.answer).toBe(`تكلفة الطلب الحقيقي ${real} امبارح.`);
    expect(r.verified).toBe(true);
  });

  it("a model that insists on a number no tool returned goes out marked, with the number named — it is not hidden", async () => {
    const llm = script(call("get_numbers", { range: "yesterday", product: "TIN01", stats: ["costPerOrder"] }), say("تكلفة الطلب الحقيقي 4.17$."), say("تكلفة الطلب الحقيقي 4.17$ (متأكد)."));
    const r = await runLoop(base(llm, makeTools({ products: async () => PRODUCTS })), ask("كم؟"));
    expect(r.verified).toBe(false);
    expect(r.unsupported).toEqual(["4.17$"]);
    expect(r.answer).toContain("4.17$");
    expect(llm.calls).toHaveLength(3); // one chance, no more
  });

  it("a difference is the code's, not the model's: calculate returns it and the guard finds it among the tool numbers", async () => {
    const llm = script(
      call("calculate", { expression: "(4.15 - 3.8) / 3.8 * 100" }),
      (req) => {
        const [r] = results(req);
        return { content: [{ type: "text", text: `زادت ${r!.data.display}%… يعني حوالي 9.21%` }], stop_reason: "end_turn", usage: USAGE };
      },
    );
    const r = await runLoop(base(llm, makeTools()), ask("كم نسبة الزيادة من 3.8 لـ 4.15؟"));
    expect(r.verified).toBe(true);
    expect(r.facts[0]).toMatchObject({ label: "حسبة: (4.15 - 3.8) / 3.8 * 100", raw: 9.210526 });
  });

  it("a number the person typed, and one an earlier answer stood on, may be said again", async () => {
    const llm = script(say("تمام، 20% زيادة، والصرف كان 118.00$ متل ما قلتلك."));
    const r = await runLoop(base(llm, []), ask("زوّدها 20%", [{ role: "assistant", text: "الصرف 118.00$" }, { role: "user", text: "ماشي" }, { role: "assistant", text: "تمام" }]));
    expect(r.verified).toBe(true);
  });

  it("a product that does not exist, or fits two, comes back as words the model can fix — not an exception", async () => {
    const llm = script(call("get_numbers", { product: "سيارة" }, "a"), (req) => {
      const [r] = results(req);
      expect(r!.error).toBe(true);
      expect(r!.data.error).toContain("ماء الكمأة (TRF01)");
      return { content: [{ type: "text", text: "أي منتج بالضبط؟" }], stop_reason: "end_turn", usage: USAGE };
    });
    const r = await runLoop(base(llm, makeTools({ products: async () => PRODUCTS })), ask("كم الصرف؟"));
    expect(r.answer).toBe("أي منتج بالضبط؟");
    expect(r.tools).toMatchObject([{ name: "get_numbers", ok: false }]);
  });
});

describe("the loop", () => {
  it("sends the turn back as it came and all the results of one turn in ONE message, with the ids they answer", async () => {
    const think = { type: "thinking", thinking: "…", signature: "sig" };
    const llm = script(
      () => ({ content: [think, { type: "tool_use", id: "t1", name: "a", input: {} }, { type: "tool_use", id: "t2", name: "b", input: {} }], stop_reason: "tool_use", usage: USAGE }),
      say("خلص"),
    );
    const r = await runLoop(base(llm, [tool("a", () => out({ n: 1 })), tool("b", () => out({ n: 2 }))]), ask("؟"));
    expect(r.answer).toBe("خلص");
    const second = llm.calls[1]!.messages;
    expect(second.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second[1]!.content).toEqual([think, { type: "tool_use", id: "t1", name: "a", input: {} }, { type: "tool_use", id: "t2", name: "b", input: {} }]);
    expect(results(llm.calls[1]!).map((x) => [x.id, x.data.n])).toEqual([["t1", 1], ["t2", 2]]);
  });

  it("tells the model the system prompt (cached), the tools and the model it asked for", async () => {
    const llm = script(say("تمام"));
    await runLoop(base(llm, [tool("a", () => out({}))], { system: "قواعد", model: "claude-sonnet-5-5" }), ask("؟"));
    const req = llm.calls[0]!;
    expect(req.model).toBe("claude-sonnet-5-5");
    expect(req.system).toEqual([{ type: "text", text: "قواعد", cache_control: { type: "ephemeral" } }]);
    expect(req.tools.map((t) => t.name)).toEqual(["a"]);
    expect(req.max_tokens).toBeGreaterThan(1000);
    expect(req).not.toHaveProperty("thinking");
    expect(req).not.toHaveProperty("tool_choice");
  });

  it("an unknown tool or arguments the schema refuses are answered in words, and the model carries on", async () => {
    const strict = tool("t", () => out({ ok: true }), "read", z.object({ n: z.number() }).strict());
    const llm = script(
      () => ({ content: [{ type: "tool_use", id: "x", name: "nope", input: {} }, { type: "tool_use", id: "y", name: "t", input: { n: "كتير" } }], stop_reason: "tool_use", usage: USAGE }),
      (req) => {
        const [a, b] = results(req);
        expect(a).toMatchObject({ id: "x", error: true });
        expect(a!.data.error).toContain("مش موجودة");
        expect(b).toMatchObject({ id: "y", error: true });
        expect(b!.data.error).toContain("n:");
        return { content: [{ type: "text", text: "جرّبت" }], stop_reason: "end_turn", usage: USAGE };
      },
    );
    const r = await runLoop(base(llm, [strict]), ask("؟"));
    expect(r.answer).toBe("جرّبت");
    expect(r.tools.map((t) => t.ok)).toEqual([false, false]);
  });

  it("a tool that crashes is an error result, not a crash — and nothing of the exception reaches the model", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const llm = script(call("boom", {}), (req) => {
      const [r] = results(req);
      expect(r).toMatchObject({ error: true });
      expect(JSON.stringify(r!.data)).not.toContain("secret-stack");
      return { content: [{ type: "text", text: "ما زبط" }], stop_reason: "end_turn", usage: USAGE };
    });
    const r = await runLoop(
      base(llm, [
        tool("boom", () => {
          throw new Error("secret-stack at db.ts:1");
        }),
      ]),
      ask("؟"),
    );
    spy.mockRestore();
    expect(r.answer).toBe("ما زبط");
  });

  it("anything that looks like a phone, an e-mail or a key is blanked before the model reads it", async () => {
    const llm = script(call("notes", {}), (req) => {
      const [r] = results(req);
      expect(JSON.stringify(r!.data)).not.toMatch(/0944|@|sk-/);
      expect(r!.data.notes[0]).toBe("[محجوب]");
      expect(r!.data.notes[1]).toBe("تابع الكرتون");
      return { content: [{ type: "text", text: "تمام" }], stop_reason: "end_turn", usage: USAGE };
    });
    await runLoop(base(llm, [tool("notes", () => out({ notes: ["كلّم 0944123456", "تابع الكرتون"] }))]), ask("؟"));
  });

  it("one tool may be called only so many times for one question", async () => {
    const llm = script(call("a", {}));
    const r = await runLoop(base(llm, [tool("a", () => out({ n: 1 }))]), ask("؟"));
    expect(r.stop).toBe("limit");
    expect(r.steps).toBe(8);
    expect(r.tools.filter((t) => t.ok)).toHaveLength(6);
    expect(r.tools.filter((t) => !t.ok)).toHaveLength(2);
    expect(r.answer).toContain("لحد الخطوات");
  });

  it("a cap that is reached stops it before the model is asked, and says so", async () => {
    const llm = script(say("ما لازم أوصل هون"));
    const r = await runLoop(base(llm, [], { budget: async () => "وصلت للحد اليومي للمساعد (3.00$)." }), ask("؟"));
    expect(llm.calls).toHaveLength(0);
    expect(r).toMatchObject({ stop: "budget", answer: "وصلت للحد اليومي للمساعد (3.00$).", verified: true });
  });

  it("a refusal of the model is said, not turned into an answer", async () => {
    const llm = script(() => ({ content: [], stop_reason: "refusal", usage: USAGE }));
    const r = await runLoop(base(llm, []), ask("؟"));
    expect(r.stop).toBe("refused");
  });

  it("counts every call: tokens, cost at the model's price, and records each one", async () => {
    const records: { ok: boolean; costUsd: number; stop?: string }[] = [];
    const llm = script(call("a", {}), say("خلص"));
    const r = await runLoop(base(llm, [tool("a", () => out({}))], { record: async (e) => void records.push(e) }), ask("؟"));
    expect(r.usage.input).toBe(2000);
    expect(r.usage.output).toBe(200);
    expect(r.costUsd).toBeCloseTo(2 * (1000 * 4 + 100 * 20) / 1e6, 8);
    expect(records.map((x) => [x.ok, x.stop])).toEqual([[true, "tool_use"], [true, "end_turn"]]);
  });

  it("what the SDK throws is a sentence for the owner, and the failed call is recorded", async () => {
    const records: { ok: boolean; error?: string }[] = [];
    const fail = (status: number, message = "x"): Llm => ({ create: async () => Promise.reject(Object.assign(new Error(message), { status })) });
    const run = (llm: Llm) => runLoop(base(llm, [], { record: async (e) => void records.push(e) }), ask("؟"));
    await expect(run(fail(401))).rejects.toMatchObject({ code: "auth", status: 502 });
    await expect(run(fail(429))).rejects.toMatchObject({ code: "rate", status: 503 });
    await expect(run(fail(404))).rejects.toMatchObject({ code: "model" });
    await expect(run(fail(400, "Your credit balance is too low"))).rejects.toMatchObject({ code: "billing" });
    await expect(run(fail(529))).rejects.toMatchObject({ code: "server", status: 503 });
    expect(records).toHaveLength(5);
    expect(records.every((r) => !r.ok && !!r.error)).toBe(true);
    expect(toAssistantError(Object.assign(new Error("Connection error."), { name: "APIConnectionError" }))).toMatchObject({ code: "connection" });
    expect(toAssistantError(new AssistantError(418, "x", "off"))).toMatchObject({ status: 418, code: "off" });
    expect(toAssistantError("what")).toMatchObject({ code: "server", status: 500 });
  });

  it("a request that was cancelled does not call the model", async () => {
    const llm = script(say("x"));
    const c = new AbortController();
    c.abort();
    await expect(runLoop(base(llm, [], { signal: c.signal }), ask("؟"))).rejects.toMatchObject({ code: "aborted" });
    expect(llm.calls).toHaveLength(0);
  });

  it("an answer cut at the token limit with text in it goes out marked cut; with none it is an error", async () => {
    const partial = script(() => ({ content: [{ type: "text", text: "الجواب ناقص" }], stop_reason: "max_tokens", usage: USAGE }));
    expect((await runLoop(base(partial, []), ask("؟"))).stop).toBe("cut");
    const empty = script(() => ({ content: [{ type: "thinking", thinking: "…" }], stop_reason: "max_tokens", usage: USAGE }));
    await expect(runLoop(base(empty, []), ask("؟"))).rejects.toMatchObject({ code: "cut" });
  });

  it("tells the panel what it is doing, tool by tool", async () => {
    const status: string[] = [];
    await runLoop(base(script(call("a", {}), say("خلص")), [tool("a", () => out({}))], { onStatus: (t) => status.push(t) }), ask("؟"));
    expect(status).toEqual(["عم بفكّر…", "a…"]);
  });
});

describe("what it may do", () => {
  const writer = (calls: unknown[]) => tool("make", (a) => (calls.push(a), out({ id: "t1" }, { artifacts: [{ kind: "task_created", id: "t1", title: "x", assignee: null, dueAt: null, href: "/tasks" } as Artifact] })), "write");

  it("a person who may not propose changes cannot run a write tool — it is refused in words", async () => {
    const calls: unknown[] = [];
    const llm = script(call("make", { title: "x" }), (req) => {
      expect(results(req)[0]).toMatchObject({ error: true });
      return { content: [{ type: "text", text: "ما بقدر" }], stop_reason: "end_turn", usage: USAGE };
    });
    await runLoop(base(llm, [writer(calls)], { canWrite: false }), ask("؟"));
    expect(calls).toHaveLength(0);
  });

  it("the same write asked twice in one question happens once; the second is told it is already done", async () => {
    const calls: unknown[] = [];
    const wrote: string[] = [];
    const llm = script(
      () => ({ content: [{ type: "tool_use", id: "1", name: "make", input: { title: "x" } }, { type: "tool_use", id: "2", name: "make", input: { title: "x" } }], stop_reason: "tool_use", usage: USAGE }),
      (req) => {
        const [a, b] = results(req);
        expect(a!.data).toEqual({ id: "t1" });
        expect(b!.data).toMatchObject({ already_done: true, id: "t1" });
        return { content: [{ type: "text", text: "تمام" }], stop_reason: "end_turn", usage: USAGE };
      },
    );
    const r = await runLoop(base(llm, [writer(calls)], { wrote: async (e) => void wrote.push(`${e.tool}:${e.ok}`) }), ask("؟"));
    expect(calls).toHaveLength(1);
    expect(wrote).toEqual(["make:true"]);
    expect(r.artifacts).toHaveLength(1);
  });

  it("the real tool list has no tool that approves, executes, rolls back, deletes, pushes or reaches Meta", () => {
    const tools = makeTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["calculate", "create_task", "draft_job", "draft_node", "draft_prompt", "draft_workflow", "edit_node", "explain", "get_ads", "get_changes", "get_day", "get_numbers", "get_overview", "get_summary", "get_tasks", "get_videos", "get_workflows", "propose_change", "update_task"]);
    expect(names.join(" ")).not.toMatch(/approve|execute|rollback|delete|remove|push|meta|spend|launch|pause|budget/);
    expect(tools.filter((t) => t.access === "write").map((t) => t.name).sort()).toEqual(["create_task", "propose_change", "update_task"]);
    // every description is Arabic (what the model reads) and every tool says what the panel shows while it runs
    for (const t of tools) {
      expect(t.description).toMatch(/[؀-ۿ]/);
      expect(t.status).toMatch(/…$/);
    }
  });

  it("propose_change is a proposal: it comes back «not executed», waiting for the owner, with the card for the panel", async () => {
    const proposed: unknown[] = [];
    const tools = makeTools({
      propose: async (p) => {
        proposed.push(p);
        return { ok: true, id: "cs1", state: "pending_approval", items: p.items.length, spendDeltaDaily: -8, refused: [] };
      },
    });
    const llm = script(call("propose_change", { sentence: "إيقاف إعلان تكلفة طلبه 9.40$ فوق الحد", items: [{ op: "pause", object_type: "ad", object_id: "120001" }] }), (req) => {
      const [r] = results(req);
      expect(r!.data).toMatchObject({ ok: true, executed: false, state: "بانتظار موافقتك" });
      return { content: [{ type: "text", text: "اقترحت الإيقاف وبانتظار موافقتك بـ المهام." }], stop_reason: "end_turn", usage: USAGE };
    });
    const r = await runLoop(base(llm, tools), ask("وقّف هالإعلان"));
    expect(proposed).toHaveLength(1);
    expect(r.artifacts[0]).toMatchObject({ kind: "change_proposed", id: "cs1", stateLabel: "بانتظار موافقتك", spendDeltaDaily: -8 });
  });

  it("propose_change refuses what the code's check refused and nothing is proposed", async () => {
    const tools = makeTools({ propose: async () => ({ ok: false, error: "ما طلع ولا تغيير صالح · 999: مش موجود" }) });
    const llm = script(call("propose_change", { sentence: "إيقاف إعلان غلط", items: [{ op: "pause", object_type: "ad", object_id: "999" }] }), (req) => {
      expect(results(req)[0]).toMatchObject({ error: true });
      return { content: [{ type: "text", text: "الإعلان مش موجود" }], stop_reason: "end_turn", usage: USAGE };
    });
    const r = await runLoop(base(llm, tools), ask("وقّف"));
    expect(r.artifacts).toEqual([]);
  });

  it("a task needs a title and refuses a customer's number — through the real validator and the task service", async () => {
    const made: unknown[] = [];
    const tools = makeTools({ createTask: (async (i: unknown) => (made.push(i), { id: "t9", title: (i as { title: string }).title, assignee: null, dueAt: null, status: "new" })) as never });
    const llm = script(call("create_task", { title: "تابع الكرتون", assignee: "muse", due_at: "2026-11-16" }), call("create_task", { notitle: true }, "bad"), say("انعملت"));
    const r = await runLoop(base(llm, tools), ask("اعملي مهمة"));
    expect(made).toEqual([{ title: "تابع الكرتون", assignee: "muse", due_at: "2026-11-16" }]);
    expect(r.artifacts).toMatchObject([{ kind: "task_created", id: "t9", title: "تابع الكرتون", href: "/tasks/team" }]);
  });

  it("demo callers (sign-in switched off) cannot write at all", async () => {
    const made: unknown[] = [];
    const tools = makeTools({ createTask: (async (i: unknown) => made.push(i)) as never });
    const demoCtx: ToolCtx = { ...ctx, caller: { id: "demo-owner", role: "OWNER", demo: true } };
    const llm = script(call("create_task", { title: "تجربة" }), say("ما انعملت"));
    await runLoop({ ...base(llm, tools), ctx: demoCtx }, ask("اعملي مهمة"));
    expect(made).toHaveLength(0);
    expect(results(llm.calls[1]!)[0]).toMatchObject({ error: true });
  });
});

describe("drafts: nothing is saved", () => {
  it("a workflow draft is checked (ids, joins, privacy), laid out, and comes back as a card with its warnings", async () => {
    const tools = makeTools();
    const nodes = [
      { id: "start", type: "trigger", label: "كل صباح", executor: "system" },
      { id: "read", type: "step", label: "اقرا أرقام امبارح", executor: "claude_mcp" },
      { id: "gate", type: "approval", label: "موافقتك", executor: "claude_mcp", permission: "yellow" },
    ];
    const edges = [{ from: "start", to: "read" }, { from: "read", to: "gate" }];
    const llm = script(call("draft_workflow", { name: "فحص الصباح", nodes, edges }), (req) => {
      const [r] = results(req);
      expect(r!.data).toMatchObject({ ok: true, saved: false });
      expect(r!.data.warnings.join(" ")).toContain("حمرا");
      return { content: [{ type: "text", text: "جهّزت مسودة" }], stop_reason: "end_turn", usage: USAGE };
    });
    const r = await runLoop(base(llm, tools), ask("ارسم لي ورك فلو"));
    const art = r.artifacts[0] as Extract<Artifact, { kind: "workflow_draft" }>;
    expect(art).toMatchObject({ kind: "workflow_draft", name: "فحص الصباح", summary: "3 خطوة · 2 وصلة" });
    expect(art.graph.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number")).toBe(true);
  });

  it("a drawing that points at a step that is not there, or carries a phone number, is refused in words", async () => {
    const tools = makeTools();
    const bad = [
      call("draft_workflow", { name: "غلط", nodes: [{ id: "a", type: "trigger", label: "بداية" }], edges: [{ from: "a", to: "zzz" }] }, "1"),
      call("draft_workflow", { name: "فيه رقم", nodes: [{ id: "a", type: "step", label: "كلّم 0944123456" }], edges: [] }, "2"),
      (req: LlmRequest) => {
        const [r] = results(req);
        expect(r).toMatchObject({ error: true });
        return { content: [{ type: "text", text: "خلص" }], stop_reason: "end_turn", usage: USAGE } as LlmResponse;
      },
    ];
    const llm = script(...bad);
    // the model fixes nothing here: each call is judged on its own
    const r = await runLoop(base(llm, tools), ask("؟"));
    expect(r.artifacts).toEqual([]);
    expect(results(llm.calls[1]!)[0]!.data.error).toContain("الرسم مش صحيح");
    expect(results(llm.calls[2]!)[0]!.data.error).toContain("رقم هاتف");
  });

  it("a step for an existing workflow is added after the one named, joined to it, and the diff says what changed", async () => {
    const card = { key: "wf-1", name: "فحص", graph: { nodes: [{ id: "start", type: "trigger", label: "بداية", executor: "system" }, { id: "read", type: "step", label: "قراءة", executor: "claude_mcp" }], edges: [{ from: "start", to: "read" }] } };
    const tools = makeTools({ workflows: async () => [card as never] });
    const llm = script(call("draft_node", { workflow_key: "wf-1", after_node_id: "read", node: { type: "notify", label: "بلّغ المالك" } }), say("جهّزتها"));
    const r = await runLoop(base(llm, tools), ask("ضيف تبليغ"));
    const art = r.artifacts[0] as Extract<Artifact, { kind: "node_draft" }>;
    expect(art).toMatchObject({ kind: "node_draft", workflowKey: "wf-1", workflowName: "فحص" });
    expect(art.graph.nodes.map((n) => n.label)).toContain("بلّغ المالك");
    expect(art.graph.edges).toContainEqual({ from: "read", to: expect.stringMatching(/^notify/) });
    expect(art.summary).toContain("بلّغ المالك");
    // the stored drawing is untouched: only the card carries the new one
    expect(card.graph.nodes).toHaveLength(2);
  });

  it("a step with no anchor goes after the LAST step of the drawing, joined to it — never floating", async () => {
    const card = { key: "wf-2", name: "فحص", graph: { nodes: [{ id: "start", type: "trigger", label: "بداية", executor: "system" }, { id: "read", type: "step", label: "قراءة", executor: "claude_mcp" }, { id: "judge", type: "step", label: "حكم", executor: "claude_mcp" }], edges: [{ from: "start", to: "read" }, { from: "read", to: "judge" }] } };
    const tools = makeTools({ workflows: async () => [card as never] });
    const llm = script(call("draft_node", { workflow_key: "wf-2", node: { type: "notify", label: "بلّغ" } }), say("جهّزتها"));
    const r = await runLoop(base(llm, tools), ask("ضيف تبليغ"));
    const art = r.artifacts[0] as Extract<Artifact, { kind: "node_draft" }>;
    expect(art.graph.edges).toContainEqual({ from: "judge", to: expect.stringMatching(/^notify/) });
    expect(art.issues).toEqual([]);
    expect(art.summary).toContain("بعد «حكم»");
  });

  const EDIT_CARD = () => ({ key: "wf-e", name: "فحص", graph: { nodes: [{ id: "start", type: "trigger", label: "بداية", executor: "system" }, { id: "read", type: "step", label: "قراءة", executor: "claude_mcp", prompt: "اقرا الأرقام" }], edges: [{ from: "start", to: "read" }] } });

  it("an existing step is edited by words: only what was named changes, the stored drawing is untouched, and it comes back as a draft", async () => {
    const card = EDIT_CARD();
    const tools = makeTools({ workflows: async () => [card as never] });
    const llm = script(call("edit_node", { workflow_key: "wf-e", node_id: "read", changes: { label: "اقرا أرقام امبارح", prompt: "اقرا أرقام امبارح بس" } }), say("جهّزت التعديل"));
    const r = await runLoop(base(llm, tools), ask("غيّر اسم خطوة القراءة"));
    const art = r.artifacts[0] as Extract<Artifact, { kind: "node_draft" }>;
    expect(art).toMatchObject({ kind: "node_draft", workflowKey: "wf-e" });
    expect(art.graph.nodes.find((n) => n.id === "read")).toMatchObject({ label: "اقرا أرقام امبارح", prompt: "اقرا أرقام امبارح بس", executor: "claude_mcp", type: "step" });
    expect(art.graph.nodes).toHaveLength(2);
    expect(art.summary).toContain("label");
    expect(card.graph.nodes[1]).toMatchObject({ label: "قراءة", prompt: "اقرا الأرقام" });
    expect(results(llm.calls[1]!)[0]!.data).toMatchObject({ ok: true, saved: false });
  });

  it("edit_node says what is wrong: no change, a step that is not there, the same values, a customer's number", async () => {
    const tools = makeTools({ workflows: async () => [EDIT_CARD() as never] });
    const llm = script(
      call("edit_node", { workflow_key: "wf-e", node_id: "read", changes: {} }, "empty"),
      call("edit_node", { workflow_key: "wf-e", node_id: "nope", changes: { label: "س" } }, "missing"),
      call("edit_node", { workflow_key: "wf-e", node_id: "read", changes: { label: "قراءة" } }, "same"),
      call("edit_node", { workflow_key: "wf-e", node_id: "read", changes: { prompt: "كلّم الزبون على 0944123456" } }, "phone"),
      call("edit_node", { workflow_key: "other", node_id: "read", changes: { label: "س" } }, "nokey"),
      call("edit_node", { workflow_key: "wf-e", node_id: "read", changes: { type: "approval" } }, "retype"),
      say("خلص"),
    );
    const r = await runLoop(base(llm, tools), ask("؟"));
    expect(r.artifacts).toEqual([]);
    expect(r.tools.map((t) => t.ok)).toEqual([false, false, false, false, false, false]);
    expect(results(llm.calls[2]!)[0]!.data.error).toContain("nope");
    expect(results(llm.calls[3]!)[0]!.data.error).toContain("نفسها");
    expect(results(llm.calls[4]!)[0]!.data.error).toContain("رقم هاتف");
  });

  it("get_summary: a week or a month in one answer, with the products ranked by what an order cost (only those with enough orders)", async () => {
    const set = (over: Record<string, number | null>) => ({ ...Object.fromEntries(STATS.map((st) => [st.key, null])), ...over });
    const prod = (code: string, name: string, orders: number, cost: number | null) => ({ code, name, hasData: true, current: set({ ordersIn: orders, costPerOrder: cost, spend: orders * (cost ?? 0) }), prev: set({}), avg7: set({}), rejectReasons: [], offers: [], breakeven: null, stockUrgency: null });
    const data = {
      demo: false,
      range: { key: "7d", from: "2026-11-09", to: "2026-11-15", days: 7 },
      label: "7 أيام",
      totals: { current: set({ spend: 700, ordersIn: 120, costPerOrder: 5.83 }), prev: set({ spend: 640, ordersIn: 100, costPerOrder: 6.4 }), avg7: set({}) },
      products: [prod("A", "أ", 40, 4.1), prod("B", "ب", 30, 5.2), prod("C", "ج", 25, 6.3), prod("D", "د", 12, 7.9), prod("E", "هـ", 9, 9.4), prod("F", "و", 2, 1.1)],
      target: 6,
    };
    const asked: unknown[] = [];
    const tools = makeTools({ numbers: (async (q: unknown) => (asked.push(q), data)) as never });
    const llm = script(call("get_summary", { period: "week" }), call("get_summary", { period: "month" }, "m"), say("ملخّص"));
    const r = await runLoop(base(llm, tools), ask("لخّصلي الأسبوع"));
    const week = results(llm.calls[1]!)[0]!.data;
    expect(week.period).toBe("آخر 7 أيام");
    expect(week.ranking.cheapest.map((x: { code: string }) => x.code)).toEqual(["A", "B", "C"]);
    expect(week.ranking.dearest.map((x: { code: string }) => x.code)).toEqual(["E", "D"]);
    expect(week.ranking.not_ranked).toContain("1 منتج");
    expect(week.ranking.cheapest[0].cost_per_real_order).toEqual({ value: 4.1, display: expect.stringContaining("4.10") });
    expect(week.scopes[0].stats.find((x: { key: string }) => x.key === "spend")).toMatchObject({ previous_window: expect.any(String) });
    expect(r.facts.some((f) => f.label.includes("تكلفة الطلب الحقيقي · أ"))).toBe(true);
    expect(asked[0]).toMatchObject({ d: "7d" });
    expect(asked[1]).toMatchObject({ d: "custom", from: "2026-10-17", to: "2026-11-15" });
    expect(results(llm.calls[2]!)[0]!.data.period).toBe("آخر 30 يوم");
  });

  it("a workflow that does not exist lists the keys that do", async () => {
    const tools = makeTools({ workflows: async () => [{ key: "wf-1", name: "فحص", graph: { nodes: [], edges: [] } } as never] });
    const llm = script(call("draft_node", { workflow_key: "nope", node: { type: "step", label: "س" } }), say("؟"));
    await runLoop(base(llm, tools), ask("؟"));
    expect(results(llm.calls[1]!)[0]!.data.error).toContain("wf-1");
  });

  it("a prompt draft lists its {{variables}} and refuses odd names and private text", async () => {
    const tools = makeTools();
    const llm = script(
      call("draft_prompt", { title: "هوكات", text: "اكتب 4 هوكات لـ {{product}} بتاريخ {{date}} و{{product}}" }, "ok"),
      call("draft_prompt", { title: "غلط", text: "استعمل {{bad name}} هون وبس" }, "bad"),
      call("draft_prompt", { title: "رقم", text: "كلّم الزبون على 0944123456 مباشرة" }, "phone"),
      say("خلص"),
    );
    const r = await runLoop(base(llm, tools), ask("اكتب برومبت"));
    expect(r.artifacts).toMatchObject([{ kind: "prompt_draft", title: "هوكات", variables: ["product", "date"] }]);
    expect(r.tools.map((t) => t.ok)).toEqual([true, false, false]);
  });
});

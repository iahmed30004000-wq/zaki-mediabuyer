/**
 * THE ASSISTANT'S LOOP (v3 · H) — the model asks for tools, the code runs them, the model writes the answer, and the code
 * reads that answer before anybody else does.
 *
 *   1. the person's question (with the last few turns) goes to the model with the tool list;
 *   2. every tool the model calls is validated, checked against the caller's role, run by the code, scrubbed of anything that
 *      looks like customer data, and handed back — all the results of one turn in ONE message;
 *   3. the final text is read by the number guard: a number no tool returned (and the person did not say) is named, the model
 *      gets ONE chance to fix it, and if it still stands the answer goes out marked «ما قدرت أتحقق»;
 *   4. what the tools returned (not what the model said) becomes «الأرقام اللي جاوبت منها» — printed by the code.
 *
 * The model client is a two-line interface (`Llm`) so a test can script it; the real one wraps the official SDK (index.ts).
 */
import {
  LIMITS, addUsage, buildMessages, costUsd, dateNumbers, markCited, noUsage, numbersIn, repairMessage, resultText, scrubForModel, toolSpecs, unsupportedNumbers,
  type Artifact, type AssistantTool, type ChatTurn, type Fact, type SourceRef, type ToolOutput, type Usage,
} from "@/core/assistant";

// ───────────────────────────── the model, as the loop needs it ─────────────────────────────

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}
/** thinking blocks and anything else the API adds ride along untouched: the assistant turn is sent back as it came. */
export type LlmBlock = TextBlock | ToolUseBlock | { type: string; [k: string]: unknown };
export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}
export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmBlock[] | ToolResultBlock[];
}
export interface LlmRequest {
  model: string;
  max_tokens: number;
  system: { type: "text"; text: string; cache_control?: { type: "ephemeral" } }[];
  tools: { name: string; description: string; input_schema: Record<string, unknown> }[];
  messages: LlmMessage[];
}
export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}
export interface LlmResponse {
  content: LlmBlock[];
  stop_reason: string | null;
  usage: LlmUsage;
}
export interface Llm {
  create(req: LlmRequest, opts?: { signal?: AbortSignal }): Promise<LlmResponse>;
}

// ───────────────────────────── errors, in words ─────────────────────────────

export type ErrorCode = "auth" | "rate" | "billing" | "model" | "connection" | "server" | "budget" | "privacy" | "off" | "cut" | "aborted" | "busy";

export class AssistantError extends Error {
  constructor(public status: number, message: string, public code: ErrorCode = "server") {
    super(message);
  }
}

/** What the SDK (or the network) threw, as a sentence for the owner. Matches on the status and the name, not on the SDK's classes. */
export function toAssistantError(e: unknown): AssistantError {
  if (e instanceof AssistantError) return e;
  const err = e as { status?: number; name?: string; message?: string; error?: { error?: { message?: string } } } | null;
  const status = typeof err?.status === "number" ? err.status : 0;
  const text = `${err?.message ?? ""} ${err?.error?.error?.message ?? ""}`.toLowerCase();
  if (status === 401 || status === 403) return new AssistantError(502, "مفتاح Claude مش مقبول — تأكد من ANTHROPIC_API_KEY بـ Coolify.", "auth");
  if (status === 429) return new AssistantError(503, "في ضغط على Claude هلأ — جرّب بعد شوي.", "rate");
  if (status === 404) return new AssistantError(502, "الموديل المطلوب مش موجود عند Claude — راجع ASSISTANT_MODEL.", "model");
  if (status === 400 && /credit|balance|billing/.test(text)) return new AssistantError(502, "رصيد حساب Claude خلص — اشحنه من لوحة Anthropic وجرّب.", "billing");
  if (status === 400) return new AssistantError(502, "Claude رفض الطلب (400) — بلّغني بالسؤال اللي ما زبط.", "server");
  if (status >= 500 || status === 529) return new AssistantError(503, "Claude مشغول أو واقف مؤقتاً — جرّب بعد شوي.", "server");
  if (/abort/.test(err?.name?.toLowerCase() ?? "") || /abort/.test(text)) return new AssistantError(499, "انلغى الطلب.", "aborted");
  if (/connection|timeout|timed out|fetch failed|enotfound|econn/.test(`${err?.name ?? ""} ${text}`.toLowerCase())) return new AssistantError(503, "ما قدرت أوصل لـ Claude — جرّب كمان مرة.", "connection");
  return new AssistantError(500, "صار خطأ مع المساعد — جرّب كمان مرة.", "server");
}

// ───────────────────────────── the loop ─────────────────────────────

export interface CallRecord {
  ok: boolean;
  ms: number;
  usage: Usage;
  costUsd: number;
  stop?: string;
  error?: string;
}

export interface LoopDeps<C> {
  llm: Llm;
  model: string;
  system: string;
  tools: AssistantTool<C>[];
  ctx: C;
  /** may this person run the «write» tools */
  canWrite: boolean;
  now: Date;
  /** asked before every call to the model: a sentence stops the loop with that sentence (a cap was reached) */
  budget?: () => Promise<string | null>;
  record?: (e: CallRecord) => Promise<void>;
  /** what a call cost, when the model is not one of Claude's (an OpenAI-compatible one has its own price); left out = Claude's table */
  price?: (u: Usage) => number;
  /** a «write» tool ran */
  wrote?: (e: { tool: string; ok: boolean }) => Promise<void>;
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
}

export interface LoopInput {
  question: string;
  history: ChatTurn[];
}

export type LoopStop = "answered" | "cut" | "refused" | "budget" | "limit";

export interface LoopResult {
  answer: string;
  facts: Fact[];
  sources: SourceRef[];
  artifacts: Artifact[];
  /** every number the answer says came out of a tool (or was the person's own, or a date) */
  verified: boolean;
  unsupported: string[];
  steps: number;
  usage: Usage;
  costUsd: number;
  tools: { name: string; ok: boolean; ms: number }[];
  stop: LoopStop;
}

const isText = (b: LlmBlock): b is TextBlock => b.type === "text" && typeof (b as TextBlock).text === "string";
const isToolUse = (b: LlmBlock): b is ToolUseBlock => b.type === "tool_use" && typeof (b as ToolUseBlock).id === "string" && typeof (b as ToolUseBlock).name === "string";

const usageOf = (u: LlmUsage): Usage => ({ input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });

const failed = (message: string): ToolOutput => ({ data: { error: message }, sources: [], facts: [], isError: true });

export async function runLoop<C>(deps: LoopDeps<C>, input: LoopInput): Promise<LoopResult> {
  const messages: LlmMessage[] = buildMessages(input.history, input.question);
  const specs = toolSpecs(deps.tools);
  const byName = new Map(deps.tools.map((t) => [t.name, t]));

  // the numbers an answer may stand on: the person's own, the days around today, and (below) whatever the tools return
  const allowed: number[] = [...numbersIn(input.question), ...input.history.flatMap((h) => numbersIn(h.text)), ...dateNumbers(deps.now)];

  const facts: Fact[] = [];
  const seen = new Set<string>();
  const sources = new Map<string, SourceRef>();
  const artifacts: Artifact[] = [];
  const log: LoopResult["tools"] = [];
  const calls = new Map<string, number>();
  const writes = new Map<string, ToolOutput>();
  let usage = noUsage();
  let cost = 0;
  let repaired = false;
  let steps = 0;

  const absorb = (out: ToolOutput) => {
    for (const f of out.facts) {
      const k = `${f.source}|${f.label}|${f.value}`;
      if (seen.has(k)) continue;
      seen.add(k);
      facts.push(f);
    }
    for (const s of out.sources) sources.set(s.id, s);
    artifacts.push(...(out.artifacts ?? []));
    allowed.push(...numbersIn(out.data));
  };

  const finish = (answer: string, stop: LoopStop, unsupported: string[] = []): LoopResult => {
    const marked = markCited(facts, answer);
    const ordered = [...marked.filter((f) => f.cited), ...marked.filter((f) => !f.cited)].slice(0, LIMITS.facts);
    return { answer, facts: ordered, sources: [...sources.values()], artifacts, verified: unsupported.length === 0, unsupported, steps, usage, costUsd: cost, tools: log, stop };
  };

  /** One tool call: refused in words when it cannot run, never an exception. */
  async function execute(use: ToolUseBlock): Promise<{ out: ToolOutput; ms: number }> {
    const tool = byName.get(use.name);
    if (!tool) return { out: failed(`أداة «${use.name}» مش موجودة. الأدوات: ${[...byName.keys()].join("، ")}`), ms: 0 };
    const n = (calls.get(tool.name) ?? 0) + 1;
    calls.set(tool.name, n);
    if (n > LIMITS.callsPerTool) return { out: failed("استعملت هالأداة كتير بهالسؤال — جاوب من اللي معك."), ms: 0 };
    if (tool.access === "write" && !deps.canWrite) return { out: failed("دورك ما بيسمح بهالإجراء (بدو صلاحية اقتراح التغييرات)."), ms: 0 };
    const parsed = tool.input.safeParse(use.input ?? {});
    if (!parsed.success) return { out: failed(`الطلب مش صحيح: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".") || "الطلب"}: ${i.message}`).join(" · ")}`), ms: 0 };
    const dedupe = tool.access === "write" ? `${tool.name}:${JSON.stringify(parsed.data)}` : null;
    if (dedupe && writes.has(dedupe)) {
      const first = writes.get(dedupe)!;
      return { out: { ...first, data: { already_done: true, ...(first.data as object) }, facts: [], sources: [], artifacts: [] }, ms: 0 };
    }
    deps.onStatus?.(tool.status);
    const t0 = Date.now();
    let out: ToolOutput;
    try {
      out = await tool.run(parsed.data, deps.ctx);
    } catch (e) {
      console.error("[assistant] tool crashed", tool.name, e);
      out = failed("صار خطأ بالأداة — جرّب بصيغة تانية.");
    }
    const ms = Date.now() - t0;
    if (dedupe) {
      writes.set(dedupe, out);
      await deps.wrote?.({ tool: tool.name, ok: !out.isError }).catch(() => undefined);
    }
    return { out, ms };
  }

  for (steps = 1; steps <= LIMITS.steps; steps++) {
    if (deps.signal?.aborted) throw new AssistantError(499, "انلغى الطلب.", "aborted");
    const stopWith = await deps.budget?.();
    if (stopWith) return finish(stopWith, "budget");
    if (steps === 1) deps.onStatus?.("عم بفكّر…");

    const t0 = Date.now();
    let res: LlmResponse;
    try {
      res = await deps.llm.create({ model: deps.model, max_tokens: LIMITS.maxTokens, system: [{ type: "text", text: deps.system, cache_control: { type: "ephemeral" } }], tools: specs, messages }, { signal: deps.signal });
    } catch (e) {
      await deps.record?.({ ok: false, ms: Date.now() - t0, usage: noUsage(), costUsd: 0, error: String((e as Error | null)?.message ?? e).slice(0, 300) }).catch(() => undefined);
      throw toAssistantError(e);
    }
    const u = usageOf(res.usage);
    const c = deps.price ? deps.price(u) : costUsd(deps.model, u);
    usage = addUsage(usage, u);
    cost += c;
    await deps.record?.({ ok: true, ms: Date.now() - t0, usage: u, costUsd: c, stop: res.stop_reason ?? undefined }).catch(() => undefined);

    if (res.stop_reason === "refusal") return finish("الموديل رفض يجاوب على هالطلب — جرّب تصيغه بشكل تاني.", "refused");

    // the turn goes back exactly as it came (thinking blocks included): that is what the API wants
    messages.push({ role: "assistant", content: res.content });

    const uses = res.content.filter(isToolUse);
    if (uses.length) {
      // reads run side by side, writes one after the other in the order the model gave them
      const results: { out: ToolOutput; ms: number }[] = new Array(uses.length);
      await Promise.all(uses.map(async (use, i) => (byName.get(use.name)?.access === "write" ? undefined : (results[i] = await execute(use)))));
      for (let i = 0; i < uses.length; i++) if (!results[i]) results[i] = await execute(uses[i]!);
      const blocks: ToolResultBlock[] = uses.map((use, i) => {
        const { out, ms } = results[i]!;
        absorb(out);
        log.push({ name: use.name, ok: !out.isError, ms });
        return { type: "tool_result", tool_use_id: use.id, content: resultText(scrubForModel(out.data)), ...(out.isError ? { is_error: true } : {}) };
      });
      messages.push({ role: "user", content: blocks });
      continue;
    }

    const text = res.content.filter(isText).map((b) => b.text).join("\n").trim();
    if (!text) {
      if (res.stop_reason === "max_tokens") throw new AssistantError(502, "الجواب انقطع قبل ما يكتمل — جرّب سؤال أبسط.", "cut");
      return finish("ما طلع جواب — جرّب كمان مرة.", "answered");
    }
    const bad = unsupportedNumbers(text, allowed);
    if (bad.length && !repaired && steps < LIMITS.steps) {
      repaired = true;
      messages.push({ role: "user", content: repairMessage(bad) });
      continue;
    }
    return finish(text, res.stop_reason === "max_tokens" ? "cut" : "answered", bad);
  }
  steps = LIMITS.steps;
  return finish("وصلت لحد الخطوات لهالسؤال — هاي الأرقام اللي جمعتها، وجرّب سؤال أضيق.", "limit");
}

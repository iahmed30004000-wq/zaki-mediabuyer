/**
 * THE ASSISTANT, WIRED (v3 · H): the official SDK as the model, the AgentRun table as the log and the cap, the settings as the
 * owner's limits. `askAssistant` is what the route calls; everything it needs from outside (the model, the tools, the clock) can
 * be handed in, so tests and the demo run it without a key.
 *
 *   key        ANTHROPIC_API_KEY, or CLAUDE_API_KEY beside it (Coolify), else the key the owner linked from the settings (encrypted in the
 *            database) — never in the repo, never in a prompt, never in the browser
 *   model      ASSISTANT_MODEL, default claude-opus-5-5
 *   caps       agents.daily_caps.M12 (default $3 a day) and agents.monthly_cap for every agent together: at a cap it stops,
 *              and the numbers, rules and screens keep working
 *   privacy    the question and the turns are read by the privacy filter before anything leaves; PRIVACY_MODE=internal_only
 *              keeps the assistant off (it is an external model)
 *   tools      the tools a person is given are the ones their role may use (`allowedTools`): the assistant is never a way round a role
 *   spending   (v6 · P4-2, S-24) one run per person at a time, and the money of a call is HELD before the call (a row that stands for its worst case)
 *              and settled after it — so two people asking at the same moment cannot both pass a cap that only one of them fits under
 */
import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_AGENT, DEFAULT_DAILY_CAP_USD, LIMITS, allowedTools, costUsd, systemPrompt, tokensIn, type Artifact, type ChatTurn, type Fact, type SourceRef, type Usage } from "@/core/assistant";
import { ammanKey } from "@/core/dates";
import { dayBounds } from "@/core/day";
import { fmt } from "@/lib/format";
import { PrivacyRefusal, privacyHits } from "@/gateway/privacy";
import { audit } from "../audit";
import type { Caller } from "../auth";
import { db } from "../db";
import { getSetting } from "../settings";
import { AssistantError, runLoop, type Llm, type LlmResponse } from "./loop";
import { NO_KEY, OFF_BY_PRIVACY, assistantModel, assistantProvider, compatConfig, compatUsdPer1k, externalModelsOff } from "./config";
import { makeCompatLlm } from "./openai-compat";
import { resolveKey } from "./key";
import { canWrite, defaultDeps, makeTools, type Tool, type ToolCtx } from "./tools";

export { AssistantError } from "./loop";
export { assistantConfigured, assistantModel, externalModelsOff } from "./config";

let cached: { key: string; llm: Llm } | null = null;

/**
 * The model client: the official SDK, non-streaming (an answer is a few hundred tokens), with its own retries on 429/5xx/connection.
 * `baseURL` is for a test or a local stand-in; left out, the SDK uses Anthropic's (or ANTHROPIC_BASE_URL).
 */
export function makeLlm(apiKey: string, baseURL?: string): Llm {
  const client = new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: 90_000, maxRetries: 2 });
  return {
    create: async (req, opts) => (await client.messages.create(req as unknown as Anthropic.MessageCreateParamsNonStreaming, opts?.signal ? { signal: opts.signal } : undefined)) as unknown as LlmResponse,
  };
}

async function realLlm(): Promise<Llm | null> {
  // an OpenAI-compatible model set in Coolify wins; otherwise Claude, as before
  const compat = compatConfig();
  if (compat) {
    const k = `compat|${compat.baseUrl}|${compat.apiKey}`;
    if (cached?.key === k) return cached.llm;
    const llm = makeCompatLlm(compat);
    cached = { key: k, llm };
    return llm;
  }
  const apiKey = (await resolveKey())?.key;
  if (!apiKey) return null;
  if (cached?.key === apiKey) return cached.llm;
  const llm = makeLlm(apiKey);
  cached = { key: apiKey, llm };
  return llm;
}

export interface AskInput {
  question: string;
  history: ChatTurn[];
  place: { key: string; label: string } | null;
}

export interface AskHooks {
  onStatus?: (text: string) => void;
  signal?: AbortSignal;
  /** stand-ins for tests and the demo */
  llm?: Llm;
  tools?: Tool[];
  now?: Date;
  model?: string;
  products?: () => Promise<{ code: string; name: string }[]>;
}

export interface AssistantReply {
  mode: "assistant";
  answer: string;
  facts: Fact[];
  sources: SourceRef[];
  artifacts: Artifact[];
  verified: boolean;
  unsupported: string[];
  model: string;
  costUsd: number;
  steps: number;
}

async function logCall(model: string, e: { ok: boolean; ms: number; tokensIn: number; tokensOut: number; costUsd: number; blocked?: string; error?: string }) {
  try {
    await db.agentRun.create({ data: { agent: ASSISTANT_AGENT, provider: assistantProvider(), model, ok: e.ok, blocked: e.blocked ?? null, tokensIn: e.tokensIn, tokensOut: e.tokensOut, costUsd: e.costUsd, ms: e.ms, error: e.error ?? null } });
  } catch (err) {
    console.error("[assistant] could not log a call", err);
  }
}

// ───────────────────────────── the caps, and the money held before a call ─────────────────────────────

/** The row that stands for the money of a call that has not come back yet (its own agent name, so no screen reads it as a call). */
export const HOLD_AGENT = `${ASSISTANT_AGENT}.hold`;
/** A hold older than this is a call that never settled (the process went down): it stops counting. */
export const HOLD_TTL_MS = 10 * 60_000;
/** What one call is held for: a long conversation in (30k tokens) and the longest answer out. Never less than what the dearest Claude would cost, so the cap does not under-count. */
export const HOLD_INPUT_TOKENS = 30_000;

export function holdUsd(model: string, per1k: number | null): number {
  return per1k !== null ? ((HOLD_INPUT_TOKENS + LIMITS.maxTokens) / 1000) * per1k : costUsd(model, { input: HOLD_INPUT_TOKENS, output: LIMITS.maxTokens, cacheRead: 0, cacheWrite: 0 });
}

/**
 * Looks at the caps and — if there is room — holds `hold` dollars for the call about to be made, in one step under a lock (two calls at the same moment are looked at one after the other, and the second sees
 * the first's hold). A call goes ahead when what is spent AND held is still under the cap, as it always did when nothing was held: the cap is a line the next call may cross, never one that two calls both cross
 * because neither saw the other. Returns the sentence of the cap that stopped it, or the id of the hold (to settle after the call).
 */
export async function reserveBudget(now: Date, hold: number, model: string): Promise<{ stop: string } | { id: string }> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('assistant.budget'))`;
      await tx.agentRun.deleteMany({ where: { agent: HOLD_AGENT, createdAt: { lt: new Date(now.getTime() - HOLD_TTL_MS) } } });
      const caps = (await getSetting("agents.daily_caps")) as Record<string, number>;
      const cap = caps[ASSISTANT_AGENT] ?? DEFAULT_DAILY_CAP_USD;
      if (cap > 0) {
        const spent = Number((await tx.agentRun.aggregate({ _sum: { costUsd: true }, where: { agent: { in: [ASSISTANT_AGENT, HOLD_AGENT] }, createdAt: { gte: dayBounds(ammanKey(now)).from } } }))._sum.costUsd ?? 0);
        if (spent >= cap) return { stop: `وصلت للحد اليومي للمساعد (${fmt(cap, "$")}). بيرجع بكرا، أو ارفع الحد من الإعدادات ← الوكلاء.` };
      }
      const monthCap = Number(await getSetting("agents.monthly_cap"));
      if (monthCap > 0) {
        const monthStart = new Date(`${ammanKey(now).slice(0, 7)}-01T00:00:00+03:00`);
        const spent = Number((await tx.agentRun.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: monthStart } } }))._sum.costUsd ?? 0);
        if (spent >= monthCap) return { stop: `وصلت للحد الشهري لكل الوكلاء (${fmt(monthCap, "$", 0)}). ارفعه من الإعدادات ← الوكلاء.` };
      }
      const row = await tx.agentRun.create({ data: { agent: HOLD_AGENT, provider: assistantProvider(), model, ok: false, blocked: "reserved", costUsd: hold } });
      return { id: row.id };
    },
    { timeout: 10_000, maxWait: 10_000 },
  );
}

/** The call came back (or failed): the hold goes, and the real cost is written by `logCall`. Never throws. */
export async function settleHold(id: string | null): Promise<void> {
  if (!id) return;
  try {
    await db.agentRun.deleteMany({ where: { id } });
  } catch (err) {
    console.error("[assistant] could not settle a hold", err);
  }
}

/** The caps, looked at without holding anything: a sentence when one is reached, null while there is room. (The loop itself holds through `reserveBudget`.) */
export async function budgetLeft(now: Date): Promise<string | null> {
  const caps = (await getSetting("agents.daily_caps")) as Record<string, number>;
  const cap = caps[ASSISTANT_AGENT] ?? DEFAULT_DAILY_CAP_USD;
  if (cap > 0) {
    const spent = Number((await db.agentRun.aggregate({ _sum: { costUsd: true }, where: { agent: { in: [ASSISTANT_AGENT, HOLD_AGENT] }, createdAt: { gte: dayBounds(ammanKey(now)).from } } }))._sum.costUsd ?? 0);
    if (spent >= cap) return `وصلت للحد اليومي للمساعد (${fmt(cap, "$")}). بيرجع بكرا، أو ارفع الحد من الإعدادات ← الوكلاء.`;
  }
  const monthCap = Number(await getSetting("agents.monthly_cap"));
  if (monthCap > 0) {
    const monthStart = new Date(`${ammanKey(now).slice(0, 7)}-01T00:00:00+03:00`);
    const spent = Number((await db.agentRun.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: monthStart } } }))._sum.costUsd ?? 0);
    if (spent >= monthCap) return `وصلت للحد الشهري لكل الوكلاء (${fmt(monthCap, "$", 0)}). ارفعه من الإعدادات ← الوكلاء.`;
  }
  return null;
}

// ───────────────────────────── one run per person ─────────────────────────────

/** A run that has not ended after this long is not holding anybody up any more (the stream was cut and nobody closed it). */
export const RUN_TTL_MS = 5 * 60_000;
const running = new Map<string, number>();

/** Takes the person's turn: false when they already have a question being answered. (One app process: a second one would need this in the database.) */
export function beginRun(userId: string, nowMs: number): boolean {
  const since = running.get(userId);
  if (since !== undefined && nowMs - since < RUN_TTL_MS) return false;
  running.set(userId, nowMs);
  return true;
}
export function endRun(userId: string): void {
  running.delete(userId);
}
/** Forgets every turn (tests). */
export const resetRuns = (): void => running.clear();

export const BUSY = "في سؤال قبله لسا عم يتجاوب — استنى يخلص وبعدين اسأل.";

// ───────────────────────────── a question, answered ─────────────────────────────

interface RunSpec {
  question: string;
  history: ChatTurn[];
  place: { key: string; label: string } | null;
  system: (products: { code: string; name: string }[]) => string;
  tools: Tool[];
}

/** The one path every model call takes: the privacy filter, the switch, the key, the turn, the hold, the loop. */
async function runAssistant(spec: RunSpec, caller: Caller, hooks: AskHooks): Promise<AssistantReply> {
  const now = hooks.now ?? new Date();
  const model = hooks.model ?? assistantModel();

  // nothing leaves before the privacy filter has read it (a phone, an e-mail, a key → refused, not cleaned)
  const hits = [...new Set([spec.question, ...spec.history.map((h) => h.text)].flatMap(privacyHits))];
  if (hits.length) {
    await logCall(model, { ok: false, ms: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, blocked: hits.join(",") });
    throw new PrivacyRefusal(hits);
  }
  if (externalModelsOff()) throw new AssistantError(403, OFF_BY_PRIVACY, "off");
  const llm = hooks.llm ?? (await realLlm());
  if (!llm) throw new AssistantError(503, NO_KEY, "off");

  // one question at a time per person: a second tap, a second tab or a script cannot start a second paid run while the first is going
  if (!beginRun(caller.id, now.getTime())) throw new AssistantError(429, BUSY, "busy");
  let held: string | null = null;
  try {
    const products = await (hooks.products ?? defaultDeps.products)();
    const ctx: ToolCtx = { caller, now, place: spec.place };
    const per1k = compatConfig() && !hooks.llm ? compatUsdPer1k() : null;
    const hold = holdUsd(model, per1k);
    const r = await runLoop(
      {
        llm,
        model,
        system: spec.system(products),
        tools: spec.tools,
        ctx,
        canWrite: canWrite(caller),
        now,
        // the money of the next call is held under the cap's lock before it is made, and settled when it comes back
        budget: async () => {
          const got = await reserveBudget(now, hold, model);
          if ("stop" in got) return got.stop;
          held = got.id;
          return null;
        },
        // an OpenAI-compatible model priced by ASSISTANT_USD_PER_1K; unset, it is priced as the dearest Claude (the cap never under-counts)
        ...(compatConfig() && !hooks.llm && per1k !== null ? { price: (u: Usage) => ((u.input + u.cacheRead + u.cacheWrite + u.output) / 1000) * per1k } : {}),
        record: async (e) => {
          await settleHold(held);
          held = null;
          await logCall(model, { ok: e.ok, ms: e.ms, tokensIn: tokensIn(e.usage), tokensOut: e.usage.output, costUsd: e.costUsd, error: e.error });
        },
        wrote: async (e) => {
          await audit({ type: "agent", id: ASSISTANT_AGENT }, "assistant.tool", { type: "user", id: caller.id }, { after: { tool: e.tool, ok: e.ok } });
        },
        onStatus: hooks.onStatus,
        signal: hooks.signal,
      },
      { question: spec.question, history: spec.history },
    );
    return { mode: "assistant", answer: r.answer, facts: r.facts, sources: r.sources, artifacts: r.artifacts, verified: r.verified, unsupported: r.unsupported, model, costUsd: r.costUsd, steps: r.steps };
  } finally {
    // a hold that was never settled (the call was cut before it came back) goes with the turn
    await settleHold(held);
    endRun(caller.id);
  }
}

/**
 * One question → one answer, with the numbers it stands on. Throws `PrivacyRefusal` (nothing was sent), `AssistantError` (the
 * model or the account said no — the message is for the owner) — and answers in words when a cap was reached.
 * The tools it is given are the ones the caller's role may use (`TOOL_NEEDS`).
 */
export async function askAssistant(input: AskInput, caller: Caller, hooks: AskHooks = {}): Promise<AssistantReply> {
  const now = hooks.now ?? new Date();
  return runAssistant(
    { question: input.question, history: input.history, place: input.place, system: (products) => systemPrompt({ now, place: input.place, products }), tools: allowedTools(hooks.tools ?? makeTools(), caller.role) },
    caller,
    hooks,
  );
}

export { runAssistant, type RunSpec };

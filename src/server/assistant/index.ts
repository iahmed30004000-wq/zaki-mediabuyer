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
 */
import Anthropic from "@anthropic-ai/sdk";
import { ASSISTANT_AGENT, DEFAULT_DAILY_CAP_USD, systemPrompt, tokensIn, type Artifact, type ChatTurn, type Fact, type SourceRef } from "@/core/assistant";
import { ammanKey } from "@/core/dates";
import { dayBounds } from "@/core/day";
import { fmt } from "@/lib/format";
import { PrivacyRefusal, privacyHits } from "@/gateway/privacy";
import { audit } from "../audit";
import type { Caller } from "../auth";
import { db } from "../db";
import { getSetting } from "../settings";
import { AssistantError, runLoop, type Llm, type LlmResponse } from "./loop";
import { NO_KEY, OFF_BY_PRIVACY, assistantModel, externalModelsOff } from "./config";
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
    await db.agentRun.create({ data: { agent: ASSISTANT_AGENT, provider: "anthropic", model, ok: e.ok, blocked: e.blocked ?? null, tokensIn: e.tokensIn, tokensOut: e.tokensOut, costUsd: e.costUsd, ms: e.ms, error: e.error ?? null } });
  } catch (err) {
    console.error("[assistant] could not log a call", err);
  }
}

/** The caps: a sentence when one is reached (the loop stops with it), null while there is room. */
export async function budgetLeft(now: Date): Promise<string | null> {
  const caps = (await getSetting("agents.daily_caps")) as Record<string, number>;
  const cap = caps[ASSISTANT_AGENT] ?? DEFAULT_DAILY_CAP_USD;
  if (cap > 0) {
    const spent = Number((await db.agentRun.aggregate({ _sum: { costUsd: true }, where: { agent: ASSISTANT_AGENT, createdAt: { gte: dayBounds(ammanKey(now)).from } } }))._sum.costUsd ?? 0);
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

/**
 * One question → one answer, with the numbers it stands on. Throws `PrivacyRefusal` (nothing was sent), `AssistantError` (the
 * model or the account said no — the message is for the owner) — and answers in words when a cap was reached.
 */
export async function askAssistant(input: AskInput, caller: Caller, hooks: AskHooks = {}): Promise<AssistantReply> {
  const now = hooks.now ?? new Date();
  const model = hooks.model ?? assistantModel();

  // nothing leaves before the privacy filter has read it (a phone, an e-mail, a key → refused, not cleaned)
  const hits = [...new Set([input.question, ...input.history.map((h) => h.text)].flatMap(privacyHits))];
  if (hits.length) {
    await logCall(model, { ok: false, ms: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, blocked: hits.join(",") });
    throw new PrivacyRefusal(hits);
  }
  if (externalModelsOff()) throw new AssistantError(403, OFF_BY_PRIVACY, "off");
  const llm = hooks.llm ?? (await realLlm());
  if (!llm) throw new AssistantError(503, NO_KEY, "off");

  const products = await (hooks.products ?? defaultDeps.products)();
  const ctx: ToolCtx = { caller, now, place: input.place };
  const r = await runLoop(
    {
      llm,
      model,
      system: systemPrompt({ now, place: input.place, products }),
      tools: hooks.tools ?? makeTools(),
      ctx,
      canWrite: canWrite(caller),
      now,
      budget: () => budgetLeft(now),
      record: (e) => logCall(model, { ok: e.ok, ms: e.ms, tokensIn: tokensIn(e.usage), tokensOut: e.usage.output, costUsd: e.costUsd, error: e.error }),
      wrote: async (e) => {
        await audit({ type: "agent", id: ASSISTANT_AGENT }, "assistant.tool", { type: "user", id: caller.id }, { after: { tool: e.tool, ok: e.ok } });
      },
      onStatus: hooks.onStatus,
      signal: hooks.signal,
    },
    { question: input.question, history: input.history },
  );
  return { mode: "assistant", answer: r.answer, facts: r.facts, sources: r.sources, artifacts: r.artifacts, verified: r.verified, unsupported: r.unsupported, model, costUsd: r.costUsd, steps: r.steps };
}

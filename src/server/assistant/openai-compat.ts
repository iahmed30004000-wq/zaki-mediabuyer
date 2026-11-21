/**
 * THE ASSISTANT ON AN OPENAI-COMPATIBLE MODEL: the same `Llm` the loop already talks to, spoken as `POST {base}/chat/completions`
 * with function calling — so the loop, the tools, the number guard and the caps do not change. Used when the owner sets
 * ASSISTANT_BASE_URL + ASSISTANT_API_KEY + ASSISTANT_MODEL in Coolify (the same model the landing pages use, for one).
 *
 *   in   the system text → a `system` message; a tool list → `tools: [{ type: "function", function }]`; an assistant turn's
 *        tool_use blocks → `tool_calls`; a user turn of tool_result blocks → one `tool` message per result
 *   out  `message.content` → a text block; `message.tool_calls` → tool_use blocks (arguments parsed; unreadable JSON is passed on
 *        as-is, so the tool's own check refuses it in words); `finish_reason` → the stop reason the loop knows
 *
 * The key goes in the Authorization header and nowhere else: not in an error, not in a log. A failure becomes an AssistantError
 * whose sentence names the variable to check — never the key, never the response body.
 */
import { AssistantError, type Llm, type LlmBlock, type LlmMessage, type LlmRequest, type LlmResponse, type ToolResultBlock } from "./loop";

export interface CompatConfig {
  baseUrl: string;
  apiKey: string;
}

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface ChatChoice {
  message?: { content?: string | null; tool_calls?: { id?: string; type?: string; function?: { name?: string; arguments?: string } }[] | null };
  finish_reason?: string | null;
}
interface ChatAnswer {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } | null } | null;
}

const TIMEOUT_MS = 90_000;

const isToolResult = (b: unknown): b is ToolResultBlock => !!b && typeof b === "object" && (b as { type?: unknown }).type === "tool_result";

/** The loop's messages, as chat-completions messages. */
export function toChatMessages(system: string, messages: LlmMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    if (typeof m.content === "string") {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    if (m.role === "user") {
      for (const b of m.content) {
        if (isToolResult(b)) out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.is_error ? `خطأ: ${b.content}` : b.content });
        else if ((b as { type?: string }).type === "text") out.push({ role: "user", content: String((b as { text?: unknown }).text ?? "") });
      }
      continue;
    }
    const blocks = m.content as LlmBlock[];
    const text = blocks.filter((b) => b.type === "text").map((b) => String((b as { text?: unknown }).text ?? "")).join("\n");
    const calls = blocks
      .filter((b) => b.type === "tool_use")
      .map((b) => {
        const u = b as { id: string; name: string; input: unknown };
        return { id: u.id, type: "function" as const, function: { name: u.name, arguments: typeof u.input === "string" ? u.input : JSON.stringify(u.input ?? {}) } };
      });
    out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
  }
  return out;
}

const STOP: Record<string, string> = { stop: "end_turn", tool_calls: "tool_use", function_call: "tool_use", length: "max_tokens", content_filter: "refusal" };

/** A chat-completions answer, as the response the loop reads. */
export function fromChatAnswer(a: ChatAnswer): LlmResponse {
  const choice = a.choices?.[0];
  const msg = choice?.message ?? {};
  const content: LlmBlock[] = [];
  if (typeof msg.content === "string" && msg.content.trim()) content.push({ type: "text", text: msg.content });
  (msg.tool_calls ?? []).forEach((c, i) => {
    const raw = c.function?.arguments ?? "";
    let input: unknown = {};
    if (raw.trim()) {
      try {
        input = JSON.parse(raw);
      } catch {
        input = raw;
      }
    }
    content.push({ type: "tool_use", id: c.id || `call_${i}`, name: c.function?.name ?? "", input });
  });
  const finish = choice?.finish_reason ?? null;
  const stop = content.some((b) => b.type === "tool_use") ? "tool_use" : finish ? (STOP[finish] ?? finish) : null;
  const cached = a.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return { content, stop_reason: stop, usage: { input_tokens: Math.max(0, (a.usage?.prompt_tokens ?? 0) - cached), output_tokens: a.usage?.completion_tokens ?? 0, cache_read_input_tokens: cached } };
}

/** The request the loop builds, as a chat-completions body. */
export function toChatRequest(req: LlmRequest): Record<string, unknown> {
  return {
    model: req.model,
    max_tokens: req.max_tokens,
    messages: toChatMessages(req.system.map((s) => s.text).join("\n\n"), req.messages),
    ...(req.tools.length ? { tools: req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })), tool_choice: "auto" } : {}),
  };
}

/** A status (or nothing) as a sentence for the owner — the variable to check, never the key or the body. */
export function compatError(status: number): AssistantError {
  if (status === 401 || status === 403) return new AssistantError(502, "مفتاح موديل المساعد مش مقبول — تأكد من ASSISTANT_API_KEY بـ Coolify.", "auth");
  if (status === 404) return new AssistantError(502, "الموديل أو العنوان مش موجود — راجع ASSISTANT_MODEL وASSISTANT_BASE_URL بـ Coolify.", "model");
  if (status === 429) return new AssistantError(503, "في ضغط على موديل المساعد هلأ — جرّب بعد شوي.", "rate");
  if (status === 402) return new AssistantError(502, "رصيد مزوّد موديل المساعد خلص — اشحنه وجرّب.", "billing");
  if (status === 400 || status === 422) return new AssistantError(502, `موديل المساعد رفض الطلب (${status}) — يمكن ما بيدعم الأدوات (function calling). بلّغني بالسؤال اللي ما زبط.`, "server");
  if (status >= 500) return new AssistantError(503, "موديل المساعد مشغول أو واقف مؤقتاً — جرّب بعد شوي.", "server");
  return new AssistantError(503, "ما قدرت أوصل لموديل المساعد — اتأكد من ASSISTANT_BASE_URL وجرّب كمان مرة.", "connection");
}

export function makeCompatLlm(cfg: CompatConfig, fetchImpl: typeof fetch = fetch): Llm {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return {
    async create(req, opts) {
      const timeout = AbortSignal.timeout(TIMEOUT_MS);
      const signal = opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(toChatRequest(req)),
          signal,
        });
      } catch (e) {
        if (opts?.signal?.aborted) throw new AssistantError(499, "انلغى الطلب.", "aborted");
        throw compatError(timeout.aborted ? 504 : 0);
      }
      if (!res.ok) throw compatError(res.status);
      let body: ChatAnswer;
      try {
        body = (await res.json()) as ChatAnswer;
      } catch {
        throw new AssistantError(502, "موديل المساعد ردّ بشي مش JSON — اتأكد إنو ASSISTANT_BASE_URL بينتهي بـ /v1.", "server");
      }
      if (!Array.isArray(body.choices) || !body.choices.length) throw new AssistantError(502, "موديل المساعد ردّ بلا جواب — جرّب كمان مرة.", "server");
      return fromChatAnswer(body);
    },
  };
}

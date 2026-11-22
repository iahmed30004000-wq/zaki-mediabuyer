/**
 * What the assistant needs from the environment, in one place (no SDK import, so a settings screen can ask «is it there?»
 * without loading the model client). A value is never returned to a screen or a log.
 */
import { DEFAULT_MODEL } from "@/core/assistant";
import { envAny } from "../env";
import { resolveKey } from "./key";

/**
 * An OpenAI-compatible model for the assistant: ASSISTANT_BASE_URL (ending in /v1) + ASSISTANT_API_KEY + ASSISTANT_MODEL, all three
 * in Coolify. When they are there they win over Claude; when any is missing the assistant stays on Claude as before.
 */
export function compatConfig(): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = envAny("ASSISTANT_BASE_URL");
  const apiKey = envAny("ASSISTANT_API_KEY");
  const model = envAny("ASSISTANT_MODEL");
  return baseUrl && apiKey && model ? { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model } : null;
}

/** Which model the assistant talks to now — for the log, never a key. */
export const assistantProvider = (): "openai-compatible" | "anthropic" => (compatConfig() ? "openai-compatible" : "anthropic");

/**
 * USD per 1k tokens (input and output alike) for the OpenAI-compatible model, from ASSISTANT_USD_PER_1K; null = not set, and then a
 * call is priced as the dearest Claude so the daily cap never under-counts.
 */
export function compatUsdPer1k(): number | null {
  const v = Number(envAny("ASSISTANT_USD_PER_1K") ?? NaN);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** A model is there: the OpenAI-compatible one, else ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in Coolify, else the key linked from the site. */
export const assistantConfigured = async (): Promise<boolean> => compatConfig() !== null || (await resolveKey()) !== null;

/** ASSISTANT_MODEL, else the default (claude-opus-5-5). */
export const assistantModel = (): string => envAny("ASSISTANT_MODEL") ?? DEFAULT_MODEL;

/** PRIVACY_MODE=internal_only means no external model for any agent — Claude is external, so the assistant stays off. */
export const externalModelsOff = (): boolean => process.env.PRIVACY_MODE === "internal_only";

export const OFF_BY_PRIVACY = "وضع الخصوصية PRIVACY_MODE=internal_only شغّال — المساعد (Claude) موديل خارجي فهو مقفول. غيّر PRIVACY_MODE لـ off بـ Coolify (مع إعادة تشغيل) لو بدك تشغّله.";
/** What «اكتبها بجملة» says when no assistant is connected (v6 · P4-2): the other two ways of making a job work without one. */
export const DRAFT_NEEDS_KEY = "هاي بدها مفتاح المساعد — اربطه من الإعدادات ← الربط. والطريقتين التانيين («ركّبها» و«من قالب») شغّالين بلا مفتاح.";
export const NO_KEY ="المساعد مش موصول — اربط مفتاح Claude من الإعدادات (ربط مفتاح Claude)، أو ضيف ANTHROPIC_API_KEY بـ Coolify.";

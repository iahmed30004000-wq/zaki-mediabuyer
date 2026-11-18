/**
 * What the assistant needs from the environment, in one place (no SDK import, so a settings screen can ask «is it there?»
 * without loading the model client). A value is never returned to a screen or a log.
 */
import { DEFAULT_MODEL } from "@/core/assistant";
import { envAny } from "../env";
import { resolveKey } from "./key";

/** A key is there: ANTHROPIC_API_KEY (or CLAUDE_API_KEY) in Coolify, else the one the owner linked from the site. */
export const assistantConfigured = async (): Promise<boolean> => (await resolveKey()) !== null;

/** ASSISTANT_MODEL, else the default (claude-opus-5-5). */
export const assistantModel = (): string => envAny("ASSISTANT_MODEL") ?? DEFAULT_MODEL;

/** PRIVACY_MODE=internal_only means no external model for any agent — Claude is external, so the assistant stays off. */
export const externalModelsOff = (): boolean => process.env.PRIVACY_MODE === "internal_only";

export const OFF_BY_PRIVACY = "وضع الخصوصية PRIVACY_MODE=internal_only شغّال — المساعد (Claude) موديل خارجي فهو مقفول. غيّر PRIVACY_MODE لـ off بـ Coolify (مع إعادة تشغيل) لو بدك تشغّله.";
export const NO_KEY = "المساعد مش موصول — اربط مفتاح Claude من الإعدادات (ربط مفتاح Claude)، أو ضيف ANTHROPIC_API_KEY بـ Coolify.";

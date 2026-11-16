/**
 * «ربط مفتاح Claude» from the site: the owner pastes the key once; it is checked against Anthropic (a models-list call — no customer
 * data, no cost), stored encrypted, and used by the assistant like the Coolify variable would be. Owner only; a demo caller changes nothing.
 * The key is never returned (only its last four characters), never audited, never logged.
 */
import Anthropic from "@anthropic-ai/sdk";
import { checkKeyShape, keyHint } from "@/core/model-key";
import { audit } from "../audit";
import { HttpError, type Caller } from "../auth";
import { encryptSecrets, encryptionKeyConfigured } from "../crypto";
import { db } from "../db";
import { OFF_BY_PRIVACY, externalModelsOff } from "./config";
import { forgetKeyCache, resolveKey, type KeySource } from "./key";

export interface ConnectionStatus {
  /** where the key in use comes from — «none» when the assistant has no key */
  source: KeySource | "none";
  /** …last four of the site key (also shown when the Coolify variable is the one winning) */
  hint: string | null;
  checkedAt: string | null;
  /** ENCRYPTION_KEY is set, so a key can be stored */
  canStore: boolean;
  /** PRIVACY_MODE=internal_only keeps every external model off */
  privacyOff: boolean;
  /** the site is on the demo data (MOCK_MODE=1): linking waits for the real mode */
  demo: boolean;
}

export async function connectionStatus(): Promise<ConnectionStatus> {
  const [resolved, row] = await Promise.all([resolveKey(), db.modelConnection.findUnique({ where: { provider: "anthropic" } }).catch(() => null)]);
  const site = row && row.status === "active" && row.keyEnc ? row : null;
  return {
    source: resolved?.source ?? "none",
    hint: site?.keyHint ?? null,
    checkedAt: site?.checkedAt?.toISOString() ?? null,
    canStore: encryptionKeyConfigured(),
    privacyOff: externalModelsOff(),
    demo: process.env.MOCK_MODE === "1",
  };
}

/** Asks Anthropic whether the key is good. Throws HttpError with a sentence the owner can act on. */
export async function verifyAnthropicKey(key: string, baseURL?: string): Promise<void> {
  const client = new Anthropic({ apiKey: key, ...(baseURL ? { baseURL } : {}), maxRetries: 0, timeout: 15_000 });
  try {
    await client.models.list({ limit: 1 });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(400, "Anthropic رفض المفتاح — غلط أو انلغى. اعمل واحد جديد من console.anthropic.com وجرّب.");
    if (e instanceof Anthropic.PermissionDeniedError) throw new HttpError(400, "المفتاح صحيح بس ما إله صلاحية — شوف إعدادات المفتاح بحساب Anthropic.");
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(502, "ما قدرت أوصل لـ Anthropic هلأ — جرّب كمان شوي. المفتاح ما انحفظ.");
    throw new HttpError(502, "Anthropic ما أكّد المفتاح هلأ — جرّب كمان شوي. المفتاح ما انحفظ.");
  }
}

interface Deps {
  verify?: (key: string) => Promise<void>;
}

function guard(caller: Caller) {
  if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بينربط مفتاح");
  if (externalModelsOff()) throw new HttpError(403, OFF_BY_PRIVACY);
}

/** Links the key: shape → Anthropic says yes → encrypted → saved. Replaces an earlier site key. */
export async function saveKey(caller: Caller, raw: unknown, deps: Deps = {}): Promise<ConnectionStatus> {
  guard(caller);
  const shape = checkKeyShape(raw);
  if (!shape.ok) throw new HttpError(400, shape.reason);
  if (!encryptionKeyConfigured()) throw new HttpError(409, "ما في ENCRYPTION_KEY (32 حرف على الأقل) بـ Coolify — بدونه الموقع ما بيخزّن مفاتيح. ضيفه وأعد التشغيل.");
  if ((await resolveKey())?.source === "env") throw new HttpError(409, "في مفتاح Claude بـ Coolify (ANTHROPIC_API_KEY) وهو بيغلب — شيله من هناك أول لو بدك تربط من الموقع.");
  await (deps.verify ?? verifyAnthropicKey)(shape.key);
  const now = new Date();
  const data = { keyEnc: encryptSecrets({ key: shape.key }), keyHint: keyHint(shape.key), status: "active", createdById: caller.id, checkedAt: now };
  const before = await db.modelConnection.findUnique({ where: { provider: "anthropic" }, select: { keyHint: true, status: true } });
  await db.modelConnection.upsert({ where: { provider: "anthropic" }, create: { provider: "anthropic", ...data }, update: data });
  forgetKeyCache();
  await audit({ type: "user", id: caller.id }, "assistant.key_link", { type: "model_connection", id: "anthropic" }, { before: before ? { hint: before.keyHint, status: before.status } : null, after: { hint: data.keyHint, status: "active" } });
  return connectionStatus();
}

/** Asks Anthropic again whether the linked key still works (a key can be revoked). */
export async function recheckKey(caller: Caller, deps: Deps = {}): Promise<ConnectionStatus> {
  guard(caller);
  const k = await resolveKey();
  if (!k) throw new HttpError(404, "ما في مفتاح مربوط");
  await (deps.verify ?? verifyAnthropicKey)(k.key);
  if (k.source === "site") await db.modelConnection.update({ where: { provider: "anthropic" }, data: { checkedAt: new Date() } });
  forgetKeyCache();
  return connectionStatus();
}

/** Unlinks the site key: the secret is erased, the row stays as history (nothing is hard-deleted). The Coolify variable is not touched. */
export async function removeKey(caller: Caller): Promise<ConnectionStatus> {
  if (caller.demo) throw new HttpError(403, "بلا تسجيل دخول ما بينفك الربط");
  const row = await db.modelConnection.findUnique({ where: { provider: "anthropic" } });
  if (!row || row.status !== "active") throw new HttpError(404, "ما في مفتاح مربوط من الموقع");
  await db.modelConnection.update({ where: { provider: "anthropic" }, data: { status: "removed", keyEnc: "" } });
  forgetKeyCache();
  await audit({ type: "user", id: caller.id }, "assistant.key_unlink", { type: "model_connection", id: "anthropic" }, { before: { hint: row.keyHint, status: "active" }, after: { status: "removed" } });
  return connectionStatus();
}

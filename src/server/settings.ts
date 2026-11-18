/**
 * SETTINGS WITH VERSIONS (spec 13.5 «Setting بنسخ ورجوع»). Every change writes a new version; `restoreSetting`
 * brings an old one back as a NEW version (history is never rewritten). Defaults come from the spec (16.2, 6.4,
 * 6.5) and are used until the owner changes a value.
 */
import type { Prisma } from "@prisma/client";
import { emptyUi, type UiConfig } from "@/core/customize";
import { DEFAULT_MODE, type NightPermission, type OwnerMode } from "@/core/mode";
import { DEFAULT_RULES, type CampaignRules } from "@/core/rules-v2";
import { db } from "./db";
import { audit } from "./audit";

export const DEFAULT_SETTINGS = {
  "attribution.window": "7d_click",
  "economics.fx_fee": 0.01,
  "economics.overhead_factor": 0.97,
  "economics.profit_min_share": 0.3,
  "economics.default_C": 0.65,
  "economics.default_D": 0.75,
  "truth.confirm_window_h": 24,
  "budget.split": { scale: 0.7, test: 0.2, new: 0.1 },
  "rules.loser_spend_x": 2,
  "rules.return_stop": 0.32,
  "scale.proof_days": 3,
  "scale.min_confirmed": 5,
  "scale.step_pct": 0.2,
  "scale.step_hours": 48,
  "scale.max_week_pct": 0.5,
  "scale.learning_guard_hours": 72,
  "scale.max_steps_per_day": 1,
  /** the most a product may spend per day, USD, by product code — above it the ladder stops (spec 6.5 «سقف المنتج») */
  "scale.product_caps": {} as Record<string, number>,
  /** agents' daily caps in USD (spec 11.2) and the monthly cap for all of them */
  "agents.daily_caps": { M01: 0.5, M02: 3, M03: 3, M04: 1, M05: 2, M06: 2, M07: 2, M09: 1, M10: 5, M11: 0.5, M12: 3 } as Record<string, number>,
  "agents.monthly_cap": 80,
  /** the replies inbox limits (spec 9.3): above them message campaigns are not raised — src/core/replies.ts */
  "replies.limits": { maxUnanswered: 50, maxP50Min: 30, staleHours: 2 } as { maxUnanswered: number; maxP50Min: number; staleHours: number },
  "capi.purchase_on": "confirmed",
  "market.SY": { msg_channel: "whatsapp", min_age: 18, team_hours_until: "17:00", payment_note: "الدفع من حساب مالي برّا سوريا" },
  "market.JO": { msg_channel: null, min_age: 18, team_hours_until: null },
  "pages.codes": { SP: "صحة بلس", VP: "فيتا فارما", AJ: "أسرار الجمال" },
  /** the landing pages of each product (LP1 · LP2 …) — the launch wizard fills the link from here */
  "landing.pages": [] as { productCode: string; lpCode: string; url: string }[],
  /** v4 · D — the owner's awake / asleep switch (src/core/mode.ts) and what may run, and wake him, while he sleeps */
  "owner.mode": DEFAULT_MODE as OwnerMode,
  "owner.night_permissions": [] as NightPermission[],
  /** kinds of decision that may ring him while he sleeps («يصحّيني») */
  "owner.wake_kinds": [] as string[],
  /** v4 · F — the campaign rules v2 (src/core/rules-v2.ts): no amount of money until the owner types it */
  "campaign.rules": DEFAULT_RULES as CampaignRules,
  /** who gets which alert: a person's key → the Telegram chat id to reach them on (the owner's is TELEGRAM_OWNER_CHAT_ID) */
  "notify.contacts": {} as Record<string, string>,
  /** v3 · D — the least a video must spend (USD, over its last 7 days) before it is ranked as a winner. null until the owner types it: then twice the cost he aims for per order */
  "videos.min_spend": null as number | null,
  /** v3 · K — «وضع التعديل»: the owner's pages, boards, fields and buttons over the built-in ones (src/core/customize.ts) */
  "ui.config": emptyUi() as UiConfig,
  /** v5 · P9 — the limits for the flags beside a team member (src/core/ops.ts). Empty until the owner writes them: no limit = no flag */
  "ops.rules": { stuckMax: null, noAnswerMargin: null, newDays: null } as { stuckMax: number | null; noAnswerMargin: number | null; newDays: number | null },
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;

export async function getSetting<K extends SettingKey>(key: K): Promise<(typeof DEFAULT_SETTINGS)[K]> {
  const row = await db.setting.findUnique({ where: { key } });
  return (row?.value ?? DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K];
}

export async function setSetting(key: SettingKey, value: unknown, by: string | null): Promise<number> {
  const json = value as Prisma.InputJsonValue;
  const version = await db.$transaction(async (tx) => {
    const old = await tx.setting.findUnique({ where: { key } });
    const next = (old?.version ?? 0) + 1;
    await tx.setting.upsert({ where: { key }, create: { key, value: json, version: next, updatedBy: by }, update: { value: json, version: next, updatedBy: by } });
    await tx.settingVersion.create({ data: { key, version: next, value: json, changedBy: by } });
    return next;
  });
  await audit(by ? { type: "user", id: by } : { type: "system" }, "setting.set", { type: "setting", id: key }, { after: value });
  return version;
}

/**
 * Changes a setting under a lock: the current value comes in, `fn` makes the next one — it may do other database work in the SAME
 * transaction (a merge of two boards moves their tasks while it rewrites the config: both happen or neither does) — and the result is
 * written as a new version. Two edits at once wait for each other, so neither overwrites the other. `fn` returns null for «no change».
 */
export async function mutateSetting<K extends SettingKey, R>(
  key: K,
  fn: (current: (typeof DEFAULT_SETTINGS)[K], tx: Prisma.TransactionClient) => Promise<{ value: (typeof DEFAULT_SETTINGS)[K]; result: R } | null>,
  by: string | null,
): Promise<{ version: number; value: (typeof DEFAULT_SETTINGS)[K]; result: R } | null> {
  const out = await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`setting:${key}`}))`;
      const old = await tx.setting.findUnique({ where: { key } });
      const made = await fn((old?.value ?? DEFAULT_SETTINGS[key]) as (typeof DEFAULT_SETTINGS)[K], tx);
      if (!made) return null;
      const json = made.value as unknown as Prisma.InputJsonValue;
      const next = (old?.version ?? 0) + 1;
      await tx.setting.upsert({ where: { key }, create: { key, value: json, version: next, updatedBy: by }, update: { value: json, version: next, updatedBy: by } });
      await tx.settingVersion.create({ data: { key, version: next, value: json, changedBy: by } });
      return { version: next, value: made.value, result: made.result };
    },
    { timeout: 20_000 },
  );
  if (out) await audit(by ? { type: "user", id: by } : { type: "system" }, "setting.set", { type: "setting", id: key }, { after: out.value });
  return out;
}

/** Brings back an old version as a new one. */
export async function restoreSetting(key: SettingKey, version: number, by: string | null): Promise<number> {
  const old = await db.settingVersion.findUnique({ where: { key_version: { key, version } } });
  if (!old) throw new Error(`no version ${version} of ${key}`);
  return setSetting(key, old.value, by);
}

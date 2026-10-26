/**
 * SETTINGS WITH VERSIONS (spec 13.5 «Setting بنسخ ورجوع»). Every change writes a new version; `restoreSetting`
 * brings an old one back as a NEW version (history is never rewritten). Defaults come from the spec (16.2, 6.4,
 * 6.5) and are used until the owner changes a value.
 */
import type { Prisma } from "@prisma/client";
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
  "capi.purchase_on": "confirmed",
  "market.SY": { msg_channel: "whatsapp", min_age: 18, team_hours_until: "17:00", payment_note: "الدفع من حساب مالي برّا سوريا" },
  "market.JO": { msg_channel: null, min_age: 18, team_hours_until: null },
  "pages.codes": { SP: "صحة بلس", VP: "فيتا فارما", AJ: "أسرار الجمال" },
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

/** Brings back an old version as a new one. */
export async function restoreSetting(key: SettingKey, version: number, by: string | null): Promise<number> {
  const old = await db.settingVersion.findUnique({ where: { key_version: { key, version } } });
  if (!old) throw new Error(`no version ${version} of ${key}`);
  return setSetting(key, old.value, by);
}

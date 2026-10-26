/**
 * AUTONOMY (spec 10.1) — what the system may do on its own, per ad account level, as one table.
 *
 *   level 0 مستشار · 1 حارس · 2 مكبّر محدود · 3 مدير (off at launch)
 *   suggest  = written into the report, nothing more
 *   auto     = executed by itself (inside the cap where it spends)
 *   approval = waits for a person with the right role, on the SITE (never Telegram)
 *   owner    = only the owner
 * Safety (pause / reduce) is automatic from level 1: «الأمان تلقائي، والصرف بموافقة».
 */
export type ActionKind =
  | "safety_pause"
  | "safety_reduce"
  | "resume"
  | "raise_step"
  | "new_ad"
  | "test_campaign"
  | "customer_audience"
  | "above_cap"
  | "connect_asset";

export type Mode = "suggest" | "auto" | "approval" | "owner";
export type AutonomyLevel = 0 | 1 | 2 | 3;

const TABLE: Record<ActionKind, [Mode, Mode, Mode, Mode]> = {
  //                     0          1           2           3
  safety_pause: ["suggest", "auto", "auto", "auto"],
  safety_reduce: ["suggest", "auto", "auto", "auto"],
  resume: ["suggest", "approval", "approval", "auto"],
  raise_step: ["suggest", "approval", "auto", "auto"],
  new_ad: ["suggest", "approval", "approval", "auto"],
  test_campaign: ["suggest", "approval", "approval", "auto"],
  customer_audience: ["suggest", "approval", "approval", "approval"],
  above_cap: ["suggest", "owner", "owner", "owner"],
  connect_asset: ["owner", "owner", "owner", "owner"],
};

export function modeFor(kind: ActionKind, level: AutonomyLevel): Mode {
  return TABLE[kind][level];
}

export interface DowngradeSignals {
  /** a data source (Meta or the OMS) is stale */
  sourceDown: boolean;
  /** Meta and the truth disagree by more than the tolerated gap */
  bigGap: boolean;
  /** restricted account, payment problem, repeated rejections */
  accountHealthAlert: boolean;
  tokenExpired: boolean;
}

/** The level the account actually runs at right now: any alarm drops it to 0 (spec 10.1 «نزول تلقائي لصفر»). */
export function effectiveLevel(configured: AutonomyLevel, s: DowngradeSignals): { level: AutonomyLevel; why: string | null } {
  if (s.tokenExpired) return { level: 0, why: "توكن فيسبوك منتهي" };
  if (s.accountHealthAlert) return { level: 0, why: "تنبيه سلامة على الحساب" };
  if (s.sourceDown) return { level: 0, why: "مصدر بيانات واقف" };
  if (s.bigGap) return { level: 0, why: "فرق كبير بين ميتا والحقيقة" };
  return { level: configured, why: null };
}

/**
 * May the owner switch an account to `to`? (spec 10.1: level 1 for everyone at the start · level 2 after two weeks of
 * reviewing the decisions · level 3 off). Going down is always allowed — that is a safety move.
 */
export function levelChange(from: AutonomyLevel, to: number, o: { daysOfDecisions: number; restricted: boolean }): { ok: boolean; why: string } {
  if (![0, 1, 2, 3].includes(to)) return { ok: false, why: "مستوى مش معروف" };
  if (to === 3) return { ok: false, why: "المستوى 3 (مدير) مطفي بهالمرحلة" };
  if (to <= from) return { ok: true, why: to < from ? "نزول — مسموح دايماً" : "نفس المستوى" };
  if (o.restricted) return { ok: false, why: "الحساب عليه تنبيه سلامة — بيضل صفر لحد ما ينحل" };
  if (to === 2 && o.daysOfDecisions < 14) return { ok: false, why: `المستوى 2 بعد أسبوعين من مراجعة القرارات — مرّ ${o.daysOfDecisions} يوم` };
  return { ok: true, why: "تمام" };
}

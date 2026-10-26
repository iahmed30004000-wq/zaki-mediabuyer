/**
 * ACCOUNT SAFETY (spec S11 / T4.5) and ATTRIBUTION HEALTH (M09 / T4.4) — pure judgements.
 *   · an account Meta restricted, disabled or holds for payment drops the system to level 0 (nothing automatic);
 *   · three rejected ads in 24 h freeze creation (rule.rejections, 6.4);
 *   · every rejected ad gets an appeal draft a person may send — the system never appeals by itself;
 *   · the attribution health: how many orders reach their ad, the Meta/truth gap per campaign, and CAPI acceptance.
 */
import { checkPolicy, policyNote } from "./policy";

/** Meta's `account_status` codes (AdAccount.account_status). */
export const ACCOUNT_STATUS_AR: Record<number, string> = {
  1: "شغّال", 2: "معطّل", 3: "دفعة متأخرة", 7: "قيد مراجعة المخاطر", 8: "بانتظار تسوية", 9: "فترة سماح", 100: "قيد الإغلاق", 101: "مسكّر", 201: "شغّال", 202: "مسكّر",
};

export interface AccountFactsSafety {
  accountStatus: number;
  disableReason?: number | null;
  /** ads rejected in the last 24 h */
  rejected24h: number;
  paymentOk: boolean;
}

export interface SafetyVerdict {
  verdict: "ok" | "watch" | "restricted";
  /** drop to level 0 */
  downgrade: boolean;
  /** stop creating anything new (rule.rejections) */
  freezeCreate: boolean;
  notes: string[];
}

export function judgeAccount(a: AccountFactsSafety): SafetyVerdict {
  const notes: string[] = [];
  let verdict: SafetyVerdict["verdict"] = "ok";
  const active = a.accountStatus === 1 || a.accountStatus === 201;
  if (!active) {
    verdict = "restricted";
    notes.push(`حالة الحساب عند ميتا: ${ACCOUNT_STATUS_AR[a.accountStatus] ?? `رمز ${a.accountStatus}`}${a.disableReason ? ` (سبب ${a.disableReason})` : ""} — نزّلت المستوى لصفر`);
  }
  if (!a.paymentOk) {
    verdict = "restricted";
    notes.push("مشكلة بالدفع — نزّلت المستوى لصفر لحد ما تنحل");
  }
  const freezeCreate = a.rejected24h >= 3;
  if (freezeCreate) {
    if (verdict === "ok") verdict = "watch";
    notes.push(`${a.rejected24h} إعلانات انرفضت خلال 24 ساعة — جمّدت الإنشاء 24 ساعة`);
  } else if (a.rejected24h > 0) {
    if (verdict === "ok") verdict = "watch";
    notes.push(`${a.rejected24h} إعلان انرفض اليوم`);
  }
  return { verdict, downgrade: verdict === "restricted", freezeCreate, notes };
}

/**
 * The appeal draft for one rejected ad: what Meta said, what our own dictionary finds in the text, and a polite
 * request for a second review — or, when our dictionary agrees with Meta, the advice to edit instead of appealing.
 */
export function appealDraft(ad: { name: string; text?: string | null }, feedback: Record<string, string>): { draft: string; worthAppeal: boolean; policyKey: string | null } {
  const reasons = Object.entries(feedback).map(([k, v]) => `${k}: ${v}`).join(" · ") || "ما في سبب مكتوب";
  const policy = ad.text ? checkPolicy({ "النص": ad.text }) : null;
  const ours = policy && policy.flag === "red";
  if (ours) {
    return {
      worthAppeal: false,
      policyKey: policy.hits.find((h) => h.level === "red")?.ruleId ?? null,
      draft: `الإعلان ${ad.name} انرفض (${reasons}). قاموسنا كمان لقى فيه ممنوع: ${policyNote(policy)}. الأفضل نعدّل النص ونعمل نسخة جديدة بدل الطعن.`,
    };
  }
  return {
    worthAppeal: true,
    policyKey: null,
    draft: [
      `طلب مراجعة ثانية للإعلان ${ad.name}`,
      `سبب الرفض المكتوب: ${reasons}.`,
      "الإعلان لمنتج عناية عادي، ما فيه وعد بشفاء ولا نتيجة مضمونة ولا قبل/بعد، والصفحة بتعرض المنتج وسعره وطريقة الدفع عند الاستلام بوضوح.",
      "نرجو مراجعة الإعلان مرة ثانية، ومستعدين نعدّل أي جملة بتشوفوها مخالفة.",
      "(مسودة — بتنبعت من مدير الإعلانات بإيد المالك، النظام ما بيطعن لحاله)",
    ].join("\n"),
  };
}

// ───────────────────────────── attribution health (M09) ─────────────────────────────

export interface CampaignGapInput {
  campaign: string;
  /** pixel purchases Meta reports (website campaigns only) */
  metaPurchases: number;
  /** website orders the OMS tied to this campaign */
  webOrders: number;
}

export interface AttributionHealth {
  gaps: { campaign: string; gap_pct: number; likely_cause: string }[];
  attribution_health: "good" | "weak" | "broken";
  /** share of orders that reached their ad by its id (not by naming or allocation) */
  attributed_pct: number | null;
  capi_accepted_pct: number | null;
  capi_issues: { error: string; fix: string }[];
  notify: ("replies" | "oms" | "mediabuyer")[];
}

const TOLERATED_GAP = 20;

export function attributionHealth(i: { campaigns: CampaignGapInput[]; ordersByMethod: Record<string, number>; capiAcceptedPct: number | null; capiErrors: string[] }): AttributionHealth {
  const gaps = i.campaigns
    .filter((c) => c.webOrders >= 5)
    .map((c) => {
      const gap = Math.round(((c.metaPurchases - c.webOrders) / c.webOrders) * 100);
      const likely_cause = gap > TOLERATED_GAP ? "ميتا بتعد أكتر من الطلبات: حدث مكرر (البكسل والسيرفر بلا نفس الرقم) أو طلبات ما وصلت الـ OMS" : gap < -TOLERATED_GAP ? "ميتا بتعد أقل: معاملات الرابط ناقصة، أو البكسل مش شغّال على صفحة الشكر، أو النافذة تغيّرت" : "ضمن المقبول";
      return { campaign: c.campaign, gap_pct: gap, likely_cause };
    })
    .sort((a, b) => Math.abs(b.gap_pct) - Math.abs(a.gap_pct));
  const total = Object.values(i.ordersByMethod).reduce((a, b) => a + b, 0);
  const attributed_pct = total ? Math.round(((i.ordersByMethod.ad_id ?? 0) / total) * 1000) / 10 : null;
  const bigGaps = gaps.filter((g) => Math.abs(g.gap_pct) > TOLERATED_GAP).length;

  let health: AttributionHealth["attribution_health"] = "good";
  if ((attributed_pct !== null && attributed_pct < 50) || (i.capiAcceptedPct !== null && i.capiAcceptedPct < 70)) health = "broken";
  else if ((attributed_pct !== null && attributed_pct < 80) || bigGaps > 0 || (i.capiAcceptedPct !== null && i.capiAcceptedPct < 90)) health = "weak";

  const notify = new Set<AttributionHealth["notify"][number]>();
  if (attributed_pct !== null && attributed_pct < 80) notify.add("oms");
  if (bigGaps || health !== "good") notify.add("mediabuyer");
  if ((i.ordersByMethod.none ?? 0) > 0 && (i.ordersByMethod.none ?? 0) / Math.max(1, total) > 0.1) notify.add("replies");

  const capi_issues = [...new Set(i.capiErrors)].slice(0, 5).map((error) => ({
    error,
    fix: /190|token|OAuth/i.test(error) ? "توكن ميتا انتهى أو ناقصه صلاحية — جدّده من الإعدادات" : /7 أيام|too old/i.test(error) ? "الإرسال كل 15 دقيقة لازم يضل شغّال — تأكد إن العامل مش واقف" : /identifier|معرّف/i.test(error) ? "الـ OMS لازم يحفظ fbc و fbp والهاتف مع كل طلب (P0.1)" : "شوف الخطأ بأداة Test Events عند ميتا",
  }));
  return { gaps, attribution_health: health, attributed_pct, capi_accepted_pct: i.capiAcceptedPct, capi_issues, notify: [...notify] };
}

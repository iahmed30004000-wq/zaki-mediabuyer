/**
 * THE CAMPAIGN RULES v2 (v4 · F) — the owner's operating rules as DATA: editable in the settings, versioned like every
 * setting, read by Claude through `get_rules` so it always works on the latest version, and enforced in the alerts.
 * Pure: validation, the sentences, and the list of what is still missing.
 *
 * What is NOT here on purpose: any amount in dollars. The caps, the targets, the break-even of each product and the
 * thresholds for a single ad are the owner's numbers — he types them in the rules page (they are stored in the database,
 * never in this repository). Until he does, they are `null`, `get_rules` says which ones are missing, and the checks that
 * need them stay silent instead of guessing.
 */
import { z } from "zod";

const money = z.number().nonnegative().max(1_000_000).nullable();
const share = z.number().min(0).max(10).nullable();
const days = z.number().int().min(0).max(60);
const hours = z.number().int().min(0).max(720);
const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const CampaignRulesSchema = z
  .object({
    nightRound: hm.describe("وقت جولة الليل — الوقت الوحيد اللي بيصير فيه تغيير"),
    judgeDays: days,
    ignoreFirstDay: z.boolean(),
    realCostFactor: z.number().min(1).max(3).describe("تكلفة الطلب الحقيقي = تكلفة البكسل × هالعامل"),
    targetCost: money.describe("الهدف: تكلفة الطلب الحقيقي أقل من"),
    breakeven: z.record(z.number().nonnegative().max(1000)).describe("نقطة التعادل لكل منتج (دولار للطلب الحقيقي)"),
    adsetPauseDays: days,
    ad: z
      .object({ minAdsetHours: hours, spendZeroSales: money, spendOneSale: money, daysAboveBreakeven: days, untestedShare: share })
      .strict(),
    newAdsetFreezeHours: hours,
    scale: z
      .object({ maxCost: money, days, stepPct: share, everyHours: hours, maxWeekPct: share, stockBlocks: z.boolean(), capRunning: money, proposeCapRaiseDays: days })
      .strict(),
    revert: z.object({ backToOldBudget: z.boolean(), pauseAfterHours: hours }).strict(),
    stock: z.object({ redDays: days, orangeDays: days, yellowDays: days, audience: z.array(z.string().trim().min(1).max(30)).max(10) }).strict(),
    videos: z
      .object({
        fatigueFrequency: z.number().min(0).max(100),
        fatigueDropPct: share,
        fatigueCostDays: days,
        fatigueCostMax: money,
        winnerScenarios: z.number().int().min(0).max(50),
        bankMin: z.number().int().min(0).max(1000),
        batch: z.number().int().min(0).max(1000),
        batchRefs: z.number().int().min(0).max(1000),
        batchWinners: z.number().int().min(0).max(1000),
      })
      .strict(),
    budgets: z.object({ runningCap: money, newProductTests: money, testPerProduct: money, fallbackTotal: money }).strict(),
    newProductTest: z.object({ perDay: money, ignoreDay1: z.boolean(), day2Max: money, day3Max: money, maxSpend: money }).strict(),
  })
  .strict();
export type CampaignRules = z.infer<typeof CampaignRulesSchema>;

/** Process defaults only (days, hours, shares, switches). Every dollar amount starts empty. */
export const DEFAULT_RULES: CampaignRules = {
  nightRound: "00:35",
  judgeDays: 3,
  ignoreFirstDay: true,
  realCostFactor: 1.16,
  targetCost: null,
  breakeven: {},
  adsetPauseDays: 3,
  ad: { minAdsetHours: 48, spendZeroSales: null, spendOneSale: null, daysAboveBreakeven: 3, untestedShare: 0.1 },
  newAdsetFreezeHours: 72,
  scale: { maxCost: null, days: 3, stepPct: 0.2, everyHours: 48, maxWeekPct: 0.5, stockBlocks: false, capRunning: null, proposeCapRaiseDays: 3 },
  revert: { backToOldBudget: true, pauseAfterHours: 48 },
  stock: { redDays: 7, orangeDays: 10, yellowDays: 14, audience: ["owner", "abdullah", "mohammad"] },
  videos: { fatigueFrequency: 3, fatigueDropPct: 0.25, fatigueCostDays: 3, fatigueCostMax: null, winnerScenarios: 2, bankMin: 10, batch: 50, batchRefs: 25, batchWinners: 25 },
  budgets: { runningCap: null, newProductTests: null, testPerProduct: null, fallbackTotal: null },
  newProductTest: { perDay: null, ignoreDay1: true, day2Max: null, day3Max: null, maxSpend: null },
};

/** Whatever is stored (maybe from an older version of the rules) over the defaults, then checked. Never throws: a broken value falls back to the defaults. */
export function readRules(stored: unknown): CampaignRules {
  const merged = merge(DEFAULT_RULES, stored);
  const ok = CampaignRulesSchema.safeParse(merged);
  return ok.success ? ok.data : DEFAULT_RULES;
}

function merge<T>(base: T, over: unknown): T {
  if (over === null || over === undefined) return base;
  if (Array.isArray(base) || typeof base !== "object" || base === null) return (typeof over === typeof base || base === null ? over : base) as T;
  if (typeof over !== "object" || Array.isArray(over)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    // `breakeven` is a free map (product → amount): taken whole, not key by key from the defaults
    out[k] = k in out ? (k === "breakeven" ? (v && typeof v === "object" ? v : out[k]) : merge(out[k], v)) : v;
  }
  return out as T;
}

// ───────────────────────────── the sentences ─────────────────────────────

const n = (v: number | null, unit = "") => (v === null ? "؟" : `${v}${unit}`);
const pct = (v: number | null) => (v === null ? "؟" : `${Math.round(v * 100)}%`);

/** The 14 rules in the owner's words, with his current numbers (a «؟» where a number is still missing). */
export function describeRules(r: CampaignRules): string[] {
  const be = Object.entries(r.breakeven);
  return [
    `ما في تغيير خارج جولة الليل (${r.nightRound}). بالنهار تنبيهات بس.`,
    `الحكم على آخر ${r.judgeDays} أيام كاملة (مش اليوم)، على الطلبات الحقيقية (هواتف فريدة). تكلفة الطلب الحقيقي = تكلفة البكسل × ${r.realCostFactor}.${r.ignoreFirstDay ? " أول يوم لأي مجموعة بينتجاهل." : ""}`,
    `الهدف لكل المنتجات: أقل من ${n(r.targetCost, "$")} للطلب الحقيقي. بين الهدف ونقطة التعادل: بنبقي ونشخّص السبب (CPM · CTR · LPV لكل نقرة · تحويل الصفحة · حصة الاختبار). فوق التعادل: بنوقف وبنصنّف السبب — مجموعة وحدة = مشكلة إبداع، كل مجموعات المنتج = مشكلة منتج.${be.length ? ` نقطة التعادل: ${be.map(([p, v]) => `${p} ${v}$`).join(" · ")}.` : " نقطة التعادل لكل منتج: لسا ما انكتبت."}`,
    `أي مجموعة فوق التعادل ${r.adsetPauseDays} أيام ← توقيف، بلا استثناء.`,
    `الإعلان الواحد (مجموعته ≥ ${r.ad.minAdsetHours} ساعة، ومش آخر إعلان): صرف ≥ ${n(r.ad.spendZeroSales, "$")} بصفر مبيعات، أو ≥ ${n(r.ad.spendOneSale, "$")} بمبيعة وحدة، أو ${r.ad.daysAboveBreakeven} أيام فوق التعادل ← توقيف. أقل من ${pct(r.ad.untestedShare)} من صرف المجموعة = «لم يُختبر».`,
    `المجموعة الجديدة: بلا تغيير ${r.newAdsetFreezeHours} ساعة.`,
    `التكبير: ≤ ${n(r.scale.maxCost, "$")} لـ ${r.scale.days} أيام ← +${pct(r.scale.stepPct)} كل ${r.scale.everyHours} ساعة، وحد +${pct(r.scale.maxWeekPct)} بالأسبوع.${r.scale.stockBlocks ? " المخزون بيمنع التكبير." : " المخزون ما بيمنع التكبير."} سقف المنتجات الشغّالة ${n(r.scale.capRunning, "$")} باليوم (بدون اختبارات المنتجات الجديدة). إذا ${r.scale.proposeCapRaiseDays} أيام ورا بعض تكلفة الحساب ≤ الهدف والصرف وصل السقف ← بنقترح عليك رفع السقف.`,
    `مجموعة كبّرناها وصارت فوق التعادل ← ${r.revert.backToOldBudget ? "ترجع لميزانيتها القديمة" : "ما بترجع لميزانيتها"}؛ وبعد ${r.revert.pauseAfterHours} ساعة لسا فوق التعادل ← توقيف.`,
    `المخزون: 🔴 أقل من ${r.stock.redDays} أيام · 🟠 ${r.stock.redDays}–${r.stock.orangeDays} · 🟡 ${r.stock.orangeDays}–${r.stock.yellowDays} ← تنبيه لـ ${r.stock.audience.join("، ")}.`,
    `الفيديوهات: رابح تعبان (تكرار > ${r.videos.fatigueFrequency}، أو CTR/Hook نزل ≥ ${pct(r.videos.fatigueDropPct)}، أو أكتر من ${n(r.videos.fatigueCostMax, "$")} لـ ${r.videos.fatigueCostDays} أيام) ← طلب هوكات من هيرمز. رابح جديد (≤ ${n(r.scale.maxCost, "$")} على ${r.scale.days} أيام أو أكتر) ← طلب ${r.videos.winnerScenarios} سيناريوهات. بنك المنتج ≤ ${r.videos.bankMin} فيديو ← دفعة ${r.videos.batch} من ليث (${r.videos.batchRefs} مراجع + ${r.videos.batchWinners} من الرابحين). كل طلب بينتبع: طلب ← عند هيرمز/ليث ← جاهز ← مرفوع ← بالتيست ← النتيجة.`,
    `الميزانيات: المنتجات الشغّالة مع اختبارات إبداعها ≤ ${n(r.budgets.runningCap, "$")} باليوم. اختبارات المنتجات الجديدة ميزانيتها لحالها: ${n(r.budgets.newProductTests, "$")} باليوم. إذا النتائج نزلت (الحساب فوق التعادل يومين) المجموع مع الاختبارات ≤ ${n(r.budgets.fallbackTotal, "$")}.`,
    `دفعات الفيديو بتنطلب من ليث.`,
    `اختبار منتج جديد: ${n(r.newProductTest.perDay, "$")} باليوم${r.newProductTest.ignoreDay1 ? "، أول يوم بيتجاهل" : ""}، اليوم الثاني لحاله < ${n(r.newProductTest.day2Max, "$")} ← بيكمّل، اليوم الثالث < ${n(r.newProductTest.day3Max, "$")} ← رابح، لحد ${n(r.newProductTest.maxSpend, "$")}.`,
    `Claude بينفّذ جوّا القواعد وبينبّه بس. المالك بيقرر: رفع السقف، التصنيع، وأي شي برّا القواعد.`,
  ];
}

/** The numbers still empty — the ones the checks need. Arabic labels, for the rules page and for Claude. */
export function missingRules(r: CampaignRules): { key: string; label: string }[] {
  const need: [string, string, unknown][] = [
    ["targetCost", "الهدف: تكلفة الطلب الحقيقي", r.targetCost],
    ["ad.spendZeroSales", "الإعلان: صرف بصفر مبيعات", r.ad.spendZeroSales],
    ["ad.spendOneSale", "الإعلان: صرف بمبيعة وحدة", r.ad.spendOneSale],
    ["scale.maxCost", "التكبير: تكلفة ≤", r.scale.maxCost],
    ["videos.fatigueCostMax", "الفيديو التعبان: تكلفة أكتر من", r.videos.fatigueCostMax],
    ["scale.capRunning", "سقف المنتجات الشغّالة", r.scale.capRunning],
    ["budgets.newProductTests", "ميزانية اختبارات المنتجات الجديدة", r.budgets.newProductTests],
    ["budgets.testPerProduct", "اختبار المنتج الواحد باليوم", r.budgets.testPerProduct],
    ["newProductTest.perDay", "اختبار منتج جديد: يومياً", r.newProductTest.perDay],
  ];
  const out = need.filter(([, , v]) => v === null).map(([key, label]) => ({ key, label }));
  if (!Object.keys(r.breakeven).length) out.unshift({ key: "breakeven", label: "نقطة التعادل لكل منتج" });
  return out;
}

/** The break-even of a product, or null when the owner has not typed it. Matches by code, case-insensitively. */
export function breakevenOf(r: CampaignRules, product: string | null | undefined): number | null {
  if (!product) return null;
  const hit = Object.entries(r.breakeven).find(([k]) => k.toLowerCase() === product.toLowerCase());
  return hit ? hit[1] : null;
}

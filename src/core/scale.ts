/**
 * THE SCALE LADDER (spec 6.5, T5.2) — pure: one ad set's facts in, one decision out. From level 2 the code raises a
 * proven ad set by one step on its own, inside the caps; at level 1 the same step waits for the owner.
 *
 *   proof     cost per mature confirmed under the scaling ceiling on each of the last 3 days (≥ 5 confirmed in all),
 *             7-day cost per order ≤ T, and a confirm rate not below the product's average;
 *   step      +20%, at most one per day and one per 48 h, never inside the 72 h learning guard;
 *   ceilings  never more than +50% in a week, never above the product's daily cap (then: scale horizontally),
 *             never while a freeze is on (stock, capacity, stale data, a loop) or stock covers < 5 days.
 * Each «no» carries its reason, so the owner sees why a winner is not being raised.
 */
export interface ScaleParams {
  proofDays: number;
  minConfirmed: number;
  stepPct: number;
  stepHours: number;
  maxWeekPct: number;
  learningGuardHours: number;
  maxStepsPerDay: number;
}

export const SCALE_DEFAULTS: ScaleParams = { proofDays: 3, minConfirmed: 5, stepPct: 0.2, stepHours: 48, maxWeekPct: 0.5, learningGuardHours: 72, maxStepsPerDay: 1 };

export interface ScaleFacts {
  adSetId: string;
  productCode: string;
  dailyBudget: number;
  /** cost per mature confirmed order for each of the last `proofDays` days, newest last (null = no confirmed that day) */
  dailyCostPerConfirmed: (number | null)[];
  /** mature confirmed orders over the proof window */
  confirmedMature: number;
  /** spend ÷ all orders over 7 days */
  cpa7: number | null;
  tOrder: number;
  ceiling: number;
  confirmRate: number | null;
  productConfirmRate: number | null;
  hoursSinceSignificant: number;
  /** the budget 7 days ago, to cap the week at +50% */
  budgetWeekAgo: number;
  raisesToday: number;
  hoursSinceLastRaise: number;
  /** a scale/all freeze on the ad set, its product or its account */
  frozen: string | null;
  stockDays: number | null;
  /** the most this product may spend per day across its ad sets (null = only the account cap) */
  productDailyCap: number | null;
  productDailySpendPlanned: number;
}

export interface ScaleDecision {
  raise: boolean;
  newBudget: number | null;
  /** why not, in the owner's words — empty when it raises */
  blockers: string[];
  /** the product cap is the limit: move the winner to the scale campaign by its post id instead */
  horizontal: boolean;
  sentence: string;
}

const usd = (n: number) => `${n.toFixed(2)}$`;
const ago = (h: number) => (h < 1 ? "أقل من ساعة" : `${Math.round(h)} ساعة`);

export function evaluateScale(f: ScaleFacts, p: ScaleParams = SCALE_DEFAULTS): ScaleDecision {
  const blockers: string[] = [];
  const days = f.dailyCostPerConfirmed.slice(-p.proofDays);
  if (days.length < p.proofDays || days.some((c) => c === null || c >= f.ceiling)) {
    blockers.push(`ما ثبت ${p.proofDays} أيام ورا بعض تحت السقف ${usd(f.ceiling)} (${days.map((c) => (c === null ? "—" : c.toFixed(2))).join(" · ")})`);
  }
  if (f.confirmedMature < p.minConfirmed) blockers.push(`${f.confirmedMature} مؤكد ناضج بس — بدنا ${p.minConfirmed}`);
  if (f.cpa7 === null || f.cpa7 > f.tOrder) blockers.push(`تكلفة الطلب 7 أيام ${f.cpa7 === null ? "—" : usd(f.cpa7)} فوق الهدف ${usd(f.tOrder)}`);
  if (f.confirmRate !== null && f.productConfirmRate !== null && f.confirmRate < f.productConfirmRate) blockers.push(`نسبة التأكيد ${Math.round(f.confirmRate * 100)}% أقل من متوسط المنتج ${Math.round(f.productConfirmRate * 100)}%`);
  if (f.frozen) blockers.push(`التكبير مجمّد: ${f.frozen}`);
  if (f.stockDays !== null && f.stockDays < 5) blockers.push(`المخزون بيكفي ${f.stockDays} أيام بس`);
  if (f.hoursSinceSignificant < p.learningGuardHours) blockers.push(`بمرحلة التعلّم: آخر تعديل جوهري قبل ${ago(f.hoursSinceSignificant)} (بدنا ${p.learningGuardHours})`);
  if (f.raisesToday >= p.maxStepsPerDay) blockers.push("انرفعت اليوم خلص");
  if (f.hoursSinceLastRaise < p.stepHours) blockers.push(`آخر زيادة قبل ${ago(f.hoursSinceLastRaise)} (بدنا ${p.stepHours})`);

  const step = Math.round(f.dailyBudget * (1 + p.stepPct) * 100) / 100;
  const weekLimit = Math.round(f.budgetWeekAgo * (1 + p.maxWeekPct) * 100) / 100;
  let newBudget = Math.min(step, weekLimit);
  if (newBudget <= f.dailyBudget) blockers.push(`وصلت حد الأسبوع (+${Math.round(p.maxWeekPct * 100)}% من ${usd(f.budgetWeekAgo)})`);
  let horizontal = false;
  if (f.productDailyCap !== null) {
    const room = f.productDailyCap - f.productDailySpendPlanned;
    const add = newBudget - f.dailyBudget;
    if (room <= 0) {
      horizontal = true;
      blockers.push(`المنتج وصل سقفه ${usd(f.productDailyCap)} — الأحسن ننقل الرابح لحملة التكبير بنفس المنشور`);
    } else if (add > room) newBudget = Math.round((f.dailyBudget + room) * 100) / 100;
  }

  if (blockers.length) return { raise: false, newBudget: null, blockers, horizontal, sentence: `ما كبّرت ${f.adSetId}: ${blockers[0]}` };
  const last = days[days.length - 1]!;
  return {
    raise: true,
    newBudget,
    blockers: [],
    horizontal: false,
    sentence: `كبّرت المجموعة ${usd(f.dailyBudget)} ← ${usd(newBudget)} باليوم: ${p.proofDays} أيام تحت السقف ${usd(f.ceiling)} (آخر يوم ${usd(last)} للمؤكد، ${f.confirmedMature} مؤكد ناضج).`,
  };
}

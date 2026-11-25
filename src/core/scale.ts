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
 *
 * v6 · P10: every number comes from the owner's rules (`campaign.rules`, via `scaleParamsFrom`) — there is no second set of scale settings.
 * The proof is his «cost ≤ X for N days»; stock blocks the raise only when he switched that on; the cap is his running-products cap.
 */
import type { CampaignRules } from "./rules-v2";

export interface ScaleParams {
  proofDays: number;
  minConfirmed: number;
  stepPct: number;
  stepHours: number;
  maxWeekPct: number;
  learningGuardHours: number;
  maxStepsPerDay: number;
  /** the owner's «stock blocks scaling»: off by default (the old engine did the opposite) */
  stockBlocks: boolean;
  /** stock under this many days blocks the raise when `stockBlocks` is on */
  stockBlockDays: number;
}

export const SCALE_DEFAULTS: ScaleParams = { proofDays: 3, minConfirmed: 5, stepPct: 0.2, stepHours: 48, maxWeekPct: 0.5, learningGuardHours: 72, maxStepsPerDay: 1, stockBlocks: false, stockBlockDays: 7 };

/** The ladder's parameters from the owner's rules. Null when a number he must type (the cost, the step or the week's limit) is missing: the ladder stays silent. */
export function scaleParamsFrom(r: CampaignRules): ScaleParams | null {
  if (r.scale.stepPct === null || r.scale.maxWeekPct === null || r.scale.maxCost === null) return null;
  return { proofDays: r.scale.days, minConfirmed: r.scale.minConfirmed, stepPct: r.scale.stepPct, stepHours: r.scale.everyHours, maxWeekPct: r.scale.maxWeekPct, learningGuardHours: r.newAdsetFreezeHours, maxStepsPerDay: 1, stockBlocks: r.scale.stockBlocks, stockBlockDays: r.stock.redDays };
}

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
  /** the product's break-even (the owner's number): the 7-day cost must not pass it. Null = not typed, the check stays silent */
  tOrder: number | null;
  /** the owner's «scale only at or under this cost» */
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
  /** the owner's cap on what the running products spend per day, and what they plan now (null cap = only the account cap) */
  runningCap: number | null;
  runningDailyPlanned: number;
  /** the ad set belongs to a test campaign: its budget is not counted in the running cap */
  isTest: boolean;
  /** v6 · P11: why the money of this ad set cannot be read (another currency, a rate missing, a code that means two products): nothing is raised */
  moneyBlock?: string | null;
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
  // the other checks would be read off figures that are not dollars: only this reason is said
  if (f.moneyBlock) return { raise: false, newBudget: null, blockers: [f.moneyBlock], horizontal: false, sentence: `ما كبّرت ${f.adSetId}: ${f.moneyBlock}` };
  const blockers: string[] = [];
  const days = f.dailyCostPerConfirmed.slice(-p.proofDays);
  if (days.length < p.proofDays || days.some((c) => c === null || c >= f.ceiling)) {
    blockers.push(`ما ثبت ${p.proofDays} أيام ورا بعض تحت السقف ${usd(f.ceiling)} (${days.map((c) => (c === null ? "—" : c.toFixed(2))).join(" · ")})`);
  }
  if (f.confirmedMature < p.minConfirmed) blockers.push(`${f.confirmedMature} مؤكد ناضج بس — بدنا ${p.minConfirmed}`);
  if (f.tOrder !== null && (f.cpa7 === null || f.cpa7 > f.tOrder)) blockers.push(`تكلفة الطلب 7 أيام ${f.cpa7 === null ? "—" : usd(f.cpa7)} فوق التعادل ${usd(f.tOrder)}`);
  if (f.confirmRate !== null && f.productConfirmRate !== null && f.confirmRate < f.productConfirmRate) blockers.push(`نسبة التأكيد ${Math.round(f.confirmRate * 100)}% أقل من متوسط المنتج ${Math.round(f.productConfirmRate * 100)}%`);
  if (f.frozen) blockers.push(`التكبير مجمّد: ${f.frozen}`);
  if (p.stockBlocks && f.stockDays !== null && f.stockDays < p.stockBlockDays) blockers.push(`المخزون بيكفي ${f.stockDays} أيام بس`);
  if (f.hoursSinceSignificant < p.learningGuardHours) blockers.push(`بمرحلة التعلّم: آخر تعديل جوهري قبل ${ago(f.hoursSinceSignificant)} (بدنا ${p.learningGuardHours})`);
  if (f.raisesToday >= p.maxStepsPerDay) blockers.push("انرفعت اليوم خلص");
  if (f.hoursSinceLastRaise < p.stepHours) blockers.push(`آخر زيادة قبل ${ago(f.hoursSinceLastRaise)} (بدنا ${p.stepHours})`);

  const step = Math.round(f.dailyBudget * (1 + p.stepPct) * 100) / 100;
  const weekLimit = Math.round(f.budgetWeekAgo * (1 + p.maxWeekPct) * 100) / 100;
  let newBudget = Math.min(step, weekLimit);
  if (newBudget <= f.dailyBudget) blockers.push(`وصلت حد الأسبوع (+${Math.round(p.maxWeekPct * 100)}% من ${usd(f.budgetWeekAgo)})`);
  let horizontal = false;
  if (f.runningCap !== null && !f.isTest) {
    const room = f.runningCap - f.runningDailyPlanned;
    const add = newBudget - f.dailyBudget;
    if (room <= 0) {
      horizontal = true;
      blockers.push(`المنتجات الشغّالة وصلت سقفها ${usd(f.runningCap)} باليوم — الأحسن ننقل الرابح لحملة التكبير بنفس المنشور`);
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

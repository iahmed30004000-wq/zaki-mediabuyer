/**
 * THE TESTS (spec 5.3 / T4.2) — every launch is a test with a hypothesis, a setup, stop rules and a result.
 * Pure: the budget the spec gives a test, the stop rules, and the verdict from the truth per arm (an arm is a concept
 * in a creative test, a video in a fair creative test, a landing page in a landing test).
 */
export type ExperimentKind = "product" | "creative" | "fair_creative" | "landing";

export const KIND_AR: Record<ExperimentKind, string> = { product: "اختبار منتج", creative: "اختبار إبداعات", fair_creative: "اختبار إبداع عادل", landing: "اختبار صفحة هبوط" };

/** «B_test = max(15$, 3 × T_order)» per ad set, 3–5 days with no edit (5.3). */
export function creativeTestBudget(tOrder: number): number {
  return Math.max(15, Math.ceil(3 * tOrder));
}

export interface StopRules {
  /** an arm that spent this much with no order at all is out (rule.loser_no_orders: 2 × T_order) */
  loserSpend: number;
  /** a winner needs this many mature confirmed orders (scale.min_confirmed) */
  minConfirmed: number;
  /** a winner's cost per confirmed must be under this (the scaling ceiling) */
  ceiling: number;
  /** no verdict before (a landing test is never ended early: 7 days) */
  minDays: number;
  maxDays: number;
}

export function stopRulesFor(kind: ExperimentKind, o: { tOrder: number; ceiling: number; minConfirmed?: number; days?: number }): StopRules {
  const days = o.days ?? (kind === "product" ? 6 : kind === "creative" ? 4 : 7);
  return {
    loserSpend: Math.round(2 * o.tOrder * 100) / 100,
    minConfirmed: o.minConfirmed ?? 5,
    ceiling: o.ceiling,
    minDays: kind === "landing" ? 7 : kind === "creative" ? 3 : 2,
    maxDays: kind === "landing" ? Math.max(days, 14) : days,
  };
}

export interface Arm {
  key: string;
  spend: number;
  orders: number;
  /** mature confirmed orders */
  confirmed: number;
}

export interface Verdict {
  status: "running" | "done";
  winner: string | null;
  losers: string[];
  /** cost per mature confirmed order, per arm (null = none yet) */
  costs: Record<string, number | null>;
  sentence: string;
}

const cost = (a: Arm) => (a.confirmed > 0 ? Math.round((a.spend / a.confirmed) * 100) / 100 : null);

export function judgeExperiment(arms: Arm[], rules: StopRules, daysRun: number): Verdict {
  const costs = Object.fromEntries(arms.map((a) => [a.key, cost(a)]));
  const losers = arms.filter((a) => a.orders === 0 && a.spend >= rules.loserSpend).map((a) => a.key);
  const qualified = arms
    .filter((a) => a.confirmed >= rules.minConfirmed && (cost(a) ?? Infinity) <= rules.ceiling)
    .sort((x, y) => (cost(x) ?? Infinity) - (cost(y) ?? Infinity));
  const best = qualified[0];
  const fmt = (n: number) => `${n.toFixed(2)}$`;

  if (daysRun < rules.minDays) {
    return { status: "running", winner: null, losers, costs, sentence: `لسا بأول ${rules.minDays} أيام — ولا حكم قبلها${losers.length ? ` · وقف: ${losers.join("، ")} (صرف بلا ولا طلب)` : ""}` };
  }
  if (best) {
    const done = daysRun >= rules.maxDays;
    return { status: done ? "done" : "running", winner: best.key, losers, costs, sentence: `${done ? "الرابح" : "المتقدّم لهلأ"} ${best.key}: الطلب المؤكد بـ ${fmt(cost(best)!)} (${best.confirmed} مؤكد) تحت السقف ${fmt(rules.ceiling)}` };
  }
  if (daysRun >= rules.maxDays) {
    return { status: "done", winner: null, losers, costs, sentence: `خلصت ${rules.maxDays} أيام وما في رابح: ولا واحد وصل ${rules.minConfirmed} مؤكد تحت ${fmt(rules.ceiling)}` };
  }
  return { status: "running", winner: null, losers, costs, sentence: `بيانات غير كافية لسا — بدنا ${rules.minConfirmed} طلبات مؤكدة ناضجة للحكم` };
}

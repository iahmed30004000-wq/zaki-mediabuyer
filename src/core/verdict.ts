/**
 * THE VERDICT OF A PRODUCT (docs/rebuild/06-dashboards.md §3): one word about the cost of a real order against the owner's own numbers — the
 * target and the break-even he wrote in the rules. Pure and with no number of its own: nothing here is a constant of money. It SHOWS what the
 * night round decides on; the decision stays with the round and the rules.
 *
 *   no cost yet (no linked orders, or no spend)   nodata   grey   «ما في طلبات مربوطة»
 *   no break-even written                         norule   grey   «ناقص نقطة التعادل»
 *   cost ≤ target                                 win      green  «رابح — مرشّح تكبير»
 *   target < cost ≤ break-even                    between  orange «بين — راقب»
 *   cost > break-even                             lose     red    «فوق التعادل»
 *
 * With a break-even but no target written, a cost at or under the break-even is «بين» (it cannot be called a win without a target to beat).
 */
export type VerdictKey = "nodata" | "norule" | "win" | "between" | "lose";
export type VerdictTone = "neutral" | "ok" | "warn" | "danger";

export interface Verdict {
  key: VerdictKey;
  label: string;
  tone: VerdictTone;
}

const V: Record<VerdictKey, Verdict> = {
  nodata: { key: "nodata", label: "ما في طلبات مربوطة", tone: "neutral" },
  norule: { key: "norule", label: "ناقص نقطة التعادل", tone: "neutral" },
  win: { key: "win", label: "رابح — مرشّح تكبير", tone: "ok" },
  between: { key: "between", label: "بين — راقب", tone: "warn" },
  lose: { key: "lose", label: "فوق التعادل", tone: "danger" },
};

export function productVerdict(cost: number | null | undefined, target: number | null | undefined, breakeven: number | null | undefined): Verdict {
  if (cost === null || cost === undefined || !Number.isFinite(cost)) return V.nodata;
  if (breakeven === null || breakeven === undefined || !Number.isFinite(breakeven)) return V.norule;
  if (target !== null && target !== undefined && Number.isFinite(target) && cost <= target) return V.win;
  return cost <= breakeven ? V.between : V.lose;
}

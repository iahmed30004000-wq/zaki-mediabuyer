/**
 * READING THE MONEY OF A TRUTH ROW (v6 · P11) — pure. A `TruthDaily` row whose money could not be known carries why (`spendMissing` · `moneyMissing`);
 * its stored money columns are then placeholders, not numbers. EVERY reader (reports, exports, agents) asks this file, which gives null in their place.
 *
 *   spendMissing   the spend is not known in dollars  → spend, cost per confirmed, profit, ROAS
 *   moneyMissing   the revenue or the costs are not   → net collected, limits, profit, ROAS
 */
import { missingRateText } from "./currency";

/** `fx:EGP,SYP` (no exchange rate) · `market` (no economics for that market) · both joined by `;` · null. */
export function encodeGap(fx: Iterable<string>, market = false): string | null {
  const codes = [...new Set(fx)].sort();
  const parts = [codes.length ? `fx:${codes.join(",")}` : null, market ? "market" : null].filter(Boolean);
  return parts.length ? parts.join(";") : null;
}

export function decodeGap(...gaps: (string | null | undefined)[]): { fx: string[]; market: boolean } {
  const parts = gaps.flatMap((g) => (g ? g.split(";") : []));
  return { fx: [...new Set(parts.filter((p) => p.startsWith("fx:")).flatMap((p) => p.slice(3).split(",")))].filter(Boolean).sort(), market: parts.includes("market") };
}

/** The sentence a report writes where the number would be; null when nothing is missing. */
export function gapText(...gaps: (string | null | undefined)[]): string | null {
  const g = decodeGap(...gaps);
  const parts = [g.fx.length ? missingRateText(g.fx) : null, g.market ? "ما في تكاليف مكتوبة لهالسوق" : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

export interface TruthMoneyRow {
  spendMissing?: string | null;
  moneyMissing?: string | null;
  spendWithFee: unknown;
  netCollected?: unknown;
  lossLimit?: unknown;
  scalingCeiling?: unknown;
  costPerConfirmed?: unknown;
  profitAfterCosts?: unknown;
  profitPerDelivered?: unknown;
  trueRoas?: unknown;
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function truthMoney(r: TruthMoneyRow) {
  const noSpend = !!r.spendMissing;
  const noMoney = !!r.moneyMissing;
  const either = noSpend || noMoney;
  return {
    spend: noSpend ? null : num(r.spendWithFee),
    costPerConfirmed: noSpend ? null : num(r.costPerConfirmed),
    netCollected: noMoney ? null : num(r.netCollected),
    lossLimit: noMoney ? null : num(r.lossLimit),
    ceiling: noMoney ? null : num(r.scalingCeiling),
    profit: either ? null : num(r.profitAfterCosts),
    profitPerDelivered: either ? null : num(r.profitPerDelivered),
    roas: either ? null : num(r.trueRoas),
    gap: gapText(r.spendMissing, r.moneyMissing),
  };
}

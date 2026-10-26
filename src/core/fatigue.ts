/**
 * CREATIVE FATIGUE (spec 6.5 «الإرهاق») — pure. A winner is «tired» when all three hold:
 *   1. frequency over the last 7 days > 2.5 (Jordan's audience is small: watched from 2.0),
 *   2. its CTR or its hook rate fell ≥ 25% against its own first days,
 *   3. its cost per order rose ≥ 30% against its own first days.
 * A tired winner is NOT paused: it is fed — new hooks on the same body are requested from the studio. Two of three
 * is «watch» (shown, nothing asked). The frequency is from daily rows (impressions ÷ reach summed by day), which
 * undercounts people seen on several days — so a hit is real, a miss may be early.
 */
export interface FatigueWindow {
  impressions: number;
  reach: number;
  clicks: number;
  /** 3-second views */
  hooks: number;
  spend: number;
  orders: number;
}

export interface FatigueVerdict {
  state: "fresh" | "watch" | "tired";
  frequency: number | null;
  ctrDrop: number | null;
  hookDrop: number | null;
  costRise: number | null;
  reasons: string[];
}

const ratio = (a: number, b: number) => (b > 0 ? a / b : null);
const drop = (early: number | null, now: number | null) => (early && now !== null ? (early - now) / early : null);
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function judgeFatigue(early: FatigueWindow, recent: FatigueWindow, last7: Pick<FatigueWindow, "impressions" | "reach">, market: string): FatigueVerdict {
  const frequency = ratio(last7.impressions, last7.reach);
  const freqLimit = market === "JO" ? 2.0 : 2.5;
  const ctrDrop = drop(ratio(early.clicks, early.impressions), ratio(recent.clicks, recent.impressions));
  const hookDrop = drop(ratio(early.hooks, early.impressions), ratio(recent.hooks, recent.impressions));
  const cpoEarly = ratio(early.spend, early.orders);
  const cpoNow = ratio(recent.spend, recent.orders);
  const costRise = cpoEarly && cpoNow !== null ? (cpoNow - cpoEarly) / cpoEarly : recent.spend > 0 && recent.orders === 0 && early.orders > 0 ? 1 : null;

  const reasons: string[] = [];
  const a = frequency !== null && frequency > freqLimit;
  const b = (ctrDrop ?? 0) >= 0.25 || (hookDrop ?? 0) >= 0.25;
  const c = (costRise ?? 0) >= 0.3;
  if (a) reasons.push(`التكرار ${frequency!.toFixed(1)} فوق ${freqLimit}`);
  if (b) reasons.push((ctrDrop ?? 0) >= (hookDrop ?? 0) ? `النقر نزل ${pct(ctrDrop!)} عن أول أيامه` : `الهوك نزل ${pct(hookDrop!)} عن أول أيامه`);
  if (c) reasons.push(`تكلفة الطلب طلعت ${pct(costRise!)}`);
  const hits = [a, b, c].filter(Boolean).length;
  return { state: hits === 3 ? "tired" : hits === 2 ? "watch" : "fresh", frequency, ctrDrop, hookDrop, costRise, reasons };
}

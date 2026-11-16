/**
 * NO MONEY WITHOUT `money.view` (docs/rebuild/05-permissions.md §3): a profit, a margin, a product's cost or a break-even point is not sent to the browser
 * at all for a role that lacks the capability — the filter runs on the SERVER over the view model, it is not a screen that hides a number it already received.
 * Pure. A hidden number becomes `null` («—» on the screen, never a made-up zero); the spend, the orders and the cost per order stay (they are the ads' own numbers).
 */
const MONEY_KEY = /profit|margin|break_?even|unit_?cost|cogs|cost_?price/i;

export const isMoneyKey = (k: string): boolean => MONEY_KEY.test(k);

export function stripMoney<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => stripMoney(x)) as unknown as T;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = isMoneyKey(k) && (typeof x === "number" || x === null || typeof x === "string") ? null : stripMoney(x);
    return out as T;
  }
  return v;
}

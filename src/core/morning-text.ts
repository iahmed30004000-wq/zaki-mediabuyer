/**
 * THE MORNING REPORT'S WORDS (v6 · P0-2, R-15 · U-07), pure. A missing figure is «—», never a zero; and a cost per confirmed order of a day whose orders have not
 * all matured is «— (مبدئي)»: the day's whole spend divided by only the confirmed orders that matured so far gives a figure several times the real one.
 */
import { fmt } from "@/lib/format";

/** The spend as a word: «—» when there is no spend row at all (or it is zero and nothing backs it up). */
export const spendText = (spend: number | null | undefined, known = true): string => (!known || spend === null || spend === undefined || !(spend > 0) ? "—" : fmt(spend, "$"));

/** The cost of a confirmed order: a number only when every order of the day matured and at least one was confirmed. */
export function costPerConfirmedText(i: { spend: number | null; confirmed: number; orders: number; matureOrders: number }): string {
  if (i.spend === null || !(i.spend > 0)) return "—";
  if (i.matureOrders < i.orders) return "— (مبدئي)";
  if (i.confirmed <= 0) return "—";
  return fmt(i.spend / i.confirmed, "$");
}

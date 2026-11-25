/**
 * The exchange rates as the settings screen reads them (v6 · P11): every currency the site needs — the markets' own, those the orders and the ad accounts
 * really carry, and any the owner wrote — with its rate, where the rate comes from and when it was written. A currency in use with no rate is first.
 */
import { BASE_CURRENCY, CURRENCY_AR, MARKET_CURRENCY, normalizeCurrency, rateTable } from "@/core/currency";
import { isDemo } from "@/core/readiness";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";

export interface CurrencyRow {
  code: string;
  name: string;
  /** units of the currency per dollar; null: missing */
  perUsd: number | null;
  source: "owner" | "default" | "missing";
  /** when the owner wrote it (ISO) */
  at: string | null;
  /** orders or ad accounts carry it */
  used: boolean;
}

export interface CurrencyView {
  rows: CurrencyRow[];
  /** currencies in use with no rate */
  missing: string[];
  /** the newest rate the owner wrote (ISO), or null when he never did */
  updatedAt: string | null;
}

export async function loadCurrencyView(): Promise<CurrencyView> {
  const demo = isDemo(process.env);
  const [stored, orders, accounts] = await Promise.all([
    demo ? Promise.resolve({}) : getSetting("currency.rates"),
    demo ? Promise.resolve([]) : db.attributedOrder.groupBy({ by: ["currency"], _count: { _all: true } }),
    demo ? Promise.resolve([]) : db.adAccount.findMany({ select: { currency: true } }),
  ]);
  const rates = rateTable(stored);
  const used = new Set([...orders.map((o) => normalizeCurrency(o.currency)), ...accounts.map((a) => normalizeCurrency(a.currency))].filter((c): c is string => !!c));
  const codes = [...new Set([...Object.values(MARKET_CURRENCY), ...used, ...rates.keys()])].filter((c) => c !== BASE_CURRENCY);
  const rows: CurrencyRow[] = codes.map((code) => {
    const r = rates.get(code);
    return { code, name: CURRENCY_AR[code] ?? code, perUsd: r?.perUsd ?? null, source: r ? (r.source === "owner" ? "owner" : "default") : "missing", at: r?.at ?? null, used: used.has(code) };
  });
  const rank = (r: CurrencyRow) => (r.used && r.source === "missing" ? 0 : r.used ? 1 : 2);
  rows.sort((a, b) => rank(a) - rank(b) || a.code.localeCompare(b.code));
  const dates = rows.map((r) => r.at).filter((d): d is string => !!d).sort();
  return { rows, missing: rows.filter((r) => rank(r) === 0).map((r) => r.code), updatedAt: dates[dates.length - 1] ?? null };
}

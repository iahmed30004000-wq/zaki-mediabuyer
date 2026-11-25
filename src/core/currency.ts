/**
 * MONEY IN ONE CURRENCY (v6 · P11) — pure. Every amount the site adds, compares or decides on is in US dollars. Amounts arrive in other currencies
 * (an OMS order in dinars, an ad account that Meta bills in another currency), so they are converted HERE, at the owner's rates, before anything is summed.
 *
 *   rate      «how many units of the currency make one dollar» (JOD 0.709 → 0.709 JOD = 1$)
 *   defaults  only currencies a central bank pegs to the dollar; a floating currency has NO default — nobody here guesses a rate
 *   missing   an amount whose currency has no rate converts to null, never to itself and never to 0. A sum that holds one is null too, and names the
 *             currency («ناقص سعر صرف») — it is never a quiet partial sum.
 *
 * A zero is zero in every currency, so it needs no rate. One rate per currency applies to every day it is asked about (the screens say when it was written).
 */
import Decimal from "decimal.js";
import type { Market } from "./naming";

export const BASE_CURRENCY = "USD";

/** Currencies pegged to the dollar: the central bank's own figure. Anything that floats is the owner's to write. */
export const DEFAULT_RATES: Readonly<Record<string, number>> = { JOD: 0.709, SAR: 3.75 };

/** The currency a market sells in: what the rates screen offers even before the first order in it arrives. */
export const MARKET_CURRENCY: Readonly<Record<Market, string>> = { SY: "SYP", JO: "JOD", EG: "EGP", SA: "SAR", LY: "LYD", MR: "MRU" };

export const CURRENCY_AR: Readonly<Record<string, string>> = {
  USD: "الدولار", SYP: "الليرة السورية", JOD: "الدينار الأردني", EGP: "الجنيه المصري", SAR: "الريال السعودي", LYD: "الدينار الليبي", MRU: "الأوقية الموريتانية",
};

/** The word for a currency nobody named (a row whose account is not known). */
export const UNKNOWN_CURRENCY = "؟";

/** The owner's rate for one currency, as the settings keep it. `at` is when he wrote it (ISO). */
export interface OwnerRate {
  perUsd: number;
  at: string;
}
export type OwnerRates = Record<string, OwnerRate>;

export interface Rate {
  perUsd: number;
  source: "base" | "owner" | "default";
  /** when the owner wrote it; null for the base and for a default nobody touched */
  at: string | null;
}
export type RateTable = ReadonlyMap<string, Rate>;

/** `jod ` → `JOD`; anything that is not three letters is no currency. */
export function normalizeCurrency(c: string | null | undefined): string | null {
  const u = (c ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(u) ? u : null;
}

export const validRate = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1_000_000;

/** The rates in force: the pegged defaults, the owner's own rows over them, and the dollar. A broken row of the settings is ignored (its currency stays missing). */
export function rateTable(owner: unknown): RateTable {
  const out = new Map<string, Rate>();
  for (const [code, perUsd] of Object.entries(DEFAULT_RATES)) out.set(code, { perUsd, source: "default", at: null });
  if (owner && typeof owner === "object" && !Array.isArray(owner)) {
    for (const [k, v] of Object.entries(owner as Record<string, unknown>)) {
      const code = normalizeCurrency(k);
      const row = v as Partial<OwnerRate> | null;
      if (!code || code === BASE_CURRENCY || !row || !validRate(row.perUsd)) continue;
      out.set(code, { perUsd: row.perUsd, source: "owner", at: typeof row.at === "string" ? row.at : null });
    }
  }
  out.set(BASE_CURRENCY, { perUsd: 1, source: "base", at: null });
  return out;
}

export interface Converted {
  /** dollars, or null when the currency has no rate */
  usd: Decimal | null;
  /** the currency that stopped it (`؟` when the amount has none), else null */
  missing: string | null;
}

/** One amount in dollars. */
export function toUsd(amount: Decimal.Value, currency: string | null | undefined, rates: RateTable): Converted {
  const a = new Decimal(amount);
  if (a.isZero()) return { usd: a, missing: null };
  const code = normalizeCurrency(currency);
  const rate = code ? rates.get(code) : undefined;
  if (!rate) return { usd: null, missing: code ?? UNKNOWN_CURRENCY };
  return { usd: rate.source === "base" ? a : a.div(rate.perUsd), missing: null };
}

export interface Summed {
  /** the sum in dollars; null as soon as ONE amount cannot be converted */
  usd: Decimal | null;
  /** the currencies that stopped it, sorted, once each */
  missing: string[];
}

export function sumUsd(list: Iterable<{ amount: Decimal.Value; currency: string | null | undefined }>, rates: RateTable): Summed {
  let total = new Decimal(0);
  const missing = new Set<string>();
  for (const x of list) {
    const c = toUsd(x.amount, x.currency, rates);
    if (c.usd === null) missing.add(c.missing!);
    else total = total.plus(c.usd);
  }
  return { usd: missing.size ? null : total, missing: [...missing].sort() };
}

/** Sorted, once each — for the lists of missing currencies that travel together. */
export const mergeMissing = (...lists: (readonly string[] | string | null | undefined)[]): string[] =>
  [...new Set(lists.flatMap((l) => (!l ? [] : typeof l === "string" ? l.split(",") : [...l])).filter(Boolean))].sort();

/** «ناقص سعر صرف: EGP، SYP» — the one sentence every screen and report says. */
export const missingRateText = (codes: readonly string[]): string => `ناقص سعر صرف: ${codes.join("، ")}`;

// ───────────────────────────── the currency of a stored amount ─────────────────────────────

/** Rows that arrived by a push or a paste: their contract is dollars (src/core/push-rows.ts). */
const DOLLAR_SOURCES = new Set(["mcp", "manual"]);

/**
 * The currency of one stored spend row: the one written on it; else, for a row from before the column existed, dollars when it was pushed or pasted, and the
 * currency of the ad account it belongs to when Meta or an import brought it. Null when nobody can tell — it then counts as missing, never as dollars.
 */
export function rowCurrency(row: { currency?: string | null; source?: string | null }, accountCurrency: string | null | undefined): string | null {
  return normalizeCurrency(row.currency) ?? (DOLLAR_SOURCES.has(row.source ?? "") ? BASE_CURRENCY : normalizeCurrency(accountCurrency));
}

/** A currency named in a header or a cell of a pasted or imported table («Amount spent (JOD)», «دينار»). Dollars and «no word at all» are both null. */
export function foreignCurrencyIn(text: string): string | null {
  const code = text.match(/\b(JOD|SYP|EGP|SAR|LYD|MRU|EUR|GBP|AED|IQD|TRY|KWD|QAR|BHD|OMR|LBP|MAD|DZD|TND|YER|SDG)\b/i)?.[1];
  if (code) return code.toUpperCase();
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  if (/دينار/.test(text)) return "JOD";
  return /ليرة|ريال|جنيه|أوقية/.test(text) ? UNKNOWN_CURRENCY : null;
}

// ───────────────────────────── what the owner saves ─────────────────────────────

/**
 * The owner's save: the currencies he sent replace his rows (an empty value removes his row, so a pegged currency goes back to its default). A row whose number
 * did not change keeps the date it was written on. Returns the sentence when something is not a currency or not a rate.
 */
export function nextRates(current: unknown, input: Record<string, number | null>, now: Date): { rates: OwnerRates } | { error: string } {
  const rates: OwnerRates = {};
  for (const [code, r] of rateTable(current)) if (r.source === "owner") rates[code] = { perUsd: r.perUsd, at: r.at ?? now.toISOString() };
  for (const [k, v] of Object.entries(input)) {
    const code = normalizeCurrency(k);
    if (!code) return { error: `«${k.slice(0, 12)}» مش رمز عملة — تلات أحرف إنجليزية متل EGP` };
    if (code === BASE_CURRENCY) return { error: "الدولار هو الأساس — ما إله سعر صرف" };
    if (v === null) {
      delete rates[code];
      continue;
    }
    if (!validRate(v)) return { error: `سعر ${code} لازم يكون رقم أكبر من صفر` };
    if (rates[code]?.perUsd === v) continue;
    // a pegged default typed as it is stays a default: nothing of the owner's to remember
    if (!rates[code] && DEFAULT_RATES[code] === v) continue;
    rates[code] = { perUsd: v, at: now.toISOString() };
  }
  return { rates };
}

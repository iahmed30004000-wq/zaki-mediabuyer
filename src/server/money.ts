/**
 * What the pure money and market rules need from the database (v6 · P11): the owner's rates, the currency of the account each Meta object belongs to, and the
 * markets every product was seen in. Gathering only — the arithmetic is src/core/currency.ts and src/core/markets.ts.
 */
import { rateTable, rowCurrency, toUsd, type Converted, type RateTable } from "@/core/currency";
import { campaignMarket, productMarkets, type ProductMarkets } from "@/core/markets";
import { db } from "./db";
import { getSetting } from "./settings";

export const loadRates = async (): Promise<RateTable> => rateTable(await getSetting("currency.rates"));

/** Meta id (account · campaign · ad set · ad) → the currency of its ad account. */
export async function objectCurrencies(): Promise<Map<string, string>> {
  const accounts = await db.adAccount.findMany({ select: { metaId: true, currency: true, campaigns: { select: { metaId: true, adsets: { select: { metaId: true, ads: { select: { metaId: true } } } } } } } });
  const out = new Map<string, string>();
  for (const a of accounts) {
    out.set(a.metaId, a.currency);
    for (const c of a.campaigns ?? []) {
      out.set(c.metaId, a.currency);
      for (const s of c.adsets ?? []) {
        out.set(s.metaId, a.currency);
        for (const x of s.ads ?? []) out.set(x.metaId, a.currency);
      }
    }
  }
  return out;
}

export interface SpendRow {
  objectId: string;
  spend: unknown;
  currency?: string | null;
  source?: string | null;
}

export interface SpendConverter {
  rates: RateTable;
  objects: Map<string, string>;
  /** the currency one stored spend row is in (null: nobody knows) */
  currencyOf(row: SpendRow): string | null;
  /** the row's spend in dollars — `usd: null` with the currency that has no rate */
  usd(row: SpendRow): Converted;
}

export async function spendConverter(): Promise<SpendConverter> {
  const [rates, objects] = await Promise.all([loadRates(), objectCurrencies()]);
  const currencyOf = (row: SpendRow) => rowCurrency(row, objects.get(row.objectId));
  return { rates, objects, currencyOf, usd: (row) => toUsd(String(row.spend ?? 0), currencyOf(row), rates) };
}

/** The markets of every product, from all its orders and all its campaigns — one answer for every screen and every job. */
export async function loadProductMarkets(): Promise<ProductMarkets> {
  const [econ, orders, campaigns] = await Promise.all([
    db.productEconomics.findMany({ select: { productCode: true, market: true } }),
    db.attributedOrder.groupBy({ by: ["productCode", "market"], where: { isFake: false }, _count: { _all: true } }),
    db.campaign.findMany({ select: { productCode: true, parsedMarket: true, account: { select: { market: true } } } }),
  ]);
  return productMarkets(
    [...orders.map((o) => ({ code: o.productCode, market: o.market })), ...campaigns.map((c) => ({ code: c.productCode, market: campaignMarket(c.parsedMarket, c.account?.market) }))],
    new Map(econ.map((e) => [e.productCode, e.market])),
  );
}

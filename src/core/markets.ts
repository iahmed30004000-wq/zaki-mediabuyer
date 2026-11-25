/**
 * ONE PRODUCT, SEVERAL MARKETS (v6 · P11) — pure. A product code that is seen in two markets is two lines of numbers, never one: the orders carry their
 * country, a campaign carries the market its name (or its account) says. The product's economics and the days somebody pushed carry no market of their own, so
 * they belong to its HOME market (the one written on the product) and to no other.
 *
 *   seen in one market (or none)  → one line, keyed by the code, exactly as before
 *   seen in two or more           → a line per market: the home keeps the plain code, the others are `CODE@MM`, and what nobody placed is `CODE@??`
 */
import { MARKETS, MARKET_AR, type Market } from "./naming";

export const isMarket = (v: unknown): v is Market => typeof v === "string" && (MARKETS as readonly string[]).includes(v);

export const UNKNOWN_MARKET_AR = "سوق مش معروف";

/** The Arabic name of a market; a country the site has no name for is written as it came. */
export const marketLabel = (m: string | null | undefined): string => (isMarket(m) ? MARKET_AR[m] : m || UNKNOWN_MARKET_AR);

/** The market a campaign runs in: what its name says, else what its ad account is for. Never a guess. */
export const campaignMarket = (parsedMarket: string | null | undefined, accountMarket: string | null | undefined): string | null => parsedMarket || accountMarket || null;

const UNPLACED = "??";

export interface ProductMarkets {
  /** every market a product was seen in */
  marketsOf(code: string): string[];
  /** seen in two or more */
  isSplit(code: string): boolean;
  /** the one market the product's economics and pushed days belong to; null when it is split and the one written on it was never seen */
  homeOf(code: string): string | null;
  /** the key of the line an amount of `code` in `market` belongs to */
  keyOf(code: string, market: string | null | undefined): string;
  /** whether the line of `market` may use the product's economics */
  isHome(code: string, market: string | null | undefined): boolean;
  /** the market of a line (null: unknown) */
  marketOfKey(key: string): string | null;
}

export function splitKey(key: string): { code: string; suffix: string | null } {
  const at = key.indexOf("@");
  return at < 0 ? { code: key, suffix: null } : { code: key.slice(0, at), suffix: key.slice(at + 1) };
}

/** `seen`: every (product, market) the orders and the campaigns show. `configured`: the market written on each product. */
export function productMarkets(seen: Iterable<{ code: string | null | undefined; market: string | null | undefined }>, configured: ReadonlyMap<string, string | null | undefined>): ProductMarkets {
  const map = new Map<string, Set<string>>();
  for (const s of seen) {
    if (!s.code || !s.market) continue;
    const set = map.get(s.code) ?? new Set<string>();
    set.add(s.market);
    map.set(s.code, set);
  }
  const marketsOf = (code: string) => [...(map.get(code) ?? [])].sort();
  const isSplit = (code: string) => (map.get(code)?.size ?? 0) > 1;
  const homeOf = (code: string): string | null => {
    const set = map.get(code);
    const own = configured.get(code) ?? null;
    if (!set?.size) return own;
    if (set.size === 1) return [...set][0]!;
    return own && set.has(own) ? own : null;
  };
  const keyOf = (code: string, market: string | null | undefined) => {
    if (!isSplit(code)) return code;
    if (!market) return `${code}@${UNPLACED}`;
    return market === homeOf(code) ? code : `${code}@${market}`;
  };
  return {
    marketsOf,
    isSplit,
    homeOf,
    keyOf,
    isHome: (code, market) => !isSplit(code) || (!!market && market === homeOf(code)),
    marketOfKey(key) {
      const { code, suffix } = splitKey(key);
      if (suffix !== null) return suffix === UNPLACED ? null : suffix;
      return homeOf(code);
    },
  };
}

/** The name of a line: a split product says its market after its name; a product in one market is just its name. */
export const marketName = (name: string, key: string, markets: ProductMarkets): string => (markets.isSplit(splitKey(key).code) ? `${name} — ${marketLabel(markets.marketOfKey(key))}` : name);

// ───────────────────────────── the market in an address ─────────────────────────────

/** A screen's query with the chosen market kept on it (any market already there is replaced). */
export function withMarket(query: string, market: string | null | undefined): string {
  const q = new URLSearchParams(query);
  q.delete("market");
  if (market) q.set("market", market);
  return q.toString();
}

/** The address of a product's page: a line of a product seen in two markets opens on ITS market. */
export function productHref(p: { code: string; market?: string | null; split?: boolean; key?: string }, query: string): string {
  const split = p.split ?? p.key !== undefined;
  const q = split && isMarket(p.market) ? withMarket(query, p.market) : query;
  return `/numbers/products/${encodeURIComponent(p.code)}${q ? `?${q}` : ""}`;
}

// ───────────────────────────── the same code, said two ways (the OMS's stores) ─────────────────────────────

export type ConflictKind = "catalogue" | "markets" | "currencies";

export interface ProductConflict {
  code: string;
  kind: ConflictKind;
  /** one sentence for the owner */
  text: string;
}

export interface CatalogueEntry {
  code: string;
  name: string;
  currency?: string | null;
  price?: string | null;
  unitCost?: string | null;
}

/** Codes the catalogue lists more than once with figures that disagree: the OMS has one code per STORE, so these are two products and none of them is taken. */
export function catalogueConflicts(list: readonly CatalogueEntry[]): ProductConflict[] {
  const by = new Map<string, CatalogueEntry[]>();
  for (const e of list) by.set(e.code, [...(by.get(e.code) ?? []), e]);
  const out: ProductConflict[] = [];
  for (const [code, rows] of by) {
    const shapes = new Set(rows.map((r) => JSON.stringify([r.name, r.currency ?? null, r.price ?? null, r.unitCost ?? null])));
    if (shapes.size < 2) continue;
    out.push({ code, kind: "catalogue", text: `رمز المنتج ${code} جاي من نظام الطلبات ${rows.length} مرات بمعلومات مختلفة (غالباً متجرين بنفس الرمز) — ما أخدنا أسعاره، وما بنكبّره لحد ما يتصلّح الرمز.` });
  }
  return out;
}

/** The same code in two countries, or in two currencies inside one country: kept (they are real orders), split by market on the screens, and said. */
export function orderConflicts(rows: readonly { code: string; market: string; currency: string }[]): ProductConflict[] {
  const by = new Map<string, Map<string, Set<string>>>();
  for (const r of rows) {
    const markets = by.get(r.code) ?? new Map<string, Set<string>>();
    const currencies = markets.get(r.market) ?? new Set<string>();
    currencies.add(r.currency);
    markets.set(r.market, currencies);
    by.set(r.code, markets);
  }
  const out: ProductConflict[] = [];
  for (const [code, markets] of by) {
    if (markets.size > 1) out.push({ code, kind: "markets", text: `رمز المنتج ${code} طالع بأكتر من سوق (${[...markets.keys()].sort().map(marketLabel).join("، ")}) — أرقامه مفصولة لكل سوق. إذا هني منتجين مختلفين، لازم كل واحد يكون إله رمز.` });
    const mixed = [...markets].filter(([, c]) => c.size > 1);
    if (mixed.length) out.push({ code, kind: "currencies", text: `رمز المنتج ${code} إله طلبات بأكتر من عملة بنفس السوق (${mixed.map(([m, c]) => `${marketLabel(m)}: ${[...c].sort().join("، ")}`).join(" · ")}) — تأكد إنو مش منتجين بنفس الرمز.` });
  }
  return out.sort((a, b) => a.code.localeCompare(b.code) || a.kind.localeCompare(b.kind));
}

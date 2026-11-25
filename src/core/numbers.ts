/**
 * «الأرقام» (v4.1) — every number of the day, per product and in total, computed here and nowhere else. The screen never
 * types a number: it asks `computeSet` and prints what comes back; every figure's formula is in the glossary and shown
 * beside it («قاعدة الاحتساب»). Pure: no database, no clock.
 *
 *   Raw      the counts and amounts of a window as they were pushed (Meta's delivery, the OMS's orders)
 *   Ctx      what a product needs besides them: the card fee, its delivery rate of the last 30 days, its unit economics
 *   NumbersSet  everything the owner reads — ratios and costs derived from Raw, never stored
 *
 * Rates are percentages (0–100). Money is USD. A number that cannot be computed (a zero denominator, a missing input)
 * is `null` and prints «—» — never 0, never a guess.
 */
import { mergeMissing } from "./currency";
import { stockUrgency, type StockThresholds } from "./stock-alerts";
import type { Urgency } from "./mode";

export interface Reason {
  reason: string;
  count: number;
}
export interface Offer {
  offer: string;
  orders: number;
  /** pieces in one order of this offer (for the upsell rate) */
  pieces?: number;
  revenue?: number;
}

export interface Raw {
  // flows: summed over the window
  metaSpend: number | null;
  impressions: number | null;
  linkClicks: number | null;
  pixelPurchases: number | null;
  ordersIn: number | null;
  uniqueCustomers: number | null;
  confirmed: number | null;
  rejected: number | null;
  cancelled: number | null;
  shippedOrders: number | null;
  shippedPieces: number | null;
  delivered: number | null;
  returned: number | null;
  revenueShipped: number | null;
  /** an expected revenue somebody pushed — used only when the screen cannot compute its own */
  expectedRevenuePushed: number | null;
  /** the value of the orders that came in, and how many they are (the average order value) */
  aovRevenue: number | null;
  aovOrders: number | null;
  rejectReasons: Reason[];
  offers: Offer[];
  /** v6 · P11: currencies of spend in the window that have no exchange rate. Non-empty = the spend is NOT known (never a partial sum) */
  fxMissing?: string[];
  /** v6 · P11: money moved here in a market the product has no economics for: a total that holds it has no whole profit */
  noEconomics?: boolean;
  // states: the latest reading in the window
  waiting: number | null;
  outForDelivery: number | null;
  stuck: number | null;
  stockUnits: number | null;
}

export const FLOW_KEYS = ["metaSpend", "impressions", "linkClicks", "pixelPurchases", "ordersIn", "uniqueCustomers", "confirmed", "rejected", "cancelled", "shippedOrders", "shippedPieces", "delivered", "returned", "revenueShipped", "expectedRevenuePushed", "aovRevenue", "aovOrders"] as const;
export const STATE_KEYS = ["waiting", "outForDelivery", "stuck", "stockUnits"] as const;

export const emptyRaw = (): Raw => ({
  metaSpend: null, impressions: null, linkClicks: null, pixelPurchases: null, ordersIn: null, uniqueCustomers: null, confirmed: null, rejected: null, cancelled: null,
  shippedOrders: null, shippedPieces: null, delivered: null, returned: null, revenueShipped: null, expectedRevenuePushed: null, aovRevenue: null, aovOrders: null,
  rejectReasons: [], offers: [], waiting: null, outForDelivery: null, stuck: null, stockUnits: null,
});

const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

function mergeReasons(list: Reason[]): Reason[] {
  const m = new Map<string, number>();
  for (const r of list) m.set(r.reason, (m.get(r.reason) ?? 0) + r.count);
  return [...m].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
}

function mergeOffers(list: Offer[]): Offer[] {
  const m = new Map<string, Offer>();
  for (const o of list) {
    const cur = m.get(o.offer);
    m.set(o.offer, cur ? { offer: o.offer, orders: cur.orders + o.orders, pieces: cur.pieces ?? o.pieces, revenue: cur.revenue === undefined && o.revenue === undefined ? undefined : (cur.revenue ?? 0) + (o.revenue ?? 0) } : { ...o });
  }
  return [...m.values()].sort((a, b) => b.orders - a.orders);
}

/** Adds windows or products: flows and states both sum (a total of products), lists merge by name. */
export function sumRaw(list: Raw[]): Raw {
  const out = emptyRaw();
  for (const r of list) {
    for (const k of [...FLOW_KEYS, ...STATE_KEYS]) out[k] = add(out[k], r[k]);
  }
  const fx = mergeMissing(...list.map((r) => r.fxMissing));
  if (fx.length) {
    out.fxMissing = fx;
    out.metaSpend = null;
  }
  if (list.some((r) => r.noEconomics)) out.noEconomics = true;
  out.rejectReasons = mergeReasons(list.flatMap((r) => r.rejectReasons));
  out.offers = mergeOffers(list.flatMap((r) => r.offers));
  return out;
}

/** The same window at another length: flows scale (the 7-day average becomes «what a window this long would have had»), states stay. */
export function scaleFlows(r: Raw, f: number): Raw {
  const out: Raw = { ...r, rejectReasons: r.rejectReasons.map((x) => ({ ...x, count: Math.round(x.count * f) })), offers: r.offers.map((o) => ({ ...o, orders: Math.round(o.orders * f), revenue: o.revenue === undefined ? undefined : o.revenue * f })) };
  for (const k of FLOW_KEYS) out[k] = r[k] === null ? null : r[k]! * f;
  return out;
}

export interface Econ {
  unitCost: number;
  deliveryFee: number;
  returnFee: number;
}

export interface Ctx {
  /** the card's fee as a fraction (0.01) */
  fx: number;
  /** delivered ÷ (delivered + returned) over the product's last 30 days, as a fraction; null when nothing was resolved */
  deliveryRate: number | null;
  econ: Econ | null;
  /** pieces shipped per day over the last 7 days (for the days of cover) */
  piecesPerDay: number | null;
}

export const SET_KEYS = [
  "spend", "pixelPurchases", "costPerPixel", "cpm", "ctr",
  "ordersIn", "uniqueCustomers", "duplicates", "gapPct",
  "costPerOrder", "costPerConfirmed", "costPerDelivered",
  "confirmed", "rejected", "cancelled", "waiting", "confirmRate",
  "upsellRate", "aov",
  "shippedOrders", "shippedPieces", "outForDelivery", "delivered", "returned", "stuck",
  "deliveryRate30", "expectedRevenue", "expectedShipping", "expectedProfit",
  "stockUnits", "stockCover",
] as const;
export type SetKey = (typeof SET_KEYS)[number];
export type NumbersSet = Record<SetKey, number | null>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const div = (a: number | null, b: number | null): number | null => (a === null || b === null || b === 0 ? null : a / b);
const rnd = (n: number | null, f: (x: number) => number): number | null => (n === null ? null : f(n));

export function computeSet(raw: Raw, ctx: Ctx): NumbersSet {
  // v6 · P11: spend in a currency with no rate is not known — the spend and everything on it is «—»
  const unconverted = !!raw.fxMissing?.length;
  const metaSpend = unconverted ? null : raw.metaSpend;
  // what it really cost: Meta's spend and the card's fee
  const eff = metaSpend === null ? null : metaSpend * (1 + ctx.fx);
  const rate = ctx.deliveryRate;

  const known = raw.offers.filter((o) => o.pieces !== undefined);
  const knownOrders = known.reduce((s, o) => s + o.orders, 0);
  const upsold = known.filter((o) => (o.pieces ?? 0) >= 2).reduce((s, o) => s + o.orders, 0);

  // R-20: with the rejected count unknown (the OMS pull leaves it empty) the rate is NOT 100% — it is not known
  const confirmedAndRejected = raw.confirmed === null || raw.rejected === null ? null : raw.confirmed + raw.rejected;

  // the money of today's shipments: what will be collected, what the goods and the delivery cost, what the ads took
  const expectedRevenue = raw.revenueShipped !== null && rate !== null ? raw.revenueShipped * rate : raw.expectedRevenuePushed;
  const expectedShipping = raw.shippedOrders !== null && ctx.econ ? raw.shippedOrders * ctx.econ.deliveryFee + raw.shippedOrders * (1 - (rate ?? 1)) * ctx.econ.returnFee : null;
  const goods = raw.shippedPieces !== null && ctx.econ ? raw.shippedPieces * (rate ?? 1) * ctx.econ.unitCost : null;
  const expectedProfit = !unconverted && expectedRevenue !== null && expectedShipping !== null && goods !== null ? expectedRevenue - goods - expectedShipping - (eff ?? 0) : null;

  return {
    spend: rnd(eff, r2),
    pixelPurchases: raw.pixelPurchases,
    costPerPixel: rnd(div(eff, raw.pixelPurchases), r2),
    // CPM and CTR are Meta's own delivery measures: Meta's spend, no card fee
    cpm: rnd(div(metaSpend === null ? null : metaSpend * 1000, raw.impressions), r2),
    ctr: rnd(div(raw.linkClicks === null ? null : raw.linkClicks * 100, raw.impressions), r2),
    ordersIn: raw.ordersIn,
    uniqueCustomers: raw.uniqueCustomers,
    duplicates: raw.ordersIn !== null && raw.uniqueCustomers !== null ? Math.max(0, raw.ordersIn - raw.uniqueCustomers) : null,
    gapPct: rnd(div(raw.pixelPurchases === null || raw.ordersIn === null ? null : (raw.pixelPurchases - raw.ordersIn) * 100, raw.ordersIn), r1),
    costPerOrder: rnd(div(eff, raw.ordersIn), r2),
    costPerConfirmed: rnd(div(eff, raw.confirmed), r2),
    costPerDelivered: rnd(div(eff, raw.delivered), r2),
    confirmed: raw.confirmed,
    rejected: raw.rejected,
    cancelled: raw.cancelled,
    waiting: raw.waiting,
    confirmRate: rnd(div(raw.confirmed === null ? null : raw.confirmed * 100, confirmedAndRejected), r1),
    upsellRate: knownOrders > 0 ? r1((upsold * 100) / knownOrders) : null,
    aov: rnd(div(raw.aovRevenue, raw.aovOrders), r2),
    shippedOrders: raw.shippedOrders,
    shippedPieces: raw.shippedPieces,
    outForDelivery: raw.outForDelivery,
    delivered: raw.delivered,
    returned: raw.returned,
    stuck: raw.stuck,
    deliveryRate30: rate === null ? null : r1(rate * 100),
    expectedRevenue: rnd(expectedRevenue, r2),
    expectedShipping: rnd(expectedShipping, r2),
    expectedProfit: rnd(expectedProfit, r2),
    stockUnits: raw.stockUnits,
    stockCover: rnd(div(raw.stockUnits, ctx.piecesPerDay), r1),
  };
}

/**
 * The totals row. Counts and costs come from the summed raw numbers (a ratio is never an average of ratios); the money of
 * the shipments is the sum of each product's own (every product has its own delivery rate and unit cost).
 */
export function totalSet(parts: { raw: Raw; set: NumbersSet; piecesPerDay: number | null }[], fx: number): NumbersSet {
  const all = computeSet(sumRaw(parts.map((p) => p.raw)), { fx, deliveryRate: null, econ: null, piecesPerDay: null });
  const sum = (k: SetKey) => parts.reduce<number | null>((s, p) => add(s, p.set[k]), null);
  const pieces = parts.reduce<number | null>((s, p) => add(s, p.piecesPerDay), null);
  // a part whose money is not known (no rate, or a market with no economics that spent or shipped) leaves the total's profit unknown — never a sum without it
  const holed = parts.some((p) => p.raw.fxMissing?.length || (p.raw.noEconomics && ((p.raw.metaSpend ?? 0) > 0 || (p.raw.shippedOrders ?? 0) > 0)));
  return {
    ...all,
    expectedRevenue: rnd(sum("expectedRevenue"), r2),
    expectedShipping: holed ? null : rnd(sum("expectedShipping"), r2),
    expectedProfit: holed ? null : rnd(sum("expectedProfit"), r2),
    deliveryRate30: null,
    // the days of cover of everything together: all the units over all the pieces shipped a day
    stockCover: pieces && pieces > 0 && all.stockUnits !== null ? r1(all.stockUnits / pieces) : null,
  };
}

// ───────────────────────────── colours and badges ─────────────────────────────

/** The cost of a real order against the owner's rules: green up to the target, amber up to the break-even, red above it. */
export function costTone(cost: number | null, target: number | null, breakeven: number | null): "ok" | "warn" | "danger" | undefined {
  if (cost === null) return undefined;
  if (breakeven !== null && cost > breakeven) return "danger";
  if (target !== null && cost <= target) return "ok";
  return target !== null || breakeven !== null ? "warn" : undefined;
}

export function coverUrgency(days: number | null, t: StockThresholds): Urgency | null {
  return days === null ? null : stockUrgency(days, t);
}

/** The few reasons that explain most of the rejections. */
export const topReasons = (list: Reason[], n = 3): Reason[] => mergeReasons(list).slice(0, n);

// ───────────────────────────── what the screen draws ─────────────────────────────

export type GroupKey = "ads" | "site" | "cost" | "confirm" | "offers" | "shipping" | "money" | "stock";
export const GROUPS: { key: GroupKey; label: string }[] = [
  { key: "ads", label: "الإعلانات" },
  { key: "site", label: "طلبات الموقع" },
  { key: "cost", label: "التكلفة الحقيقية" },
  { key: "confirm", label: "التأكيد" },
  { key: "offers", label: "العروض" },
  { key: "shipping", label: "الشحن" },
  { key: "money", label: "الأموال المتوقعة" },
  { key: "stock", label: "المخزون" },
];

/** `good`: which way is good for the number (for the colour of its arrow when compared). `term`: its entry in the glossary — the «قاعدة الاحتساب». */
export interface StatDef {
  key: SetKey;
  group: GroupKey;
  label: string;
  unit: "$" | "%" | "" | "يوم";
  term: string;
  good: "up" | "down" | "none";
}

export const STATS: StatDef[] = [
  { key: "spend", group: "ads", label: "الصرف", unit: "$", term: "spend", good: "none" },
  { key: "pixelPurchases", group: "ads", label: "Purchase بالبكسل", unit: "", term: "pixelPurchases", good: "none" },
  { key: "costPerPixel", group: "ads", label: "تكلفة Purchase", unit: "$", term: "cpaPixel", good: "down" },
  { key: "cpm", group: "ads", label: "CPM", unit: "$", term: "cpm", good: "down" },
  { key: "ctr", group: "ads", label: "CTR", unit: "%", term: "ctr", good: "up" },
  { key: "ordersIn", group: "site", label: "الطلبات الحقيقية", unit: "", term: "realOrders", good: "up" },
  { key: "uniqueCustomers", group: "site", label: "عملاء فريدين", unit: "", term: "uniqueCustomers", good: "up" },
  { key: "duplicates", group: "site", label: "تكرار انحذف", unit: "", term: "duplicates", good: "none" },
  { key: "gapPct", group: "site", label: "فرق البكسل/الحقيقي", unit: "%", term: "gap", good: "none" },
  { key: "costPerOrder", group: "cost", label: "تكلفة الطلب الحقيقي", unit: "$", term: "costPerOrder", good: "down" },
  { key: "costPerConfirmed", group: "cost", label: "تكلفة المؤكد", unit: "$", term: "costPerConfirmed", good: "down" },
  { key: "costPerDelivered", group: "cost", label: "تكلفة المُسلَّم", unit: "$", term: "costPerDelivered", good: "down" },
  { key: "confirmed", group: "confirm", label: "مؤكد", unit: "", term: "confirmedN", good: "up" },
  { key: "rejected", group: "confirm", label: "مرفوض", unit: "", term: "rejectedN", good: "down" },
  { key: "cancelled", group: "confirm", label: "ملغي", unit: "", term: "cancelledN", good: "down" },
  { key: "waiting", group: "confirm", label: "بالانتظار", unit: "", term: "waitingN", good: "none" },
  { key: "confirmRate", group: "confirm", label: "نسبة التأكيد", unit: "%", term: "confirmRateDay", good: "up" },
  { key: "upsellRate", group: "offers", label: "نسبة الزيادة (Upsell)", unit: "%", term: "upsell", good: "up" },
  { key: "aov", group: "offers", label: "متوسط قيمة الطلب", unit: "$", term: "aov", good: "up" },
  { key: "shippedOrders", group: "shipping", label: "طلبات انشحنت", unit: "", term: "shippedOrders", good: "up" },
  { key: "shippedPieces", group: "shipping", label: "قطع انشحنت", unit: "", term: "shippedPieces", good: "up" },
  { key: "outForDelivery", group: "shipping", label: "خارجة للتوصيل", unit: "", term: "outForDelivery", good: "none" },
  { key: "delivered", group: "shipping", label: "مُسلَّم", unit: "", term: "deliveredN", good: "up" },
  { key: "returned", group: "shipping", label: "مرتجع", unit: "", term: "returnedN", good: "down" },
  { key: "stuck", group: "shipping", label: "عالق أكتر من 7 أيام", unit: "", term: "stuckN", good: "down" },
  { key: "deliveryRate30", group: "money", label: "نسبة التسليم (30 يوم)", unit: "%", term: "deliveryRate30", good: "up" },
  { key: "expectedRevenue", group: "money", label: "الإيراد المتوقع", unit: "$", term: "expectedRevenue", good: "up" },
  { key: "expectedShipping", group: "money", label: "الشحن المتوقع", unit: "$", term: "expectedShipping", good: "none" },
  { key: "expectedProfit", group: "money", label: "الربح المتوقع", unit: "$", term: "expectedProfit", good: "up" },
  { key: "stockUnits", group: "stock", label: "القطع الباقية", unit: "", term: "stockUnits", good: "none" },
  { key: "stockCover", group: "stock", label: "أيام التغطية", unit: "يوم", term: "stockCover", good: "up" },
];

/** The products' cards and the totals. `prev` and `avg7` are the same numbers for the window before and for the 7 days before (scaled to the window's length). */
export interface ProductNumbers {
  code: string;
  /** v6 · P11: the line's own key — the code, or `CODE@MM` for another market of a product seen in two (src/core/markets.ts) */
  key?: string;
  /** the market of this line; null when nobody placed it */
  market?: string | null;
  /** the product is seen in more than one market: its links carry the market */
  split?: boolean;
  name: string;
  current: NumbersSet;
  prev: NumbersSet;
  avg7: NumbersSet;
  rejectReasons: Reason[];
  offers: Offer[];
  breakeven: number | null;
  /** the stock's urgency: 🔴 < 7 days · 🟠 7–10 · 🟡 10–14 */
  stockUrgency: Urgency | null;
  /** false: nothing at all was pushed for this product in the window */
  hasData: boolean;
}

/** The day, said in a few lines for Telegram (the code writes it; nobody types a number). */
export function summaryText(label: string, totals: NumbersSet, products: { name: string; set: NumbersSet }[], stamp?: string): string {
  const n = (v: number | null, unit = "", d = 0) => (v === null ? "—" : `${d ? v.toFixed(d) : Math.round(v)}${unit}`);
  const money = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}$`);
  const line = (name: string, s: NumbersSet) =>
    `${name}: صرف ${money(s.spend)} · طلبات ${n(s.ordersIn)} · تكلفة الطلب ${money(s.costPerOrder)} · مؤكد ${n(s.confirmed)}${s.confirmRate === null ? "" : ` (${n(s.confirmRate, "%")})`} · انشحن ${n(s.shippedOrders)} طلب/${n(s.shippedPieces)} قطعة · مُسلَّم ${n(s.delivered)} · ربح متوقع ${money(s.expectedProfit)}`;
  // P6 (R-23): the line that says whether these figures are «حقيقي» or «تقدير» (`stampOf`) goes under the title when the caller has read it
  return [`📊 أرقام ${label}`, ...(stamp ? [`المصدر: ${stamp}`] : []), line("المجموع", totals), "", ...products.filter((p) => p.set.spend !== null || p.set.ordersIn !== null).map((p) => line(p.name, p.set))].join("\n").slice(0, 3900);
}

/** A number as it is printed: «—» when it is not known, two decimals for money, one for a rate, whole for a count. */
export function formatStat(def: Pick<StatDef, "unit">, v: number | null): string {
  if (v === null) return "—";
  if (def.unit === "$") return `${v.toFixed(2)}$`;
  if (def.unit === "%") return `${v.toFixed(1)}%`;
  if (def.unit === "يوم") return `${v.toFixed(1)} يوم`;
  return String(Math.round(v));
}

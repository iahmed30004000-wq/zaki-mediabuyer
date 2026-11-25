/**
 * «الإعلانات» — the arithmetic of the table (v3 · C), pure: which columns exist, what a row's numbers are made of, the
 * filters, the test-share gauge and the step of an «اقترح زيادة». The code computes; the screen only shows. Nothing here
 * reads a database or a clock.
 *
 * Where a row's numbers come from, in order: what was pushed or synced for THAT object on those days (campaign, ad set or
 * ad level), else the sum of its children's. A day nobody has numbers for is a dash — never a zero that looks like a result.
 * Orders are the OMS rows tied to the object by their ad / ad set / campaign id (so no roll-up is needed for them).
 */
import { mergeMissing } from "./currency";
import { ammanKey, daysBetween } from "./dates";
import { isTestStage } from "./today";

export type Level = "campaign" | "adset" | "ad";
export type Good = "up" | "down" | "none";

// ───────────────────────────── the columns ─────────────────────────────

export type MetricKey = "spend" | "pixel" | "orders" | "costPerOrder" | "confirmRate" | "profit" | "cpm" | "ctr" | "frequency" | "costPerConfirmed" | "cpaPixel" | "hook" | "hold" | "gap";

export const COLUMN_KEYS = [
  "name", "product", "page", "status", "days", "budget", "spendTY", "pixel", "orders", "costPerOrder", "confirmRate", "profit", "cpm", "ctr", "frequency", "adsCount",
  "spend", "costPerConfirmed", "cpaPixel", "hook", "hold", "gap", "verdict",
] as const;
export type ColumnKey = (typeof COLUMN_KEYS)[number];

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  /** the glossary term that explains it («قاعدة الاحتساب»), if it is a number */
  term: string | null;
  unit: "$" | "%" | "x" | "";
  /** which direction is good, for the arrows of «قارن» */
  good: Good;
  /** the metric a numeric column reads (the others come from the row's own fields) */
  metric?: MetricKey;
  /** on by default */
  on: boolean;
}

export const COLUMNS: ColumnDef[] = [
  { key: "name", label: "الاسم", term: null, unit: "", good: "none", on: true },
  { key: "status", label: "الحالة", term: null, unit: "", good: "none", on: true },
  { key: "spend", label: "الصرف", term: "spend", unit: "$", good: "none", metric: "spend", on: true },
  { key: "orders", label: "طلبات حقيقية", term: "realOrders", unit: "", good: "up", metric: "orders", on: true },
  { key: "costPerOrder", label: "تكلفة الطلب", term: "costPerOrder", unit: "$", good: "down", metric: "costPerOrder", on: true },
  { key: "verdict", label: "الحكم", term: null, unit: "", good: "none", on: true },
  // not on by default: «أعمدة أكتر» adds them
  { key: "product", label: "المنتج", term: null, unit: "", good: "none", on: false },
  { key: "page", label: "الصفحة", term: "pageCode", unit: "", good: "none", on: false },
  { key: "days", label: "أيام التشغيل", term: "daysRunning", unit: "", good: "none", on: false },
  { key: "budget", label: "الميزانية / يوم", term: "budgetDaily", unit: "$", good: "none", on: false },
  { key: "spendTY", label: "الصرف اليوم / أمس", term: "spendTY", unit: "$", good: "none", on: false },
  { key: "pixel", label: "Purchase بالبكسل", term: "pixelPurchases", unit: "", good: "up", metric: "pixel", on: false },
  { key: "confirmRate", label: "التأكيد", term: "confirmRate", unit: "%", good: "up", metric: "confirmRate", on: false },
  { key: "profit", label: "الربح التقديري", term: "profitEst", unit: "$", good: "up", metric: "profit", on: false },
  { key: "cpm", label: "CPM", term: "cpm", unit: "$", good: "down", metric: "cpm", on: false },
  { key: "ctr", label: "CTR", term: "ctr", unit: "%", good: "up", metric: "ctr", on: false },
  { key: "frequency", label: "التكرار", term: "frequency", unit: "x", good: "down", metric: "frequency", on: false },
  { key: "adsCount", label: "عدد الإعلانات", term: "adsCount", unit: "", good: "none", on: false },
  { key: "costPerConfirmed", label: "تكلفة المؤكد", term: "costPerConfirmed", unit: "$", good: "down", metric: "costPerConfirmed", on: false },
  { key: "cpaPixel", label: "CPA بكسل", term: "cpaPixel", unit: "$", good: "down", metric: "cpaPixel", on: false },
  { key: "hook", label: "Hook", term: "hook", unit: "%", good: "up", metric: "hook", on: false },
  { key: "hold", label: "Hold", term: "hold", unit: "%", good: "up", metric: "hold", on: false },
  { key: "gap", label: "فرق ميتا/حقيقي", term: "gap", unit: "%", good: "none", metric: "gap", on: false },
];

export const DEFAULT_COLUMNS: ColumnKey[] = COLUMNS.filter((c) => c.on).map((c) => c.key);

/** What a person saved (or what came over the wire) → a safe list: known keys only, no repeats, «الاسم» always first. */
export function sanitizeColumns(v: unknown): ColumnKey[] {
  const known = new Set<string>(COLUMN_KEYS);
  const list = Array.isArray(v) ? v.filter((k): k is ColumnKey => typeof k === "string" && known.has(k)) : [];
  const out = ["name", ...list.filter((k) => k !== "name")].filter((k, i, a) => a.indexOf(k) === i) as ColumnKey[];
  return out.length > 1 ? out : [...DEFAULT_COLUMNS];
}

// ───────────────────────────── the facts: insights and orders ─────────────────────────────

export interface InsightRow {
  level: Level;
  /** Meta id */
  id: string;
  /** business day, Asia/Amman: 2026-11-14 */
  day: string;
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  v3s: number;
  thru: number;
  conversations: number;
  frequency: number;
  /** v6 · P11: set when this row's spend is in a currency with no rate — `spend` is then 0 and means nothing */
  fxMissing?: string;
}

export interface OrderRow {
  adId: string | null;
  adSetId: string | null;
  campaignId: string | null;
  day: string;
  status: string;
  /** when it becomes mature (ms) — the confirmation rate only counts mature orders */
  matureAt: number;
  messaging: boolean;
}

/** The same shape the calculator (`viewOf`) reads. */
export interface CountsLike {
  spend: number;
  impressions: number;
  clicks: number;
  v3s: number;
  thru: number;
  purchases: number;
  conversations?: number;
  orders: number;
  mature: number;
  confirmed: number;
  shipments: number;
  delivered: number;
  returned: number;
  /** v6 · P11: currencies with no rate among the spend behind these counts; non-empty = `spend` is not known */
  fxMissing?: string[];
}

export interface Window {
  from: string;
  to: string;
}

export interface Node {
  id: string;
  level: Level;
  children: Node[];
}

interface Acc {
  spend: number;
  impressions: number;
  clicks: number;
  purchases: number;
  v3s: number;
  thru: number;
  conversations: number;
  /** Σ impressions × frequency, and Σ impressions of the rows that carry a frequency — the weighted mean is their ratio */
  freqSum: number;
  freqImpr: number;
  /** currencies with no rate among the rows added */
  fx: string[];
}

const zero = (): Acc => ({ spend: 0, impressions: 0, clicks: 0, purchases: 0, v3s: 0, thru: 0, conversations: 0, freqSum: 0, freqImpr: 0, fx: [] });
const addInto = (t: Acc, a: Acc) => {
  for (const k of Object.keys(t) as (keyof Acc)[]) if (k !== "fx") t[k] += a[k];
  t.fx = mergeMissing(t.fx, a.fx);
};

const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
const SHIPPED = new Set(["shipped", "delivered", "returned"]);
const childLevel = (l: Level): Level | null => (l === "campaign" ? "adset" : l === "adset" ? "ad" : null);

export interface Counted {
  counts: CountsLike;
  /** impressions-weighted mean frequency (null when no row carries one) */
  frequency: number | null;
  /** Meta's numbers (own or the children's) exist for the window — without them spend, CPM, CTR… are a dash, not a zero */
  hasInsights: boolean;
  /** any insight row or any order behind the numbers */
  has: boolean;
}

/** Indexes the facts once; then any object over any window answers in a few array scans. */
export function indexFacts(roots: Node[], insights: InsightRow[], orders: OrderRow[], nowMs: number) {
  const own = new Map<string, InsightRow[]>();
  for (const r of insights) {
    const k = `${r.level}:${r.id}`;
    const list = own.get(k);
    if (list) list.push(r);
    else own.set(k, [r]);
  }
  const kids = new Map<string, Node[]>();
  const walk = (n: Node) => {
    kids.set(`${n.level}:${n.id}`, n.children);
    n.children.forEach(walk);
  };
  roots.forEach(walk);

  const by: Record<Level, Map<string, OrderRow[]>> = { campaign: new Map(), adset: new Map(), ad: new Map() };
  const put = (m: Map<string, OrderRow[]>, id: string | null, o: OrderRow) => {
    if (!id) return;
    const list = m.get(id);
    if (list) list.push(o);
    else m.set(id, [o]);
  };
  for (const o of orders) {
    put(by.campaign, o.campaignId, o);
    put(by.adset, o.adSetId, o);
    put(by.ad, o.adId, o);
  }

  const inWin = (day: string, w: Window) => day >= w.from && day <= w.to;

  function acc(level: Level, id: string, w: Window): Acc | null {
    const rows = (own.get(`${level}:${id}`) ?? []).filter((r) => inWin(r.day, w));
    if (rows.length) {
      const t = zero();
      for (const r of rows) {
        if (r.fxMissing) t.fx = mergeMissing(t.fx, [r.fxMissing]);
        else t.spend += r.spend;
        t.impressions += r.impressions;
        t.clicks += r.clicks;
        t.purchases += r.purchases;
        t.v3s += r.v3s;
        t.thru += r.thru;
        t.conversations += r.conversations;
        if (r.frequency > 0) {
          t.freqSum += r.impressions * r.frequency;
          t.freqImpr += r.impressions;
        }
      }
      return t;
    }
    // nothing at its own level: what its children carry (an ad set pushed without its ads, a campaign without its ad sets)
    let total: Acc | null = null;
    for (const c of kids.get(`${level}:${id}`) ?? []) {
      const a = acc(c.level, c.id, w);
      if (!a) continue;
      total ??= zero();
      addInto(total, a);
    }
    return total;
  }

  function counted(level: Level, id: string, w: Window): Counted {
    const a = acc(level, id, w);
    const list = (by[level].get(id) ?? []).filter((o) => inWin(o.day, w));
    const mature = list.filter((o) => o.matureAt <= nowMs);
    const messaging = list.some((o) => o.messaging);
    const counts: CountsLike = {
      spend: a?.spend ?? 0,
      impressions: a?.impressions ?? 0,
      clicks: a?.clicks ?? 0,
      v3s: a?.v3s ?? 0,
      thru: a?.thru ?? 0,
      purchases: a?.purchases ?? 0,
      conversations: messaging || (a?.conversations ?? 0) > 0 ? a?.conversations ?? 0 : undefined,
      orders: list.length,
      mature: mature.length,
      confirmed: mature.filter((o) => CONFIRMED.has(o.status)).length,
      shipments: list.filter((o) => SHIPPED.has(o.status)).length,
      delivered: list.filter((o) => o.status === "delivered").length,
      returned: list.filter((o) => o.status === "returned").length,
      ...(a?.fx.length ? { fxMissing: a.fx } : {}),
    };
    return { counts, frequency: a && a.freqImpr > 0 ? Math.round((a.freqSum / a.freqImpr) * 100) / 100 : null, hasInsights: a !== null, has: a !== null || list.length > 0 };
  }

  // a spend with a hole in it is not a spend: null, never the rows that happened to convert
  return {
    counted,
    spendOf: (level: Level, id: string, w: Window): number | null => {
      const a = acc(level, id, w);
      return a && !a.fx.length ? a.spend : null;
    },
  };
}

// ───────────────────────────── a row's metrics ─────────────────────────────

/** The numbers `viewOf` gives for a row (only the ones this table reads). */
export interface ViewLike {
  spend: number | null;
  ctr: number | null;
  hook: number | null;
  hold: number | null;
  cpaPixel: number | null;
  confirmRate: number | null;
  costPerConfirmed: number | null;
  profit: number | null;
  gap: number | null;
}

export type Metrics = Record<MetricKey, number | null>;

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One row's metrics for one window.
 *   الصرف            = صرف ميتا × (1 + رسوم البطاقة) — what left the pocket (it comes in `v.spend`)
 *   تكلفة الطلب      = الصرف ÷ طلبات الـ OMS برقم العنصر (null بلا طلبات)
 *   الربح التقديري   = الطلبات × هامش الطلب المتوقع للمنتج − الصرف (نفس تعريف شاشة «اليوم»؛ null إذا المنتج مجهول)
 *   CPM · CTR        = Meta's own delivery measures: Meta's spend, without the fee
 * What Meta never sent is a dash, not a zero; orders without any Meta number still count (a campaign synced from the OMS only).
 */
export function metricsOf(c: Counted, v: ViewLike, margin: number | null): Metrics {
  const k = c.counts;
  const ins = c.hasInsights;
  // v6 · P11: with spend in a currency that has no rate, nothing that is money (or divides money) is a number
  const money = ins && !k.fxMissing?.length;
  const spend = money ? v.spend : null;
  return {
    spend,
    pixel: ins ? k.purchases : null,
    orders: ins || k.orders > 0 ? k.orders : null,
    costPerOrder: spend !== null && k.orders > 0 ? r2(spend / k.orders) : null,
    confirmRate: k.orders > 0 ? v.confirmRate : null,
    profit: money && margin !== null && spend !== null ? r2(k.orders * margin - spend) : null,
    cpm: money && k.impressions > 0 ? r2((k.spend * 1000) / k.impressions) : null,
    ctr: ins && k.impressions > 0 ? r2((k.clicks * 100) / k.impressions) : null,
    frequency: c.frequency,
    costPerConfirmed: money ? v.costPerConfirmed : null,
    cpaPixel: money ? v.cpaPixel : null,
    hook: ins && v.hook !== null ? r2(v.hook) : null,
    hold: ins && v.hold !== null ? r2(v.hold) : null,
    gap: k.orders > 0 ? v.gap : null,
  };
}

/** Days a thing has been running: the day it started counts as the first. Null when nobody knows when it started. */
export function daysRunning(start: string | Date | null | undefined, today: string): number | null {
  if (!start) return null;
  const d = start instanceof Date ? start : new Date(start);
  if (Number.isNaN(d.getTime())) return null;
  const diff = daysBetween(ammanKey(d), today);
  return diff < 0 ? 0 : diff + 1;
}

/** The earliest of some start times (a campaign that has none of its own is as old as its oldest ad set). */
export function earliest(list: (string | Date | null | undefined)[]): Date | null {
  const times = list.map((s) => (s ? new Date(s) : null)).filter((d): d is Date => !!d && !Number.isNaN(d.getTime()));
  return times.length ? new Date(Math.min(...times.map((d) => d.getTime()))) : null;
}

// ───────────────────────────── filters ─────────────────────────────

export interface Filters {
  product?: string | null;
  page?: string | null;
  kind?: "all" | "test" | "scale" | null;
  /** a row status, or «naming» for the campaigns whose name the parser could not read */
  status?: string | null;
  /** one of the markets (SY · JO · EG · SA · LY · MR) */
  market?: string | null;
}

export interface Filterable<T> {
  level: Level;
  product: { code: string } | null;
  market: string;
  /** an ad set's page code; a campaign's is the codes of its ad sets */
  pages: string[];
  /** a campaign's stage is a test (true), a scale (false) or unreadable (null); its ad sets and ads inherit it */
  isTest: boolean | null;
  status: string;
  needsNaming?: boolean;
  children: T[];
}

export const filtersActive = (f: Filters) => !!(f.product || f.page || f.market || (f.kind && f.kind !== "all") || f.status);

/**
 * Keeps a row when it matches every chosen filter on its own, or when something under it does (so a paused ad inside a
 * running campaign is still reachable by «موقوف»). Under a kept row, children are pruned only by the filters that can differ
 * between levels (status, page); product, market and kind belong to the whole campaign.
 */
export function filterTree<T extends Filterable<T>>(rows: T[], f: Filters): T[] {
  const kind = f.kind ?? "all";
  const own = (r: T) =>
    (!f.product || r.product?.code === f.product) &&
    (!f.market || r.market === f.market) &&
    (!f.page || r.pages.includes(f.page)) &&
    (kind === "all" || (kind === "test" ? r.isTest === true : r.isTest === false)) &&
    (!f.status || (f.status === "naming" ? !!r.needsNaming : r.status === f.status));
  // «needs naming» is a campaign's trait: its ad sets and ads stay under it
  const prune = !!(f.page || (f.status && f.status !== "naming"));
  const go = (r: T): T | null => {
    const kids = r.children.map(go).filter((x): x is T => x !== null);
    if (own(r)) return { ...r, children: prune ? kids : r.children };
    // product / market / kind are decided by the campaign: a child never rescues a campaign that fails them
    if (r.level === "campaign" && ((f.product && r.product?.code !== f.product) || (f.market && r.market !== f.market) || (kind === "test" && r.isTest !== true) || (kind === "scale" && r.isTest !== false))) return null;
    return kids.length ? { ...r, children: kids } : null;
  };
  return rows.map(go).filter((x): x is T => x !== null);
}

// ───────────────────────────── the test-share gauge ─────────────────────────────

export interface Share {
  test: number;
  total: number;
  /** 0..1, null with no spend */
  share: number | null;
  limit: number;
  over: boolean;
}

/** The share of the spend that went into tests (campaigns whose stage is a test). */
export function testShareOf(campaigns: { isTest: boolean | null; spend: number | null }[], limit: number): Share {
  const total = campaigns.reduce((s, c) => s + (c.spend ?? 0), 0);
  const test = campaigns.filter((c) => c.isTest === true).reduce((s, c) => s + (c.spend ?? 0), 0);
  const share = total > 0 ? Math.round((test / total) * 1000) / 1000 : null;
  return { test: r2(test), total: r2(total), share, limit, over: share !== null && share > limit };
}

export const stageIsTest = (stage: string | null | undefined): boolean | null => (stage ? isTestStage(stage) : null);

// ───────────────────────────── «اقترح زيادة» ─────────────────────────────

/** The daily budget one step up (the ladder's step, 20% by default). Null when the object has no budget of its own. */
export function scaleStep(budget: number | null | undefined, stepPct: number): { before: number; after: number; delta: number } | null {
  if (budget === null || budget === undefined || !(budget > 0) || !(stepPct > 0)) return null;
  const after = Math.max(r2(budget * (1 + stepPct)), r2(budget + 0.01));
  return { before: r2(budget), after, delta: r2(after - budget) };
}

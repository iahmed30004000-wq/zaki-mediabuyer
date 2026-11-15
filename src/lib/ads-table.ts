/**
 * «الإعلانات» as the screen reads it (v3 · C): one tree — campaign → ad set → ad — with, for every row, the numbers of the
 * chosen range, the same numbers for the window before (what «قارن» sets beside them), today's and yesterday's spend, the
 * days it has been running and what its name says. The arithmetic is src/core/ads-table.ts (and `viewOf`, the calculator
 * every screen shares); this file gathers: the database (MOCK_MODE=0) or the demo set, run through the very same code.
 *
 * A screen is real or it is demo — never both. In demo the same pipeline runs over made-up days built from the demo counts.
 */
import { addDays, ammanKey, keyMs, parseRange, previousRange, rangeLabel, type Range } from "@/core/dates";
import { daysRunning, earliest, indexFacts, metricsOf, stageIsTest, testShareOf, type InsightRow, type Level, type Metrics, type Node, type OrderRow, type Share } from "@/core/ads-table";
import { MARKET_AR, OBJECTIVE_AR, STAGE_AR, parseAdName, parseAdSetName, parseCampaignName } from "@/core/naming";
import { breakevenOf, readRules } from "@/core/rules-v2";
import { DEMO, targetsOf, viewOf, type Product, type RowStatus, type RowView } from "@/lib/mock/data";
import { statusOf, toProduct } from "@/lib/source";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";

// ───────────────────────────── what a screen row is ─────────────────────────────

/** The item card's view of a row (the side sheet reads it). */
export interface TreeRow {
  id: string;
  level: Level;
  name: string;
  status: RowStatus;
  note?: string;
  product: { code: string; name: string } | null;
  market: string;
  decoded: string[] | null;
  needsNaming?: boolean;
  learning?: { events: number; of: number };
  budget?: number;
  /** this object holds a daily budget of its own, so «اقترح زيادة» has something to raise */
  canScale?: boolean;
  counts?: { impressions: number; clicks: number; orders: number; confirmed: number; delivered: number; conversations: number | null };
  view: RowView;
  tOrder: number | null;
  children: TreeRow[];
}

export interface TableRow extends TreeRow {
  /** an ad set's page code (SP · VP…); a campaign's are its ad sets'; an ad shows its ad set's */
  pages: string[];
  /** the campaign's stage is a test (true), a scale (false) or unreadable (null); children inherit */
  isTest: boolean | null;
  startTime: string | null;
  days: number | null;
  spendToday: number | null;
  spendYesterday: number | null;
  adsCount: number | null;
  /** the range's numbers, and the window before's — for «قارن» */
  m: Metrics;
  prev: Metrics;
  /** the owner's break-even for the row's product (null until he types it) */
  breakeven: number | null;
  /** for an ad: its creative code (the thumbnail) and the rest of what its name says */
  creativeCode: string | null;
  codes: string | null;
  children: TableRow[];
}

export interface AdsTableData {
  demo: boolean;
  range: Range;
  label: string;
  today: string;
  rows: TableRow[];
  products: { code: string; name: string }[];
  pages: string[];
  share: Share;
  /** the owner's target for the cost of a real order (null until he types it) */
  target: number | null;
  stepPct: number;
  rulesMissing: boolean;
}

// ───────────────────────────── where the facts come from ─────────────────────────────

export interface SAd {
  id: string;
  name: string;
  status: RowStatus;
  note?: string;
  start: string | null;
}
export interface SAdSet {
  id: string;
  name: string;
  status: RowStatus;
  pageCode: string | null;
  budget: number | null;
  start: string | null;
  ads: SAd[];
}
export interface SCampaign {
  id: string;
  name: string;
  status: RowStatus;
  market: string;
  productCode: string | null;
  stage: string | null;
  namingOk: boolean;
  budget: number | null;
  start: string | null;
  adsets: SAdSet[];
}

export interface Source {
  demo: boolean;
  products: Product[];
  campaigns: SCampaign[];
  insights: InsightRow[];
  orders: OrderRow[];
}

export interface Ctx {
  /** the card's fee, 0.01 */
  fx: number;
  /** the share of the day's spend tests may take (0.2) */
  testLimit: number;
  stepPct: number;
  target: number | null;
  breakeven: (productCode: string | null) => number | null;
  rulesMissing: boolean;
}

const MS_DAY = 86_400_000;
const r2 = (n: number) => Math.round(n * 100) / 100;
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** The real facts: Meta's archive (InsightDaily, at every level it has) and the OMS orders, over the days the screen needs. */
export async function realSource(range: Range, today: string): Promise<Source> {
  const prevW = previousRange(range);
  const span = [prevW.from, range.from, addDays(today, -6)].sort()[0]!;
  const last = [range.to, today].sort().reverse()[0]!;
  const gte = new Date(keyMs(span));
  const lte = new Date(keyMs(last));

  const [econ, campaigns, insights, orders] = await Promise.all([
    db.productEconomics.findMany(),
    db.campaign.findMany({ include: { account: true, adsets: { include: { ads: true } } } }),
    db.insightDaily.findMany({
      where: { date: { gte, lte }, level: { in: ["campaign", "adset", "ad"] } },
      select: { level: true, objectId: true, date: true, spend: true, impressions: true, linkClicks: true, purchases: true, video3s: true, thruplays: true, conversations: true, frequency: true },
    }),
    db.attributedOrder.findMany({
      where: { createdAtOms: { gte: new Date(keyMs(span) - 3 * 3_600_000), lt: new Date(keyMs(last) + 21 * 3_600_000) }, isFake: false },
      select: { adId: true, adSetId: true, campaignId: true, createdAtOms: true, status: true, matureAt: true, channel: true },
    }),
  ]);

  return {
    demo: false,
    products: econ.map(toProduct),
    campaigns: campaigns.map((c) => ({
      id: c.metaId,
      name: c.name,
      status: statusOf(c.status),
      market: c.account.market ?? "SY",
      productCode: c.productCode,
      stage: c.stage,
      namingOk: c.namingOk,
      budget: c.dailyBudget === null ? null : Number(c.dailyBudget),
      start: c.startTime?.toISOString() ?? null,
      adsets: c.adsets.map((s) => ({
        id: s.metaId,
        name: s.name,
        status: statusOf(s.status, s.learningStage),
        pageCode: s.pageCode,
        budget: s.dailyBudget === null ? null : Number(s.dailyBudget),
        start: s.startTime?.toISOString() ?? null,
        ads: s.ads.map((a) => ({ id: a.metaId, name: a.name, status: statusOf(a.status), start: a.startTime?.toISOString() ?? null })),
      })),
    })),
    insights: insights.map((r) => ({
      level: r.level as Level,
      id: r.objectId,
      day: dayOf(r.date),
      spend: Number(r.spend),
      impressions: r.impressions,
      clicks: r.linkClicks,
      purchases: r.purchases,
      v3s: r.video3s,
      thru: r.thruplays,
      conversations: r.conversations,
      frequency: Number(r.frequency),
    })),
    orders: orders.map((o) => ({ adId: o.adId, adSetId: o.adSetId, campaignId: o.campaignId, day: ammanKey(o.createdAtOms), status: o.status, matureAt: o.matureAt.getTime(), messaging: o.channel !== "website" })),
  };
}

/** A small deterministic number from a string (the demo's frequencies and start dates — the same every time). */
const hash = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/**
 * The demo: the demo counts spread over fourteen made-up days (heavier and lighter days, a frequency that creeps up) and
 * turned into the same kind of rows the database gives — so the screen, its ranges and «قارن» all run the real arithmetic.
 */
export function demoSource(today: string, nowMs: number): Source {
  const weights = [0.9, 1.1, 1, 1.05, 0.95, 1, 1];
  const insights: InsightRow[] = [];
  const orders: OrderRow[] = [];
  const campaigns: SCampaign[] = DEMO.campaigns.map((c, ci) => {
    const account = DEMO.accounts.find((a) => a.id === c.account);
    const parsed = parseCampaignName(c.name);
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      market: account?.market ?? "SY",
      productCode: c.productCode,
      stage: parsed?.stage ?? null,
      namingOk: !c.needsNaming,
      budget: null,
      start: `${addDays(today, -(4 + ci * 3))}T08:00:00+03:00`,
      adsets: c.adsets.map((s) => ({
        id: s.id,
        name: s.name,
        status: s.status,
        pageCode: parseAdSetName(s.name)?.pageCode ?? null,
        budget: s.dailyBudget,
        start: `${addDays(today, -(4 + ci * 3))}T08:00:00+03:00`,
        ads: s.ads.map((a) => {
          const k = a.counts;
          for (let i = 0; i < 14; i++) {
            const w = (weights[i % 7] ?? 1) / 7;
            insights.push({
              level: "ad", id: a.id, day: addDays(today, -i),
              spend: r2(k.spend * w), impressions: Math.round(k.impressions * w), clicks: Math.round(k.clicks * w), purchases: Math.round(k.purchases * w),
              v3s: Math.round(k.v3s * w), thru: Math.round(k.thru * w), conversations: Math.round((k.conversations ?? 0) * w),
              frequency: r2(1.3 + (hash(a.id) % 12) / 10 + i * 0.02),
            });
          }
          // the orders, oldest statuses first, spread over the last seven days
          const rows: string[] = [
            ...Array<string>(k.delivered).fill("delivered"), ...Array<string>(k.returned).fill("returned"),
            ...Array<string>(Math.max(0, k.shipments - k.delivered - k.returned)).fill("shipped"), ...Array<string>(Math.max(0, k.confirmed - k.shipments)).fill("confirmed"),
          ];
          while (rows.length < k.orders) rows.push("new");
          rows.slice(0, k.orders).forEach((status, j) => {
            orders.push({ adId: a.id, adSetId: s.id, campaignId: c.id, day: addDays(today, -(j % 7)), status, matureAt: j < k.mature ? nowMs - MS_DAY : nowMs + 12 * 3_600_000, messaging: k.conversations !== undefined });
          });
          return { id: a.id, name: a.name, status: a.status, note: a.note, start: `${addDays(today, -(3 + (hash(a.id) % 4)))}T08:00:00+03:00` };
        }),
      })),
    };
  });
  return { demo: true, products: DEMO.products, campaigns, insights, orders };
}

// ───────────────────────────── assembling the rows ─────────────────────────────

/** Turns the facts into the screen's rows. No database here — `loadAdsTable` fetches, this computes (and is tested on its own). */
export function assembleTable(src: Source, range: Range, now: Date, ctx: Ctx): AdsTableData {
  const today = ammanKey(now);
  const yesterday = addDays(today, -1);
  const W = { cur: range, prev: previousRange(range), today: { from: today, to: today }, yesterday: { from: yesterday, to: yesterday }, d7: { from: addDays(today, -6), to: today } };
  const products = new Map(src.products.map((p) => [p.code, p]));
  const fee = (n: number | null) => (n === null ? null : r2(n * (1 + ctx.fx)));

  const roots: Node[] = src.campaigns.map((c) => ({ id: c.id, level: "campaign", children: c.adsets.map((s) => ({ id: s.id, level: "adset", children: s.ads.map((a) => ({ id: a.id, level: "ad", children: [] })) })) }));
  const facts = indexFacts(roots, src.insights, src.orders, now.getTime());

  const rows: TableRow[] = src.campaigns.map((c) => {
    const p = c.productCode ? products.get(c.productCode) : undefined;
    const t = p ? targetsOf(p) : null;
    const margin = t?.margin ?? null;
    const parsed = parseCampaignName(c.name);
    const isTest = stageIsTest(c.stage ?? parsed?.stage ?? null);
    const breakeven = ctx.breakeven(c.productCode);
    const product = p ? { code: p.code, name: p.name } : null;

    const measure = (level: Level, id: string) => {
      const cur = facts.counted(level, id, W.cur);
      const view = viewOf(cur.counts, p);
      const before = facts.counted(level, id, W.prev);
      const k = cur.counts;
      return {
        view,
        m: metricsOf(cur, view, margin),
        prev: metricsOf(before, viewOf(before.counts, p), margin),
        spendToday: fee(facts.spendOf(level, id, W.today)),
        spendYesterday: fee(facts.spendOf(level, id, W.yesterday)),
        counts: { impressions: k.impressions, clicks: k.clicks, orders: k.orders, confirmed: k.confirmed, delivered: k.delivered, conversations: k.conversations ?? null },
      };
    };
    const byCost = (a: TableRow, b: TableRow) => (b.m.spend ?? -1) - (a.m.spend ?? -1) || a.name.localeCompare(b.name);

    const adsets: TableRow[] = c.adsets.map((s) => {
      const ps = parseAdSetName(s.name);
      const page = s.pageCode ?? ps?.pageCode ?? null;
      const ads: TableRow[] = s.ads.map((a) => {
        const pa = parseAdName(a.name);
        const x = measure("ad", a.id);
        return {
          id: a.id, level: "ad", name: a.name, status: a.status, note: a.note, product, market: c.market,
          decoded: pa ? [`فيديو ${pa.creativeCode}`, `خطّاف ${pa.hookCode}`, `زاوية ${pa.angleCode}`, `صفحة هبوط ${pa.lpCode}`] : null,
          counts: x.counts, view: x.view, tOrder: t?.tOrder ?? null,
          pages: page ? [page] : [], isTest, startTime: a.start ?? s.start ?? c.start, days: daysRunning(a.start ?? s.start ?? c.start, today),
          spendToday: x.spendToday, spendYesterday: x.spendYesterday, adsCount: null, m: x.m, prev: x.prev, breakeven,
          creativeCode: pa?.creativeCode ?? null, codes: pa ? `${pa.hookCode} · ${pa.angleCode} · ${pa.lpCode}` : null, children: [],
        };
      });
      const x = measure("adset", s.id);
      const events = facts.counted("adset", s.id, W.d7).counts.purchases;
      return {
        id: s.id, level: "adset", name: s.name, status: s.status, product, market: c.market,
        decoded: ps ? [ps.audience === "BROAD" ? "جمهور واسع" : ps.audience, `صفحة ${ps.pageCode}`, `مفهوم ${ps.conceptId}`] : null,
        learning: { events, of: 50 }, budget: s.budget ?? undefined, canScale: s.budget !== null && s.budget > 0,
        counts: x.counts, view: x.view, tOrder: t?.tOrder ?? null,
        pages: page ? [page] : [], isTest, startTime: s.start ?? c.start, days: daysRunning(s.start ?? earliest(s.ads.map((a) => a.start)) ?? c.start, today),
        spendToday: x.spendToday, spendYesterday: x.spendYesterday, adsCount: s.ads.length, m: x.m, prev: x.prev, breakeven,
        creativeCode: null, codes: null, children: ads.sort(byCost),
      };
    });

    const x = measure("campaign", c.id);
    const sumBudgets = c.adsets.reduce((n, s) => n + (s.budget ?? 0), 0);
    const budget = c.budget ?? (sumBudgets > 0 ? sumBudgets : null);
    return {
      id: c.id, level: "campaign", name: c.name, status: c.status, product, market: c.market,
      decoded: parsed ? [MARKET_AR[parsed.market], p?.name ?? parsed.productCode, OBJECTIVE_AR[parsed.objective], STAGE_AR[parsed.stage]] : null,
      needsNaming: !c.namingOk, budget: budget ?? undefined, canScale: c.budget !== null && c.budget > 0,
      counts: x.counts, view: x.view, tOrder: t?.tOrder ?? null,
      pages: [...new Set(c.adsets.map((s) => s.pageCode ?? parseAdSetName(s.name)?.pageCode ?? null).filter((v): v is string => !!v))],
      isTest, startTime: c.start, days: daysRunning(c.start ?? earliest([...c.adsets.map((s) => s.start), ...c.adsets.flatMap((s) => s.ads.map((a) => a.start))]), today),
      spendToday: x.spendToday, spendYesterday: x.spendYesterday, adsCount: c.adsets.reduce((n, s) => n + s.ads.length, 0), m: x.m, prev: x.prev, breakeven,
      creativeCode: null, codes: null, children: adsets.sort(byCost),
    };
  });
  rows.sort((a, b) => (b.m.spend ?? -1) - (a.m.spend ?? -1) || a.name.localeCompare(b.name));

  const seen = new Map<string, string>();
  for (const r of rows) if (r.product) seen.set(r.product.code, r.product.name);
  return {
    demo: src.demo,
    range,
    label: rangeLabel(range),
    today,
    rows,
    products: [...seen].map(([code, name]) => ({ code, name })),
    pages: [...new Set(rows.flatMap((r) => r.pages))].sort(),
    share: testShareOf(rows.map((r) => ({ isTest: r.isTest, spend: r.m.spend })), ctx.testLimit),
    target: ctx.target,
    stepPct: ctx.stepPct,
    rulesMissing: ctx.rulesMissing,
  };
}

export async function loadAdsTable(q: { d?: string | null; from?: string | null; to?: string | null }, now = new Date()): Promise<AdsTableData> {
  const range = parseRange(q, now);
  const today = ammanKey(now);
  const rules = readRules(await getSetting("campaign.rules"));
  const [fx, split, stepPct] = await Promise.all([getSetting("economics.fx_fee"), getSetting("budget.split"), getSetting("scale.step_pct")]);
  const demo = process.env.MOCK_MODE === "1";
  const src = demo ? demoSource(today, now.getTime()) : await realSource(range, today);
  return assembleTable(src, range, now, {
    fx: Number(fx),
    testLimit: split.test,
    stepPct: Number(stepPct),
    target: demo ? 3 : rules.targetCost,
    breakeven: (code) => (demo ? (code === "TRF01" ? 4.5 : code === "TIN01" ? 6 : null) : breakevenOf(rules, code)),
    rulesMissing: !demo && (rules.targetCost === null || !Object.keys(rules.breakeven).length),
  });
}

/**
 * «الأرقام» as the screen reads it (v4.1): for a date range, every product's numbers and the totals — and the same numbers
 * for the window before and for the 7 days before (the two things «قارن» compares with). All of it from the database
 * (MOCK_MODE=0): the days Claude pushed for each product (ProductDay), the ads' numbers (the day's own, or the campaigns'
 * archive), the product's economics and the owner's rules. The arithmetic is src/core/numbers.ts — this file only gathers.
 *
 * Where a number comes from, in order: what was pushed for the product-day; else what the OMS orders / Meta's archive say;
 * else nothing (null, a dash). A screen is real or it is demo — never both.
 *
 * v6 · P11: every line is a product IN A MARKET (a product seen in two markets is two lines, src/core/markets.ts), and Meta's spend is turned into dollars at
 * the owner's rates before it is added; spend with no rate leaves the line's spend unknown and names the currency. A pushed day carries no market: for a
 * product in two markets it is placed only when nothing else tells that day, and then on the «unknown market» line — never added on top of one market.
 */
import { mergeMissing, normalizeCurrency, rowCurrency, toUsd } from "@/core/currency";
import { campaignMarket, isMarket, marketName, productMarkets, splitKey } from "@/core/markets";
import { addDays, baselineWindow, eachDay, keyMs, ammanKey, parseRange, previousRange, rangeLabel, type Range } from "@/core/dates";
import { computeSet, coverUrgency, emptyRaw, scaleFlows, sumRaw, topReasons, totalSet, type Ctx, type NumbersSet, type Offer, type ProductNumbers, type Raw, type Reason } from "@/core/numbers";
import { matureThrough, METRIC_KEYS, seriesOf, valueOf, type MetricKey } from "@/core/compare";
import { nameOf, productLabels } from "@/core/product-name";
import { breakevenOf, readRules, type CampaignRules } from "@/core/rules-v2";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { forViewer } from "@/server/redact";
import { loadRates } from "@/server/money";

const LEVELS = ["ad", "adset", "campaign"] as const;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const add = (a: number | null, b: number | null) => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export interface NumbersData {
  demo: boolean;
  range: Range;
  label: string;
  totals: { current: NumbersSet; prev: NumbersSet; avg7: NumbersSet };
  products: ProductNumbers[];
  /** the owner's target for the cost of a real order (null until he types it) */
  target: number | null;
  stockLevels: { redDays: number; orangeDays: number; yellowDays: number };
  /** the rules he has not filled in that this screen colours with */
  rulesMissing: boolean;
  /** v6 · P11: the market the screen is filtered to; null: every market */
  market: string | null;
  /** currencies in these windows with no exchange rate (spend, or delivered orders) */
  missingRates: string[];
  /** products in two markets whose pushed days could not be placed in one (so they are not counted) */
  unplacedPushed: string[];
}

interface Ads {
  spend: number | null;
  impressions: number | null;
  clicks: number | null;
  purchases: number | null;
}

/** A product-day of the database as plain numbers. */
interface PD {
  ads: Ads | null;
  ordersIn: number | null;
  uniqueCustomers: number | null;
  confirmed: number | null;
  rejected: number | null;
  cancelled: number | null;
  waiting: number | null;
  rejectReasons: Reason[];
  offers: Offer[];
  aov: number | null;
  shippedOrders: number | null;
  shippedPieces: number | null;
  outForDelivery: number | null;
  stuck: number | null;
  delivered: number | null;
  returned: number | null;
  revenueShipped: number | null;
  expectedRevenue: number | null;
  stockUnits: number | null;
}

/**
 * EVERYTHING THE NUMBERS OF A STRETCH OF DAYS STAND ON, read ONCE: the product-days Claude pushed, Meta's archive, the OMS's orders and the stock — in one round of queries, whatever the number of
 * windows or days asked of it. `rawOf` sums a product over a window; `ctxOf` is the product's context as it stood on a day (its delivery rate over the 30 days before it, its pieces a day).
 * The arithmetic is src/core/numbers.ts: nothing here computes a number, it only gathers and sums.
 */
async function gather(spanFrom: string, to: string) {
  const rules = readRules(await getSetting("campaign.rules"));
  const fx = Number(await getSetting("economics.fx_fee"));
  const gte = new Date(keyMs(spanFrom));
  const lte = new Date(keyMs(to));

  const rates = await loadRates();
  const [pdRows, spendRows, orderRows, econRows, campaigns, adsets, ads, snaps, aliasRows, everyMarket] = await Promise.all([
    db.productDay.findMany({ where: { date: { gte, lte } } }),
    db.insightDaily.groupBy({ by: ["level", "date", "objectId", "currency", "source"], where: { date: { gte, lte } }, _sum: { spend: true, impressions: true, linkClicks: true, purchases: true } }),
    db.attributedOrder.findMany({ where: { createdAtOms: { gte: new Date(keyMs(spanFrom) - 3 * 3_600_000), lt: new Date(keyMs(to) + 21 * 3_600_000) }, isFake: false }, select: { createdAtOms: true, productCode: true, status: true, market: true, currency: true } }),
    db.productEconomics.findMany(),
    db.campaign.findMany({ select: { metaId: true, productCode: true, parsedMarket: true, account: { select: { market: true, currency: true } } } }),
    db.adSet.findMany({ select: { metaId: true, campaign: { select: { metaId: true } } } }),
    db.ad.findMany({ select: { metaId: true, adSet: { select: { campaign: { select: { metaId: true } } } } } }),
    db.stockSnapshot.findMany({ orderBy: { at: "desc" }, take: 400 }),
    db.productAlias.findMany({ select: { productCode: true, alias: true } }),
    db.attributedOrder.groupBy({ by: ["productCode", "market"], where: { isFake: false }, _count: { _all: true } }),
  ]);
  // v6 · P11: the markets each product was seen in — all its campaigns and all its orders, the same answer the truth and the ads get
  const markets = productMarkets(
    [...campaigns.map((c) => ({ code: c.productCode, market: campaignMarket(c.parsedMarket, c.account?.market) })), ...everyMarket.map((o) => ({ code: o.productCode, market: o.market }))],
    new Map(econRows.map((e) => [e.productCode, e.market])),
  );
  // U-08: the name a screen writes is Arabic (the OMS name, else an Arabic alias); the code stays beside it
  const labels = productLabels(econRows, aliasRows);
  /** `code|day` for which one market or another has Meta's numbers or the OMS's orders */
  const placed = new Set<string>();

  // ── Meta's archive, per line (a product in a market) and day (the finest level that day has) ──
  const campaignOf = new Map<string, string>(campaigns.map((c) => [c.metaId, c.metaId]));
  for (const s of adsets) campaignOf.set(s.metaId, s.campaign.metaId);
  for (const a of ads) campaignOf.set(a.metaId, a.adSet.campaign.metaId);
  const campaignInfo = new Map(campaigns.map((c) => [c.metaId, { code: c.productCode, market: campaignMarket(c.parsedMarket, c.account?.market), currency: c.account?.currency }]));
  const archive = new Map<string, Ads>();
  /** `line|day` → currencies of that day's spend with no rate */
  const spendFx = new Map<string, string[]>();
  const byDay = new Map<string, typeof spendRows>();
  for (const r of spendRows) byDay.set(dayOf(r.date), [...(byDay.get(dayOf(r.date)) ?? []), r]);
  for (const [day, list] of byDay) {
    const detail = LEVELS.map((l) => list.filter((r) => r.level === l)).find((l) => l.length) ?? [];
    for (const r of detail) {
      const info = campaignInfo.get(campaignOf.get(r.objectId) ?? "");
      if (!info?.code) continue;
      placed.add(`${info.code}|${day}`);
      const k = `${markets.keyOf(info.code, info.market)}|${day}`;
      const cur = archive.get(k) ?? { spend: null, impressions: null, clicks: null, purchases: null };
      const dollars = r._sum.spend === null ? null : toUsd(String(r._sum.spend), rowCurrency(r, info.currency), rates);
      if (dollars && dollars.usd === null) spendFx.set(k, mergeMissing(spendFx.get(k), [dollars.missing!]));
      archive.set(k, { spend: add(cur.spend, dollars?.usd?.toNumber() ?? null), impressions: add(cur.impressions, r._sum.impressions), clicks: add(cur.clicks, r._sum.linkClicks), purchases: add(cur.purchases, r._sum.purchases) });
    }
  }

  // ── the OMS's orders, when nothing was pushed for that product-day ──
  const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
  const omsDay = new Map<string, { orders: number; confirmed: number; delivered: number; returned: number }>();
  /** `line|day` → currencies of that day's delivered orders with no rate (the truth and the profit cannot stand on them) */
  const orderFx = new Map<string, string[]>();
  for (const o of orderRows) {
    const day = ammanKey(o.createdAtOms);
    placed.add(`${o.productCode}|${day}`);
    const k = `${markets.keyOf(o.productCode, o.market)}|${day}`;
    const currency = normalizeCurrency(o.currency);
    if (o.status === "delivered" && o.currency && !(currency && rates.has(currency))) orderFx.set(k, mergeMissing(orderFx.get(k), [currency ?? o.currency]));
    const cur = omsDay.get(k) ?? { orders: 0, confirmed: 0, delivered: 0, returned: 0 };
    cur.orders++;
    if (CONFIRMED.has(o.status)) cur.confirmed++;
    if (o.status === "delivered") cur.delivered++;
    if (o.status === "returned") cur.returned++;
    omsDay.set(k, cur);
  }

  // ── the product-days Claude pushed ──
  const pd = new Map<string, PD>();
  const unplaced = new Set<string>();
  for (const r of pdRows) {
    const day = dayOf(r.date);
    // a pushed day carries no market: a product in two markets takes it only when nothing else tells that day, on the unknown-market line
    if (markets.isSplit(r.productCode) && placed.has(`${r.productCode}|${day}`)) {
      unplaced.add(r.productCode);
      continue;
    }
    pd.set(`${markets.keyOf(r.productCode, null)}|${day}`, {
      ads: r.spend === null && r.impressions === null && r.linkClicks === null && r.pixelPurchases === null ? null : { spend: num(r.spend), impressions: r.impressions, clicks: r.linkClicks, purchases: r.pixelPurchases },
      ordersIn: r.ordersIn, uniqueCustomers: r.uniqueCustomers, confirmed: r.confirmed, rejected: r.rejected, cancelled: r.cancelled, waiting: r.waiting,
      rejectReasons: (r.rejectReasons as Reason[] | null) ?? [], offers: (r.offerBreakdown as Offer[] | null) ?? [], aov: num(r.aov),
      shippedOrders: r.shippedOrders, shippedPieces: r.shippedPieces, outForDelivery: r.outForDelivery, stuck: r.stuck, delivered: r.delivered, returned: r.returned,
      revenueShipped: num(r.revenueShipped), expectedRevenue: num(r.expectedRevenue), stockUnits: r.stockUnits,
    });
  }

  const econ = new Map(econRows.map((e) => [e.productCode, e]));
  const keys = new Set<string>([...pd.keys(), ...archive.keys(), ...omsDay.keys()].map((k) => k.split("|")[0]!));

  /** The currencies with no rate among one line's spend, delivered orders and product prices in a window. */
  const missingIn = (key: string, w: { from: string; to: string }) =>
    mergeMissing(econ.get(splitKey(key).code)?.moneyMissing, ...eachDay(w.from, w.to).flatMap((d) => [pd.get(`${key}|${d}`)?.ads ? undefined : spendFx.get(`${key}|${d}`), orderFx.get(`${key}|${d}`)]));

  /** One line over one window: the flows summed, the states as they stood on its latest day. */
  function rawOf(code: string, w: { from: string; to: string }): Raw {
    const out = emptyRaw();
    const reasons: Reason[] = [];
    const offers: Offer[] = [];
    let aovRev = 0;
    let aovOrders = 0;
    for (const d of eachDay(w.from, w.to)) {
      const row = pd.get(`${code}|${d}`);
      if (!row?.ads) out.fxMissing = mergeMissing(out.fxMissing, spendFx.get(`${code}|${d}`));
      const ads = row?.ads ?? archive.get(`${code}|${d}`) ?? null;
      const oms = omsDay.get(`${code}|${d}`);
      if (ads) {
        out.metaSpend = add(out.metaSpend, ads.spend);
        out.impressions = add(out.impressions, ads.impressions);
        out.linkClicks = add(out.linkClicks, ads.clicks);
        out.pixelPurchases = add(out.pixelPurchases, ads.purchases);
      }
      const ordersIn = row?.ordersIn ?? oms?.orders ?? null;
      out.ordersIn = add(out.ordersIn, ordersIn);
      out.uniqueCustomers = add(out.uniqueCustomers, row?.uniqueCustomers ?? null);
      out.confirmed = add(out.confirmed, row?.confirmed ?? oms?.confirmed ?? null);
      out.rejected = add(out.rejected, row?.rejected ?? null);
      out.cancelled = add(out.cancelled, row?.cancelled ?? null);
      out.shippedOrders = add(out.shippedOrders, row?.shippedOrders ?? null);
      out.shippedPieces = add(out.shippedPieces, row?.shippedPieces ?? null);
      out.delivered = add(out.delivered, row?.delivered ?? oms?.delivered ?? null);
      out.returned = add(out.returned, row?.returned ?? oms?.returned ?? null);
      out.revenueShipped = add(out.revenueShipped, row?.revenueShipped ?? null);
      out.expectedRevenuePushed = add(out.expectedRevenuePushed, row?.expectedRevenue ?? null);
      reasons.push(...(row?.rejectReasons ?? []));
      offers.push(...(row?.offers ?? []));
      if (row?.aov != null && ordersIn) {
        aovRev += row.aov * ordersIn;
        aovOrders += ordersIn;
      } else if (row?.offers.length && row.offers.every((o) => o.revenue !== undefined)) {
        aovRev += row.offers.reduce((s, o) => s + (o.revenue ?? 0), 0);
        aovOrders += row.offers.reduce((s, o) => s + o.orders, 0);
      }
      // states: the newest reading wins (the days are walked in order)
      if (row?.waiting != null) out.waiting = row.waiting;
      if (row?.outForDelivery != null) out.outForDelivery = row.outForDelivery;
      if (row?.stuck != null) out.stuck = row.stuck;
      if (row?.stockUnits != null) out.stockUnits = row.stockUnits;
    }
    out.aovRevenue = aovOrders ? aovRev : null;
    out.aovOrders = aovOrders || null;
    out.rejectReasons = reasons;
    out.offers = offers;
    out.noEconomics = !markets.isHome(splitKey(code).code, markets.marketOfKey(code)) || !!econ.get(splitKey(code).code)?.moneyMissing;
    return sumRaw([out]);
  }

  const ctxOf = (code: string, upTo: string): { ctx: Ctx; cover: number | null } => {
    let delivered = 0;
    let returned = 0;
    for (const d of eachDay(addDays(upTo, -29), upTo)) {
      const row = pd.get(`${code}|${d}`);
      delivered += row?.delivered ?? 0;
      returned += row?.returned ?? 0;
    }
    let pieces = 0;
    let anyPieces = false;
    for (const d of eachDay(addDays(upTo, -6), upTo)) {
      const v = pd.get(`${code}|${d}`)?.shippedPieces;
      if (v != null) {
        pieces += v;
        anyPieces = true;
      }
    }
    const product = splitKey(code).code;
    // the economics and the stock belong to the product's home market, never to another one — and prices with no rate are not read
    const e = markets.isHome(product, markets.marketOfKey(code)) && !econ.get(product)?.moneyMissing ? econ.get(product) : undefined;
    const snap = markets.keyOf(product, markets.homeOf(product)) === code ? snaps.find((s) => s.productCode === product) : undefined;
    return {
      ctx: { fx, deliveryRate: delivered + returned > 0 ? delivered / (delivered + returned) : null, econ: e ? { unitCost: Number(e.unitCost), deliveryFee: Number(e.deliveryFee), returnFee: Number(e.returnFee) } : null, piecesPerDay: anyPieces ? pieces / 7 : null },
      cover: snap ? Number(snap.daysCover) : null,
    };
  };

  return { rules, fx, econ, labels, keys, markets, unplaced, missingIn, rawOf, ctxOf };
}

export interface NumbersQuery {
  d?: string | null;
  from?: string | null;
  to?: string | null;
  /** one market (SY · JO · …); anything else is every market */
  market?: string | null;
}

async function loadNumbersRaw(q: NumbersQuery, now = new Date()): Promise<NumbersData> {
  const range = parseRange(q, now);
  const market = isMarket(q.market) ? q.market : null;
  if (process.env.MOCK_MODE === "1") return demoNumbers(range, market);

  const prevW = previousRange(range);
  const baseW = baselineWindow(range);
  const spanFrom = [prevW.from, baseW.from, addDays(range.to, -29)].sort()[0]!;
  const { rules, fx, labels, keys, markets, unplaced, missingIn, rawOf, ctxOf } = await gather(spanFrom, range.to);

  const factor = range.days / baseW.days;
  const parts = [...keys].filter((k) => !market || markets.marketOfKey(k) === market).map((code) => {
    const { ctx, cover } = ctxOf(code, range.to);
    const cur = rawOf(code, range);
    const prev = rawOf(code, prevW);
    const avg = scaleFlows(rawOf(code, baseW), factor);
    const set = computeSet(cur, ctx);
    // the stock's days of cover: from the pieces shipped a day, else the reading somebody pushed
    if (set.stockCover === null && cover !== null) set.stockCover = cover;
    const has = [cur, prev, avg].some((r) => r.metaSpend !== null || !!r.fxMissing?.length || r.ordersIn !== null || r.shippedOrders !== null);
    return { code, ctx, cur, prev, avg, set, setPrev: computeSet(prev, ctx), setAvg: computeSet(avg, ctx), has };
  });

  const shown = parts.filter((p) => p.has).sort((a, b) => (b.set.spend ?? 0) - (a.set.spend ?? 0) || (b.set.ordersIn ?? 0) - (a.set.ordersIn ?? 0));
  const products: ProductNumbers[] = shown.map((p) => ({
    code: splitKey(p.code).code,
    key: p.code,
    market: markets.marketOfKey(p.code),
    split: markets.isSplit(splitKey(p.code).code),
    name: marketName(nameOf(labels, splitKey(p.code).code), p.code, markets),
    current: p.set,
    prev: p.setPrev,
    avg7: p.setAvg,
    rejectReasons: topReasons(p.cur.rejectReasons, 3),
    offers: p.cur.offers,
    breakeven: breakevenOf(rules, splitKey(p.code).code),
    stockUrgency: coverUrgency(p.set.stockCover, rules.stock),
    hasData: p.cur.metaSpend !== null || !!p.cur.fxMissing?.length || p.cur.ordersIn !== null || p.cur.shippedOrders !== null,
  }));
  const whole = (pick: "cur" | "prev" | "avg", setOf: "set" | "setPrev" | "setAvg") => totalSet(shown.map((p) => ({ raw: p[pick], set: p[setOf], piecesPerDay: p.ctx.piecesPerDay })), fx);
  return {
    demo: false,
    range,
    label: rangeLabel(range),
    totals: { current: whole("cur", "set"), prev: whole("prev", "setPrev"), avg7: whole("avg", "setAvg") },
    products,
    target: rules.targetCost,
    stockLevels: rules.stock,
    rulesMissing: rules.targetCost === null || !Object.keys(rules.breakeven).length,
    market,
    missingRates: mergeMissing(...parts.flatMap((p) => [p.cur.fxMissing, p.prev.fxMissing, missingIn(p.code, range), missingIn(p.code, prevW)])),
    unplacedPushed: [...unplaced].map((code) => nameOf(labels, code)),
  };
}

// ───────────────────────────── the line, day by day (P6) ─────────────────────────────

/** How many days the lines of the tiles and the big chart cover. */
export const SERIES_DAYS = 30;

/**
 * The day-by-day line of several metrics at once (docs/rebuild-v6/04-numbers.md §4): `days` values for each, the oldest first, the last one YESTERDAY — an unfinished day is never drawn. One read of the
 * tables for all of it (`gather` runs once for the whole stretch and the 30 days each day's delivery rate looks back over), then `computeSet` per day over those same rows: it is never 30 queries.
 * A day with no number is null (a gap in the line), never a zero. With `product`, the line of that product alone; without, of all of them together.
 */
export async function loadSeriesMany(keys: readonly MetricKey[], opts: { days?: number; /** a line's key: the code, or `CODE@MM` */ product?: string; market?: string | null; now?: Date } = {}): Promise<Record<MetricKey, (number | null)[]>> {
  const now = opts.now ?? new Date();
  const days = opts.days ?? SERIES_DAYS;
  const to = addDays(ammanKey(now), -1);
  const out = Object.fromEntries(METRIC_KEYS.map((k) => [k, [] as (number | null)[]])) as Record<MetricKey, (number | null)[]>;
  if (process.env.MOCK_MODE === "1") {
    for (const k of keys) out[k] = demoSeries(k, to, days, now);
    return forViewer(out);
  }
  const first = addDays(to, -(days - 1));
  const g = await gather(addDays(first, -29), to);
  const market = isMarket(opts.market) ? opts.market : null;
  const codes = [...g.keys].filter((c) => (!opts.product || c === opts.product) && (!market || g.markets.marketOfKey(c) === market));
  const sets = new Map<string, NumbersSet | null>();
  for (const day of eachDay(first, to)) {
    const parts = codes
      .map((code) => {
        const { ctx } = g.ctxOf(code, day);
        const raw = g.rawOf(code, { from: day, to: day });
        const has = raw.metaSpend !== null || !!raw.fxMissing?.length || raw.ordersIn !== null || raw.shippedOrders !== null;
        return { raw, ctx, has };
      })
      .filter((p) => p.has)
      .map((p) => ({ raw: p.raw, set: computeSet(p.raw, p.ctx), piecesPerDay: p.ctx.piecesPerDay }));
    sets.set(day, parts.length === 0 ? null : opts.product ? parts[0]!.set : totalSet(parts, g.fx));
  }
  for (const k of keys) out[k] = seriesOf(k, to, days, (d) => sets.get(d) ?? null, now);
  return forViewer(out);
}

/** The line of one metric: `days` values, the oldest first. */
export async function loadSeries(key: MetricKey, days = SERIES_DAYS, product?: string, now?: Date, market?: string | null): Promise<(number | null)[]> {
  return (await loadSeriesMany([key], { days, ...(product ? { product } : {}), ...(now ? { now } : {}), ...(market ? { market } : {}) }))[key];
}

/** The demo's line: the demo's own figure with a gentle wobble, so a demo screen has a line to draw. Real sites never reach this. */
function demoSeries(key: MetricKey, to: string, days: number, now: Date): (number | null)[] {
  const base = valueOf(key, demoNumbers({ key: "custom", from: to, to, days: 1 }, null).totals.current, 1);
  const list = eachDay(addDays(to, -(days - 1)), to);
  if (base === null) return list.map(() => null);
  return list.map((d, i) => {
    const wobble = 1 + 0.12 * Math.sin(i / 2.3) + 0.05 * Math.cos(i * 1.7);
    return key === "costPerConfirmed" && d > matureThrough(now) ? null : Math.round(base * wobble * 100) / 100;
  });
}

// ───────────────────────────── the demo: the same arithmetic over made-up counts ─────────────────────────────

function demoNumbers(range: Range, market: string | null): NumbersData {
  const rules: CampaignRules = readRules({ targetCost: 3, breakeven: { TRF01: 4.5, TIN01: 6 } });
  const fx = 0.01;
  const mk = (scale: number, x: Partial<Raw>): Raw => scaleFlows({ ...emptyRaw(), ...x }, scale);
  const all = [
    { code: "TRF01", name: "ماء الكمأة", ctx: { fx, deliveryRate: 0.78, econ: { unitCost: 2.2, deliveryFee: 2.5, returnFee: 0 }, piecesPerDay: 30 } as Ctx, raw: { metaSpend: 118, impressions: 26_000, linkClicks: 520, pixelPurchases: 44, ordersIn: 38, uniqueCustomers: 36, confirmed: 27, rejected: 5, cancelled: 2, waiting: 6, shippedOrders: 24, shippedPieces: 33, delivered: 11, returned: 2, outForDelivery: 15, stuck: 1, revenueShipped: 520, aovRevenue: 912, aovOrders: 38, stockUnits: 540, offers: [{ offer: "قطعة", orders: 26, pieces: 1 }, { offer: "2 + هدية", orders: 12, pieces: 3, revenue: 330 }], rejectReasons: [{ reason: "رقم غلط", count: 3 }, { reason: "غيّر رأيه", count: 2 }] } as Partial<Raw> },
    { code: "TIN01", name: "قطرة طنين الأذن", ctx: { fx, deliveryRate: 0.7, econ: { unitCost: 2.6, deliveryFee: 2.5, returnFee: 1 }, piecesPerDay: 14 } as Ctx, raw: { metaSpend: 64, impressions: 15_000, linkClicks: 270, pixelPurchases: 19, ordersIn: 11, uniqueCustomers: 11, confirmed: 7, rejected: 3, cancelled: 0, waiting: 1, shippedOrders: 9, shippedPieces: 10, delivered: 4, returned: 2, outForDelivery: 5, stuck: 0, revenueShipped: 160, aovRevenue: 198, aovOrders: 11, stockUnits: 60, offers: [{ offer: "قطعة", orders: 11, pieces: 1 }], rejectReasons: [{ reason: "سعر", count: 2 }] } as Partial<Raw> },
  ];
  // the demo's two products sell in Syria
  const demo = !market || market === "SY" ? all : [];
  const sets = (scale: number) => demo.map((p) => ({ raw: mk(scale, p.raw), set: computeSet(mk(scale, p.raw), p.ctx), piecesPerDay: p.ctx.piecesPerDay }));
  // the flows of a longer range are that many days' worth (the states — waiting, stock — stay as they are)
  const [cur, prev, avg] = [sets(range.days), sets(1.06 * range.days), sets(0.97 * range.days)];
  const products: ProductNumbers[] = demo.map((p, i) => ({
    code: p.code, key: p.code, market: "SY", name: p.name, current: cur[i]!.set, prev: prev[i]!.set, avg7: avg[i]!.set, rejectReasons: topReasons(cur[i]!.raw.rejectReasons, 3), offers: cur[i]!.raw.offers,
    breakeven: breakevenOf(rules, p.code), stockUrgency: coverUrgency(cur[i]!.set.stockCover, rules.stock), hasData: true,
  }));
  return { demo: true, range, label: rangeLabel(range), totals: { current: totalSet(cur, fx), prev: totalSet(prev, fx), avg7: totalSet(avg, fx) }, products, target: 3, stockLevels: rules.stock, rulesMissing: false, market, missingRates: [], unplacedPushed: [] };
}

/** loadNumbers for a screen: without `money.view` no profit, margin, product cost or break-even leaves the server (docs/rebuild/05-permissions.md §3). */
export const loadNumbers = async (...a: Parameters<typeof loadNumbersRaw>) => forViewer(await loadNumbersRaw(...a));

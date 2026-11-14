/**
 * «الأرقام» as the screen reads it (v4.1): for a date range, every product's numbers and the totals — and the same numbers
 * for the window before and for the 7 days before (the two things «قارن» compares with). All of it from the database
 * (MOCK_MODE=0): the days Claude pushed for each product (ProductDay), the ads' numbers (the day's own, or the campaigns'
 * archive), the product's economics and the owner's rules. The arithmetic is src/core/numbers.ts — this file only gathers.
 *
 * Where a number comes from, in order: what was pushed for the product-day; else what the OMS orders / Meta's archive say;
 * else nothing (null, a dash). A screen is real or it is demo — never both.
 */
import { addDays, baselineWindow, eachDay, keyMs, ammanKey, parseRange, previousRange, rangeLabel, type Range } from "@/core/dates";
import { computeSet, coverUrgency, emptyRaw, scaleFlows, sumRaw, topReasons, totalSet, type Ctx, type NumbersSet, type Offer, type ProductNumbers, type Raw, type Reason } from "@/core/numbers";
import { breakevenOf, readRules, type CampaignRules } from "@/core/rules-v2";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";

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

export async function loadNumbers(q: { d?: string | null; from?: string | null; to?: string | null }, now = new Date()): Promise<NumbersData> {
  const range = parseRange(q, now);
  if (process.env.MOCK_MODE === "1") return demoNumbers(range);

  const rules = readRules(await getSetting("campaign.rules"));
  const fx = Number(await getSetting("economics.fx_fee"));
  const prevW = previousRange(range);
  const baseW = baselineWindow(range);
  const rateFrom = addDays(range.to, -29);
  const spanFrom = [prevW.from, baseW.from, rateFrom].sort()[0]!;
  const gte = new Date(keyMs(spanFrom));
  const lte = new Date(keyMs(range.to));

  const [pdRows, spendRows, orderRows, econRows, campaigns, adsets, ads, snaps] = await Promise.all([
    db.productDay.findMany({ where: { date: { gte, lte } } }),
    db.insightDaily.groupBy({ by: ["level", "date", "objectId"], where: { date: { gte, lte } }, _sum: { spend: true, impressions: true, linkClicks: true, purchases: true } }),
    db.attributedOrder.findMany({ where: { createdAtOms: { gte: new Date(keyMs(spanFrom) - 3 * 3_600_000), lt: new Date(keyMs(range.to) + 21 * 3_600_000) }, isFake: false }, select: { createdAtOms: true, productCode: true, status: true } }),
    db.productEconomics.findMany(),
    db.campaign.findMany({ select: { metaId: true, productCode: true } }),
    db.adSet.findMany({ select: { metaId: true, campaign: { select: { metaId: true } } } }),
    db.ad.findMany({ select: { metaId: true, adSet: { select: { campaign: { select: { metaId: true } } } } } }),
    db.stockSnapshot.findMany({ orderBy: { at: "desc" }, take: 400 }),
  ]);

  // ── the product-days Claude pushed ──
  const pd = new Map<string, PD>();
  for (const r of pdRows) {
    pd.set(`${r.productCode}|${dayOf(r.date)}`, {
      ads: r.spend === null && r.impressions === null && r.linkClicks === null && r.pixelPurchases === null ? null : { spend: num(r.spend), impressions: r.impressions, clicks: r.linkClicks, purchases: r.pixelPurchases },
      ordersIn: r.ordersIn, uniqueCustomers: r.uniqueCustomers, confirmed: r.confirmed, rejected: r.rejected, cancelled: r.cancelled, waiting: r.waiting,
      rejectReasons: (r.rejectReasons as Reason[] | null) ?? [], offers: (r.offerBreakdown as Offer[] | null) ?? [], aov: num(r.aov),
      shippedOrders: r.shippedOrders, shippedPieces: r.shippedPieces, outForDelivery: r.outForDelivery, stuck: r.stuck, delivered: r.delivered, returned: r.returned,
      revenueShipped: num(r.revenueShipped), expectedRevenue: num(r.expectedRevenue), stockUnits: r.stockUnits,
    });
  }

  // ── Meta's archive, per product and day (the finest level that day has) ──
  const campaignOf = new Map<string, string>(campaigns.map((c) => [c.metaId, c.metaId]));
  for (const s of adsets) campaignOf.set(s.metaId, s.campaign.metaId);
  for (const a of ads) campaignOf.set(a.metaId, a.adSet.campaign.metaId);
  const productOfCampaign = new Map(campaigns.map((c) => [c.metaId, c.productCode]));
  const archive = new Map<string, Ads>();
  const byDay = new Map<string, typeof spendRows>();
  for (const r of spendRows) byDay.set(dayOf(r.date), [...(byDay.get(dayOf(r.date)) ?? []), r]);
  for (const [day, list] of byDay) {
    const detail = LEVELS.map((l) => list.filter((r) => r.level === l)).find((l) => l.length) ?? [];
    for (const r of detail) {
      const code = productOfCampaign.get(campaignOf.get(r.objectId) ?? "");
      if (!code) continue;
      const k = `${code}|${day}`;
      const cur = archive.get(k) ?? { spend: null, impressions: null, clicks: null, purchases: null };
      archive.set(k, { spend: add(cur.spend, num(r._sum.spend)), impressions: add(cur.impressions, r._sum.impressions), clicks: add(cur.clicks, r._sum.linkClicks), purchases: add(cur.purchases, r._sum.purchases) });
    }
  }

  // ── the OMS's orders, when nothing was pushed for that product-day ──
  const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
  const omsDay = new Map<string, { orders: number; confirmed: number; delivered: number; returned: number }>();
  for (const o of orderRows) {
    const k = `${o.productCode}|${ammanKey(o.createdAtOms)}`;
    const cur = omsDay.get(k) ?? { orders: 0, confirmed: 0, delivered: 0, returned: 0 };
    cur.orders++;
    if (CONFIRMED.has(o.status)) cur.confirmed++;
    if (o.status === "delivered") cur.delivered++;
    if (o.status === "returned") cur.returned++;
    omsDay.set(k, cur);
  }

  const econ = new Map(econRows.map((e) => [e.productCode, e]));
  const codes = new Set<string>([...pdRows.map((r) => r.productCode), ...[...archive.keys()].map((k) => k.split("|")[0]!), ...[...omsDay.keys()].map((k) => k.split("|")[0]!)]);

  /** One product over one window: the flows summed, the states as they stood on its latest day. */
  function rawOf(code: string, w: { from: string; to: string }): Raw {
    const out = emptyRaw();
    const reasons: Reason[] = [];
    const offers: Offer[] = [];
    let aovRev = 0;
    let aovOrders = 0;
    for (const d of eachDay(w.from, w.to)) {
      const row = pd.get(`${code}|${d}`);
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
    return sumRaw([out]);
  }

  const ctxOf = (code: string): { ctx: Ctx; cover: number | null } => {
    let delivered = 0;
    let returned = 0;
    for (const d of eachDay(rateFrom, range.to)) {
      const row = pd.get(`${code}|${d}`);
      delivered += row?.delivered ?? 0;
      returned += row?.returned ?? 0;
    }
    let pieces = 0;
    let anyPieces = false;
    for (const d of eachDay(addDays(range.to, -6), range.to)) {
      const v = pd.get(`${code}|${d}`)?.shippedPieces;
      if (v != null) {
        pieces += v;
        anyPieces = true;
      }
    }
    const e = econ.get(code);
    const snap = snaps.find((s) => s.productCode === code);
    return {
      ctx: { fx, deliveryRate: delivered + returned > 0 ? delivered / (delivered + returned) : null, econ: e ? { unitCost: Number(e.unitCost), deliveryFee: Number(e.deliveryFee), returnFee: Number(e.returnFee) } : null, piecesPerDay: anyPieces ? pieces / 7 : null },
      cover: snap ? Number(snap.daysCover) : null,
    };
  };

  const factor = range.days / baseW.days;
  const parts = [...codes].map((code) => {
    const { ctx, cover } = ctxOf(code);
    const cur = rawOf(code, range);
    const prev = rawOf(code, prevW);
    const avg = scaleFlows(rawOf(code, baseW), factor);
    const set = computeSet(cur, ctx);
    // the stock's days of cover: from the pieces shipped a day, else the reading somebody pushed
    if (set.stockCover === null && cover !== null) set.stockCover = cover;
    const has = [cur, prev, avg].some((r) => r.metaSpend !== null || r.ordersIn !== null || r.shippedOrders !== null);
    return { code, ctx, cur, prev, avg, set, setPrev: computeSet(prev, ctx), setAvg: computeSet(avg, ctx), has };
  });

  const shown = parts.filter((p) => p.has).sort((a, b) => (b.set.spend ?? 0) - (a.set.spend ?? 0) || (b.set.ordersIn ?? 0) - (a.set.ordersIn ?? 0));
  const products: ProductNumbers[] = shown.map((p) => ({
    code: p.code,
    name: econ.get(p.code)?.name ?? p.code,
    current: p.set,
    prev: p.setPrev,
    avg7: p.setAvg,
    rejectReasons: topReasons(p.cur.rejectReasons, 3),
    offers: p.cur.offers,
    breakeven: breakevenOf(rules, p.code),
    stockUrgency: coverUrgency(p.set.stockCover, rules.stock),
    hasData: p.cur.metaSpend !== null || p.cur.ordersIn !== null || p.cur.shippedOrders !== null,
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
  };
}

// ───────────────────────────── the demo: the same arithmetic over made-up counts ─────────────────────────────

function demoNumbers(range: Range): NumbersData {
  const rules: CampaignRules = readRules({ targetCost: 3, breakeven: { TRF01: 4.5, TIN01: 6 } });
  const fx = 0.01;
  const mk = (scale: number, x: Partial<Raw>): Raw => scaleFlows({ ...emptyRaw(), ...x }, scale);
  const demo = [
    { code: "TRF01", name: "ماء الكمأة", ctx: { fx, deliveryRate: 0.78, econ: { unitCost: 2.2, deliveryFee: 2.5, returnFee: 0 }, piecesPerDay: 30 } as Ctx, raw: { metaSpend: 118, impressions: 26_000, linkClicks: 520, pixelPurchases: 44, ordersIn: 38, uniqueCustomers: 36, confirmed: 27, rejected: 5, cancelled: 2, waiting: 6, shippedOrders: 24, shippedPieces: 33, delivered: 11, returned: 2, outForDelivery: 15, stuck: 1, revenueShipped: 520, aovRevenue: 912, aovOrders: 38, stockUnits: 540, offers: [{ offer: "قطعة", orders: 26, pieces: 1 }, { offer: "2 + هدية", orders: 12, pieces: 3, revenue: 330 }], rejectReasons: [{ reason: "رقم غلط", count: 3 }, { reason: "غيّر رأيه", count: 2 }] } as Partial<Raw> },
    { code: "TIN01", name: "قطرة طنين الأذن", ctx: { fx, deliveryRate: 0.7, econ: { unitCost: 2.6, deliveryFee: 2.5, returnFee: 1 }, piecesPerDay: 14 } as Ctx, raw: { metaSpend: 64, impressions: 15_000, linkClicks: 270, pixelPurchases: 19, ordersIn: 11, uniqueCustomers: 11, confirmed: 7, rejected: 3, cancelled: 0, waiting: 1, shippedOrders: 9, shippedPieces: 10, delivered: 4, returned: 2, outForDelivery: 5, stuck: 0, revenueShipped: 160, aovRevenue: 198, aovOrders: 11, stockUnits: 60, offers: [{ offer: "قطعة", orders: 11, pieces: 1 }], rejectReasons: [{ reason: "سعر", count: 2 }] } as Partial<Raw> },
  ];
  const sets = (scale: number) => demo.map((p) => ({ raw: mk(scale, p.raw), set: computeSet(mk(scale, p.raw), p.ctx), piecesPerDay: p.ctx.piecesPerDay }));
  // the flows of a longer range are that many days' worth (the states — waiting, stock — stay as they are)
  const [cur, prev, avg] = [sets(range.days), sets(1.06 * range.days), sets(0.97 * range.days)];
  const products: ProductNumbers[] = demo.map((p, i) => ({
    code: p.code, name: p.name, current: cur[i]!.set, prev: prev[i]!.set, avg7: avg[i]!.set, rejectReasons: topReasons(cur[i]!.raw.rejectReasons, 3), offers: cur[i]!.raw.offers,
    breakeven: breakevenOf(rules, p.code), stockUrgency: coverUrgency(cur[i]!.set.stockCover, rules.stock), hasData: true,
  }));
  return { demo: true, range, label: rangeLabel(range), totals: { current: totalSet(cur, fx), prev: totalSet(prev, fx), avg7: totalSet(avg, fx) }, products, target: 3, stockLevels: rules.stock, rulesMissing: false };
}

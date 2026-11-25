/**
 * oms.sync + truth.compute (spec 13.6). Orders come in (upsert on the OMS id), then the truth of every ad and every
 * product is computed per day from the archive: Meta's spend × (1 + fx fee) against the OMS outcomes, through the one
 * calculator (src/core/economics.ts). Confirm rates use MATURE orders only (6.6).
 *
 * v6 · P11: every amount is turned into dollars at the owner's rates BEFORE it is added (spend in the account's currency,
 * orders in theirs). An amount with no rate makes the figures that stand on it unknown, and the row says which currency —
 * it is never added as if it were dollars, never left out quietly. A product seen in two markets gets a row per market.
 */
import Decimal from "decimal.js";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { omsBaseUrl, omsToken } from "@/server/env";
import { computeTruth } from "@/core/economics";
import { BASE_CURRENCY, normalizeCurrency, rateTable, sumUsd, toUsd, type RateTable } from "@/core/currency";
import { campaignMarket, catalogueConflicts, isMarket, orderConflicts, splitKey, type ProductConflict } from "@/core/markets";
import { encodeGap } from "@/core/truth-money";
import { loadProductMarkets, loadRates, objectCurrencies, spendConverter } from "@/server/money";
import { setSetting } from "@/server/settings";
import { readOrders, readProducts, toAttributedOrder, type OmsOptions, type OmsProduct } from "@/adapters/oms";

export function omsOptions(fetchImpl?: typeof fetch): OmsOptions | null {
  const baseUrl = omsBaseUrl() ?? undefined;
  const token = omsToken() ?? undefined;
  return baseUrl && token ? { baseUrl, token, fetch: fetchImpl } : null;
}

/**
 * One OMS product as the economics row. `update` carries only the figures the OMS actually sent, so a null never wipes
 * a number the owner typed in Settings (P0.9); `create` fills the missing ones with 0, and the row keeps the default
 * source «estimate», which every screen shows as «تقدير». Stock days are whole days in this table.
 *
 * v6 · P11: the table is dollars. `unit_cost_usd` is dollars by its name; the prices and the fees are in the product's own
 * currency, so they are converted at the owner's rates — and with no rate they are NOT written (`missing` names the currency).
 */
export function economicsFromOms(p: OmsProduct, rates: RateTable = rateTable({})) {
  const update: { name: string; price?: string; unitCost?: string; deliveryFee?: string; returnFee?: string; codFeePct?: string; stockDays?: number | null } = { name: p.name };
  const currency = p.currency ?? BASE_CURRENCY;
  const missing = new Set<string>();
  const dollars = (v: string) => {
    if (normalizeCurrency(currency) === BASE_CURRENCY) return v;
    const c = toUsd(v, currency, rates);
    if (c.usd === null) missing.add(c.missing!);
    return c.usd?.toDecimalPlaces(2).toString();
  };
  const price = p.price_options?.[0]?.price;
  const money = { price, deliveryFee: p.delivery_fee, returnFee: p.return_fee };
  for (const [k, v] of Object.entries(money) as [keyof typeof money, string | null | undefined][]) {
    if (v == null) continue;
    const usd = dollars(v);
    if (usd !== undefined) update[k] = usd;
  }
  if (p.unit_cost_usd != null) update.unitCost = p.unit_cost_usd;
  if (p.cod_fee_pct != null) update.codFeePct = p.cod_fee_pct;
  if (p.stock_days !== undefined) update.stockDays = p.stock_days === null ? null : Math.round(p.stock_days);
  const create = { productCode: p.code, market: "SY", confirmCost: 0.3, price: "0", unitCost: "0", deliveryFee: "0", returnFee: "0", codFeePct: "0", stockDays: null as number | null, ...update };
  return { create, update, missing: [...missing] };
}

export async function syncOms(o: OmsOptions, since: Date) {
  const windowH = await getSetting("truth.confirm_window_h");
  const rates = await loadRates();
  const catalogue = await readProducts(o);
  // a code the catalogue lists twice with different figures is two products under one name: neither is taken
  const clashes = catalogueConflicts(catalogue.map((p) => ({ code: p.code, name: p.name, currency: p.currency, price: p.price_options?.[0]?.price, unitCost: p.unit_cost_usd })));
  const refused = new Set(clashes.map((c) => c.code));
  const noRate = new Set<string>();
  let cleared = false;
  for (const p of catalogue) {
    if (refused.has(p.code)) continue;
    const { create, update, missing } = economicsFromOms(p, rates);
    missing.forEach((c) => noRate.add(c));
    // the mark follows the pull: set while a price or a fee cannot be turned into dollars (whatever the row holds is then not read), cleared once it can
    const moneyMissing = missing.length ? missing.join(",") : null;
    const old = await db.productEconomics.findUnique({ where: { productCode: p.code }, select: { moneyMissing: true } });
    if (old?.moneyMissing && !moneyMissing) cleared = true;
    await db.productEconomics.upsert({ where: { productCode: p.code }, create: { ...create, moneyMissing }, update: { ...update, moneyMissing } });
    for (const alias of p.aliases ?? []) {
      await db.productAlias.upsert({ where: { productCode_alias: { productCode: p.code, alias } }, create: { productCode: p.code, alias }, update: {} });
    }
  }
  let orders = 0;
  const raws = await readOrders(o, since);
  // the OMS is the truth: order rows made from a tally Claude pushed (method «mcp») for the days it just read step aside
  await db.attributedOrder.deleteMany({ where: { method: "mcp", createdAtOms: { gte: since } } });
  for (const raw of raws) {
    const row = toAttributedOrder(raw, windowH);
    await db.attributedOrder.upsert({ where: { omsOrderId: row.omsOrderId }, create: row, update: row });
    orders++;
  }
  await placeDefaultMarkets([...new Set(catalogue.map((p) => p.code))]);
  const conflicts = await recordConflicts(clashes, [...new Set([...catalogue.map((p) => p.code), ...raws.map((r) => r.product_code)])]);
  // a product's money became readable: the days that were waiting for it are worked out again
  if (cleared) await rebuildTruth();
  return { orders, conflicts, missingRates: [...noRate].sort() };
}

/** The market every product row used to be created with. */
const OLD_DEFAULT_MARKET = "SY";

/**
 * The catalogue carries no country, and a row used to be born «SY». While the owner never saved the product himself, a row still on that default whose orders and
 * campaigns show exactly ONE market, and not that one, takes it — so that one stray order from a third country later does not leave the product with no home.
 * A market the owner wrote is never rewritten.
 */
async function placeDefaultMarkets(codes: string[]): Promise<void> {
  if (!codes.length) return;
  const onDefault = (await db.productEconomics.findMany({ where: { productCode: { in: codes }, market: OLD_DEFAULT_MARKET }, select: { productCode: true, market: true } })).filter((e) => e.market === OLD_DEFAULT_MARKET);
  if (!onDefault.length) return;
  const markets = await loadProductMarkets();
  for (const { productCode } of onDefault) {
    const seen = markets.marketsOf(productCode);
    if (seen.length !== 1 || seen[0] === OLD_DEFAULT_MARKET || !isMarket(seen[0])) continue;
    if (await db.auditLog.findFirst({ where: { targetType: "product", targetId: productCode }, select: { id: true } })) continue;
    await db.productEconomics.updateMany({ where: { productCode }, data: { market: seen[0] } });
  }
}

/** How far back the stored truth is rebuilt when a rate or a product's money changes: the two months the reports read. */
const REBUILD_DAYS = 62;
const MAX_OLD_DAYS = 90;

/**
 * Works the stored truth out again for the days it can be wrong about money, and no other: days of the last two months that hold an amount in another
 * currency (an order, or an account that bills in it), and any older day still marked as missing something.
 */
export async function rebuildTruth(now = new Date()) {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const since = new Date(today.getTime() - REBUILD_DAYS * DAY);
  const objects = await objectCurrencies();
  const foreignObjects = [...objects].filter(([, currency]) => normalizeCurrency(currency) !== BASE_CURRENCY).map(([id]) => id);
  const [orders, spend, holed] = await Promise.all([
    db.attributedOrder.findMany({ where: { createdAtOms: { gte: since }, isFake: false, currency: { not: BASE_CURRENCY } }, select: { createdAtOms: true } }),
    db.insightDaily.findMany({ where: { level: "ad", date: { gte: since }, OR: [{ objectId: { in: foreignObjects } }, { currency: { notIn: [BASE_CURRENCY] } }] }, select: { date: true }, distinct: ["date"] }),
    db.truthDaily.findMany({ where: { OR: [{ spendMissing: { not: null } }, { moneyMissing: { not: null } }] }, select: { date: true }, distinct: ["date"], orderBy: { date: "desc" }, take: MAX_OLD_DAYS }),
  ]);
  const days = [...new Set([...orders.map((o) => dayKey(o.createdAtOms)), ...spend.map((i) => dayKey(i.date)), ...holed.map((h) => dayKey(h.date))])].sort();
  let truthRows = 0;
  for (const d of days) {
    const date = new Date(`${d}T00:00:00Z`);
    truthRows += (await computeTruthDays(date, date, now)).truthRows;
  }
  return { days: days.length, truthRows };
}

/** Keeps the list of codes that say two different things, and raises one alert the first time each is seen. Returns how many of THIS pull's codes have one. */
async function recordConflicts(clashes: ProductConflict[], codes: string[]): Promise<number> {
  if (!codes.length) return 0;
  const rows = await db.attributedOrder.groupBy({ by: ["productCode", "market", "currency"], where: { productCode: { in: codes }, isFake: false, method: { not: "mcp" } }, _count: { _all: true } });
  const found = [...clashes, ...orderConflicts(rows.map((r) => ({ code: r.productCode, market: r.market, currency: r.currency })))];
  const stored = await getSetting("oms.product_conflicts");
  const before = Array.isArray(stored) ? stored : [];
  const keyOf = (c: ProductConflict) => `${c.code}:${c.kind}`;
  const known = new Set(before.map(keyOf));
  for (const c of found) if (!known.has(keyOf(c))) await db.alert.create({ data: { kind: "oms.product_conflict", tone: "warn", text: c.text, href: "/settings/products" } });
  const looked = new Set(codes);
  const next = [...before.filter((c) => !looked.has(c.code)), ...found].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  if (JSON.stringify(next) !== JSON.stringify(before)) await setSetting("oms.product_conflicts", next, null);
  return found.length;
}

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
const SHIPPED = new Set(["shipped", "delivered", "returned"]);

/** The truth of every ad and product for each day in [from, to] (UTC dates of the archive). */
export async function computeTruthDays(from: Date, to: Date, now = new Date()) {
  const fx = new Decimal(String(await getSetting("economics.fx_fee")));
  const overhead = new Decimal(String(await getSetting("economics.overhead_factor")));
  const products = new Map((await db.productEconomics.findMany()).map((p) => [p.productCode, p]));
  const ads = await db.ad.findMany({ include: { adSet: { include: { campaign: { include: { account: true } } } } } });
  const productOfAd = new Map(ads.map((a) => [a.metaId, a.adSet.campaign.productCode]));
  const marketOfAd = new Map(ads.map((a) => [a.metaId, campaignMarket(a.adSet.campaign.parsedMarket, a.adSet.campaign.account?.market)]));
  const money = await spendConverter();
  const markets = await loadProductMarkets();
  let written = 0;

  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const date = new Date(t);
    const next = new Date(t + DAY);
    const insights = await db.insightDaily.findMany({ where: { level: "ad", date } });
    const orders = await db.attributedOrder.findMany({ where: { createdAtOms: { gte: date, lt: next }, isFake: false } });

    // group by ad, then by product (and by market for a product seen in two)
    const groups = new Map<string, { level: "ad" | "product"; id: string; product: string | null; spend: Decimal; spendFx: Set<string>; foreign: boolean; list: typeof orders }>();
    const group = (level: "ad" | "product", id: string, product: string | null) => {
      const k = `${level}:${id}`;
      if (!groups.has(k)) groups.set(k, { level, id, product, spend: new Decimal(0), spendFx: new Set(), foreign: false, list: [] });
      return groups.get(k)!;
    };
    for (const i of insights) {
      const product = productOfAd.get(i.objectId) ?? null;
      const market = marketOfAd.get(i.objectId) ?? null;
      const dollars = money.usd(i);
      const targets = [group("ad", i.objectId, product), ...(product ? [group("product", markets.keyOf(product, market), product)] : [])];
      for (const g of targets) {
        if (dollars.usd === null) g.spendFx.add(dollars.missing!);
        else g.spend = g.spend.plus(dollars.usd);
        if (product && !markets.isHome(product, market)) g.foreign = true;
      }
    }
    for (const o of orders) {
      const targets = [...(o.adId ? [group("ad", o.adId, o.productCode)] : []), group("product", markets.keyOf(o.productCode, o.market), o.productCode)];
      for (const g of targets) {
        g.list.push(o);
        if (!markets.isHome(o.productCode, o.market)) g.foreign = true;
      }
    }

    // a product seen in two markets: its older merged rows of this day step aside for the rows per market
    for (const code of new Set([...groups.values()].filter((g) => g.level === "product" && markets.isSplit(splitKey(g.id).code)).map((g) => splitKey(g.id).code))) {
      const keys = [...groups.values()].filter((g) => g.level === "product").map((g) => g.id);
      await db.truthDaily.deleteMany({ where: { level: "product", date, OR: [{ objectId: code }, { objectId: { startsWith: `${code}@` } }], NOT: { objectId: { in: keys } } } });
    }

    for (const g of groups.values()) {
      // a product's economics belong to its home market: another market's money is unknown, never worked out with them —
      // and neither are prices or fees the OMS sent in a currency with no rate
      const row = g.product && !g.foreign ? products.get(g.product) : undefined;
      const economicsFx = row?.moneyMissing ? row.moneyMissing.split(",") : [];
      const p = economicsFx.length ? undefined : row;
      const noEconomics = g.foreign;
      const mature = g.list.filter((o) => o.matureAt <= now);
      const shipped = g.list.filter((o) => SHIPPED.has(o.status));
      const delivered = g.list.filter((o) => o.status === "delivered");
      const returned = g.list.filter((o) => o.status === "returned");
      const revenue = sumUsd(delivered.map((o) => ({ amount: (o.collected ?? o.orderValue).toString(), currency: o.currency })), money.rates);
      const collected = revenue.usd ?? new Decimal(0);
      const spendMissing = encodeGap(g.spendFx);
      const moneyMissing = encodeGap([...revenue.missing, ...economicsFx], noEconomics);
      const either = !!spendMissing || !!moneyMissing;
      const truth = computeTruth({
        spend: g.spend,
        fxFee: fx,
        orders: g.list.length,
        confirmed: mature.filter((o) => CONFIRMED.has(o.status)).length,
        matureOrders: mature.length,
        shipments: shipped.length,
        delivered: delivered.length,
        returned: returned.length,
        collected,
        deliveryFees: new Decimal(p?.deliveryFee.toString() ?? 0).mul(shipped.length),
        returnFees: new Decimal(p?.returnFee.toString() ?? 0).mul(returned.length),
        cogsDelivered: new Decimal(p?.unitCost.toString() ?? 0).mul(delivered.length),
        overheadFactor: overhead,
      });
      const values = {
        // where a column cannot be null, the 0 beside a «missing» mark is a placeholder: every reader goes through src/core/truth-money.ts
        spendWithFee: spendMissing ? "0" : truth.spendWithFee.toDecimalPlaces(2).toString(),
        spendMissing,
        moneyMissing,
        orders: g.list.length,
        matureOrders: mature.length,
        confirmed: mature.filter((o) => CONFIRMED.has(o.status)).length,
        shipments: shipped.length,
        delivered: delivered.length,
        returned: returned.length,
        costPerConfirmed: spendMissing ? null : truth.costPerConfirmed?.toDecimalPlaces(4).toString() ?? null,
        confirmRate: truth.confirmRate?.toDecimalPlaces(6).toString() ?? null,
        deliveryRate: truth.deliveryRate?.toDecimalPlaces(6).toString() ?? null,
        returnRate: truth.returnRate?.toDecimalPlaces(6).toString() ?? null,
        netCollected: moneyMissing ? "0" : truth.netCollected.toDecimalPlaces(2).toString(),
        lossLimit: moneyMissing ? null : truth.lossLimit?.toDecimalPlaces(4).toString() ?? null,
        scalingCeiling: moneyMissing ? null : truth.scalingCeiling?.toDecimalPlaces(4).toString() ?? null,
        profitAfterCosts: either ? "0" : truth.profitAfterCosts.toDecimalPlaces(2).toString(),
        profitPerDelivered: either ? null : truth.profitPerDelivered?.toDecimalPlaces(4).toString() ?? null,
        trueRoas: either ? null : truth.trueRoas?.toDecimalPlaces(4).toString() ?? null,
      };
      const key = { level: g.level, objectId: g.id, date };
      await db.truthDaily.upsert({ where: { level_objectId_date: key }, create: { ...key, ...values }, update: values });
      written++;
    }
  }
  return { truthRows: written, days: dayKey(from) + "…" + dayKey(to) };
}

/**
 * oms.sync + truth.compute (spec 13.6). Orders come in (upsert on the OMS id), then the truth of every ad and every
 * product is computed per day from the archive: Meta's spend × (1 + fx fee) against the OMS outcomes, through the one
 * calculator (src/core/economics.ts). Confirm rates use MATURE orders only (6.6).
 */
import Decimal from "decimal.js";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { computeTruth } from "@/core/economics";
import { readOrders, readProducts, toAttributedOrder, type OmsOptions, type OmsProduct } from "@/adapters/oms";
import { omsLink } from "@/server/oms-link";

/** The live OMS options, or null while the link is off (`OMS_LIVE`, `src/server/oms-link.ts`). */
export function omsOptions(fetchImpl?: typeof fetch): OmsOptions | null {
  const link = omsLink(process.env, fetchImpl);
  return link.mode === "live" ? link.options : null;
}

/**
 * One OMS product as the economics row: `update` carries only the figures the OMS actually sent, so a null never
 * wipes a number the owner typed; `create` fills the missing ones with 0 and marks the row `oms_partial`, which the
 * screens read as «تقدير». Stock days are whole days in this table.
 */
export function economicsFromOms(p: OmsProduct) {
  const update: { name: string; price?: string; unitCost?: string; deliveryFee?: string; returnFee?: string; codFeePct?: string; stockDays?: number | null } = { name: p.name };
  const price = p.price_options?.[0]?.price;
  if (price != null) update.price = price;
  if (p.unit_cost_usd != null) update.unitCost = p.unit_cost_usd;
  if (p.delivery_fee != null) update.deliveryFee = p.delivery_fee;
  if (p.return_fee != null) update.returnFee = p.return_fee;
  if (p.cod_fee_pct != null) update.codFeePct = p.cod_fee_pct;
  if (p.stock_days !== undefined) update.stockDays = p.stock_days === null ? null : Math.round(p.stock_days);
  const complete = price != null && p.unit_cost_usd != null && p.delivery_fee != null && p.return_fee != null && p.cod_fee_pct != null;
  const create = {
    productCode: p.code,
    market: "SY",
    confirmCost: 0.3,
    price: "0",
    unitCost: "0",
    deliveryFee: "0",
    returnFee: "0",
    codFeePct: "0",
    stockDays: null as number | null,
    ...update,
    source: complete ? "oms" : "oms_partial",
  };
  return { create, update };
}

export async function syncOms(o: OmsOptions, since: Date) {
  const windowH = await getSetting("truth.confirm_window_h");
  for (const p of await readProducts(o)) {
    const { create, update } = economicsFromOms(p);
    await db.productEconomics.upsert({ where: { productCode: p.code }, create, update });
    for (const alias of p.aliases ?? []) {
      await db.productAlias.upsert({ where: { productCode_alias: { productCode: p.code, alias } }, create: { productCode: p.code, alias }, update: {} });
    }
  }
  let orders = 0;
  for (const raw of await readOrders(o, since)) {
    const row = toAttributedOrder(raw, windowH);
    await db.attributedOrder.upsert({ where: { omsOrderId: row.omsOrderId }, create: row, update: row });
    orders++;
  }
  return { orders };
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
  const ads = await db.ad.findMany({ include: { adSet: { include: { campaign: true } } } });
  const productOfAd = new Map(ads.map((a) => [a.metaId, a.adSet.campaign.productCode]));
  let written = 0;

  for (let t = from.getTime(); t <= to.getTime(); t += DAY) {
    const date = new Date(t);
    const next = new Date(t + DAY);
    const insights = await db.insightDaily.findMany({ where: { level: "ad", date } });
    const orders = await db.attributedOrder.findMany({ where: { createdAtOms: { gte: date, lt: next }, isFake: false } });

    // group by ad, then by product
    const groups = new Map<string, { level: "ad" | "product"; id: string; product: string | null; spend: Decimal; list: typeof orders }>();
    const group = (level: "ad" | "product", id: string, product: string | null) => {
      const k = `${level}:${id}`;
      if (!groups.has(k)) groups.set(k, { level, id, product, spend: new Decimal(0), list: [] });
      return groups.get(k)!;
    };
    for (const i of insights) {
      const product = productOfAd.get(i.objectId) ?? null;
      group("ad", i.objectId, product).spend = group("ad", i.objectId, product).spend.plus(i.spend.toString());
      if (product) group("product", product, product).spend = group("product", product, product).spend.plus(i.spend.toString());
    }
    for (const o of orders) {
      if (o.adId) group("ad", o.adId, o.productCode).list.push(o);
      group("product", o.productCode, o.productCode).list.push(o);
    }

    for (const g of groups.values()) {
      const p = g.product ? products.get(g.product) : undefined;
      const mature = g.list.filter((o) => o.matureAt <= now);
      const shipped = g.list.filter((o) => SHIPPED.has(o.status));
      const delivered = g.list.filter((o) => o.status === "delivered");
      const returned = g.list.filter((o) => o.status === "returned");
      const collected = delivered.reduce((s, o) => s.plus((o.collected ?? o.orderValue).toString()), new Decimal(0));
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
        spendWithFee: truth.spendWithFee.toDecimalPlaces(2).toString(),
        orders: g.list.length,
        matureOrders: mature.length,
        confirmed: mature.filter((o) => CONFIRMED.has(o.status)).length,
        shipments: shipped.length,
        delivered: delivered.length,
        returned: returned.length,
        costPerConfirmed: truth.costPerConfirmed?.toDecimalPlaces(4).toString() ?? null,
        confirmRate: truth.confirmRate?.toDecimalPlaces(6).toString() ?? null,
        deliveryRate: truth.deliveryRate?.toDecimalPlaces(6).toString() ?? null,
        returnRate: truth.returnRate?.toDecimalPlaces(6).toString() ?? null,
        netCollected: truth.netCollected.toDecimalPlaces(2).toString(),
        lossLimit: truth.lossLimit?.toDecimalPlaces(4).toString() ?? null,
        scalingCeiling: truth.scalingCeiling?.toDecimalPlaces(4).toString() ?? null,
        profitAfterCosts: truth.profitAfterCosts.toDecimalPlaces(2).toString(),
        profitPerDelivered: truth.profitPerDelivered?.toDecimalPlaces(4).toString() ?? null,
        trueRoas: truth.trueRoas?.toDecimalPlaces(4).toString() ?? null,
      };
      const key = { level: g.level, objectId: g.id, date };
      await db.truthDaily.upsert({ where: { level_objectId_date: key }, create: { ...key, ...values }, update: values });
      written++;
    }
  }
  return { truthRows: written, days: dayKey(from) + "…" + dayKey(to) };
}

/**
 * WHERE THE SCREENS' NUMBERS COME FROM (T1.8). `MOCK_MODE=1`: the demo set. Otherwise the same shapes built from the
 * database — Meta's archive (InsightDaily) and the OMS orders (AttributedOrder) over the last `days` days — so every
 * screen, the report and the export read real numbers through the very same calculator.
 */
import { mergeMissing } from "@/core/currency";
import { campaignMarket } from "@/core/markets";
import { nameOf, productLabels } from "@/core/product-name";
import { db } from "@/server/db";
import { spendConverter } from "@/server/money";
import { lastOmsSync, omsStale } from "@/jobs/oms-health";
import { DEMO, type Account, type CampaignRow, type Counts, type Dataset, type Product, type RowStatus } from "@/lib/mock/data";
import { forViewer } from "@/server/redact";

const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
const SHIPPED = new Set(["shipped", "delivered", "returned"]);

export function statusOf(meta: string, learning?: string | null): RowStatus {
  if (meta === "PAUSED" || meta === "CAMPAIGN_PAUSED" || meta === "ADSET_PAUSED" || meta === "ARCHIVED") return "paused";
  if (meta === "DISAPPROVED" || meta === "WITH_ISSUES") return "rejected";
  if (learning === "LEARNING") return "learning";
  return "active";
}

/** A product's economics row as the calculator reads it. */
export function toProduct(p: { productCode: string; name: string; market: string; price: unknown; unitCost: unknown; deliveryFee: unknown; returnFee: unknown; codFeePct: unknown; confirmCost: unknown; stockDays: number | null; source: string; moneyMissing?: string | null }): Product {
  return {
    ...(p.moneyMissing ? { moneyMissing: p.moneyMissing } : {}),
    code: p.productCode, name: p.name, market: p.market as Product["market"], price: Number(p.price), unitCost: Number(p.unitCost), delivery: Number(p.deliveryFee),
    returnFee: Number(p.returnFee), codFee: Number(p.codFeePct), confirmCost: Number(p.confirmCost), stockDays: p.stockDays ?? 0, shipmentsToDate: p.source === "actual" ? 50 : 0,
  };
}

async function loadDatasetRaw(days = 7, now = new Date()): Promise<Dataset> {
  if (process.env.MOCK_MODE === "1") return DEMO;
  const since = new Date(now.getTime() - days * 86_400_000);

  // The OMS answers once an hour at most; when its last real answer is over 3 h old, nothing here may say «حقيقي».
  const stale = omsStale(lastOmsSync(await db.jobRun.findMany({ where: { job: "oms.sync" }, orderBy: { startedAt: "desc" }, take: 48 })), now);

  const [econ, accountsDb, campaignsDb, insights, orders, aliasRows, money, orderMarkets] = await Promise.all([
    db.productEconomics.findMany(),
    db.adAccount.findMany(),
    db.campaign.findMany({ include: { adsets: { include: { ads: true } }, account: true } }),
    db.insightDaily.groupBy({ by: ["objectId", "currency", "source"], where: { level: "ad", date: { gte: since } }, _sum: { spend: true, impressions: true, linkClicks: true, video3s: true, thruplays: true, purchases: true, conversations: true } }),
    db.attributedOrder.findMany({ where: { createdAtOms: { gte: since }, isFake: false, adId: { not: null } }, select: { adId: true, status: true, matureAt: true, channel: true } }),
    db.productAlias.findMany({ select: { productCode: true, alias: true } }),
    spendConverter(),
    db.attributedOrder.groupBy({ by: ["productCode", "market"], where: { isFake: false }, _count: { _all: true } }),
  ]);

  // U-08: a product is written by its Arabic name (the OMS name, else an Arabic alias)
  const labels = productLabels(econ, aliasRows);
  const named = <T extends { productCode: string; name: string }>(p: T): T => ({ ...p, name: nameOf(labels, p.productCode) });
  const products: Product[] = econ.map((p) => (stale ? { ...toProduct(named(p)), shipmentsToDate: 0 } : toProduct(named(p))));

  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  // v6 · P11: every row of spend in dollars (a row with no rate leaves its ad's spend unknown)
  const spentToday = new Map<string, number>();
  for (const r of await db.insightDaily.groupBy({ by: ["objectId", "currency", "source"], where: { level: "ad", date: today }, _sum: { spend: true } })) {
    spentToday.set(r.objectId, (spentToday.get(r.objectId) ?? 0) + (money.usd({ objectId: r.objectId, spend: r._sum.spend, currency: r.currency, source: r.source }).usd?.toNumber() ?? 0));
  }

  type Sums = { spend: number; impressions: number; linkClicks: number; video3s: number; thruplays: number; purchases: number; conversations: number; fx: string[] };
  const byAd = new Map<string, Sums>();
  for (const r of insights) {
    const s = byAd.get(r.objectId) ?? { spend: 0, impressions: 0, linkClicks: 0, video3s: 0, thruplays: 0, purchases: 0, conversations: 0, fx: [] };
    const dollars = money.usd({ objectId: r.objectId, spend: r._sum.spend, currency: r.currency, source: r.source });
    if (dollars.usd === null) s.fx = mergeMissing(s.fx, [dollars.missing!]);
    else s.spend += dollars.usd.toNumber();
    for (const k of ["impressions", "linkClicks", "video3s", "thruplays", "purchases", "conversations"] as const) s[k] += r._sum[k] ?? 0;
    byAd.set(r.objectId, s);
  }
  const ordersByAd = new Map<string, typeof orders>();
  for (const o of orders) ordersByAd.set(o.adId!, [...(ordersByAd.get(o.adId!) ?? []), o]);

  const countsOf = (adMetaId: string): Counts => {
    const i = byAd.get(adMetaId);
    const list = ordersByAd.get(adMetaId) ?? [];
    const mature = list.filter((o) => o.matureAt <= now);
    const messaging = list.some((o) => o.channel !== "website");
    return {
      ...(i?.fx.length ? { fxMissing: i.fx } : {}),
      spend: i?.spend ?? 0, impressions: i?.impressions ?? 0, clicks: i?.linkClicks ?? 0, v3s: i?.video3s ?? 0, thru: i?.thruplays ?? 0, purchases: i?.purchases ?? 0,
      conversations: messaging || (i?.conversations ?? 0) > 0 ? i?.conversations ?? 0 : undefined,
      orders: list.length, mature: mature.length, confirmed: mature.filter((o) => CONFIRMED.has(o.status)).length,
      shipments: list.filter((o) => SHIPPED.has(o.status)).length, delivered: list.filter((o) => o.status === "delivered").length, returned: list.filter((o) => o.status === "returned").length,
    };
  };

  const campaigns: CampaignRow[] = campaignsDb.map((c) => ({
    id: c.metaId,
    account: c.account.metaId,
    name: c.name,
    productCode: c.productCode,
    status: statusOf(c.status),
    needsNaming: !c.namingOk,
    market: campaignMarket(c.parsedMarket, c.account.market),
    adsets: c.adsets.map((s) => ({
      id: s.metaId,
      name: s.name,
      status: statusOf(s.status, s.learningStage),
      dailyBudget: Number(s.dailyBudget ?? 0),
      learning: { events: s.ads.reduce((n, a) => n + (byAd.get(a.metaId)?.purchases ?? 0), 0), of: 50 },
      ads: s.ads.map((a) => ({ id: a.metaId, name: a.name, status: statusOf(a.status), counts: countsOf(a.metaId) })),
    })),
  }));

  const accounts: Account[] = accountsDb.map((a) => {
    const adIds = campaigns.filter((c) => c.account === a.metaId).flatMap((c) => c.adsets.flatMap((s) => s.ads.map((x) => x.id)));
    return {
      id: a.metaId, name: a.name, market: (a.market ?? "SY") as Account["market"], level: Math.min(3, Math.max(0, a.autonomyLevel)) as Account["level"],
      dailyCap: Number(a.dailyCap ?? 0), spentToday: adIds.reduce((s, id) => s + (spentToday.get(id) ?? 0), 0), plannedToday: Number(a.dailyCap ?? 0) * 0.9, paymentOk: a.paymentStatus !== "failed",
    };
  });

  const seen = orderMarkets.map((o) => ({ code: o.productCode, market: o.market }));
  return { products, accounts, campaigns, demo: false, omsStale: stale, seen };
}

/** loadDataset for a screen: without `money.view` no profit, margin, product cost or break-even leaves the server (docs/rebuild/05-permissions.md §3). */
export const loadDataset = async (...a: Parameters<typeof loadDatasetRaw>) => forViewer(await loadDatasetRaw(...a));

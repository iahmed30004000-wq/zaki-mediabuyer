/**
 * WHERE THE SCREENS' NUMBERS COME FROM (T1.8). `MOCK_MODE=1`: the demo set. Otherwise the same shapes built from the
 * database — Meta's archive (InsightDaily) and the OMS orders (AttributedOrder) over the last `days` days — so every
 * screen, the report and the export read real numbers through the very same calculator.
 */
import { db } from "@/server/db";
import { DEMO, type Account, type CampaignRow, type Counts, type Dataset, type Product, type RowStatus } from "@/lib/mock/data";

const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
const SHIPPED = new Set(["shipped", "delivered", "returned"]);

function statusOf(meta: string, learning?: string | null): RowStatus {
  if (meta === "PAUSED" || meta === "CAMPAIGN_PAUSED" || meta === "ADSET_PAUSED" || meta === "ARCHIVED") return "paused";
  if (meta === "DISAPPROVED" || meta === "WITH_ISSUES") return "rejected";
  if (learning === "LEARNING") return "learning";
  return "active";
}

export async function loadDataset(days = 7, now = new Date()): Promise<Dataset> {
  if (process.env.MOCK_MODE === "1") return DEMO;
  const since = new Date(now.getTime() - days * 86_400_000);

  const [econ, accountsDb, campaignsDb, insights, orders] = await Promise.all([
    db.productEconomics.findMany(),
    db.adAccount.findMany(),
    db.campaign.findMany({ include: { adsets: { include: { ads: true } }, account: true } }),
    db.insightDaily.groupBy({ by: ["objectId"], where: { level: "ad", date: { gte: since } }, _sum: { spend: true, impressions: true, linkClicks: true, video3s: true, thruplays: true, purchases: true, conversations: true } }),
    db.attributedOrder.findMany({ where: { createdAtOms: { gte: since }, isFake: false, adId: { not: null } }, select: { adId: true, status: true, matureAt: true, channel: true } }),
  ]);

  const products: Product[] = econ.map((p) => ({
    code: p.productCode, name: p.name, market: p.market as Product["market"], price: Number(p.price), unitCost: Number(p.unitCost), delivery: Number(p.deliveryFee),
    returnFee: Number(p.returnFee), codFee: Number(p.codFeePct), confirmCost: Number(p.confirmCost), stockDays: p.stockDays ?? 0, shipmentsToDate: p.source === "actual" ? 50 : 0,
  }));

  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const spentToday = new Map(
    (await db.insightDaily.groupBy({ by: ["objectId"], where: { level: "ad", date: today }, _sum: { spend: true } })).map((r) => [r.objectId, Number(r._sum.spend ?? 0)]),
  );

  const byAd = new Map(insights.map((i) => [i.objectId, i._sum]));
  const ordersByAd = new Map<string, typeof orders>();
  for (const o of orders) ordersByAd.set(o.adId!, [...(ordersByAd.get(o.adId!) ?? []), o]);

  const countsOf = (adMetaId: string): Counts => {
    const i = byAd.get(adMetaId);
    const list = ordersByAd.get(adMetaId) ?? [];
    const mature = list.filter((o) => o.matureAt <= now);
    const messaging = list.some((o) => o.channel !== "website");
    return {
      spend: Number(i?.spend ?? 0), impressions: i?.impressions ?? 0, clicks: i?.linkClicks ?? 0, v3s: i?.video3s ?? 0, thru: i?.thruplays ?? 0, purchases: i?.purchases ?? 0,
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

  return { products, accounts, campaigns, demo: false };
}

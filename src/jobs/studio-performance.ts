/**
 * What the content studio pulls (docs/STUDIO_DATA_CONTRACT_AR.md §3): per linked ad and order day, Meta's spend from
 * the archive and the OMS outcome of the orders placed that day. Days are the archive's UTC days, as in truth.ts.
 */
import { db } from "@/server/db";
import { spendConverter } from "@/server/money";
import { performanceRows, studioAdName, vpIdFromAdName, type LinkedAd } from "@/core/studio-contract";

const DAY = 86_400_000;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The ads that came from a studio script: named the studio's way on Meta, or a CR##### the registry ties to a VP id. */
export async function linkedAds(): Promise<LinkedAd[]> {
  const ads = await db.ad.findMany({ include: { adSet: { include: { campaign: true } } } });
  const codes = ads.map((a) => a.creativeCode).filter((c): c is string => !!c);
  const assets = await db.creativeAsset.findMany({ where: { crCode: { in: codes }, sourceRef: { not: null } } });
  const vpOf = new Map(assets.map((a) => [a.crCode, a.sourceRef!]));
  const out: LinkedAd[] = [];
  for (const ad of ads) {
    if (vpIdFromAdName(ad.name)) {
      out.push({ metaAdId: ad.metaId, adName: ad.name });
      continue;
    }
    const vpId = ad.creativeCode ? vpOf.get(ad.creativeCode) : undefined;
    if (!vpId) continue;
    const c = ad.adSet.campaign;
    out.push({ metaAdId: ad.metaId, adName: studioAdName({ market: c.parsedMarket, productCode: c.productCode, pageCode: ad.adSet.pageCode, vpId }) });
  }
  return out;
}

export async function studioPerformance(from: Date, to: Date) {
  const ads = await linkedAds();
  if (!ads.length) return [];
  const ids = ads.map((a) => a.metaAdId);
  const end = new Date(to.getTime() + DAY);
  const insights = await db.insightDaily.findMany({ where: { level: "ad", objectId: { in: ids }, date: { gte: from, lte: to } } });
  // an order without the ad id but with the ad's exact name is the same ad (spec 5.7, method «naming»)
  const byName = new Map((await db.ad.findMany({ where: { metaId: { in: ids } }, select: { metaId: true, name: true } })).map((a) => [a.name, a.metaId]));
  const orders = await db.attributedOrder.findMany({
    where: { createdAtOms: { gte: from, lt: end }, isFake: false, OR: [{ adId: { in: ids } }, { adId: null, adName: { in: [...byName.keys()] } }] },
    select: { adId: true, adName: true, createdAtOms: true, status: true, collected: true },
  });
  // v6 · P11: the studio compares spend in dollars; an (ad, day) whose spend has no rate is left out whole — never a row that reads «no spend»
  const money = await spendConverter();
  const holed = new Set<string>();
  const spend = insights.flatMap((i) => {
    const c = money.usd(i);
    if (c.usd === null) {
      holed.add(`${i.objectId}|${dayKey(i.date)}`);
      return [];
    }
    return [{ metaAdId: i.objectId, date: dayKey(i.date), spend: c.usd.toString(), impressions: i.impressions, video3s: i.video3s }];
  });
  const rows = performanceRows(
    ads,
    spend,
    orders.flatMap((o) => {
      const metaAdId = o.adId ?? byName.get(o.adName ?? "") ?? "";
      return holed.has(`${metaAdId}|${dayKey(o.createdAtOms)}`) ? [] : [{ metaAdId, date: dayKey(o.createdAtOms), status: o.status, collected: o.collected?.toString() ?? null }];
    }),
  );
  return rows;
}

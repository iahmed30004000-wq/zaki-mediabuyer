import { AdsView, type TreeRow } from "@/components/ads/ads-view";
import { parseAdName, parseAdSetName, parseCampaignName, STAGE_AR, OBJECTIVE_AR, MARKET_AR } from "@/core/naming";
import { adsetCounts, campaignCounts, productView, targetsOf, viewOf } from "@/lib/mock/data";
import { loadDataset } from "@/lib/source";
import { loadExperiments, loadLaunchOptions } from "@/lib/launch-view";

export const metadata = { title: "الإعلانات" };

/** Builds the tree on the server (every number through the calculator) and hands plain rows to the client view. */
export const dynamic = "force-dynamic";

export default async function AdsPage({ searchParams }: { searchParams: { tab?: string; open?: string; product?: string } }) {
  const [ds, launchOptions, experiments] = await Promise.all([loadDataset(), loadLaunchOptions(), loadExperiments()]);
  const rows: TreeRow[] = ds.campaigns.map((cmp) => {
    const p = cmp.productCode ? ds.products.find((x) => x.code === cmp.productCode) : undefined;
    const parsed = parseCampaignName(cmp.name);
    const account = ds.accounts.find((a) => a.id === cmp.account) ?? { market: "SY" as const };
    return {
      id: cmp.id,
      level: "campaign" as const,
      name: cmp.name,
      status: cmp.status,
      product: p ? { code: p.code, name: p.name } : null,
      market: account.market,
      decoded: parsed ? [MARKET_AR[parsed.market], p?.name ?? parsed.productCode, OBJECTIVE_AR[parsed.objective], STAGE_AR[parsed.stage]] : null,
      needsNaming: !!cmp.needsNaming,
      view: viewOf(campaignCounts(cmp), p),
      tOrder: p ? targetsOf(p).tOrder : null,
      children: cmp.adsets.map((s) => {
        const ps = parseAdSetName(s.name);
        return {
          id: s.id,
          level: "adset" as const,
          name: s.name,
          status: s.status,
          product: p ? { code: p.code, name: p.name } : null,
          market: account.market,
          decoded: ps ? [ps.audience === "BROAD" ? "جمهور واسع" : ps.audience, `صفحة ${ps.pageCode}`, `مفهوم ${ps.conceptId}`] : null,
          learning: s.learning,
          budget: s.dailyBudget,
          view: viewOf(adsetCounts(s), p),
          tOrder: p ? targetsOf(p).tOrder : null,
          children: s.ads.map((a) => {
            const pa = parseAdName(a.name);
            return {
              id: a.id,
              level: "ad" as const,
              name: a.name,
              status: a.status,
              note: a.note,
              product: p ? { code: p.code, name: p.name } : null,
              market: account.market,
              decoded: pa ? [`فيديو ${pa.creativeCode}`, `خطّاف ${pa.hookCode}`, `زاوية ${pa.angleCode}`, `صفحة هبوط ${pa.lpCode}`] : null,
              counts: { impressions: a.counts.impressions, clicks: a.counts.clicks, orders: a.counts.orders, confirmed: a.counts.confirmed, delivered: a.counts.delivered, conversations: a.counts.conversations ?? null },
              view: viewOf(a.counts, p),
              tOrder: p ? targetsOf(p).tOrder : null,
              children: [],
            };
          }),
        };
      }),
    };
  });

  const products = ds.products.map((p) => {
    const v = productView(p.code, ds);
    return { code: p.code, name: p.name, market: p.market, stockDays: p.stockDays, view: v.view, targets: v.targets };
  });

  return <AdsView rows={rows} products={products} initialTab={searchParams.tab ?? "campaigns"} openId={searchParams.open} productFilter={searchParams.product} launchOptions={launchOptions} experiments={experiments} />;
}

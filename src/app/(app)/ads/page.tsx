import { AdsTabs } from "@/components/ads/ads-tabs";
import { AdsView } from "@/components/ads/ads-view";
import { DataHealth } from "@/components/pages/data-health";
import { ScaleLadder } from "@/components/pages/scale-ladder";
import type { Filters } from "@/core/ads-table";
import { loadAdsTable } from "@/lib/ads-table";
import { loadExperiments, loadLaunchOptions } from "@/lib/launch-view";
import { productView } from "@/lib/mock/data";
import { loadDataset } from "@/lib/source";
import { loadColumns } from "@/server/ads-prefs";
import { currentCaller } from "@/server/auth";

export const metadata = { title: "الإعلانات" };

/** Builds the table on the server (every number through the calculator) and hands plain rows to the client view. */
export const dynamic = "force-dynamic";

interface Search {
  tab?: string;
  open?: string;
  product?: string;
  page?: string;
  kind?: string;
  status?: string;
  market?: string;
  d?: string;
  from?: string;
  to?: string;
}

export default async function AdsPage({ searchParams }: { searchParams: Search }) {
  // «الصحة» and «سلّم التكبير» are server-rendered tabs of their own (the old reports/decisions pages live here now);
  // ?tab=safety|data are the addresses the alerts used to point at
  const tab = searchParams.tab === "safety" || searchParams.tab === "data" ? "health" : searchParams.tab ?? "campaigns";
  if (tab === "health" || tab === "scale") {
    return (
      <div className="space-y-6">
        <AdsTabs active={tab} />
        {tab === "health" ? <DataHealth /> : <ScaleLadder />}
      </div>
    );
  }
  const caller = await currentCaller();
  const [table, ds, launchOptions, experiments, columns] = await Promise.all([
    loadAdsTable(searchParams),
    loadDataset(),
    loadLaunchOptions(),
    loadExperiments(),
    loadColumns(caller && !caller.demo ? caller.id : null),
  ]);

  const products = ds.products.map((p) => {
    const v = productView(p.code, ds);
    return { code: p.code, name: p.name, market: p.market, stockDays: p.stockDays, view: v.view, targets: v.targets };
  });

  // the filters live in the address: Back, a refresh and a shared link keep them
  const filters: Filters = {
    product: searchParams.product || null,
    page: searchParams.page || null,
    kind: searchParams.kind === "test" || searchParams.kind === "scale" ? searchParams.kind : "all",
    status: searchParams.status || null,
    market: searchParams.market === "SY" || searchParams.market === "JO" ? searchParams.market : null,
  };

  return <AdsView table={table} columns={columns} filters={filters} products={products} initialTab={searchParams.tab ?? "campaigns"} openId={searchParams.open} launchOptions={launchOptions} experiments={experiments} />;
}

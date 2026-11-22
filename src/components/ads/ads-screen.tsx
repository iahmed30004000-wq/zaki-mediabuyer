import { AdsView } from "@/components/ads/ads-view";
import type { Filters } from "@/core/ads-table";
import { loadAdsTable } from "@/lib/ads-table";
import { loadExperiments, loadLaunchOptions } from "@/lib/launch-view";
import { productView } from "@/core/ads-model";
import { loadDataset } from "@/lib/source";
import { loadColumns } from "@/server/ads-prefs";
import { currentCaller } from "@/server/auth";

export interface AdsSearch {
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

/**
 * The ads table and its views, built on the server (every number through the calculator) and handed as plain rows to the client view.
 * `tab` says which of the three the address is: the products (the dashboard for now), the campaigns, or the tests.
 */
export async function AdsScreen({ tab, searchParams }: { tab: "products" | "campaigns" | "tests"; searchParams: AdsSearch }) {
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

  return <AdsView table={table} columns={columns} filters={filters} products={products} initialTab={tab} openId={searchParams.open} launchOptions={launchOptions} experiments={experiments} />;
}

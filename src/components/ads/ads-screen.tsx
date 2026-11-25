import { AdsView } from "@/components/ads/ads-view";
import { FxNotice } from "@/components/numbers/fx-notice";
import { MarketSwitcher } from "@/components/numbers/market-switcher";
import { isMarket } from "@/core/markets";
import type { Filters } from "@/core/ads-table";
import { loadAdsTable } from "@/lib/ads-table";
import { loadExperiments, loadLaunchOptions } from "@/lib/launch-view";
import { productMarketViews } from "@/core/ads-model";
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

  const market = isMarket(searchParams.market) ? searchParams.market : null;
  // v6 · P11: «حسب المنتج» is a line per product AND market — a product in two markets is never folded into one
  const products = productMarketViews(ds)
    .filter((v) => !market || v.market === market)
    .map((v) => ({ key: v.key, code: v.product.code, name: v.name, market: v.market, stockDays: v.product.stockDays, view: v.view, targets: v.targets }));

  // the filters live in the address: Back, a refresh and a shared link keep them
  const filters: Filters = {
    product: searchParams.product || null,
    page: searchParams.page || null,
    kind: searchParams.kind === "test" || searchParams.kind === "scale" ? searchParams.kind : "all",
    status: searchParams.status || null,
    market,
  };

  return (
    <div className="space-y-4">
      <FxNotice codes={table.missingRates ?? []} />
      {tab === "tests" ? <MarketSwitcher market={market} /> : null}
      <AdsView table={table} columns={columns} filters={filters} products={products} initialTab={tab} openId={searchParams.open} launchOptions={launchOptions} experiments={experiments.filter((e) => !market || e.market === market)} />
    </div>
  );
}

/**
 * The export of the demo site (`MOCK_MODE=1`, or no truth rows yet): the demo numbers as rows of the workbook. It lives here, not in the route, so that the route (a part of the app) never
 * imports the demo data itself — v6 · P8, `mockInUi` of the ratchet. Every figure still goes through the real calculator (`productView` → src/core/economics.ts).
 */
import { allAds, campaignCounts, productView } from "@/core/ads-model";
import type { ExportRow } from "@/io/export";
import { ACCOUNTS, CAMPAIGNS, DEMO, PRODUCTS } from "@/lib/mock/data";

type View = ReturnType<typeof productView>["view"];

const rowOf = (level: string, name: string, v: View, counts: { orders: number; confirmed: number; delivered: number }): ExportRow => ({
  level,
  name,
  spend: v.spend,
  orders: counts.orders,
  confirmed: counts.confirmed,
  delivered: counts.delivered,
  costPerConfirmed: v.costPerConfirmed,
  ceiling: v.ceiling,
  confirmRate: v.confirmRate === null ? null : v.confirmRate / 100,
  deliveryRate: v.deliveryRate === null ? null : v.deliveryRate / 100,
  profit: v.profit,
  roas: v.roas,
});

export function demoExport(): { rows: ExportRow[]; title: string } {
  const products = PRODUCTS.map((p) => productView(p.code, DEMO)).map(({ product, counts, view }) => rowOf("منتج", product.name, view, counts));
  const ads = allAds(DEMO).map(({ ad, view }) => rowOf("إعلان", ad.name, view, ad.counts));
  return {
    rows: [...products, ...ads],
    title: `الحقيقة — بيانات تجريبية (${ACCOUNTS.length} حسابات · ${CAMPAIGNS.length} حملات · ${campaignCounts(CAMPAIGNS[0]!).orders}+ طلب)`,
  };
}

import { buildWorkbook, type ExportRow } from "@/io/export";
import { errorResponse, requireCapability } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { ACCOUNTS, CAMPAIGNS, PRODUCTS, campaignCounts, productView, allAds } from "@/lib/mock/data";

export const dynamic = "force-dynamic";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** GET /api/export — the truth as Excel. Real rows from the database when there are any; the demo numbers otherwise. */
export async function GET() {
  try {
    const caller = await requireCapability("view");
    const latest = await db.truthDaily.findFirst({ orderBy: { date: "desc" } }).catch(() => null);
    let rows: ExportRow[];
    let title: string;
    if (latest && process.env.MOCK_MODE !== "1") {
      const truth = await db.truthDaily.findMany({ where: { date: latest.date }, orderBy: [{ level: "desc" }, { objectId: "asc" }] });
      const names = new Map([...(await db.productEconomics.findMany()).map((p) => [p.productCode, p.name] as const), ...(await db.ad.findMany({ select: { metaId: true, name: true } })).map((a) => [a.metaId, a.name] as const)]);
      rows = truth.map((t) => ({ level: t.level === "product" ? "منتج" : "إعلان", name: names.get(t.objectId) ?? t.objectId, spend: n(t.spendWithFee), orders: t.orders, confirmed: t.confirmed, delivered: t.delivered, costPerConfirmed: n(t.costPerConfirmed), ceiling: n(t.scalingCeiling), confirmRate: n(t.confirmRate), deliveryRate: n(t.deliveryRate), profit: n(t.profitAfterCosts), roas: n(t.trueRoas) }));
      title = `الحقيقة — ${latest.date.toISOString().slice(0, 10)}`;
    } else {
      const products = PRODUCTS.map((p) => productView(p.code)).map(({ product, counts, view }) => ({ level: "منتج", name: product.name, spend: view.spend, orders: counts.orders, confirmed: counts.confirmed, delivered: counts.delivered, costPerConfirmed: view.costPerConfirmed, ceiling: view.ceiling, confirmRate: view.confirmRate === null ? null : view.confirmRate / 100, deliveryRate: view.deliveryRate === null ? null : view.deliveryRate / 100, profit: view.profit, roas: view.roas }));
      const ads = allAds().map(({ ad, view }) => ({ level: "إعلان", name: ad.name, spend: view.spend, orders: ad.counts.orders, confirmed: ad.counts.confirmed, delivered: ad.counts.delivered, costPerConfirmed: view.costPerConfirmed, ceiling: view.ceiling, confirmRate: view.confirmRate === null ? null : view.confirmRate / 100, deliveryRate: view.deliveryRate === null ? null : view.deliveryRate / 100, profit: view.profit, roas: view.roas }));
      rows = [...products, ...ads];
      title = `الحقيقة — بيانات تجريبية (${ACCOUNTS.length} حسابات · ${CAMPAIGNS.length} حملات · ${campaignCounts(CAMPAIGNS[0]!).orders}+ طلب)`;
    }
    const file = await buildWorkbook(rows, title);
    if (!caller.demo) await audit({ type: "user", id: caller.id }, "export.truth_xlsx");
    return new Response(new Blob([file as BlobPart]), {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="mediabuyer-truth-${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

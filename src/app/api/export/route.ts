import { buildWorkbook, type ExportRow } from "@/io/export";
import { errorResponse, requireCapability } from "@/server/auth";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { demoExport } from "@/lib/export-demo";
import { isDemo } from "@/core/readiness";
import { stampOf } from "@/core/freshness";
import { nameOf, productLabels } from "@/core/product-name";
import { marketLabel, splitKey } from "@/core/markets";
import { truthMoney } from "@/core/truth-money";
import { loadSourceFacts } from "@/lib/source-facts";

export const dynamic = "force-dynamic";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** GET /api/export — the truth as Excel. Real rows from the database when there are any; the demo numbers otherwise. */
export async function GET() {
  try {
    const caller = await requireCapability("money.view");
    const latest = await db.truthDaily.findFirst({ orderBy: { date: "desc" } }).catch(() => null);
    let rows: ExportRow[];
    let title: string;
    if (latest && !isDemo(process.env)) {
      const truth = await db.truthDaily.findMany({ where: { date: latest.date }, orderBy: [{ level: "desc" }, { objectId: "asc" }] });
      // U-08: a product is written by its Arabic name
      const labels = productLabels(await db.productEconomics.findMany(), await db.productAlias.findMany({ select: { productCode: true, alias: true } }));
      const names = new Map([...(await db.productEconomics.findMany()).map((p) => [p.productCode, nameOf(labels, p.productCode)] as const), ...(await db.ad.findMany({ select: { metaId: true, name: true } })).map((a) => [a.metaId, a.name] as const)]);
      // v6 · P11: a figure that could not be worked out is an empty cell, and the line says why; a product's other market says its market
      const nameFor = (key: string) => {
        const { code, suffix } = splitKey(key);
        const base = names.get(code) ?? code;
        return suffix === null ? base : `${base} — ${marketLabel(suffix === "??" ? null : suffix)}`;
      };
      rows = truth.map((t) => {
        const m = truthMoney(t);
        const name = t.level === "product" ? nameFor(t.objectId) : names.get(t.objectId) ?? t.objectId;
        return { level: t.level === "product" ? "منتج" : "إعلان", name: m.gap ? `${name} (${m.gap})` : name, spend: m.spend, orders: t.orders, confirmed: t.confirmed, delivered: t.delivered, costPerConfirmed: m.costPerConfirmed, ceiling: m.ceiling, confirmRate: n(t.confirmRate), deliveryRate: n(t.deliveryRate), profit: m.profit, roas: m.roas };
      });
      // R-23: the file says whether its figures are «حقيقي» or «تقدير» (the OMS silent for three hours turns them into an estimate)
      title = `الحقيقة — ${latest.date.toISOString().slice(0, 10)} — ${stampOf(await loadSourceFacts())}`;
    } else {
      ({ rows, title } = demoExport());
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

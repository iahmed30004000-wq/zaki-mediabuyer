/**
 * report.morning (spec 12.1) — the morning report, built by CODE from the computed truth, so every figure is exact
 * and carries its source. The agent (M11) may add one short reading at the end; if the model is down or refused,
 * the report goes without it (spec 9.8 «التقرير بلا آراء الوكلاء»).
 */
import { db } from "@/server/db";
import { fmt } from "@/lib/format";
import { getSetting } from "@/server/settings";
import { lastSuccess } from "./runner";
import { lastOmsSync, omsStale } from "./oms-health";

const pct = (v: unknown) => (v === null || v === undefined ? null : Number(v) * 100);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function buildMorningReport(day: Date): Promise<string> {
  const window = await getSetting("attribution.window");
  const date = new Date(`${day.toISOString().slice(0, 10)}T00:00:00Z`);
  const products = await db.truthDaily.findMany({ where: { level: "product", date } });
  const ads = await db.truthDaily.findMany({ where: { level: "ad", date } });
  const econ = new Map((await db.productEconomics.findMany()).map((p) => [p.productCode, p]));
  const adNames = new Map((await db.ad.findMany({ select: { metaId: true, name: true } })).map((a) => [a.metaId, a.name]));
  const insights = await db.insightDaily.findMany({ where: { level: "ad", date } });
  const purchases = insights.reduce((s, i) => s + i.purchases, 0);

  const total = products.reduce(
    (s, p) => ({ spend: s.spend + Number(p.spendWithFee), orders: s.orders + p.orders, confirmed: s.confirmed + p.confirmed, mature: s.mature + p.matureOrders }),
    { spend: 0, orders: 0, confirmed: 0, mature: 0 },
  );
  const orphanSpend = insights.length ? Number(insights.reduce((s, i) => s + Number(i.spend), 0)) * 1.01 - total.spend : 0;
  const best = ads.filter((a) => a.costPerConfirmed !== null && a.confirmed >= 3).sort((a, b) => Number(a.costPerConfirmed) - Number(b.costPerConfirmed)).slice(0, 3);
  // the gap compares like with like: pixel purchases against WEBSITE orders (messaging orders have no pixel event)
  const webOrders = await db.attributedOrder.count({ where: { channel: "website", isFake: false, createdAtOms: { gte: date, lt: new Date(date.getTime() + 86_400_000) } } });
  const gap = webOrders ? Math.round(((purchases - webOrders) / webOrders) * 100) : null;
  const metaAge = await lastSuccess("meta.sync");
  // The last REAL OMS sync — a skipped or backed-off slot is not one. Over 3 h old, the OMS figures are «تقدير».
  const omsAge = lastOmsSync(await db.jobRun.findMany({ where: { job: "oms.sync" }, orderBy: { startedAt: "desc" }, take: 48 }));
  const truthTag = omsStale(omsAge, new Date()) ? "تقدير — الـ OMS ما ردّ من أكتر من 3 ساعات" : "حقيقي";
  const dateAr = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long" }).format(day);

  const lines = [
    `تقرير الإعلانات — ${dateAr}`,
    `(الإسناد: ${window} | الرقم مبدئي | الحقيقة على الطلبات الناضجة)`,
    "",
    `1) الحساب: صرف ${fmt(total.spend, "$")} · طلبات ${total.orders} · مؤكد ${total.confirmed} (${fmt(total.mature ? (total.confirmed / total.mature) * 100 : null, "%")}) · تكلفة المؤكد ${fmt(total.confirmed ? total.spend / total.confirmed : null, "$")} [${truthTag}]`,
    "2) لكل منتج:",
    ...products.map((p) => {
      const e = econ.get(p.objectId);
      return `   ${e?.name ?? p.objectId}: صرف ${fmt(num(p.spendWithFee), "$")} · تكلفة المؤكد ${fmt(num(p.costPerConfirmed), "$")} (السقف ${fmt(num(p.scalingCeiling), "$")}) · مُسلَّم ${p.delivered} · ربح المُسلَّم ${fmt(num(p.profitPerDelivered), "$")} [${e?.source === "actual" ? "حقيقي" : "تقدير"}]`;
    }),
    "3) أفضل 3 إعلانات:",
    ...(best.length ? best.map((a) => `   ${(adNames.get(a.objectId) ?? a.objectId).split("_")[0]} · صرف ${fmt(num(a.spendWithFee), "$")} · تكلفة المؤكد ${fmt(num(a.costPerConfirmed), "$")} · تأكيد ${fmt(pct(a.confirmRate), "%")}`) : ["   — بيانات غير كافية"]),
    `8) صحة البيانات: فرق ميتا/حقيقي ${gap === null ? "—" : `${gap}%`} · صرف يتيم ${fmt(Math.max(0, orphanSpend), "$")} · آخر سحب ميتا ${metaAge ? metaAge.toISOString().slice(11, 16) : "—"} · آخر مزامنة OMS ${omsAge ? omsAge.toISOString().slice(11, 16) : "—"}`,
  ];
  return lines.join("\n");
}

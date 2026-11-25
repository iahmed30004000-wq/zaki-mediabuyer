/**
 * report.morning (spec 12.1) — the morning report, built by CODE from the computed truth, so every figure is exact
 * and carries its source. The agent (M11) may add one short reading at the end; if the model is down or refused,
 * the report goes without it (spec 9.8 «التقرير بلا آراء الوكلاء»).
 */
import { db } from "@/server/db";
import { fmt } from "@/lib/format";
import { getSetting } from "@/server/settings";
import { lastSuccess } from "./runner";
import { lastOmsSync } from "./oms-health";
import { loadSourceFacts } from "@/lib/source-facts";
import { badgeOf, omsWord } from "@/core/freshness";
import { nameOf, productLabels } from "@/core/product-name";
import { costPerConfirmedText, spendText } from "@/core/morning-text";
import { mergeMissing, missingRateText, sumUsd } from "@/core/currency";
import { marketLabel, splitKey } from "@/core/markets";
import { decodeGap, truthMoney } from "@/core/truth-money";
import { spendConverter } from "@/server/money";

const pct = (v: unknown) => (v === null || v === undefined ? null : Number(v) * 100);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function buildMorningReport(day: Date): Promise<string> {
  const window = await getSetting("attribution.window");
  const date = new Date(`${day.toISOString().slice(0, 10)}T00:00:00Z`);
  const products = await db.truthDaily.findMany({ where: { level: "product", date } });
  const ads = await db.truthDaily.findMany({ where: { level: "ad", date } });
  const econRows = await db.productEconomics.findMany();
  const econ = new Map(econRows.map((p) => [p.productCode, p]));
  // U-08: a product is written by its Arabic name
  const labels = productLabels(econRows, await db.productAlias.findMany({ select: { productCode: true, alias: true } }));
  const adNames = new Map((await db.ad.findMany({ select: { metaId: true, name: true } })).map((a) => [a.metaId, a.name]));
  const insights = await db.insightDaily.findMany({ where: { level: "ad", date } });
  const purchases = insights.reduce((s, i) => s + i.purchases, 0);

  const total = products.reduce(
    (s, p) => ({ spend: s.spend + (truthMoney(p).spend ?? 0), orders: s.orders + p.orders, confirmed: s.confirmed + p.confirmed, mature: s.mature + p.matureOrders }),
    { spend: 0, orders: 0, confirmed: 0, mature: 0 },
  );
  // v6 · P11: in dollars; a currency with no rate leaves the account's spend unknown — never a sum without it
  const money = await spendConverter();
  const raw = sumUsd(insights.map((i) => ({ amount: String(i.spend), currency: money.currencyOf(i) })), money.rates);
  const noRate = mergeMissing(raw.missing, decodeGap(...products.map((p) => p.spendMissing)).fx);
  const accountSpend = noRate.length ? null : total.spend;
  const orphanSpend = insights.length && raw.usd && !noRate.length ? raw.usd.toNumber() * 1.01 - total.spend : null;
  // only an ad whose orders all matured has a cost per confirmed worth ranking (R-15)
  const best = ads.filter((a) => !a.spendMissing && a.costPerConfirmed !== null && a.confirmed >= 3 && a.matureOrders >= a.orders).sort((a, b) => Number(a.costPerConfirmed) - Number(b.costPerConfirmed)).slice(0, 3);
  // the gap compares like with like: pixel purchases against WEBSITE orders (messaging orders have no pixel event)
  const webOrders = await db.attributedOrder.count({ where: { channel: "website", isFake: false, createdAtOms: { gte: date, lt: new Date(date.getTime() + 86_400_000) } } });
  const gap = webOrders ? Math.round(((purchases - webOrders) / webOrders) * 100) : null;
  const metaAge = await lastSuccess("meta.sync");
  // The last REAL OMS sync — a skipped or backed-off slot is not one. Over 3 h old, EVERY figure that stands on the OMS is «تقدير» (R-23: one rule, `src/core/freshness.ts`, for every screen, report and export).
  const omsAge = lastOmsSync(await db.jobRun.findMany({ where: { job: "oms.sync" }, orderBy: { startedAt: "desc" }, take: 48 }));
  const facts = await loadSourceFacts({ now: new Date() });
  const word = omsWord(facts);
  const truthTag = word === "حقيقي" ? "حقيقي" : "تقدير — الـ OMS ما ردّ من أكتر من 3 ساعات";
  const dateAr = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "long", day: "numeric", month: "long" }).format(day);

  const lines = [
    `تقرير الإعلانات — ${dateAr}`,
    `(الإسناد: ${window} | الرقم مبدئي | الحقيقة على الطلبات الناضجة)`,
    "",
    `1) الحساب: صرف ${spendText(accountSpend, insights.length > 0)} · طلبات ${total.orders} · مؤكد ${total.confirmed} (${fmt(total.mature ? (total.confirmed / total.mature) * 100 : null, "%")}) · تكلفة المؤكد ${costPerConfirmedText({ spend: insights.length > 0 ? accountSpend : null, confirmed: total.confirmed, orders: total.orders, matureOrders: total.mature })} [${truthTag}]`,
    ...(noRate.length ? [`   ${missingRateText(noRate)} — اكتبه بالإعدادات ← القواعد ← أسعار الصرف`] : []),
    "2) لكل منتج:",
    ...products.map((p) => {
      const { code, suffix } = splitKey(p.objectId);
      const e = econ.get(code);
      const m = truthMoney(p);
      const name = suffix === null ? nameOf(labels, code) : `${nameOf(labels, code)} — ${marketLabel(suffix === "??" ? null : suffix)}`;
      return `   ${name}: صرف ${spendText(m.spend)} · تكلفة المؤكد ${costPerConfirmedText({ spend: m.spend, confirmed: p.confirmed, orders: p.orders, matureOrders: p.matureOrders })} (السقف ${fmt(m.ceiling, "$")}) · مُسلَّم ${p.delivered} · ربح المُسلَّم ${fmt(m.profitPerDelivered, "$")} [${badgeOf(e?.source === "actual", facts)}]${m.gap ? ` — ${m.gap}` : ""}`;
    }),
    "3) أفضل 3 إعلانات:",
    ...(best.length ? best.map((a) => `   ${(adNames.get(a.objectId) ?? a.objectId).split("_")[0]} · صرف ${fmt(truthMoney(a).spend, "$")} · تكلفة المؤكد ${fmt(num(a.costPerConfirmed), "$")} · تأكيد ${fmt(pct(a.confirmRate), "%")}`) : ["   — بيانات غير كافية"]),
    `8) صحة البيانات: فرق ميتا/حقيقي ${gap === null ? "—" : `${gap}%`} · صرف يتيم ${orphanSpend === null ? "—" : fmt(Math.max(0, orphanSpend), "$")} · آخر سحب ميتا ${metaAge ? metaAge.toISOString().slice(11, 16) : "—"} · آخر مزامنة OMS ${omsAge ? omsAge.toISOString().slice(11, 16) : "—"}`,
  ];
  return lines.join("\n");
}

/**
 * M02 — the daily analyst (spec 11.2 / 11.4), 08:00. The funnel and the weakest step are the code's
 * (src/core/diagnosis.ts); the agent may reword the cause and the action for each product (without numbers) and add
 * the day's top decisions. Stored as a report («analysis») under the reports. Without a model the code's words stand.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { ask, AgentUnavailable, PrivacyRefusal } from "@/gateway";
import { benchmarks, diagnose, type Diagnosis, type Funnel } from "@/core/diagnosis";

const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
const SHIPPED = new Set(["shipped", "delivered", "returned"]);
const DAY = 86_400_000;

const Words = z.object({
  products: z.array(z.object({ product_code: z.string(), likely_cause: z.string().max(240), proposed_action: z.string().max(240) })).max(30),
  top_decisions: z.array(z.string().max(200)).max(5),
});

export async function funnels(now = new Date()): Promise<Funnel[]> {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const from = new Date(today.getTime() - 3 * DAY);
  const out: Funnel[] = [];
  for (const p of await db.productEconomics.findMany({ select: { productCode: true } })) {
    const ads = await db.ad.findMany({ where: { adSet: { campaign: { productCode: p.productCode } } }, select: { metaId: true } });
    const ids = ads.map((a) => a.metaId);
    const ins = ids.length ? await db.insightDaily.findMany({ where: { level: "ad", objectId: { in: ids }, date: { gte: from, lt: today } } }) : [];
    const orders = await db.attributedOrder.findMany({ where: { productCode: p.productCode, isFake: false, createdAtOms: { gte: from, lt: today } }, select: { status: true, matureAt: true } });
    const mature = orders.filter((o) => o.matureAt <= now);
    const shipped = orders.filter((o) => SHIPPED.has(o.status));
    out.push({
      code: p.productCode,
      impressions: ins.reduce((n, r) => n + r.impressions, 0),
      hooks: ins.reduce((n, r) => n + r.video3s, 0),
      clicks: ins.reduce((n, r) => n + r.linkClicks, 0),
      lpv: ins.reduce((n, r) => n + r.lpv, 0),
      orders: orders.length,
      matureOrders: mature.length,
      confirmed: mature.filter((o) => CONFIRMED.has(o.status)).length,
      shipments: shipped.length,
      delivered: orders.filter((o) => o.status === "delivered").length,
      returned: orders.filter((o) => o.status === "returned").length,
    });
  }
  return out;
}

export async function analyseDay(now = new Date()): Promise<{ products: Diagnosis[]; top_decisions: string[]; by: "agent" | "code" }> {
  const fs = await funnels(now);
  const bench = benchmarks(fs);
  const products = fs.map((f) => diagnose(f, bench));
  const top = products.filter((p) => p.status === "weak").map((p) => `${p.product_code}: ${p.proposed_action}`).slice(0, 3);
  try {
    const words = await ask("M02", [
      { role: "user", content: ["هاد تشخيص الكود لكل منتج (نقطة الضعف ثابتة). أعد صياغة السبب المحتمل والإجراء المقترح بالأردني بجملة قصيرة لكل منتج، بلا أرقام. وزيد أهم 3 قرارات لليوم.", `رجّع JSON: {"products":[{"product_code":"…","likely_cause":"…","proposed_action":"…"}],"top_decisions":["…"]}`, JSON.stringify(products)].join("\n") },
    ], Words);
    for (const p of products) {
      const w = words.products.find((x) => x.product_code === p.product_code);
      // a sentence with a number in it is dropped: the numbers are the code's
      if (w && !/\d/.test(w.likely_cause)) p.likely_cause = w.likely_cause;
      if (w && !/\d/.test(w.proposed_action)) p.proposed_action = w.proposed_action;
    }
    return { products, top_decisions: words.top_decisions.filter((d) => !/\d/.test(d)).slice(0, 3).concat(top).slice(0, 3), by: "agent" };
  } catch (e) {
    if (e instanceof AgentUnavailable || e instanceof PrivacyRefusal) return { products, top_decisions: top, by: "code" };
    throw e;
  }
}

export async function storeAnalysis(now = new Date()) {
  const a = await analyseDay(now);
  const forDate = new Date(now);
  forDate.setUTCHours(0, 0, 0, 0);
  await db.report.upsert({ where: { kind_forDate: { kind: "analysis", forDate } }, create: { kind: "analysis", forDate, text: JSON.stringify(a) }, update: { text: JSON.stringify(a) } });
  return { products: a.products.length, weak: a.products.filter((p) => p.status === "weak").length, by: a.by };
}

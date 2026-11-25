/**
 * M03 — the weekly planner (spec 11.2 / 11.4), Saturdays. The allocation is computed by src/core/plan.ts; the agent
 * may rewrite each reason in plain words and add risks and creative needs — never a number. Without a model the
 * code's own reasons stand. The plan is stored as a report («plan») and shown under the reports.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { ask, AgentUnavailable, PrivacyRefusal } from "@/gateway";
import { estimateTargets } from "@/core/economics";
import { planWeek, type PlanProduct, type WeeklyPlan } from "@/core/plan";
import { isEmptyReport } from "@/core/report-empty";
import { mergeMissing, missingRateText, toUsd } from "@/core/currency";
import { gapText } from "@/core/truth-money";
import { loadRates } from "@/server/money";

const Notes = z.object({
  notes: z.array(z.object({ product_code: z.string(), reason: z.string().max(300) })).max(20),
  risks: z.array(z.string().max(300)).max(8),
  creative_needs: z.array(z.string().max(300)).max(8),
});

/**
 * The week's facts per product, and the products left out because their money cannot be worked out (v6 · P11). A product in two markets is planned on its home
 * market's profit, with the spend of every market; one with no home market, or with any spend that has no rate, is left out.
 */
export async function planRows(now = new Date()): Promise<{ products: PlanProduct[]; excluded: { code: string; why: string }[] }> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const out: PlanProduct[] = [];
  const excluded: { code: string; why: string }[] = [];
  for (const e of await db.productEconomics.findMany()) {
    const all = await db.truthDaily.findMany({ where: { level: "product", OR: [{ objectId: e.productCode }, { objectId: { startsWith: `${e.productCode}@` } }], date: { gte: since } } });
    const rows = all.filter((r) => !r.objectId || r.objectId === e.productCode);
    const why = e.moneyMissing
      ? missingRateText(e.moneyMissing.split(","))
      : gapText(...all.map((r) => r.spendMissing), ...rows.map((r) => r.moneyMissing)) ?? (all.length && !rows.length ? "بأكتر من سوق وما إله أرقام بسوقه الأساسي" : null);
    if (why) {
      excluded.push({ code: e.productCode, why });
      continue;
    }
    const delivered = rows.reduce((n, r) => n + r.delivered, 0);
    const profit = rows.reduce((n, r) => n + Number(r.profitAfterCosts), 0);
    const spend = all.reduce((n, r) => n + Number(r.spendWithFee), 0);
    const t = estimateTargets({ price: e.price.toString(), unitCost: e.unitCost.toString(), shipping: e.deliveryFee.toString(), returnFee: e.returnFee.toString(), codFee: e.codFeePct.toString(), confirmCost: e.confirmCost.toString(), confirmRate: "0.65", deliveryRate: "0.75", profitMinShare: "0.30" });
    out.push({
      code: e.productCode,
      name: e.name,
      profitPerDelivered: delivered ? Math.round((profit / delivered) * 100) / 100 : null,
      estimated: e.source !== "actual",
      // losing on paper, or already losing money on what it delivered (a few deliveries are enough to stop adding)
      losing: t.losing || (delivered >= 2 && profit < 0),
      stockDays: e.stockDays,
      tOrder: Number(t.tOrder.toFixed(2)),
      spendNow: Math.round((spend / 7) * 100) / 100,
    });
  }
  return { products: out, excluded };
}

export async function planProducts(now = new Date()): Promise<PlanProduct[]> {
  return (await planRows(now)).products;
}

export async function buildPlan(now = new Date()): Promise<WeeklyPlan & { by: "code" | "agent" }> {
  const accounts = await db.adAccount.findMany({ select: { dailyCap: true, currency: true } });
  // v6 · P11: a cap is in its account's currency; one with no rate is not added to the week's money
  const rates = await loadRates();
  const caps = accounts.map((a) => toUsd(String(a.dailyCap ?? 0), a.currency, rates));
  const dailyCap = Math.round(caps.reduce((n, c) => n + (c.usd?.toNumber() ?? 0), 0) * 100) / 100;
  const split = (await getSetting("budget.split")) as { scale: number; test: number; new: number };
  const { products, excluded } = await planRows(now);
  const plan = planWeek({ dailyCap, split, products });
  const capsMissing = mergeMissing(...caps.map((c) => (c.missing ? [c.missing] : [])));
  const said = [...(capsMissing.length ? [`${missingRateText(capsMissing)} — سقف حساب بهالعملة برّا مجموع الخطة`] : []), ...excluded.map((x) => `${x.code} برّا خطة هالأسبوع: ${x.why}`)];
  plan.risks = [...said, ...plan.risks];
  try {
    const notes = await ask("M03", [
      {
        role: "user",
        content: [
          "هاي خطة الأسبوع اللي حسبها الكود (الأرقام نهائية، ما بتتغيّر). اكتب لكل منتج سبب قصير بالأردني، وزيد مخاطر واحتياجات إبداعات إذا في.",
          `رجّع JSON: {"notes":[{"product_code":"…","reason":"…"}],"risks":["…"],"creative_needs":["…"]}`,
          JSON.stringify({ plan, products }),
        ].join("\n"),
      },
    ], Notes);
    for (const a of plan.daily_allocation) {
      const n = notes.notes.find((x) => x.product_code === a.product_code);
      if (n && !/\d/.test(n.reason)) a.reason = `${a.reason} — ${n.reason}`; // a sentence with a number in it is dropped: numbers are the code's
    }
    // the agent often repeats the code's lines with a tail added: keep the code's line, drop the repeat
    const fresh = (have: string[], extra: string[]) => extra.filter((x) => !have.some((h) => x.startsWith(h.slice(0, 24)) || h.startsWith(x.slice(0, 24))));
    plan.risks = [...plan.risks, ...fresh(plan.risks, notes.risks)].slice(0, 10);
    plan.creative_needs = [...plan.creative_needs, ...fresh(plan.creative_needs, notes.creative_needs)].slice(0, 10);
    return { ...plan, by: "agent" };
  } catch (e) {
    if (e instanceof AgentUnavailable || e instanceof PrivacyRefusal) return { ...plan, by: "code" };
    throw e;
  }
}

export async function storePlan(now = new Date()) {
  const plan = await buildPlan(now);
  const forDate = new Date(now);
  forDate.setUTCHours(0, 0, 0, 0);
  await db.report.upsert({ where: { kind_forDate: { kind: "plan", forDate } }, create: { kind: "plan", forDate, text: JSON.stringify(plan), empty: isEmptyReport("plan", JSON.stringify(plan)) }, update: { text: JSON.stringify(plan), empty: isEmptyReport("plan", JSON.stringify(plan)) } });
  return { total: plan.total_usd, lines: plan.daily_allocation.length, by: plan.by };
}

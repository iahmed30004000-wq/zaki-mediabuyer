/**
 * report.weekly (Saturday 10:00) and report.monthly (the 1st) — spec 12.2, T5.3. Built by code from the archive and
 * the truth: the period against the one before, the rankings, the reconciliation, the decisions, the tests, the
 * lessons (kept in the Lesson log) and the next week's plan. Sent to Telegram when it is linked.
 */
import { db } from "@/server/db";
import { compareWeeks, decisionAccuracy, lessonsFrom, rankBy, weeklyText, type ProductWeek, type RankRow } from "@/core/weekly";

const DAY = 86_400_000;
const utcDay = (d: Date) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};
const dateAr = (d: Date) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", day: "numeric", month: "long" }).format(d);

async function productWeeks(from: Date, to: Date): Promise<ProductWeek[]> {
  const rows = await db.truthDaily.findMany({ where: { level: "product", date: { gte: from, lt: to } } });
  const names = new Map((await db.productEconomics.findMany({ select: { productCode: true, name: true } })).map((p) => [p.productCode, p.name]));
  const by = new Map<string, ProductWeek>();
  for (const r of rows) {
    const p = by.get(r.objectId) ?? { code: r.objectId, name: names.get(r.objectId) ?? r.objectId, spend: 0, orders: 0, matureOrders: 0, confirmed: 0, shipments: 0, delivered: 0, profit: 0 };
    p.spend += Number(r.spendWithFee);
    p.orders += r.orders;
    p.matureOrders += r.matureOrders;
    p.confirmed += r.confirmed;
    p.shipments += r.shipments;
    p.delivered += r.delivered;
    p.profit += Number(r.profitAfterCosts);
    by.set(r.objectId, p);
  }
  return [...by.values()];
}

async function rankings(from: Date, to: Date): Promise<Record<string, RankRow[]>> {
  const rows = await db.truthDaily.findMany({ where: { level: "ad", date: { gte: from, lt: to } }, select: { objectId: true, spendWithFee: true, confirmed: true } });
  const ads = await db.ad.findMany({ where: { metaId: { in: [...new Set(rows.map((r) => r.objectId))] } }, select: { metaId: true, creativeCode: true, hookCode: true, angleCode: true, lpCode: true, adSet: { select: { conceptId: true, pageCode: true } } } });
  const info = new Map(ads.map((a) => [a.metaId, a]));
  const dims: Record<string, { key: string; spend: number; confirmed: number }[]> = { concept: [], angle: [], hook: [], page: [], lp: [], creative: [] };
  for (const r of rows) {
    const a = info.get(r.objectId);
    if (!a) continue;
    const v = { spend: Number(r.spendWithFee), confirmed: r.confirmed };
    if (a.adSet.conceptId) dims.concept!.push({ key: a.adSet.conceptId.startsWith("CPT") ? a.adSet.conceptId : `CPT${a.adSet.conceptId}`, ...v });
    if (a.angleCode) dims.angle!.push({ key: a.angleCode, ...v });
    if (a.hookCode) dims.hook!.push({ key: a.hookCode, ...v });
    if (a.adSet.pageCode) dims.page!.push({ key: a.adSet.pageCode, ...v });
    if (a.lpCode) dims.lp!.push({ key: a.lpCode, ...v });
    if (a.creativeCode) dims.creative!.push({ key: a.creativeCode, ...v });
  }
  return Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, rankBy(v)]));
}

export async function buildPeriodReport(kind: "weekly" | "monthly", now = new Date()) {
  const today = utcDay(now);
  let from: Date, to: Date, prevFrom: Date;
  if (kind === "weekly") {
    to = today;
    from = new Date(to.getTime() - 7 * DAY);
    prevFrom = new Date(from.getTime() - 7 * DAY);
  } else {
    to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
    from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, 1));
    prevFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
  }
  const products = compareWeeks(await productWeeks(from, to), await productWeeks(prevFrom, from));
  const ranks = await rankings(from, to);

  const insights = await db.insightDaily.aggregate({ _sum: { purchases: true }, where: { level: "ad", date: { gte: from, lt: to } } });
  const webOrders = await db.attributedOrder.count({ where: { channel: "website", isFake: false, createdAtOms: { gte: from, lt: to } } });
  // the same cohort as the truth: orders created in the period, and how many of THOSE were delivered
  const delivered = await db.attributedOrder.count({ where: { channel: "website", isFake: false, createdAtOms: { gte: from, lt: to }, OR: [{ status: "delivered" }, { deliveredAt: { not: null } }] } });

  const changes = await db.changeSet.findMany({ where: { createdAt: { gte: from, lt: to } }, select: { source: true, kind: true, state: true, approvedBy: true, executedAt: true, rolledBackAt: true } });
  const count = (f: (c: (typeof changes)[number]) => boolean) => changes.filter(f).length;
  const tests = (await db.experiment.findMany({ where: { updatedAt: { gte: from, lt: to }, status: { in: ["done", "stopped"] } }, select: { kind: true, hypothesis: true, verdict: true, setup: true } })).map((e) => `${(e.setup as { campaign?: string }).campaign ?? e.kind}: ${e.verdict ?? "بلا حكم"}`);

  const lessons = lessonsFrom({ concept: ranks.concept ?? [], angle: ranks.angle ?? [], hook: ranks.hook ?? [], page: ranks.page ?? [], lp: ranks.lp ?? [] });
  for (const l of lessons) await db.lesson.upsert({ where: { key_week: { key: l.key, week: from } }, create: { key: l.key, week: from, text: l.text, evidence: l.evidence }, update: { text: l.text, evidence: l.evidence } });

  const plan = await db.report.findFirst({ where: { kind: "plan" }, orderBy: { forDate: "desc" }, select: { text: true } });
  const planLines = plan ? (JSON.parse(plan.text) as { daily_allocation: { product_code: string; bucket: string; usd: number }[]; total_usd: number }) : null;
  const BUCKET: Record<string, string> = { scale: "تكبير", test: "اختبار", new: "جديد" };

  const text = weeklyText({
    title: kind === "weekly" ? `التقرير الأسبوعي — ${dateAr(from)} لـ ${dateAr(new Date(to.getTime() - DAY))}` : `التقرير الشهري — ${new Intl.DateTimeFormat("ar-SY-u-nu-latn", { month: "long", year: "numeric", timeZone: "UTC" }).format(from)}`,
    products,
    rankings: ranks,
    reconciliation: { pixelPurchases: insights._sum.purchases ?? 0, omsWebOrders: webOrders, delivered },
    changes: {
      auto: count((c) => c.source === "rule" && c.state === "executed"),
      approved: count((c) => c.source !== "rule" && !!c.approvedBy && c.state === "executed"),
      rejected: count((c) => c.state === "rejected"),
      rolledBack: count((c) => c.state === "rolled_back"),
      pending: count((c) => c.state === "pending_approval"),
    },
    tests,
    lessons,
    winners: (ranks.creative ?? []).filter((r) => !r.smallSample).slice(0, 3).map((r) => `${r.key} ${r.cost?.toFixed(2)}$`),
    fatigued: (await db.creativeAsset.findMany({ where: { status: "fatigued" }, select: { crCode: true }, take: 5 })).map((c) => c.crCode),
    plan: planLines ? [`${planLines.total_usd.toFixed(2)}$ باليوم`, ...planLines.daily_allocation.map((a) => `${a.product_code} ${BUCKET[a.bucket] ?? a.bucket} ${a.usd.toFixed(2)}$`)] : [],
    accuracy: kind === "monthly" ? decisionAccuracy(changes) : undefined,
  });
  return { text, from, lessons: lessons.length };
}

export async function storePeriodReport(kind: "weekly" | "monthly", now = new Date()) {
  const { text, from, lessons } = await buildPeriodReport(kind, now);
  const forDate = utcDay(now);
  await db.report.upsert({ where: { kind_forDate: { kind, forDate } }, create: { kind, forDate, text }, update: { text } });
  return { forDate, from, lessons, chars: text.length };
}

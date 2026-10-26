/**
 * rules.spend + rules.truth (spec 13.6) — gather the facts from the archive and the OMS orders, run the safety rules,
 * and turn each decision into what it means: a change set (pause / reduce, through the change service and the
 * account's autonomy level), a freeze (scaling / creating), or an alert. Alert-only decisions (a new batch) and
 * repeats inside a rule's cooldown are recorded and nothing more.
 */
import { db } from "@/server/db";
import { estimateTargets, round2 } from "@/core/economics";
import { evaluateAccount, evaluateAd, evaluateAdSet, evaluateProduct, type Decision } from "@/core/rules";
import type { ChangeItemDraft } from "@/core/changeset";
import { propose } from "@/server/changes";
import { lastSuccess } from "./runner";

const HOUR = 3_600_000;
const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);
const SHIPPED = new Set(["shipped", "delivered", "returned"]);

/** Cooldown per rule, in hours (spec 6.4); the others act once a day per target at most. */
const COOLDOWN: Partial<Record<Decision["rule"], number>> = { high_cpa: 24, spend_spike: 6, stale_data: 1 };

export async function targetsOf(productCode: string) {
  const p = await db.productEconomics.findUnique({ where: { productCode } });
  if (!p) return { tOrder: null, ceiling: null };
  const e = estimateTargets({ price: p.price.toString(), unitCost: p.unitCost.toString(), shipping: p.deliveryFee.toString(), returnFee: p.returnFee.toString(), codFee: p.codFeePct.toString(), confirmCost: p.confirmCost.toString(), confirmRate: "0.65", deliveryRate: "0.75", profitMinShare: "0.30" });
  const truth = await db.truthDaily.findFirst({ where: { level: "product", objectId: productCode, scalingCeiling: { not: null }, shipments: { gte: 1 } }, orderBy: { date: "desc" } });
  const ceiling = p.source === "actual" && truth?.scalingCeiling ? Number(truth.scalingCeiling) : round2(e.tConfirmed);
  return { tOrder: round2(e.tOrder), ceiling };
}

export async function gatherDecisions(now = new Date()) {
  const ads = await db.ad.findMany({ include: { adSet: { include: { campaign: { include: { account: true } } } } } });
  const insights = await db.insightDaily.groupBy({ by: ["objectId"], where: { level: "ad" }, _sum: { spend: true }, _min: { date: true } });
  const spendOf = new Map(insights.map((i) => [i.objectId, { spend: Number(i._sum.spend ?? 0) * 1.01, first: i._min.date }]));
  const orders = await db.attributedOrder.findMany({ select: { adId: true, productCode: true, status: true, matureAt: true, isFake: true } });
  const targets = new Map<string, Awaited<ReturnType<typeof targetsOf>>>();
  for (const code of new Set(ads.map((a) => a.adSet.campaign.productCode).filter((c): c is string => !!c))) targets.set(code, await targetsOf(code));

  const adSetSpend = new Map<string, number>();
  for (const a of ads) adSetSpend.set(a.adSetId, (adSetSpend.get(a.adSetId) ?? 0) + (spendOf.get(a.metaId)?.spend ?? 0));

  const decisions: { d: Decision; accountMetaId: string | null; context: Record<string, unknown> }[] = [];
  for (const a of ads) {
    if (a.status === "PAUSED") continue;
    const s = spendOf.get(a.metaId);
    const product = a.adSet.campaign.productCode;
    const t = product ? targets.get(product) : undefined;
    const list = orders.filter((o) => o.adId === a.metaId);
    const mature = list.filter((o) => o.matureAt <= now && !o.isFake);
    const hours = s?.first ? (now.getTime() - s.first.getTime()) / HOUR : 0;
    for (const d of evaluateAd({
      adId: a.metaId, adSetId: a.adSet.metaId, productCode: product, hoursRunning: hours, spend: s?.spend ?? 0, adSetSpend: adSetSpend.get(a.adSetId) ?? 0,
      orders: list.filter((o) => !o.isFake).length, matureOrders: mature.length, confirmedMature: mature.filter((o) => CONFIRMED.has(o.status)).length, fakeOrders: list.filter((o) => o.isFake).length,
      tOrder: t?.tOrder ?? null, ceiling: t?.ceiling ?? null, newBatch: hours < 48,
    })) decisions.push({ d, accountMetaId: a.adSet.campaign.account.metaId, context: { adName: a.name } });
  }

  // ad sets: cost per confirmed over the last 3 days without today (spec 6.4 data window)
  const from = new Date(now.getTime() - 3 * 24 * HOUR);
  const productSpend = new Map<string, number>();
  for (const a of ads) {
    const p = a.adSet.campaign.productCode;
    if (p) productSpend.set(p, (productSpend.get(p) ?? 0) + (spendOf.get(a.metaId)?.spend ?? 0));
  }
  const adsets = await db.adSet.findMany({ where: { status: { not: "PAUSED" } }, include: { ads: true, campaign: { include: { account: true } } } });
  for (const s of adsets) {
    const product = s.campaign.productCode;
    const ids = s.ads.map((x) => x.metaId);
    const spent = await db.insightDaily.aggregate({ _sum: { spend: true }, where: { level: "ad", objectId: { in: ids }, date: { gte: from } } });
    const confirmed = orders.filter((o) => o.adId && ids.includes(o.adId) && o.matureAt <= now && CONFIRMED.has(o.status)).length;
    const spend = Number(spent._sum.spend ?? 0) * 1.01;
    for (const d of evaluateAdSet({ adSetId: s.metaId, productCode: product, costPerConfirmed: confirmed ? spend / confirmed : null, ceiling: product ? targets.get(product)?.ceiling ?? null : null, productSpend: product ? productSpend.get(product) ?? 0 : 0, newBatch: false })) {
      decisions.push({ d, accountMetaId: s.campaign.account.metaId, context: { dailyBudget: Number(s.dailyBudget ?? 0) } });
    }
  }

  for (const p of await db.productEconomics.findMany()) {
    const list = orders.filter((o) => o.productCode === p.productCode && !o.isFake);
    const shipped = list.filter((o) => SHIPPED.has(o.status));
    for (const d of evaluateProduct({ productCode: p.productCode, shipments: shipped.length, returned: list.filter((o) => o.status === "returned").length, shipmentsToDate: shipped.length, stockDays: p.stockDays })) {
      decisions.push({ d, accountMetaId: null, context: {} });
    }
  }

  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const metaAt = await lastSuccess("meta.sync");
  const omsAt = await lastSuccess("oms.sync");
  const oldest = Math.min(metaAt?.getTime() ?? 0, omsAt?.getTime() ?? 0);
  for (const acc of await db.adAccount.findMany({ include: { campaigns: { include: { adsets: { include: { ads: true } } } } } })) {
    const adIds = acc.campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads.map((x) => x.metaId)));
    const t = await db.insightDaily.aggregate({ _sum: { spend: true }, where: { level: "ad", objectId: { in: adIds }, date: today } });
    const budgets = acc.campaigns.flatMap((c) => c.adsets).filter((s) => s.status !== "PAUSED").reduce((n, s) => n + Number(s.dailyBudget ?? 0), 0);
    for (const d of evaluateAccount({ accountId: acc.metaId, spendToday: Number(t._sum.spend ?? 0) * 1.01, dailyCap: acc.dailyCap ? Number(acc.dailyCap) : null, hourSpend: 0, avgHourSpend7d: 0, dailyBudgetsSum: budgets, dataAgeHours: oldest ? (now.getTime() - oldest) / HOUR : Infinity })) {
      decisions.push({ d, accountMetaId: acc.metaId, context: {} });
    }
  }
  return decisions;
}

/** The items a decision becomes. */
async function itemsFor(d: Decision, context: Record<string, unknown>): Promise<ChangeItemDraft[]> {
  if (d.level === "ad") return [{ op: "pause", objectType: "ad", objectId: d.targetId, before: { status: "ACTIVE" }, after: { status: "PAUSED" } }];
  if (d.level === "adset" && d.action === "reduce") {
    const b = Number(context.dailyBudget ?? 0);
    return b > 0 ? [{ op: "set_budget", objectType: "adset", objectId: d.targetId, before: { dailyBudget: b }, after: { dailyBudget: Math.round(b * (1 - (d.pct ?? 0.3)) * 100) / 100 } }] : [];
  }
  const campaigns = await db.campaign.findMany({
    where: { status: { not: "PAUSED" }, ...(d.level === "product" ? { productCode: d.targetId } : { account: { metaId: d.targetId } }) },
    include: { adsets: true },
  });
  if (d.action === "pause") return campaigns.map((c) => ({ op: "pause" as const, objectType: "campaign" as const, objectId: c.metaId, before: { status: c.status, dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : undefined }, after: { status: "PAUSED" } }));
  // account-wide reduce (spend spike): every active ad set −pct
  return campaigns.flatMap((c) => c.adsets.filter((s) => s.status !== "PAUSED" && Number(s.dailyBudget ?? 0) > 0).map((s) => ({ op: "set_budget" as const, objectType: "adset" as const, objectId: s.metaId, before: { dailyBudget: Number(s.dailyBudget) }, after: { dailyBudget: Math.round(Number(s.dailyBudget) * (1 - (d.pct ?? 0.3)) * 100) / 100 } })));
}

export async function runRules(now = new Date()) {
  const decisions = await gatherDecisions(now);
  const stats = { decisions: decisions.length, changes: 0, freezes: 0, alerts: 0, skipped: 0 };
  for (const { d, accountMetaId, context } of decisions) {
    const cooldown = COOLDOWN[d.rule] ?? 24;
    const recent = await db.ruleRun.findFirst({ where: { rule: d.rule, targetId: d.targetId, createdAt: { gte: new Date(now.getTime() - cooldown * HOUR) } } });
    if (recent) {
      stats.skipped++;
      continue;
    }
    let changeSetId: string | null = null;
    if (!d.alertOnly && (d.action === "pause" || d.action === "reduce")) {
      const items = await itemsFor(d, context);
      if (items.length) {
        const cs = await propose({ source: "rule", sourceRef: d.rule, reasonCode: d.reasonCode, sentence: d.sentence, kind: d.action === "pause" ? "safety_pause" : "safety_reduce", accountMetaId, items, cooldownHours: cooldown }, { type: "rule", id: d.rule });
        changeSetId = cs.id;
        stats.changes++;
      }
    } else if (!d.alertOnly && (d.action === "freeze_scale" || d.action === "freeze_create")) {
      await db.freeze.create({ data: { scope: d.level, targetId: d.targetId, kind: d.action === "freeze_scale" ? "scale" : "create", reason: d.sentence, until: new Date(now.getTime() + cooldown * HOUR) } });
      stats.freezes++;
    }
    if (d.alertOnly || d.action === "alert" || d.rule === "spend_spike" || d.rule === "high_return") {
      await db.alert.create({ data: { kind: `rule.${d.rule}`, tone: d.rule === "daily_cap" || d.rule === "spend_spike" ? "danger" : "warn", text: d.alertOnly ? `اقتراح (دفعة جديدة، تنبيه بس): ${d.sentence}` : d.sentence, href: "/decisions" } });
      stats.alerts++;
    }
    await db.ruleRun.create({ data: { rule: d.rule, level: d.level, targetId: d.targetId, action: d.action, alertOnly: d.alertOnly, sentence: d.sentence, changeSetId } });
  }
  return stats;
}

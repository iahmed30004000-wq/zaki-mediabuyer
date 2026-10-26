/**
 * rules.scale (spec 6.5, T5.2) — every hour after the safety rules: the facts of each active ad set, the ladder,
 * and a `raise_step` change set for each that passes. At level 2 it executes on its own inside the caps; at level 1
 * it waits for the owner; at level 0 it is only a suggestion (src/core/autonomy.ts). The same facts explain, on the
 * decisions screen, why a winner was NOT raised.
 */
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { propose } from "@/server/changes";
import { evaluateScale, SCALE_DEFAULTS, type ScaleDecision, type ScaleFacts } from "@/core/scale";
import { targetsOf } from "./rules-run";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);

const utcDay = (d: Date) => {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
};

export interface ScaleRow {
  adSetId: string;
  name: string;
  accountMetaId: string;
  facts: ScaleFacts;
  decision: ScaleDecision;
}

export async function gatherScale(now = new Date()): Promise<ScaleRow[]> {
  const p = {
    ...SCALE_DEFAULTS,
    proofDays: Number(await getSetting("scale.proof_days")),
    minConfirmed: Number(await getSetting("scale.min_confirmed")),
    stepPct: Number(await getSetting("scale.step_pct")),
    stepHours: Number(await getSetting("scale.step_hours")),
    maxWeekPct: Number(await getSetting("scale.max_week_pct")),
    learningGuardHours: Number(await getSetting("scale.learning_guard_hours")),
    maxStepsPerDay: Number(await getSetting("scale.max_steps_per_day")),
  };
  const productCaps = (await getSetting("scale.product_caps")) as Record<string, number>;
  const adsets = await db.adSet.findMany({ where: { status: { notIn: ["PAUSED", "ARCHIVED", "DELETED"] }, dailyBudget: { gt: 0 }, campaign: { productCode: { not: null } } }, include: { ads: true, campaign: { include: { account: true } } } });
  const today = utcDay(now);
  const weekAgo = new Date(today.getTime() - 7 * DAY);
  const freezes = await db.freeze.findMany({ where: { liftedAt: null, kind: { in: ["scale", "all"] }, OR: [{ until: null }, { until: { gt: now } }] } });
  const out: ScaleRow[] = [];

  // the product's planned daily spend: every active ad set budget of that product
  const plannedByProduct = new Map<string, number>();
  for (const s of adsets) plannedByProduct.set(s.campaign.productCode!, (plannedByProduct.get(s.campaign.productCode!) ?? 0) + Number(s.dailyBudget ?? 0));

  for (const s of adsets) {
    const product = s.campaign.productCode!;
    const t = await targetsOf(product);
    if (t.tOrder === null || t.ceiling === null) continue;
    const adIds = s.ads.map((a) => a.metaId);
    const insights = await db.insightDaily.findMany({ where: { level: "ad", objectId: { in: adIds }, date: { gte: weekAgo, lt: today } }, select: { date: true, spend: true } });
    const orders = await db.attributedOrder.findMany({ where: { adId: { in: adIds }, isFake: false, createdAtOms: { gte: weekAgo, lt: today } }, select: { createdAtOms: true, status: true, matureAt: true } });

    const daily: (number | null)[] = [];
    let confirmedMature = 0;
    for (let i = p.proofDays; i >= 1; i--) {
      const from = new Date(today.getTime() - i * DAY);
      const to = new Date(from.getTime() + DAY);
      const spend = insights.filter((x) => x.date >= from && x.date < to).reduce((n, x) => n + Number(x.spend), 0) * 1.01;
      const conf = orders.filter((o) => o.createdAtOms >= from && o.createdAtOms < to && o.matureAt <= now && CONFIRMED.has(o.status)).length;
      confirmedMature += conf;
      daily.push(conf ? Math.round((spend / conf) * 100) / 100 : null);
    }
    const spend7 = insights.reduce((n, x) => n + Number(x.spend), 0) * 1.01;
    const mature7 = orders.filter((o) => o.matureAt <= now);
    const confirmRate = mature7.length ? mature7.filter((o) => CONFIRMED.has(o.status)).length / mature7.length : null;
    const productOrders = await db.attributedOrder.findMany({ where: { productCode: product, isFake: false, createdAtOms: { gte: weekAgo, lt: today }, matureAt: { lte: now } }, select: { status: true } });
    const productConfirmRate = productOrders.length ? productOrders.filter((o) => CONFIRMED.has(o.status)).length / productOrders.length : null;

    // change history on this ad set: the learning guard, the steps of the ladder, the budget a week ago
    const history = await db.changeItem.findMany({ where: { objectId: s.metaId, changeSet: { state: { in: ["executed", "rolled_back"] } } }, include: { changeSet: true }, orderBy: { createdAt: "asc" } });
    const at = (h: (typeof history)[number]) => h.changeSet.executedAt ?? h.createdAt;
    const significant = history.filter((h) => h.op === "resume" || h.op === "set_budget" || h.op === "create");
    const lastSig = significant.length ? at(significant[significant.length - 1]!) : s.lastSignificantEditAt ?? s.createdAt;
    const raises = history.filter((h) => h.op === "set_budget" && h.changeSet.kind === "raise_step");
    const lastRaise = raises.length ? at(raises[raises.length - 1]!) : null;
    const weekRaises = raises.filter((h) => at(h) >= new Date(now.getTime() - 7 * DAY));
    const budgetWeekAgo = weekRaises.length ? Number((weekRaises[0]!.before as { dailyBudget?: number }).dailyBudget ?? s.dailyBudget) : Number(s.dailyBudget);
    const freeze = freezes.find((f) => [s.metaId, product, s.campaign.account.metaId].includes(f.targetId));
    const econ = await db.productEconomics.findUnique({ where: { productCode: product }, select: { stockDays: true } });

    const facts: ScaleFacts = {
      adSetId: s.metaId,
      productCode: product,
      dailyBudget: Number(s.dailyBudget),
      dailyCostPerConfirmed: daily,
      confirmedMature,
      cpa7: orders.length ? Math.round((spend7 / orders.length) * 100) / 100 : null,
      tOrder: t.tOrder,
      ceiling: t.ceiling,
      confirmRate,
      productConfirmRate,
      hoursSinceSignificant: (now.getTime() - lastSig.getTime()) / HOUR,
      budgetWeekAgo,
      raisesToday: raises.filter((h) => at(h) >= today).length,
      hoursSinceLastRaise: lastRaise ? (now.getTime() - lastRaise.getTime()) / HOUR : Infinity,
      frozen: freeze?.reason ?? null,
      stockDays: econ?.stockDays ?? null,
      productDailyCap: productCaps[product] ?? null,
      productDailySpendPlanned: plannedByProduct.get(product) ?? 0,
    };
    out.push({ adSetId: s.metaId, name: s.name, accountMetaId: s.campaign.account.metaId, facts, decision: evaluateScale(facts, p) });
  }
  return out;
}

export async function runScale(now = new Date()) {
  const rows = await gatherScale(now);
  const stats = { adsets: rows.length, raised: 0, waiting: 0, held: 0, skipped: 0 };
  for (const r of rows) {
    if (!r.decision.raise) {
      stats.held++;
      continue;
    }
    // one proposal per ad set per day: a raise waiting for the owner is not proposed again every hour
    const recent = await db.ruleRun.findFirst({ where: { rule: "scale", targetId: r.adSetId, createdAt: { gte: new Date(now.getTime() - 24 * HOUR) } } });
    if (recent) {
      stats.skipped++;
      continue;
    }
    const cs = await propose(
      {
        source: "rule",
        sourceRef: "scale",
        reasonCode: "S12",
        sentence: r.decision.sentence,
        kind: "raise_step",
        accountMetaId: r.accountMetaId,
        items: [{ op: "set_budget", objectType: "adset", objectId: r.adSetId, before: { dailyBudget: r.facts.dailyBudget }, after: { dailyBudget: r.decision.newBudget! } }],
        cooldownHours: 48,
      },
      { type: "rule", id: "scale" },
    );
    await db.ruleRun.create({ data: { rule: "scale", level: "adset", targetId: r.adSetId, action: "raise", alertOnly: false, sentence: r.decision.sentence, changeSetId: cs.id } });
    if (cs.state === "executed") stats.raised++;
    else stats.waiting++;
  }
  return stats;
}

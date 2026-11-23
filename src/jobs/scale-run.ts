/**
 * rules.scale (spec 6.5, T5.2) — part of the NIGHT ROUND (v6 · P10): the facts of each active ad set, the ladder, and a `raise_step`
 * change set for each that passes. Every number comes from the owner's rules (`campaign.rules`): the cost he scales at, the days of proof,
 * the step, the hours between steps, the week's limit, whether stock blocks, the cap of the running products. At level 2 it executes on its
 * own inside the caps; at level 1 it waits for the owner; at level 0 it is only a suggestion (src/core/autonomy.ts). The same facts explain,
 * on the ladder screen, why a winner was NOT raised.
 *
 * Days are Amman days (R-14); only a change Meta counts as «significant» restarts the learning guard (a +20% step is not), so the cadence is
 * the owner's 48 hours, not 72 (R-18). An ad set whose budget lives on its campaign (CBO) is not on the ladder yet.
 */
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { getRules } from "@/server/rules";
import { propose } from "@/server/changes";
import { evaluateScale, scaleParamsFrom, type ScaleDecision, type ScaleFacts } from "@/core/scale";
import { isSignificant } from "@/core/changeset";
import { breakevenOf } from "@/core/rules-v2";
import { plannedDaily } from "@/core/rulebook";
import { addDays, ammanInstant, ammanKey, keyMs } from "@/core/dates";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const CONFIRMED = new Set(["confirmed", "shipped", "delivered", "returned"]);

export interface ScaleRow {
  adSetId: string;
  name: string;
  accountMetaId: string;
  facts: ScaleFacts;
  decision: ScaleDecision;
}

const keyOf = (d: Date) => d.toISOString().slice(0, 10);

export async function gatherScale(now = new Date()): Promise<ScaleRow[]> {
  const { rules } = await getRules();
  const p = scaleParamsFrom(rules);
  if (!p) return []; // the owner has not typed the cost, the step or the week's limit: the ladder stays silent
  const fee = Number(await getSetting("economics.fx_fee")) || 0;
  const todayKey = ammanKey(now);
  const weekAgoKey = addDays(todayKey, -7);
  const todayStart = ammanInstant(todayKey, "00:00") ?? now;
  const weekAgoStart = ammanInstant(weekAgoKey, "00:00") ?? new Date(now.getTime() - 7 * DAY);

  const adsets = await db.adSet.findMany({ where: { status: { not: "PAUSED" }, dailyBudget: { gt: 0 }, campaign: { productCode: { not: null }, status: { not: "PAUSED" } } }, include: { ads: true, campaign: { include: { account: true } } } });
  const live = adsets.filter((s) => !/PAUSED|ARCHIVED|DELETED/.test(s.status) && !/PAUSED|ARCHIVED|DELETED/.test(s.campaign.status));
  const freezes = await db.freeze.findMany({ where: { liftedAt: null, kind: { in: ["scale", "all"] }, OR: [{ until: null }, { until: { gt: now } }] } });
  const out: ScaleRow[] = [];

  // what the running products (every campaign that is not a new-product test) plan per day, across the accounts
  const campaigns = await db.campaign.findMany({ include: { adsets: true } });
  const runningPlanned = plannedDaily(campaigns.filter((c) => c.stage !== "TEST").map((c) => ({ status: c.status, dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null, adsets: c.adsets.map((s) => ({ status: s.status, dailyBudget: s.dailyBudget ? Number(s.dailyBudget) : null })) })));

  for (const s of live) {
    const product = s.campaign.productCode!;
    const breakeven = breakevenOf(rules, product);
    const adIds = s.ads.map((a) => a.metaId);
    const insights = await db.insightDaily.findMany({ where: { level: "ad", objectId: { in: adIds }, date: { gte: new Date(keyMs(weekAgoKey)), lt: new Date(keyMs(todayKey)) } }, select: { date: true, spend: true } });
    const orders = await db.attributedOrder.findMany({ where: { adId: { in: adIds }, isFake: false, createdAtOms: { gte: weekAgoStart, lt: todayStart } }, select: { createdAtOms: true, status: true, matureAt: true } });

    const daily: (number | null)[] = [];
    let confirmedMature = 0;
    for (let i = p.proofDays; i >= 1; i--) {
      const key = addDays(todayKey, -i);
      const spend = insights.filter((x) => keyOf(x.date) === key).reduce((n, x) => n + Number(x.spend), 0) * (1 + fee);
      const conf = orders.filter((o) => ammanKey(o.createdAtOms) === key && o.matureAt <= now && CONFIRMED.has(o.status)).length;
      confirmedMature += conf;
      daily.push(conf ? Math.round((spend / conf) * 100) / 100 : null);
    }
    const spend7 = insights.reduce((n, x) => n + Number(x.spend), 0) * (1 + fee);
    const mature7 = orders.filter((o) => o.matureAt <= now);
    const confirmRate = mature7.length ? mature7.filter((o) => CONFIRMED.has(o.status)).length / mature7.length : null;
    const productOrders = await db.attributedOrder.findMany({ where: { productCode: product, isFake: false, createdAtOms: { gte: weekAgoStart, lt: todayStart }, matureAt: { lte: now } }, select: { status: true } });
    const productConfirmRate = productOrders.length ? productOrders.filter((o) => CONFIRMED.has(o.status)).length / productOrders.length : null;

    // change history on this ad set: the learning guard, the steps of the ladder, the budget a week ago
    const history = await db.changeItem.findMany({ where: { objectId: s.metaId, changeSet: { state: { in: ["executed", "rolled_back"] } } }, include: { changeSet: true }, orderBy: { createdAt: "asc" } });
    const at = (h: (typeof history)[number]) => h.changeSet.executedAt ?? h.createdAt;
    const significant = history.filter((h) => isSignificant({ op: h.op as "set_budget", objectType: "adset", objectId: h.objectId, before: h.before as { dailyBudget?: number }, after: h.after as { dailyBudget?: number } }) || h.op === "create");
    const lastSig = significant.length ? at(significant[significant.length - 1]!) : s.lastSignificantEditAt ?? s.startTime ?? s.createdAt;
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
      tOrder: breakeven,
      ceiling: rules.scale.maxCost!,
      confirmRate,
      productConfirmRate,
      hoursSinceSignificant: (now.getTime() - lastSig.getTime()) / HOUR,
      budgetWeekAgo,
      raisesToday: raises.filter((h) => at(h) >= todayStart).length,
      hoursSinceLastRaise: lastRaise ? (now.getTime() - lastRaise.getTime()) / HOUR : Infinity,
      frozen: freeze?.reason ?? null,
      stockDays: econ?.stockDays ?? null,
      runningCap: rules.scale.capRunning,
      runningDailyPlanned: runningPlanned,
      isTest: s.campaign.stage === "TEST",
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
    // one proposal per ad set per day: a raise waiting for the owner is not proposed again
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

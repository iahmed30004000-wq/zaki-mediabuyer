/**
 * rules (hourly) — the WATCH, not the engine (v6 · P10). Every hour it reads the account's spend of the Amman day, the planned budgets,
 * how old the data is and the orders that look fake, and raises alerts (src/core/rules.ts). It proposes nothing and changes nothing:
 * the one rulebook that writes is the night round (src/jobs/night-round.ts), reading the owner's `campaign.rules`.
 */
import { db } from "@/server/db";
import { watchAccount, watchAd, type Alert, type RuleKey } from "@/core/rules";
import { plannedDaily } from "@/core/rulebook";
import { addDays, ammanKey, keyMs } from "@/core/dates";
import { getSetting } from "@/server/settings";
import { lastSuccess } from "./runner";

const HOUR = 3_600_000;

/** How long the same alert on the same target is not repeated, in hours. */
const COOLDOWN: Record<RuleKey, number> = { daily_cap: 12, spend_spike: 6, stale_data: 6, fake_orders: 24 };

export async function gatherAlerts(now = new Date()): Promise<Alert[]> {
  const out: Alert[] = [];
  const fee = Number(await getSetting("economics.fx_fee")) || 0;
  const today = new Date(keyMs(ammanKey(now)));
  const weekAgo = new Date(keyMs(addDays(ammanKey(now), -7)));

  const orders = await db.attributedOrder.findMany({ where: { adId: { not: null }, createdAtOms: { gte: weekAgo } }, select: { adId: true, isFake: true } });
  const byAd = new Map<string, { orders: number; fake: number }>();
  for (const o of orders) {
    if (!o.adId) continue;
    const x = byAd.get(o.adId) ?? { orders: 0, fake: 0 };
    x.orders++;
    if (o.isFake) x.fake++;
    byAd.set(o.adId, x);
  }
  for (const [adId, x] of byAd) out.push(...watchAd({ adId, orders: x.orders, fakeOrders: x.fake }));

  const metaAt = await lastSuccess("meta.sync");
  const omsAt = await lastSuccess("oms.sync");
  const oldest = Math.min(metaAt?.getTime() ?? 0, omsAt?.getTime() ?? 0);
  for (const acc of await db.adAccount.findMany({ include: { campaigns: { include: { adsets: { include: { ads: true } } } } } })) {
    const adIds = acc.campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads.map((x) => x.metaId)));
    const t = await db.insightDaily.aggregate({ _sum: { spend: true }, where: { level: "ad", objectId: { in: adIds }, date: today } });
    const budgets = plannedDaily(acc.campaigns.map((c) => ({ status: c.status, dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : null, adsets: c.adsets.map((s) => ({ status: s.status, dailyBudget: s.dailyBudget ? Number(s.dailyBudget) : null })) })));
    out.push(...watchAccount({ accountId: acc.metaId, spendToday: Number(t._sum.spend ?? 0) * (1 + fee), dailyCap: acc.dailyCap ? Number(acc.dailyCap) : null, hourSpend: 0, avgHourSpend7d: 0, dailyBudgetsSum: budgets, dataAgeHours: oldest ? (now.getTime() - oldest) / HOUR : Infinity }));
  }
  return out;
}

export async function runRules(now = new Date()) {
  const alerts = await gatherAlerts(now);
  const stats = { alerts: 0, skipped: 0 };
  for (const a of alerts) {
    const recent = await db.ruleRun.findFirst({ where: { rule: a.rule, targetId: a.targetId, createdAt: { gte: new Date(now.getTime() - COOLDOWN[a.rule] * HOUR) } } });
    if (recent) {
      stats.skipped++;
      continue;
    }
    await db.alert.create({ data: { kind: `rule.${a.rule}`, tone: a.tone, text: a.sentence, href: "/inbox" } });
    await db.ruleRun.create({ data: { rule: a.rule, level: a.level, targetId: a.targetId, action: "alert", alertOnly: true, sentence: a.sentence, changeSetId: null } });
    stats.alerts++;
  }
  return stats;
}

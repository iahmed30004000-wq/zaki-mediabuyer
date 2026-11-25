/**
 * rules (hourly) — the WATCH (v6 · P10) with the safety stop back (D82, the owner's decision of 25/11/2026).
 *
 * Every hour it reads the account's spend of the Amman day, the planned daily budgets, how old the data is and the orders that look fake.
 * Two findings are acted on, both only ever lowering spend, through the change service like every other change (simulate · level · execute · verify):
 *   • daily_cap   — the day's spend reached the account's cap: every running campaign of the account is paused, and stays paused until a person
 *                   brings it back (where the site knows its budget, a resume counts as a raise and waits for approval);
 *   • spend_spike — the day's spend is above 1.75 × the planned daily budgets: every running daily budget of the account is cut by 30%.
 * Each rule acts at most ONCE per account per Amman day (a failed change is tried again, `WATCH.tries` times in all), so a cut never compounds
 * and a «رجّع» of the owner's stands. Everything else is an alert. Ads, ad sets and products are still judged by the night round alone.
 * With META_WRITE_MODE=dry_run nothing reaches Meta, and the alert says so.
 */
import { db } from "@/server/db";
import { isSafetyRule, outcomeSentence, SAFETY_ACTION, watchAccount, watchAd, WATCH, type Alert, type Held, type Outcome, type RuleKey, type SafetyRule } from "@/core/rules";
import { plannedDaily } from "@/core/rulebook";
import { addDays, ammanInstant, ammanKey, keyMs } from "@/core/dates";
import { BASE_CURRENCY, rowCurrency, sumUsd, toUsd } from "@/core/currency";
import type { ChangeItemDraft } from "@/core/changeset";
import { loadRates } from "@/server/money";
import { getSetting } from "@/server/settings";
import { propose } from "@/server/changes";
import { lastSuccess } from "./runner";

const HOUR = 3_600_000;

/** How long the same alert on the same target is not repeated, in hours. An ACTION is not held by this: it is once per Amman day. */
const COOLDOWN: Record<RuleKey, number> = { daily_cap: 12, spend_spike: 6, stale_data: 6, fake_orders: 24 };

const REASON: Record<SafetyRule, string> = { daily_cap: "S04", spend_spike: "S05" };

const isLive = (s: string) => !/PAUSED|ARCHIVED|DELETED/.test(s);
const num = (v: unknown) => (v ? Number(v) : null);
const midnightOf = (now: Date) => ammanInstant(ammanKey(now), "00:00") ?? new Date(now.getTime() - 24 * HOUR);

interface Campaign {
  metaId: string;
  status: string;
  dailyBudget: number | null;
  adsets: { metaId: string; status: string; dailyBudget: number | null; adIds: string[] }[];
}

/** What an action on one account is built from. */
export interface Watched {
  currency: string | null;
  campaigns: Campaign[];
  metaFresh: boolean;
  /** a budget of this account in dollars — null when it cannot be said (another currency with no rate) */
  inDollars: (n: number) => number | null;
}

/** The budgets that went DOWN today on Meta (live, written and read back): their higher figure is what today's spend was allowed against. */
async function higherToday(ids: string[], now: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!ids.length) return out;
  const rows = await db.changeItem.findMany({
    where: { objectId: { in: ids }, op: "set_budget", updatedAt: { gte: midnightOf(now) }, changeSet: { writeMode: "live" } },
    select: { objectId: true, before: true, after: true, verifyResult: true },
  });
  for (const r of rows) {
    const before = (r.before as { dailyBudget?: number }).dailyBudget ?? 0;
    const after = (r.after as { dailyBudget?: number }).dailyBudget ?? 0;
    if (after < before && verified(r.verifyResult)) out.set(r.objectId, Math.max(before, out.get(r.objectId) ?? 0));
  }
  return out;
}

export async function gatherAlerts(now = new Date()): Promise<{ alerts: Alert[]; accounts: Map<string, Watched> }> {
  const out: Alert[] = [];
  const accounts = new Map<string, Watched>();
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

  const rates = await loadRates();
  const metaAt = await lastSuccess("meta.sync");
  const omsAt = await lastSuccess("oms.sync");
  const oldest = Math.min(metaAt?.getTime() ?? 0, omsAt?.getTime() ?? 0);
  const metaFresh = !!metaAt && now.getTime() - metaAt.getTime() <= WATCH.staleHours * HOUR;
  for (const acc of await db.adAccount.findMany({ include: { campaigns: { include: { adsets: { include: { ads: true } } } } } })) {
    const campaigns: Campaign[] = acc.campaigns.map((c) => ({ metaId: c.metaId, status: c.status, dailyBudget: num(c.dailyBudget), adsets: c.adsets.map((s) => ({ metaId: s.metaId, status: s.status, dailyBudget: num(s.dailyBudget), adIds: s.ads.map((x) => x.metaId) })) }));
    const dollars = (n: number) => (!acc.currency || acc.currency === BASE_CURRENCY ? n : rates.has(acc.currency) ? (toUsd(n, acc.currency, rates).usd?.toDecimalPlaces(2).toNumber() ?? null) : null);
    accounts.set(acc.metaId, { currency: acc.currency ?? null, campaigns, metaFresh, inDollars: dollars });
    const adIds = campaigns.flatMap((c) => c.adsets.flatMap((s) => s.adIds));
    // the spike compares like with like: the ads under a running daily budget against the sum of those budgets
    const budgetedIds = campaigns.filter((c) => isLive(c.status)).flatMap((c) => c.adsets.filter((s) => isLive(s.status) && ((c.dailyBudget ?? 0) > 0 || (s.dailyBudget ?? 0) > 0)).flatMap((s) => s.adIds));
    const higher = await higherToday(campaigns.flatMap((c) => [c.metaId, ...c.adsets.map((s) => s.metaId)]), now);
    const atItsHighest = (id: string, budget: number | null) => (higher.has(id) ? Math.max(higher.get(id)!, budget ?? 0) : budget);
    const budgets = plannedDaily(campaigns.map((c) => ({ status: c.status, dailyBudget: atItsHighest(c.metaId, c.dailyBudget), adsets: c.adsets.map((s) => ({ status: s.status, dailyBudget: atItsHighest(s.metaId, s.dailyBudget) })) })));
    const cap = num(acc.dailyCap);
    // v6 · P11: the cap and the budgets are in the account's currency. A dollar account reads as before; another one is watched in dollars when it has a
    // rate, and in its own figures (said by name) when it has none — never its figures written with a «$»
    let money = { spend: 0, budgeted: 0, cap, budgets, unit: null as string | null };
    if (!acc.currency || acc.currency === BASE_CURRENCY) {
      const sum = async (ids: string[]) => Number((await db.insightDaily.aggregate({ _sum: { spend: true }, where: { level: "ad", objectId: { in: ids }, date: today } }))._sum.spend ?? 0);
      money.spend = await sum(adIds);
      money.budgeted = await sum(budgetedIds);
    } else {
      const rows = (await db.insightDaily.findMany({ where: { level: "ad", objectId: { in: adIds }, date: today }, select: { objectId: true, spend: true, currency: true, source: true } })).map((r) => ({ id: r.objectId, amount: String(r.spend), currency: rowCurrency(r, acc.currency) }));
      const under = new Set(budgetedIds);
      const mine = rows.filter((r) => under.has(r.id));
      const spend = sumUsd(rows, rates);
      const budgeted = sumUsd(mine, rates);
      const own = (list: typeof rows) => list.filter((r) => r.currency === acc.currency).reduce((n, r) => n + Number(r.amount), 0);
      if (spend.usd !== null && budgeted.usd !== null && rates.has(acc.currency)) money = { spend: spend.usd.toNumber(), budgeted: budgeted.usd.toNumber(), cap: cap === null ? null : dollars(cap), budgets: dollars(budgets) ?? 0, unit: null };
      else money = { spend: own(rows), budgeted: own(mine), cap, budgets, unit: acc.currency };
    }
    out.push(...watchAccount({ accountId: acc.metaId, spendToday: money.spend * (1 + fee), budgetedSpend: money.budgeted, dailyCap: money.cap, hourSpend: 0, avgHourSpend7d: 0, dailyBudgetsSum: money.budgets, unit: money.unit, dataAgeHours: oldest ? (now.getTime() - oldest) / HOUR : Infinity }));
  }
  return { alerts: out, accounts };
}

const verified = (v: unknown) => (v as { verified?: boolean } | null)?.verified === true;

/** The items a safety rule becomes: every running campaign paused, or every running daily budget cut. */
export function itemsFor(rule: SafetyRule, w: Watched, skip: Set<string> = new Set()): ChangeItemDraft[] {
  const running = w.campaigns.filter((c) => isLive(c.status));
  if (SAFETY_ACTION[rule] === "pause") {
    return running.filter((c) => !skip.has(c.metaId)).map((c) => {
      // the budget the pause takes off the day (in dollars, like every figure of a change): bringing it back then counts as the raise it is, and waits for approval
      const planned = w.inDollars(plannedDaily([c]));
      return { op: "pause", objectType: "campaign", objectId: c.metaId, before: { status: c.status, dailyBudget: planned || undefined }, after: { status: "PAUSED" } };
    });
  }
  const cut = (objectType: "campaign" | "adset", objectId: string, budget: number | null): ChangeItemDraft[] =>
    budget && budget > 0 && !skip.has(objectId) ? [{ op: "set_budget", objectType, objectId, before: { dailyBudget: budget }, after: { dailyBudget: Math.round(budget * (1 - WATCH.reducePct) * 100) / 100 } }] : [];
  return running.flatMap((c) => [...cut("campaign", c.metaId, c.dailyBudget), ...c.adsets.filter((s) => isLive(s.status)).flatMap((s) => cut("adset", s.metaId, s.dailyBudget))]);
}

/** Acts on one safety finding, or says why it did not. */
async function act(a: Alert, rule: SafetyRule, w: Watched, atCap: boolean, now: Date): Promise<{ outcome: Outcome; changeSetId: string | null }> {
  const held = (h: Held) => ({ outcome: { held: h, currency: w.currency ?? undefined } satisfies Outcome, changeSetId: null });
  const today = await db.changeSet.findMany({ where: { source: "rule", sourceRef: rule, accountMetaId: a.targetId, createdAt: { gte: midnightOf(now) } }, include: { items: true } });
  if (today.some((c) => c.state !== "failed")) return held("handled_today");
  if (today.length >= WATCH.tries) return held("gave_up");
  if (rule === "spend_spike") {
    if (atCap) return held("cap_first");
    if (w.currency && w.currency !== BASE_CURRENCY) return held("foreign_money");
    if (!w.metaFresh) return held("stale_meta");
  }
  // a second try takes only what the first did not finish: what was already cut is never cut again
  const items = itemsFor(rule, w, new Set(today.flatMap((c) => c.items.filter((i) => verified(i.verifyResult)).map((i) => i.objectId))));
  if (!items.length) return held("nothing_running");
  const pause = SAFETY_ACTION[rule] === "pause";
  const lastTry = today.length + 1 >= WATCH.tries;
  try {
    const cs = await propose(
      { source: "rule", sourceRef: rule, reasonCode: REASON[rule], sentence: `${a.sentence} ${pause ? "إيقاف حملات الحساب." : `تخفيض ميزانيات الحساب ${Math.round(WATCH.reducePct * 100)}%.`}`, kind: pause ? "safety_pause" : "safety_reduce", accountMetaId: a.targetId, items },
      { type: "rule", id: rule },
    );
    const done = (await db.changeItem.findMany({ where: { changeSetId: cs.id }, select: { verifyResult: true } })).filter((i) => verified(i.verifyResult)).length;
    return { outcome: { state: cs.state, writeMode: cs.writeMode, done, total: items.length, lastTry }, changeSetId: cs.id };
  } catch (e) {
    // one account that cannot be written must not stop the watch of the others
    console.error(`rules: ${rule} on ${a.targetId} failed`, e instanceof Error ? e.message : e);
    return { outcome: { state: "failed", writeMode: "dry_run", done: 0, total: items.length, lastTry }, changeSetId: null };
  }
}

export async function runRules(now = new Date()) {
  const { alerts, accounts } = await gatherAlerts(now);
  const atCap = new Set(alerts.filter((a) => a.rule === "daily_cap").map((a) => a.targetId));
  const stats = { alerts: 0, skipped: 0, changes: 0 };
  for (const a of alerts) {
    let sentence = a.sentence;
    let changeSetId: string | null = null;
    /** the action taken, when one was — null for an alert with nothing done */
    let done: "pause" | "reduce" | null = null;
    if (isSafetyRule(a.rule)) {
      const r = await act(a, a.rule, accounts.get(a.targetId)!, atCap.has(a.targetId), now);
      sentence = `${a.sentence} ${outcomeSentence(a.rule, r.outcome)}`;
      changeSetId = r.changeSetId;
      if (r.outcome.held === undefined) done = SAFETY_ACTION[a.rule];
    }
    // what was done is always told; a finding with nothing done is not repeated inside its cooldown
    if (!done && (await db.ruleRun.findFirst({ where: { rule: a.rule, targetId: a.targetId, createdAt: { gte: new Date(now.getTime() - COOLDOWN[a.rule] * HOUR) } } }))) {
      stats.skipped++;
      continue;
    }
    await db.alert.create({ data: { kind: `rule.${a.rule}`, tone: a.tone, text: sentence, href: "/inbox" } });
    await db.ruleRun.create({ data: { rule: a.rule, level: a.level, targetId: a.targetId, action: done ?? "alert", alertOnly: !done, sentence, changeSetId } });
    stats.alerts++;
    if (changeSetId) stats.changes++;
  }
  return stats;
}

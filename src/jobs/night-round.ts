/**
 * night.round (v6 · P10) — the ONE place where the site's rules turn into changes. Once a day, from the owner's night-round time (Amman) for a
 * few hours, it reads `campaign.rules` (what the owner edits and Claude reads), judges the last full days, and turns each decision into a change
 * set through the change service (src/server/changes.ts: simulate · level · approve · execute · verify). Then the scale ladder runs, on the same rules.
 *
 *   • it refuses to decide on stale data, and on an account whose currency is not USD (it says so, once);
 *   • spend that has no exchange rate is never read as dollars: what stands on it is held (v6 · P11), and the return stop is judged market by market;
 *   • «no orders» is a verdict only when the OMS names the ads (R-01); otherwise the pixel's purchases × his factor are the signal, and with no signal at all nothing is judged;
 *   • days are Amman days (R-14), the age of an object comes from its start time (R-13), the cost of the window is the window's, never the lifetime's (R-09);
 *   • every number he has not typed keeps its rule silent — a missing number is never a zero (R-10);
 *   • nothing here talks to Meta: a decision is a proposal, the dry-run default and the live gate live in the change service.
 */
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { getRules } from "@/server/rules";
import { propose } from "@/server/changes";
import { explainSafety } from "@/agents/monitor";
import { addDays, ammanClock, ammanInstant, ammanKey, eachDay, keyMs } from "@/core/dates";
import { breakevenOf, type CampaignRules } from "@/core/rules-v2";
import { currencyGate, dataGate, judgeAd, judgeAdSet, judgeProductReturn, nightDue, type DayFact, type Held, type NightDecision } from "@/core/rulebook";
import { WATCH } from "@/core/rules";
import { mergeMissing, missingRateText, rowCurrency, toUsd } from "@/core/currency";
import { campaignMarket, marketLabel, productMarkets, splitKey, type ProductConflict } from "@/core/markets";
import { loadRates } from "@/server/money";
import type { ChangeItemDraft } from "@/core/changeset";
import { runScale } from "./scale-run";
import { lastSuccess } from "./runner";

const HOUR = 3_600_000;
const SHIPPED = new Set(["shipped", "delivered", "returned"]);
/** The days gathered back from yesterday: the longest of the owner's windows, with room. */
const WINDOW_DAYS = 10;
/** Only orders the OMS tied to an ad are proof about that ad (an allocation is a guess). */
const AD_METHODS = ["ad_id", "naming"];

export interface NightPlan {
  decisions: NightDecision[];
  held: Held[];
  /** why the whole round did not decide (stale data); null when it did */
  gate: string | null;
}

const isLive = (s: string) => !/PAUSED|ARCHIVED|DELETED/.test(s);
const dayOf = (d: Date) => d.toISOString().slice(0, 10);

/** Everything the rulebook needs, read once, and its verdicts. Pure of side effects: nothing is proposed here. */
export async function planNight(now = new Date(), rulesIn?: CampaignRules): Promise<NightPlan> {
  const rules = rulesIn ?? (await getRules()).rules;
  const fee = Number(await getSetting("economics.fx_fee")) || 0;
  const decisions: NightDecision[] = [];
  const held: Held[] = [];

  // data first: Meta AND the OMS must have really pulled (a skipped pull is not a pull — R-06)
  const metaAt = await lastSuccess("meta.sync");
  const omsAt = await lastSuccess("oms.sync");
  const oldest = Math.min(metaAt?.getTime() ?? 0, omsAt?.getTime() ?? 0);
  const gate = dataGate(oldest ? (now.getTime() - oldest) / HOUR : Infinity, WATCH.staleHours);
  if (!gate.ok) return { decisions, held, gate: gate.why };

  const todayKey = ammanKey(now);
  const yesterday = addDays(todayKey, -1);
  const fromKey = addDays(todayKey, -WINDOW_DAYS);
  const fromAt = ammanInstant(fromKey, "00:00") ?? new Date(now.getTime() - WINDOW_DAYS * 24 * HOUR);
  const toAt = ammanInstant(todayKey, "00:00") ?? now;

  const accounts = await db.adAccount.findMany({ include: { campaigns: { include: { adsets: { include: { ads: true } } } } } });
  const adIds = accounts.flatMap((a) => a.campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads.map((x) => x.metaId))));
  const insights = await db.insightDaily.findMany({ where: { level: "ad", objectId: { in: adIds }, date: { gte: new Date(keyMs(fromKey)), lte: new Date(keyMs(yesterday)) } }, select: { objectId: true, date: true, spend: true, purchases: true, currency: true, source: true } });
  const rates = await loadRates();
  const currencyOfAd = new Map(accounts.flatMap((a) => a.campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads.map((x) => [x.metaId, a.currency] as const)))));
  /** ad → currencies of its spend with no rate */
  const noRate = new Map<string, string[]>();
  const orders = await db.attributedOrder.findMany({ where: { adId: { in: adIds }, isFake: false, method: { in: AD_METHODS }, createdAtOms: { gte: fromAt, lt: toAt } }, select: { adId: true, createdAtOms: true } });

  const days = new Map<string, Map<string, DayFact>>();
  const dayFact = (adId: string, date: string) => {
    const m = days.get(adId) ?? new Map<string, DayFact>();
    days.set(adId, m);
    const f = m.get(date) ?? { date, spend: 0, orders: 0, purchases: 0 };
    m.set(date, f);
    return f;
  };
  for (const i of insights) {
    const f = dayFact(i.objectId, dayOf(i.date));
    const dollars = toUsd(String(i.spend), rowCurrency(i, currencyOfAd.get(i.objectId)), rates);
    if (dollars.usd === null) noRate.set(i.objectId, mergeMissing(noRate.get(i.objectId), [dollars.missing!]));
    f.spend += dollars.usd?.toNumber() ?? 0;
    f.purchases += Number(i.purchases);
  }
  for (const o of orders) if (o.adId) dayFact(o.adId, ammanKey(o.createdAtOms)).orders++;
  const factsOf = (ids: string[]): DayFact[] =>
    eachDay(fromKey, yesterday).map((date) => ids.reduce<DayFact>((n, id) => {
      const f = days.get(id)?.get(date);
      return f ? { date, spend: n.spend + f.spend, orders: n.orders + f.orders, purchases: n.purchases + f.purchases } : n;
    }, { date, spend: 0, orders: 0, purchases: 0 }));

  // what the ladder did to each ad set (live only: a trial changed nothing on Meta)
  const setIds = accounts.flatMap((a) => a.campaigns.flatMap((c) => c.adsets.map((s) => s.metaId)));
  const history = await db.changeItem.findMany({ where: { objectId: { in: setIds }, op: "set_budget", changeSet: { state: "executed", writeMode: "live" } }, include: { changeSet: true }, orderBy: { createdAt: "asc" } });
  const at = (h: (typeof history)[number]) => h.changeSet.executedAt ?? h.createdAt;

  for (const acc of accounts) {
    const cur = currencyGate(acc.currency);
    if (!cur.ok) {
      held.push({ targetId: acc.metaId, level: "account", why: cur.why! });
      continue;
    }
    const accAds = acc.campaigns.flatMap((c) => c.adsets.flatMap((s) => s.ads.map((x) => x.metaId)));
    const attributionKnown = accAds.some((id) => (days.get(id) ? [...days.get(id)!.values()].some((f) => f.orders > 0) : false));
    const signalKnown = attributionKnown || accAds.some((id) => (days.get(id) ? [...days.get(id)!.values()].some((f) => f.purchases > 0) : false));

    for (const c of acc.campaigns) {
      if (!isLive(c.status)) continue;
      const product = c.productCode;
      const breakeven = breakevenOf(rules, product);
      for (const s of c.adsets) {
        if (!isLive(s.status)) continue;
        const start = s.startTime ?? c.startTime ?? s.createdAt;
        // spend that cannot be read in dollars: the ad set and its ads are held, with the currency named
        const missing = mergeMissing(...s.ads.map((x) => noRate.get(x.metaId)));
        if (missing.length) {
          held.push({ targetId: s.metaId, level: "adset", why: missingRateText(missing) });
          continue;
        }
        const setDays = factsOf(s.ads.map((x) => x.metaId));
        const mine = history.filter((h) => h.objectId === s.metaId);
        const raise = [...mine].reverse().find((h) => h.changeSet.kind === "raise_step");
        const revert = raise ? [...mine].reverse().find((h) => h.changeSet.sourceRef === "adset_revert" && at(h) > at(raise)) : undefined;
        const verdict = judgeAdSet({
          adSetId: s.metaId, name: s.name, accountMetaId: acc.metaId, productCode: product, dailyBudget: s.dailyBudget ? Number(s.dailyBudget) : null,
          ageHours: (now.getTime() - start.getTime()) / HOUR, startDay: ammanKey(start), days: setDays, attributionKnown, signalKnown, breakeven,
          lastRaise: raise ? { at: at(raise), from: Number((raise.before as { dailyBudget?: number }).dailyBudget ?? 0), to: Number((raise.after as { dailyBudget?: number }).dailyBudget ?? 0) } : null,
          lastRevertAt: revert ? at(revert) : null,
        }, rules, now, fee);
        if (verdict.held) held.push(verdict.held);
        if (verdict.decision) {
          decisions.push(verdict.decision);
          continue; // the whole ad set stops tonight: its ads are not judged one by one
        }
        // the ads of this ad set, the worst spenders first; the last active one is never stopped
        let active = s.ads.filter((x) => isLive(x.status)).length;
        const judged = s.ads.filter((x) => isLive(x.status)).map((x) => ({ x, facts: factsOf([x.metaId]) })).sort((a, b) => b.facts.reduce((n, f) => n + f.spend, 0) - a.facts.reduce((n, f) => n + f.spend, 0));
        const setSpend = factsOf(s.ads.map((x) => x.metaId)).reduce((n, f) => n + f.spend, 0) * (attributionKnown ? 1 + fee : 1);
        for (const { x, facts } of judged) {
          const adStart = x.startTime ?? s.startTime ?? x.createdAt;
          const v = judgeAd({ adId: x.metaId, name: x.name, accountMetaId: acc.metaId, adSetId: s.metaId, adSetAgeHours: (now.getTime() - start.getTime()) / HOUR, activeInAdSet: active, adSetSpend: setSpend, startDay: ammanKey(adStart), days: facts, attributionKnown, signalKnown, breakeven }, rules, fee);
          if (v.held) held.push(v.held);
          if (v.decision) {
            decisions.push(v.decision);
            active--;
          }
        }
      }
    }
  }

  // the product's return stop (the owner's share of the first N shipments), market by market for a product seen in two (v6 · P11)
  const counts = await db.attributedOrder.groupBy({ by: ["productCode", "market", "status"], where: { isFake: false }, _count: { _all: true } });
  const markets = productMarkets([...counts.map((c) => ({ code: c.productCode, market: c.market })), ...accounts.flatMap((a) => a.campaigns.map((c) => ({ code: c.productCode, market: campaignMarket(c.parsedMarket, a.market) })))], new Map());
  const byProduct = new Map<string, { code: string; market: string | null; shipments: number; returned: number }>();
  for (const c of counts) {
    const split = markets.isSplit(c.productCode);
    const key = split ? `${c.productCode}@${c.market}` : c.productCode;
    const x = byProduct.get(key) ?? { code: c.productCode, market: split ? c.market : null, shipments: 0, returned: 0 };
    if (SHIPPED.has(c.status)) x.shipments += c._count._all;
    if (c.status === "returned") x.returned += c._count._all;
    byProduct.set(key, x);
  }
  const stored = await getSetting("oms.product_conflicts");
  const clashing = new Set((Array.isArray(stored) ? (stored as ProductConflict[]) : []).filter((c) => c.kind === "catalogue").map((c) => c.code));
  for (const [key, x] of byProduct) {
    // a campaign whose market nobody knows is stopped with this market's (a stop only lowers spend), and the sentence says so
    const unplaced = x.market && accounts.some((a) => a.campaigns.some((c) => c.productCode === x.code && isLive(c.status) && !campaignMarket(c.parsedMarket, a.market)));
    const label = x.market ? `${x.code} (${marketLabel(x.market)}${unplaced ? " ومعه حملاته اللي سوقها مش معروف" : ""})` : x.code;
    const d = judgeProductReturn({ productCode: key, label, shipments: x.shipments, returned: x.returned, shipmentsToDate: x.shipments }, rules);
    if (!d) continue;
    if (clashing.has(x.code)) held.push({ targetId: x.code, level: "product", why: `رمز المنتج ${x.code} متضارب بنظام الطلبات (متجرين بنفس الرمز) — المرتجع ممكن يكون لمنتجين` });
    else decisions.push(d);
  }
  return { decisions, held, gate: null };
}

/** The items a night decision becomes. */
export async function itemsFor(d: NightDecision): Promise<ChangeItemDraft[]> {
  if (d.level === "ad") {
    const ad = await db.ad.findUnique({ where: { metaId: d.targetId } });
    return ad ? [{ op: "pause", objectType: "ad", objectId: d.targetId, before: { status: ad.status }, after: { status: "PAUSED" } }] : [];
  }
  if (d.level === "adset") {
    const s = await db.adSet.findUnique({ where: { metaId: d.targetId } });
    if (!s) return [];
    const b = s.dailyBudget ? Number(s.dailyBudget) : undefined;
    if (d.action === "reduce") return b && d.newBudget !== undefined ? [{ op: "set_budget", objectType: "adset", objectId: d.targetId, before: { dailyBudget: b }, after: { dailyBudget: d.newBudget } }] : [];
    return [{ op: "pause", objectType: "adset", objectId: d.targetId, before: { status: s.status, dailyBudget: b }, after: { status: "PAUSED" } }];
  }
  // a line of one market (`CODE@JO`) stops that market's campaigns and the ones with no market — never one known to be another market's
  const { code, suffix } = splitKey(d.targetId);
  const all = await db.campaign.findMany({ where: { status: { not: "PAUSED" }, productCode: code }, include: { account: true } });
  const campaigns = suffix ? all.filter((c) => (campaignMarket(c.parsedMarket, c.account?.market) ?? suffix) === suffix) : all;
  return campaigns.filter((c) => isLive(c.status)).map((c) => ({ op: "pause" as const, objectType: "campaign" as const, objectId: c.metaId, before: { status: c.status, dailyBudget: c.dailyBudget ? Number(c.dailyBudget) : undefined }, after: { status: "PAUSED" } }));
}

const COOLDOWN_HOURS = 24;

/** The night round: the gate and the window, the plan, the proposals, then the ladder. One acting run per Amman day. */
export async function runNight(now = new Date()) {
  const { rules } = await getRules();
  if (!nightDue(ammanClock(now), rules.nightRound)) return { acted: false, skipped: "outside the night-round window" };
  const day = ammanKey(now);
  const done = await db.jobRun.findFirst({ where: { job: "night.round", slot: { startsWith: day }, status: "ok", stats: { path: ["acted"], equals: true } } });
  if (done) return { acted: false, skipped: "already ran tonight" };

  const plan = await planNight(now, rules);
  if (plan.gate) {
    // not an acting run: the next hour of the window tries again; the owner is told once per day that the round is waiting
    const told = await db.alert.findFirst({ where: { kind: "night.waiting", createdAt: { gte: new Date(keyMs(day)) } } });
    if (!told) await db.alert.create({ data: { kind: "night.waiting", tone: "warn", text: `جولة الليل مستنية: ${plan.gate}`, href: "/inbox" } });
    return { acted: false, waiting: plan.gate };
  }

  const stats = { acted: true, decisions: plan.decisions.length, changes: 0, skipped: 0, held: plan.held.length, scale: null as unknown };
  for (const d of plan.decisions) {
    const recent = await db.ruleRun.findFirst({ where: { rule: d.rule, targetId: d.targetId, createdAt: { gte: new Date(now.getTime() - COOLDOWN_HOURS * HOUR) } } });
    if (recent) {
      stats.skipped++;
      continue;
    }
    const items = await itemsFor(d);
    if (!items.length) continue;
    const cs = await propose({ source: "rule", sourceRef: d.rule === "adset_revert" ? "adset_revert" : d.rule, reasonCode: d.reasonCode, sentence: d.sentence, kind: d.action === "pause" ? "safety_pause" : "safety_reduce", accountMetaId: d.accountMetaId, items, cooldownHours: COOLDOWN_HOURS }, { type: "rule", id: d.rule });
    stats.changes++;
    await db.ruleRun.create({ data: { rule: d.rule, level: d.level, targetId: d.targetId, action: d.action, alertOnly: false, sentence: d.sentence, changeSetId: cs.id } });
    // M01 reads the first few safety actions of the run (internal model; nothing changes on its word)
    if (cs.state === "executed" && stats.changes <= 3) await explainSafety(cs.id, [d.sentence, ...items.map((i) => `${i.op} ${i.objectType} ${i.objectId}`)]).catch(() => null);
  }
  stats.scale = await runScale(now);
  return stats;
}

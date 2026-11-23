/**
 * THE ONE RULEBOOK (v6 · P10) — the night round's judgement, pure: facts in, decisions out. The code decides; nothing here touches Meta.
 *
 * Before P10 the site had two rulebooks: the engine that wrote (an hourly job with its own fixed numbers) and the owner's rules as data
 * (`campaign.rules`, what he edits in the settings and what Claude reads). From now on the engine reads ONLY `campaign.rules`
 * (src/core/rules-v2.ts), once a day in the night round, and every decision becomes a ChangeSet. The hourly job only raises alerts
 * (src/core/rules.ts).
 *
 * The rules, in the owner's words (describeRules): judge the last full Amman days (never today) · the cost of a real order is the OMS's
 * when the OMS names the ad, else the pixel's × the factor · an ad set above its break-even for N days stops · a raised ad set that goes
 * above its break-even goes back to its old budget, then stops · a single ad stops on its spend thresholds · a new ad set is left alone
 * for a while · the ones whose number is not typed stay silent (a missing number is never a zero).
 */
import { addDays } from "./dates";
import type { CampaignRules } from "./rules-v2";
import { fmt } from "@/lib/format";

const HOUR = 3_600_000;

export type Basis = "oms" | "pixel";

/** One Amman day of one object. `spend` is Meta's raw spend; `orders` the OMS orders that day named this object; `purchases` the pixel's. */
export interface DayFact {
  date: string;
  spend: number;
  orders: number;
  purchases: number;
}

export interface CostParams {
  basis: Basis;
  /** the card / currency fee on Meta's spend (0.01 = 1%), applied on the OMS basis */
  fee: number;
  /** the owner's «real cost = pixel cost × factor», applied on the pixel basis */
  factor: number;
}

/** The cost of one real order on one day, or null when it cannot be told (no spend, or no order to divide by). */
export function dayCost(d: DayFact, p: CostParams): number | null {
  if (!(d.spend > 0)) return null;
  if (p.basis === "oms") return d.orders > 0 ? (d.spend * (1 + p.fee)) / d.orders : null;
  return d.purchases > 0 ? (d.spend / d.purchases) * p.factor : null;
}

/** «above» = spent and (no sale, or a cost over the break-even); «below» = a sale at or under it; null = nothing spent, nothing to say. */
export function dayVerdict(d: DayFact, breakeven: number, p: CostParams): "above" | "below" | null {
  if (!(d.spend > 0)) return null;
  const c = dayCost(d, p);
  if (c === null) return "above";
  return c > breakeven ? "above" : "below";
}

/** How many of the newest days, back to back, are above the break-even (a day with no spend, or a gap in the dates, ends the run). */
export function aboveStreak(days: DayFact[], breakeven: number, p: CostParams): number {
  let n = 0;
  let expect: string | null = null;
  for (const d of [...days].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    if (expect !== null && d.date !== expect) break;
    if (dayVerdict(d, breakeven, p) !== "above") break;
    n++;
    expect = addDays(d.date, -1);
  }
  return n;
}

/**
 * The days a verdict may use: only full days before today (the caller passes days up to yesterday), the day the object started is dropped
 * when the owner said «ignore the first day», and nothing older than `judgeDays` back from the newest.
 */
export function judgedDays(days: DayFact[], startDay: string | null, rules: Pick<CampaignRules, "ignoreFirstDay" | "judgeDays">, need = 0): DayFact[] {
  const keep = days.filter((d) => !(startDay && (d.date < startDay || (rules.ignoreFirstDay && d.date === startDay))));
  const sorted = [...keep].sort((a, b) => (a.date < b.date ? -1 : 1));
  return sorted.slice(-Math.max(rules.judgeDays, need));
}

// ───────────────────────────── the gates ─────────────────────────────

/** The night round is due from the owner's time (Amman) for `windowHours` — outside it nothing is changed, a late worker does not act at noon. */
export function nightDue(clock: { hour: number; minute: number }, nightRound: string, windowHours = 3): boolean {
  const [h, m] = nightRound.split(":").map(Number) as [number, number];
  const from = h! * 60 + m!;
  const at = clock.hour * 60 + clock.minute;
  const delta = (at - from + 1440) % 1440;
  return delta < windowHours * 60;
}

export interface Gate {
  ok: boolean;
  why: string | null;
}

/** Stale data stops the whole round (not for an hour: for as long as it is stale, said once per round). */
export function dataGate(dataAgeHours: number, staleHours: number): Gate {
  return dataAgeHours > staleHours ? { ok: false, why: `البيانات متأخرة ${Number.isFinite(dataAgeHours) ? Math.round(dataAgeHours) : "؟"} ساعة — ما بنقرر على أرقام قديمة` } : { ok: true, why: null };
}

/** An account whose currency is not USD is not judged: the sums would be read as dollars (R-17). */
export function currencyGate(currency: string | null | undefined): Gate {
  return (currency ?? "").toUpperCase() === "USD" ? { ok: true, why: null } : { ok: false, why: `عملة الحساب ${currency || "مش معروفة"} — الأرقام بالدولار بس، ما بنحكم عليه` };
}

// ───────────────────────────── ad set ─────────────────────────────

export interface AdSetFacts {
  adSetId: string;
  name: string;
  accountMetaId: string;
  productCode: string | null;
  dailyBudget: number | null;
  /** hours since it started delivering (its start time, else its creation) */
  ageHours: number | null;
  /** the Amman day it started, to drop that first day */
  startDay: string | null;
  /** full days up to yesterday, oldest first */
  days: DayFact[];
  /** the OMS names the ads of this account (R-01): without it, «no orders» is not a verdict */
  attributionKnown: boolean;
  /** some sales signal exists at all (an OMS order named an ad, or the pixel counted a purchase): without one, nothing is judged */
  signalKnown: boolean;
  breakeven: number | null;
  /** the last executed raise of this ad set */
  lastRaise: { at: Date; from: number; to: number } | null;
  /** the last executed revert (budget put back) after that raise */
  lastRevertAt: Date | null;
}

export type NightRule = "adset_above_breakeven" | "adset_revert" | "adset_revert_pause" | "ad_spend_no_sale" | "ad_spend_one_sale" | "ad_days_above" | "high_return";

export interface NightDecision {
  rule: NightRule;
  level: "adset" | "ad" | "product";
  targetId: string;
  accountMetaId: string | null;
  action: "pause" | "reduce";
  /** for a revert: the budget it goes back to */
  newBudget?: number;
  reasonCode: string;
  sentence: string;
}

export interface Held {
  targetId: string;
  level: "adset" | "ad" | "product" | "account";
  why: string;
}

const costParams = (f: { attributionKnown: boolean }, rules: CampaignRules, fee: number): CostParams => ({ basis: f.attributionKnown ? "oms" : "pixel", fee, factor: rules.realCostFactor });
const usd = (n: number) => fmt(n, "$");

/** The ad set's verdict tonight: one decision, or why not. */
export function judgeAdSet(f: AdSetFacts, rules: CampaignRules, now: Date, fee = 0): { decision: NightDecision | null; held: Held | null } {
  const held = (why: string) => ({ decision: null, held: { targetId: f.adSetId, level: "adset" as const, why } });
  if (rules.newAdsetFreezeHours > 0 && f.ageHours !== null && f.ageHours < rules.newAdsetFreezeHours) return held(`مجموعة جديدة (${Math.round(f.ageHours)} ساعة) — بلا تغيير ${rules.newAdsetFreezeHours} ساعة`);
  if (f.breakeven === null) return held(`نقطة تعادل ${f.productCode ?? "المنتج"} ما انكتبت`);
  if (!f.signalKnown) return held("ما في أي رقم مبيعات (لا الـ OMS ولا البكسل) — ما بنحكم");
  const p = costParams(f, rules, fee);
  const days = judgedDays(f.days, f.startDay, rules, rules.adsetPauseDays);
  const latest = [...days].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const basisNote = p.basis === "oms" ? "من طلبات الـ OMS" : `من البكسل × ${rules.realCostFactor}`;

  // a raised ad set that went above its break-even goes back to its old budget; if it is still above after the owner's hours it stops
  if (latest && dayVerdict(latest, f.breakeven, p) === "above") {
    if (f.lastRevertAt && (now.getTime() - f.lastRevertAt.getTime()) / HOUR >= rules.revert.pauseAfterHours && latest.date >= toDay(f.lastRevertAt)) {
      return { decision: { rule: "adset_revert_pause", level: "adset", targetId: f.adSetId, accountMetaId: f.accountMetaId, action: "pause", reasonCode: "S02", sentence: `اقتراح توقيف المجموعة ${f.name}: رجعت لميزانيتها القديمة وبعد ${rules.revert.pauseAfterHours} ساعة لسا فوق التعادل ${usd(f.breakeven)}.` }, held: null };
    }
    if (rules.revert.backToOldBudget && f.lastRaise && !f.lastRevertAt && f.dailyBudget !== null && f.dailyBudget > f.lastRaise.from && latest.date >= toDay(f.lastRaise.at)) {
      return { decision: { rule: "adset_revert", level: "adset", targetId: f.adSetId, accountMetaId: f.accountMetaId, action: "reduce", newBudget: f.lastRaise.from, reasonCode: "S02", sentence: `اقتراح ترجيع ميزانية ${f.name} من ${usd(f.dailyBudget)} لـ ${usd(f.lastRaise.from)}: بعد التكبير صارت فوق التعادل ${usd(f.breakeven)} (${basisNote}).` }, held: null };
    }
  }
  const run = aboveStreak(days, f.breakeven, p);
  if (rules.adsetPauseDays > 0 && run >= rules.adsetPauseDays) {
    return { decision: { rule: "adset_above_breakeven", level: "adset", targetId: f.adSetId, accountMetaId: f.accountMetaId, action: "pause", reasonCode: "S02", sentence: `اقتراح توقيف المجموعة ${f.name}: ${run} أيام ورا بعض فوق التعادل ${usd(f.breakeven)} (${basisNote}).` }, held: null };
  }
  return { decision: null, held: null };
}

const toDay = (d: Date) => d.toISOString().slice(0, 10);

// ───────────────────────────── single ad ─────────────────────────────

export interface AdFacts {
  adId: string;
  name: string;
  accountMetaId: string;
  adSetId: string;
  adSetAgeHours: number | null;
  /** how many ads of its ad set are still active, itself included: the last one is never stopped */
  activeInAdSet: number;
  /** the ad set's spend over the judged days, and the ad's own */
  adSetSpend: number;
  startDay: string | null;
  days: DayFact[];
  attributionKnown: boolean;
  signalKnown: boolean;
  breakeven: number | null;
}

/** One ad's verdict tonight, by the owner's thresholds. A threshold he has not typed keeps that check silent. */
export function judgeAd(f: AdFacts, rules: CampaignRules, fee = 0): { decision: NightDecision | null; held: Held | null } {
  const held = (why: string) => ({ decision: null, held: { targetId: f.adId, level: "ad" as const, why } });
  const r = rules.ad;
  if (f.adSetAgeHours === null || f.adSetAgeHours < r.minAdsetHours) return held(`مجموعته أقل من ${r.minAdsetHours} ساعة`);
  if (f.activeInAdSet <= 1) return held("آخر إعلان شغّال بمجموعته — ما بنوقفه");
  if (!f.signalKnown) return held("ما في أي رقم مبيعات — ما بنحكم");
  const p = costParams(f, rules, fee);
  const days = judgedDays(f.days, f.startDay, rules, r.daysAboveBreakeven);
  const spend = days.reduce((n, d) => n + d.spend, 0) * (p.basis === "oms" ? 1 + fee : 1);
  const sales = days.reduce((n, d) => n + (p.basis === "oms" ? d.orders : d.purchases), 0);
  if (r.untestedShare !== null && f.adSetSpend > 0 && spend / f.adSetSpend < r.untestedShare) return held(`«لم يُختبر»: أقل من ${Math.round(r.untestedShare * 100)}% من صرف مجموعته`);
  const base = { level: "ad" as const, targetId: f.adId, accountMetaId: f.accountMetaId, action: "pause" as const, reasonCode: "S01" };
  // «no sale» is a verdict only when the OMS names the ad (or the pixel counted) — never when nobody told us (R-01)
  if (r.spendZeroSales !== null && spend >= r.spendZeroSales && sales === 0) {
    return { decision: { ...base, rule: "ad_spend_no_sale", sentence: `اقتراح توقيف الإعلان ${f.name}: صرف ${usd(spend)} (حدّك ${usd(r.spendZeroSales)}) وما إلو ولا مبيعة.` }, held: null };
  }
  if (r.spendOneSale !== null && spend >= r.spendOneSale && sales === 1) {
    return { decision: { ...base, rule: "ad_spend_one_sale", sentence: `اقتراح توقيف الإعلان ${f.name}: صرف ${usd(spend)} (حدّك ${usd(r.spendOneSale)}) بمبيعة وحدة.` }, held: null };
  }
  if (f.breakeven !== null && r.daysAboveBreakeven > 0 && aboveStreak(days, f.breakeven, p) >= r.daysAboveBreakeven) {
    return { decision: { ...base, rule: "ad_days_above", sentence: `اقتراح توقيف الإعلان ${f.name}: ${r.daysAboveBreakeven} أيام ورا بعض فوق التعادل ${usd(f.breakeven)}.` }, held: null };
  }
  return { decision: null, held: null };
}

// ───────────────────────────── the account's budgets ─────────────────────────────

/**
 * What an account plans to spend per day: every active ad set's budget plus every active campaign budget (a CBO campaign holds its budget itself —
 * counting only ad sets read it as zero, R-03). Paused and archived objects count nothing.
 */
export function plannedDaily(campaigns: { status: string; dailyBudget: number | null; adsets: { status: string; dailyBudget: number | null }[] }[]): number {
  // Meta's effective statuses too: «CAMPAIGN_PAUSED», «ADSET_PAUSED»
  const live = (s: string) => !/PAUSED|ARCHIVED|DELETED/.test(s);
  let sum = 0;
  for (const c of campaigns) {
    if (!live(c.status)) continue;
    sum += c.dailyBudget ?? 0;
    for (const s of c.adsets) if (live(s.status)) sum += s.dailyBudget ?? 0;
  }
  return Math.round(sum * 100) / 100;
}

// ───────────────────────────── product ─────────────────────────────

export interface ProductReturnFacts {
  productCode: string;
  shipments: number;
  returned: number;
  /** shipments counted from the product's first one: the stop applies to the first `windowShipments` */
  shipmentsToDate: number;
}

/** The owner's return stop: more than his share of the first N shipments (after at least M) stops the product's test. */
export function judgeProductReturn(x: ProductReturnFacts, rules: CampaignRules): NightDecision | null {
  const r = rules.returns;
  if (x.shipmentsToDate > r.windowShipments || x.shipments < r.minShipments || x.shipments === 0) return null;
  if (x.returned / x.shipments <= r.stopShare) return null;
  return { rule: "high_return", level: "product", targetId: x.productCode, accountMetaId: null, action: "pause", reasonCode: "S03", sentence: `اقتراح توقيف ${x.productCode}: المرتجع ${fmt((x.returned / x.shipments) * 100, "%")} من أول ${x.shipments} شحنة (حدّك ${Math.round(r.stopShare * 100)}%).` };
}

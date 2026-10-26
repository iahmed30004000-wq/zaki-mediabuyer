/**
 * THE SAFETY RULES (spec 6.4) — pure: facts in, decisions out. The code decides; nothing here touches Meta.
 *
 *   • Every threshold is a ratio of the product's targets (T_order, the scaling ceiling), never a fixed number.
 *   • Data thresholds first: no verdict on an ad before it has spent 2 × T and run 48 h; an ad that got < 10% of its
 *     ad set's spend after 72 h and spent < T is «لم يُختبر» — never a loser.
 *   • A new batch (< 48 h) only ALERTS, except daily_cap, spend_spike and stock_out, which act at once.
 *   • Confirm-based rules use MATURE orders only (6.6).
 * Each decision carries the sentence the owner reads, with the numbers that triggered it.
 */
import { fmt } from "@/lib/format";

export type RuleKey =
  | "loser_no_orders"
  | "loser_no_confirmed"
  | "high_cpa"
  | "high_return"
  | "daily_cap"
  | "spend_spike"
  | "stock_out"
  | "stock_low"
  | "stale_data"
  | "fake_orders";

export type Action = "pause" | "reduce" | "freeze_scale" | "freeze_create" | "alert";
export type Level = "ad" | "adset" | "product" | "account";

export interface Decision {
  rule: RuleKey;
  level: Level;
  targetId: string;
  action: Action;
  /** for `reduce`: the share to take off (0.3 = −30%) */
  pct?: number;
  reasonCode: string;
  sentence: string;
  /** a new batch: proposed in the report, not executed */
  alertOnly: boolean;
}

export interface AdFacts {
  adId: string;
  adSetId: string;
  productCode: string | null;
  /** hours since the ad first delivered */
  hoursRunning: number;
  /** spend with the card fee, cumulative */
  spend: number;
  adSetSpend: number;
  orders: number;
  matureOrders: number;
  confirmedMature: number;
  fakeOrders: number;
  tOrder: number | null;
  ceiling: number | null;
  /** launched (or its batch) less than 48 h ago */
  newBatch: boolean;
}

export interface AdSetFacts {
  adSetId: string;
  productCode: string | null;
  costPerConfirmed: number | null;
  ceiling: number | null;
  /** the product's total spend so far (the rule waits for the first 100$) */
  productSpend: number;
  newBatch: boolean;
}

export interface ProductFacts {
  productCode: string;
  shipments: number;
  returned: number;
  /** shipments counted from the product's first one: the 32% stop applies to the first 50 */
  shipmentsToDate: number;
  stockDays: number | null;
}

export interface AccountFacts {
  accountId: string;
  spendToday: number;
  dailyCap: number | null;
  hourSpend: number;
  avgHourSpend7d: number;
  dailyBudgetsSum: number;
  /** hours since the last successful pull of Meta AND of the OMS (the older one) */
  dataAgeHours: number;
}

export const DEFAULTS = {
  loserSpendX: 2,
  loserConfirmedX: 1.5,
  minHours: 48,
  minMatureForConfirmRule: 3,
  highCpaAfterSpend: 100,
  reducePct: 0.3,
  returnStop: 0.32,
  returnWindowShipments: 50,
  returnMinShipments: 10,
  spikeHourX: 3,
  spikeDayX: 1.75,
  stockOutDays: 2,
  stockLowDays: 5,
  staleHours: 2,
  fakeShare: 0.3,
  fakeMinOrders: 10,
  untestedShare: 0.1,
  untestedHours: 72,
};
export type RuleParams = typeof DEFAULTS;

/** Rules that act even on a new batch (spec 6.4 «وضع تنبيه فقط»). */
const ALWAYS_ACT = new Set<RuleKey>(["daily_cap", "spend_spike", "stock_out"]);

const d = (rule: RuleKey, level: Level, targetId: string, action: Action, reasonCode: string, sentence: string, newBatch: boolean, pct?: number): Decision => ({
  rule,
  level,
  targetId,
  action,
  pct,
  reasonCode,
  sentence,
  alertOnly: newBatch && !ALWAYS_ACT.has(rule),
});

/** «لم يُختبر»: Meta barely spent on it — never judge it. */
export function isUntested(a: AdFacts, p: RuleParams = DEFAULTS): boolean {
  if (a.hoursRunning < p.untestedHours) return false;
  const share = a.adSetSpend > 0 ? a.spend / a.adSetSpend : 0;
  return share < p.untestedShare && (a.tOrder === null || a.spend < a.tOrder);
}

export function evaluateAd(a: AdFacts, p: RuleParams = DEFAULTS): Decision[] {
  const out: Decision[] = [];
  if (isUntested(a, p) || a.hoursRunning < p.minHours) return out;
  if (a.tOrder !== null && a.spend >= p.loserSpendX * a.tOrder && a.orders === 0) {
    out.push(d("loser_no_orders", "ad", a.adId, "pause", "S01", `وقّفت الإعلان لأنه صرف ${fmt(a.spend, "$")} (${p.loserSpendX} × هدف الطلب ${fmt(a.tOrder, "$")}) بـ ${Math.round(a.hoursRunning)} ساعة بلا ولا طلب.`, a.newBatch));
  } else if (a.ceiling !== null && a.spend >= p.loserConfirmedX * a.ceiling && a.matureOrders >= p.minMatureForConfirmRule && a.confirmedMature === 0) {
    out.push(d("loser_no_confirmed", "ad", a.adId, "pause", "S02", `وقّفت الإعلان: صرف ${fmt(a.spend, "$")} وعنده ${a.matureOrders} طلبات ناضجة وولا وحدة تأكدت.`, a.newBatch));
  }
  if (a.orders >= p.fakeMinOrders && a.fakeOrders / a.orders >= p.fakeShare) {
    out.push(d("fake_orders", "ad", a.adId, "alert", "S13", `${a.fakeOrders} من ${a.orders} طلب من هالإعلان وهمية أو أرقام غلط — بقترح نوقفه.`, a.newBatch));
  }
  return out;
}

export function evaluateAdSet(s: AdSetFacts, p: RuleParams = DEFAULTS): Decision[] {
  if (s.productSpend < p.highCpaAfterSpend || s.costPerConfirmed === null || s.ceiling === null) return [];
  // compared in whole cents, as the owner reads them: 6.234 is not «over» 6.23
  if (Math.round(s.costPerConfirmed * 100) <= Math.round(s.ceiling * 100)) return [];
  return [d("high_cpa", "adset", s.adSetId, "reduce", "S02", `خفّضت ميزانية المجموعة ${Math.round(p.reducePct * 100)}%: تكلفة المؤكد ${fmt(s.costPerConfirmed, "$")} فوق السقف ${fmt(s.ceiling, "$")}.`, s.newBatch, p.reducePct)];
}

export function evaluateProduct(x: ProductFacts, p: RuleParams = DEFAULTS): Decision[] {
  const out: Decision[] = [];
  if (x.stockDays !== null && x.stockDays < p.stockOutDays) {
    out.push(d("stock_out", "product", x.productCode, "pause", "S06", `وقّفت إعلانات ${x.productCode}: المخزون بيكفي أقل من ${p.stockOutDays} يوم.`, false));
  } else if (x.stockDays !== null && x.stockDays < p.stockLowDays) {
    out.push(d("stock_low", "product", x.productCode, "freeze_scale", "S06", `جمّدت التكبير لـ ${x.productCode}: المخزون بيكفي ${x.stockDays} أيام بس.`, false));
  }
  const inWindow = x.shipmentsToDate <= p.returnWindowShipments;
  if (inWindow && x.shipments >= p.returnMinShipments && x.returned / x.shipments > p.returnStop) {
    out.push(d("high_return", "product", x.productCode, "pause", "S03", `وقّفت اختبار ${x.productCode}: المرتجع ${fmt((x.returned / x.shipments) * 100, "%")} من أول ${x.shipments} شحنة (الحد ${Math.round(p.returnStop * 100)}%).`, false));
  }
  return out;
}

export function evaluateAccount(a: AccountFacts, p: RuleParams = DEFAULTS): Decision[] {
  const out: Decision[] = [];
  if (a.dailyCap !== null && a.spendToday >= a.dailyCap) {
    out.push(d("daily_cap", "account", a.accountId, "pause", "S04", `وصل صرف اليوم ${fmt(a.spendToday, "$")} للسقف ${fmt(a.dailyCap, "$")} — وقّفت غير المحمي لآخر اليوم.`, false));
  }
  const hourSpike = a.avgHourSpend7d > 0 && a.hourSpend > p.spikeHourX * a.avgHourSpend7d;
  const daySpike = a.dailyBudgetsSum > 0 && a.spendToday > p.spikeDayX * a.dailyBudgetsSum;
  if (hourSpike || daySpike) {
    const why = hourSpike ? `ساعة صرفت ${fmt(a.hourSpend, "$")} (المعتاد ${fmt(a.avgHourSpend7d, "$")})` : `صرف اليوم ${fmt(a.spendToday, "$")} فوق ${p.spikeDayX} × مجموع الميزانيات`;
    out.push(d("spend_spike", "account", a.accountId, "reduce", "S05", `قفزة صرف: ${why} — خفّضت 30% وبلّغتك.`, false, p.reducePct));
  }
  if (a.dataAgeHours > p.staleHours) {
    out.push(d("stale_data", "account", a.accountId, "freeze_scale", "S14", `البيانات متأخرة ${Math.round(a.dataAgeHours)} ساعات — جمّدت التكبير وقواعد الحقيقة لحد ما ترجع.`, false));
  }
  return out;
}

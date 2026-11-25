/**
 * THE HOURLY WATCH (spec 6.4, v6 · P10) — pure: facts in, ALERTS out. The code decides what is wrong; nothing here changes anything.
 *
 * Until P10 this file was a second rulebook: it paused, cut budgets and froze scaling every hour on numbers of its own. Now the only
 * rulebook that writes is the night round (src/core/rulebook.ts, reading the owner's `campaign.rules`); what is left here watches:
 *   • the account's spend today (an Amman day) against its cap — an alert, the cap is enforced where budgets are raised;
 *   • a spend spike against the budgets the account actually planned (ad sets AND campaign budgets);
 *   • stale data — said as an alert, and the night round refuses to decide on it (no freeze row that expires);
 *   • fake or wrong-number orders on one ad.
 * Every sentence says what is wrong. None says «وقّفت» / «خفّضت»: nothing was done.
 */
import { fmt, fmtExact } from "@/lib/format";

export type RuleKey = "daily_cap" | "spend_spike" | "stale_data" | "fake_orders";

export interface Alert {
  rule: RuleKey;
  level: "ad" | "account";
  targetId: string;
  tone: "danger" | "warn";
  sentence: string;
}

export interface AdWatchFacts {
  adId: string;
  orders: number;
  fakeOrders: number;
}

export interface AccountFacts {
  accountId: string;
  /** spend of the Amman day so far, raw from Meta (the fee is applied by the caller) */
  spendToday: number;
  dailyCap: number | null;
  hourSpend: number;
  avgHourSpend7d: number;
  /** what the account planned per day: every active ad set budget plus every active campaign budget */
  dailyBudgetsSum: number;
  /** hours since the last successful pull of Meta AND of the OMS (the older one) */
  dataAgeHours: number;
  /** v6 · P11: set when these figures are NOT dollars (an account of another currency with no rate): the unit the sentences write */
  unit?: string | null;
}

export const WATCH = { spikeHourX: 3, spikeDayX: 1.75, staleHours: 2, fakeShare: 0.3, fakeMinOrders: 10 };

export function watchAd(a: AdWatchFacts): Alert[] {
  if (a.orders >= WATCH.fakeMinOrders && a.fakeOrders / a.orders >= WATCH.fakeShare) {
    return [{ rule: "fake_orders", level: "ad", targetId: a.adId, tone: "warn", sentence: `${a.fakeOrders} من ${a.orders} طلب من هالإعلان وهمية أو أرقام غلط — الأحسن توقفه.` }];
  }
  return [];
}

export function watchAccount(a: AccountFacts): Alert[] {
  const out: Alert[] = [];
  const money = (n: number) => (a.unit ? `${fmtExact(n, "", 2)} ${a.unit}` : fmt(n, "$"));
  if (a.dailyCap !== null && a.spendToday >= a.dailyCap) {
    out.push({ rule: "daily_cap", level: "account", targetId: a.accountId, tone: "danger", sentence: `صرف اليوم ${money(a.spendToday)} وصل سقف الحساب ${money(a.dailyCap)}. ما انعمل شي تلقائي: وقّف من الموقع إذا بدك، أو سقف الحساب عند ميتا بيوقفه.` });
  }
  const hourSpike = a.avgHourSpend7d > 0 && a.hourSpend > WATCH.spikeHourX * a.avgHourSpend7d;
  const daySpike = a.dailyBudgetsSum > 0 && a.spendToday > WATCH.spikeDayX * a.dailyBudgetsSum;
  if (hourSpike || daySpike) {
    const why = hourSpike ? `ساعة صرفت ${money(a.hourSpend)} (المعتاد ${money(a.avgHourSpend7d)})` : `صرف اليوم ${money(a.spendToday)} فوق ${WATCH.spikeDayX} × مجموع الميزانيات ${money(a.dailyBudgetsSum)}`;
    out.push({ rule: "spend_spike", level: "account", targetId: a.accountId, tone: "danger", sentence: `قفزة صرف: ${why}. ما انعمل شي تلقائي — شوف الحساب.` });
  }
  if (a.dataAgeHours > WATCH.staleHours) {
    out.push({ rule: "stale_data", level: "account", targetId: a.accountId, tone: "warn", sentence: `البيانات متأخرة ${Number.isFinite(a.dataAgeHours) ? Math.round(a.dataAgeHours) : "؟"} ساعات — جولة الليل ما بتقرر على أرقام قديمة لحد ما ترجع.` });
  }
  return out;
}
